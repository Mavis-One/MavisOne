/**
 * ONDE A SESSÃO DE LOGIN MORA (fase CL).
 *
 * Antes desta fase: dois objetos na memória do processo em server.js — um com
 * quem está logado, outro com o motivo de quem caiu. Funcionava perfeitamente
 * até o processo reiniciar, e aí deslogava todo mundo de uma vez sem conseguir
 * explicar a ninguém por quê. O porquê inteiro, com o que foi medido, está na
 * migração banco/migrations/fase-cl-sessao-no-banco.sql.
 *
 * O CONTRATO É O MESMO DE ANTES, de propósito: as funções aqui devolvem e
 * aceitam os mesmos campos que o mapa em memória tinha ({ userId, criadaEm,
 * expiraEm }), e a REGRA de quando uma sessão vence continua sendo só de
 * lib/sessao.js. Este arquivo é o armazém; ele não decide quando algo expira.
 *
 * SQL CRU, e não o construtor de consultas de ./client: as operações daqui
 * precisam do número exato de linhas afetadas (quantas máquinas foram
 * derrubadas) e de fazer leitura-e-escrita numa ida só. `returning` dá as duas
 * coisas; o construtor precisaria de um select antes de cada update, e entre um
 * e outro caberia outra requisição.
 */
const crypto = require('crypto');
const { consultar, emTransacao } = require('./conexao');

// Doze horas, o mesmo que o mapa em memória guardava. Ver a migração.
const LEMBRAR_ENCERRADA_HORAS = 12;

/**
 * O que vai para o banco é o HASH, nunca o token.
 *
 * SHA-256 sem sal é a escolha certa aqui e a razão está na migração: o token
 * são 256 bits de `crypto.randomBytes`, então não há dicionário nem
 * força-bruta a defender — e bcrypt custaria ~100ms em toda requisição, porque
 * o portão de acesso procura a sessão a cada chamada.
 */
function hashDoToken(token) {
  return crypto.createHash('sha256').update(String(token || ''), 'utf8').digest();
}

/**
 * A TABELA AINDA NÃO EXISTE — e isso acontece exatamente uma vez, no deploy que
 * sobe este código antes de rodar a migração.
 *
 * Sem esta tradução, o sintoma seria: ninguém consegue entrar, e a tela diz
 * "Erro interno no servidor (código a1b2c3)". O código está no log, mas quem
 * está no VPS às 8h da manhã com o escritório parado precisa da FRASE, não de
 * uma caça ao log. É a mesma convenção que lib/db/auth.js já usa para as
 * colunas de migração pendente.
 *
 * 503 e não 500: é indisponibilidade temporária com conserto conhecido.
 */
function traduzirFaltaDaTabela(erro) {
  if (erro && /relation "sessoes" does not exist/i.test(erro.message || '')) {
    const err = new Error(
      'A tabela de sessões ainda não existe no banco. Rode as migrações no servidor: '
      + 'npm run migracoes:aplicar (cria banco/migrations/fase-cl-sessao-no-banco.sql).'
    );
    err.status = 503;
    return err;
  }
  return erro;
}

/**
 * Converte a linha do banco no formato que o server.js sempre usou.
 *
 * `criadaEm` e `expiraEm` voltam em MILISSEGUNDOS porque é o que
 * lib/sessao.js/sessaoExpirou compara (contra Date.now()) e o que a resposta
 * do login manda para a tela agendar a própria saída. Devolver Date aqui
 * faria cada ponto de uso lembrar de converter, e o que esquecesse comparia
 * um Date com um número — que em JavaScript não dá erro, dá `false`.
 */
function mapSessaoRow(row) {
  if (!row) return null;
  return {
    userId: row.user_id,
    criadaEm: new Date(row.criada_em).getTime(),
    expiraEm: new Date(row.expira_em).getTime(),
    encerradaEm: row.encerrada_em ? new Date(row.encerrada_em).getTime() : null,
    motivo: row.motivo || null
  };
}

/**
 * Abre a sessão do login e derruba as outras do mesmo usuário, NUMA TRANSAÇÃO.
 *
 * As duas coisas juntas são a regra de sessão única por usuário, e o motivo de
 * serem uma operação só é o que acontece se elas falharem no meio:
 *
 *   derrubar → (falha) → não abrir  = a pessoa foi expulsa da outra máquina e
 *                                     não entrou nesta. Fica sem nada.
 *   abrir → (falha) → não derrubar  = duas sessões vivas do mesmo usuário. A
 *                                     regra foi violada EM SILÊNCIO, que é o
 *                                     pior jeito de uma regra de acesso falhar.
 *
 * Com BEGIN/COMMIT nenhum dos dois estados existe: ou o login inteiro valeu, ou
 * nada mudou e a sessão antiga continua servindo.
 *
 * `expiraEm` em ms (o que proximaViradaDeDia devolve). Devolve a sessão criada e
 * quantas máquinas caíram, que é o que a auditoria do login registra.
 */
async function abrirUnica({ token, userId, expiraEm, ip = null, motivo = 'outro-dispositivo' }) {
  try {
    return await abrirUnicaSemTraduzir({ token, userId, expiraEm, ip, motivo });
  } catch (erro) {
    throw traduzirFaltaDaTabela(erro);
  }
}

async function abrirUnicaSemTraduzir({ token, userId, expiraEm, ip, motivo }) {
  return emTransacao(async (cliente) => {
    const { rows: derrubadas } = await cliente.query(
      `update sessoes
          set encerrada_em = now(), motivo = $2
        where user_id = $1
          and encerrada_em is null
       returning token_hash`,
      [userId, motivo]
    );
    const { rows } = await cliente.query(
      `insert into sessoes (token_hash, user_id, expira_em, ip)
       values ($1, $2, $3, $4)
       returning user_id, criada_em, expira_em, encerrada_em, motivo`,
      [hashDoToken(token), userId, new Date(expiraEm).toISOString(), ip]
    );
    return { sessao: mapSessaoRow(rows[0]), derrubadas: derrubadas.length };
  });
}

/**
 * A sessão deste token, viva ou encerrada.
 *
 * Devolve a encerrada TAMBÉM, e é o ponto da fase: é a linha encerrada que
 * permite responder "sua conta entrou em outro dispositivo" em vez de "Não
 * autenticado". Quem chama distingue pelo `encerradaEm`.
 */
async function buscar(token) {
  try {
    const { rows } = await consultar(
      `select user_id, criada_em, expira_em, encerrada_em, motivo
         from sessoes
        where token_hash = $1`,
      [hashDoToken(token)]
    );
    return mapSessaoRow(rows[0]);
  } catch (erro) {
    throw traduzirFaltaDaTabela(erro);
  }
}

/**
 * Encerra ESTA sessão. Devolve true se ela estava viva e foi encerrada agora.
 *
 * `encerrada_em is null` no WHERE não é decoração: sem ele, encerrar duas vezes
 * reescreveria o motivo, e o segundo motivo apagaria o primeiro — quem caiu por
 * login em outra máquina passaria a ler "fim do dia" se a varredura chegasse
 * depois.
 */
async function encerrar(token, motivo) {
  const { rows } = await consultar(
    `update sessoes
        set encerrada_em = now(), motivo = $2
      where token_hash = $1
        and encerrada_em is null
     returning token_hash`,
    [hashDoToken(token), motivo]
  );
  return rows.length > 0;
}

/**
 * A varredura periódica, em dois passos com propósitos diferentes:
 *
 *   1. marca como 'fim-do-dia' o que já passou da virada e ninguém mais usou.
 *      Sem isto, quem deixou a tela aberta na sexta voltaria na segunda e
 *      receberia "Não autenticado" em vez da frase que explica a meia-noite.
 *   2. apaga o que está encerrado há mais de 12h. É o que impede a tabela de
 *      crescer para sempre — o mesmo peso que a regra da virada do dia existia
 *      para tirar quando as sessões viviam em memória.
 *
 * A comparação do passo 1 é com `now()` do BANCO, e não do Node. Os dois são o
 * mesmo instante absoluto (a coluna é timestamptz), então não há divergência
 * de fuso a acertar — e uma varredura em lote não tem por que trazer milhares
 * de linhas para o Node só para comparar data.
 */
async function varrer() {
  const { rows: expiradas } = await consultar(
    `update sessoes
        set encerrada_em = now(), motivo = 'fim-do-dia'
      where encerrada_em is null
        and expira_em <= now()
     returning token_hash`
  );
  const { rows: limpas } = await consultar(
    `delete from sessoes
      where encerrada_em is not null
        and encerrada_em < now() - ($1 || ' hours')::interval
     returning token_hash`,
    [String(LEMBRAR_ENCERRADA_HORAS)]
  );
  return { expiradas: expiradas.length, limpas: limpas.length };
}

module.exports = {
  hashDoToken, abrirUnica, buscar, encerrar, varrer, LEMBRAR_ENCERRADA_HORAS
};
