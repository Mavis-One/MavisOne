/**
 * AS MIGRAÇÕES — ler, ordenar e conferir. Num lugar só.
 *
 * Três programas precisam das mesmas respostas sobre banco/migrations/:
 *
 *   scripts/verificar-migracoes.js ... o que falta no banco?
 *   scripts/aplicar-migracoes.js ..... aplique o que falta
 *   scripts/gerar-sql-do-zero.js ..... junte tudo, na ordem certa
 *
 * Enquanto cada um tinha a sua cópia, a primeira correção feita de um lado
 * ficava de fora do outro — e este arquivo já custou duas vezes por isso:
 *
 *   1. o regex de colunas exigia "alter table IF EXISTS", e a fase-v escreve
 *      "alter table regra_fiscal add column". Ela deixava de declarar as duas
 *      colunas do DIFAL, virava "sem estrutura a conferir" e o verificador
 *      anunciava BANCO EM DIA com a tela de Regras Fiscais quebrada por baixo.
 *
 *   2. a ordem. 'fase-aa' vem ANTES de 'fase-h' em qualquer listagem de pasta,
 *      e aplicar nessa ordem tenta alterar tabela que ainda não foi criada. O
 *      gerador do zero já sabia disso; o verificador não precisava saber, mas o
 *      aplicador precisa — e ia herdar o `.sort()` cru se ninguém juntasse.
 */
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'banco', 'migrations');

/**
 * A ORDEM DAS FASES NÃO É A ORDEM ALFABÉTICA.
 *
 * As fases vão de `h` a `z` e seguem em `aa`, `ab`, … `cd`, `ce` — como coluna
 * de planilha. Uma letra vem sempre antes de duas; dentro do mesmo tamanho, é
 * alfabética. Quebrada, esta regra só aparece como "relation does not exist" no
 * meio de um arquivo de quatro mil linhas, num banco novo, provavelmente no dia
 * em que alguém está com pressa.
 */
function ordenarPorFase(nomes) {
  const letras = (nome) => {
    const m = /^fase-([a-z]+)-/i.exec(nome);
    return m ? m[1].toLowerCase() : null;
  };
  return nomes.slice().sort((a, b) => {
    const la = letras(a);
    const lb = letras(b);
    if (!la && !lb) return a.localeCompare(b);
    if (!la) return 1;
    if (!lb) return -1;
    if (la.length !== lb.length) return la.length - lb.length;
    return la.localeCompare(lb);
  });
}

/**
 * Lê os arquivos e extrai o que cada um promete criar.
 *
 * `if exists` e `if not exists` são OPCIONAIS no regex de propósito — ver o
 * caso 1 no cabeçalho. São 24 comandos na forma sem guarda espalhados pelas
 * migrações, todos invisíveis enquanto o regex os exigia.
 */
function lerMigracoes() {
  const nomes = fs.readdirSync(DIR).filter((nome) => nome.endsWith('.sql'));
  return ordenarPorFase(nomes).map((nome) => {
    const caminho = path.join(DIR, nome);
    const sql = fs.readFileSync(caminho, 'utf8');
    const colunas = [...sql.matchAll(/alter\s+table\s+(?:if\s+exists\s+)?(\w+)\s+add\s+column\s+(?:if\s+not\s+exists\s+)?(\w+)/gi)]
      .map((m) => ({ tabela: m[1], coluna: m[2] }));
    const tabelas = [...sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(\w+)/gi)].map((m) => m[1]);
    // Arquivo que só junta outras migrações para colar de uma vez. Contá-lo
    // somaria as mesmas colunas duas vezes e mandaria rodar o pacote E as
    // partes — foi o que aconteceu na primeira versão do verificador.
    const consolidado = /^--\s*CONSOLIDADO/im.test(sql);
    const superada = /SUPERADA PELA/i.test(sql);
    return {
      nome,
      caminho,
      sql,
      colunas,
      tabelas,
      consolidado,
      superada,
      // O que o aplicador roda: nem o pacote (repetiria as partes) nem a
      // superada (foi substituída por outra que já está na fila).
      aplicavel: !consolidado && !superada
    };
  });
}

/**
 * Confere contra o banco o que cada migração promete.
 *
 * As sondas entram por parâmetro para este arquivo não depender do cliente do
 * banco — assim ele é testável sem banco no ar, e quem chama decide como
 * pergunta "isto existe?".
 *
 * Devolve TRÊS listas, e a terceira é o ponto:
 *
 *   aplicadas ...... tudo que ela promete está no banco
 *   pendentes ...... falta alguma coisa
 *   naoConferidas .. ela não declara tabela nem coluna, então este código NÃO
 *                    TEM COMO SABER se rodou. É estado legítimo (migração que
 *                    só insere dado, só cria índice ou trigger) e não é erro —
 *                    mas não pode sair com a mesma cara de "está certo". A
 *                    versão anterior somava as duas coisas e imprimia BANCO EM
 *                    DIA: uma garantia que ela não tinha.
 */
async function conferir({ existeTabela, existeColuna }) {
  const migracoes = lerMigracoes();
  const aplicadas = [];
  const pendentes = [];
  const naoConferidas = [];

  for (const migracao of migracoes) {
    if (migracao.consolidado) continue;
    const faltando = [];

    for (const tabela of [...new Set(migracao.tabelas)]) {
      if (!(await existeTabela(tabela))) faltando.push(`tabela ${tabela}`);
    }
    for (const { tabela, coluna } of migracao.colunas) {
      // Coluna de tabela que nem existe já foi contada acima.
      if (migracao.tabelas.includes(tabela)) continue;
      if (!(await existeTabela(tabela))) continue;
      if (!(await existeColuna(tabela, coluna))) faltando.push(`${tabela}.${coluna}`);
    }

    const total = migracao.tabelas.length + migracao.colunas.length;
    const estado = migracao.superada ? 'SUPERADA'
      : !total ? 'NÃO CONFERIDA'
        : faltando.length === 0 ? 'APLICADA'
          : `PENDENTE (${faltando.length} de ${total} faltando)`;

    const registro = { ...migracao, faltando, total, estado };
    if (migracao.superada) aplicadas.push(registro);
    else if (!total) naoConferidas.push(registro);
    else if (faltando.length) pendentes.push(registro);
    else aplicadas.push(registro);
  }

  return { migracoes, aplicadas, pendentes, naoConferidas };
}

module.exports = { DIR, ordenarPorFase, lerMigracoes, conferir };
