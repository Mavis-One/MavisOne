#!/usr/bin/env node
// A SESSÃO NO BANCO, E AS GUARDAS QUE PARARAM DE DERRUBAR O PROCESSO (fase CL).
//
// O QUE ISTO PROTEGE, e por que existe como teste e não como leitura de código:
//
// Em 16/09/2026 o escritório relatou que ninguém ficava conectado mais de dez
// minutos, com a tela dizendo "Não autenticado". Não havia prazo de dez minutos
// em lugar nenhum — a sessão vale até a meia-noite. O que havia era o processo
// reiniciando, e dois objetos em memória morrendo com ele: o de quem está
// logado e o do MOTIVO de quem caiu. Sem o segundo, o servidor responde 401 sem
// `motivo`, e a tela só volta ao login quando tem um motivo para mostrar.
//
// São três propriedades, e nenhuma delas se vê lendo o arquivo:
//
//   1. o token NÃO é gravado — vai o SHA-256 dele. O banco sai da máquina nos
//      backups, e token em texto num backup é credencial viva num drive;
//   2. abrir sessão e derrubar as outras é UMA operação. Pela metade, ou a
//      pessoa fica sem nada, ou ficam duas sessões vivas do mesmo usuário —
//      a regra de sessão única violada em silêncio;
//   3. encerrar não apaga a linha: 'logout', 'fim-do-dia' e 'outro-dispositivo'
//      ficam gravados, porque é deles que sai a frase que a tela mostra.
//
// Não precisa de Postgres: o dublê abaixo implementa as seis consultas que
// lib/db/sessoes.js faz, e só elas — dublê que responde a tudo esconde a
// mudança que deveria ter quebrado o teste.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const RAIZ = path.join(__dirname, '..');
const ler = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');
// A ORDEM IMPORTA, e descobri isso quebrando: tirar os blocos `/* */` primeiro
// engole código de verdade. O server.js tem uma linha de comentário `//` que
// cita "public/modules/**", e dentro dela mora um `/*` — que pareia com o `*/`
// do PRÓXIMO comentário de bloco e leva as 30 linhas entre os dois, inclusive
// as que este teste confere. Removendo as linhas `//` antes, o `/*` de dentro
// delas vai embora junto e o pareamento dos blocos volta a bater.
const semComentarios = (s) => s.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};

function dublar(caminho, exports) {
  const resolvido = require.resolve(caminho);
  require.cache[resolvido] = { id: resolvido, filename: resolvido, loaded: true, children: [], paths: [], exports };
}

// ---------------------------------------------------------------------------
// O "BANCO": uma lista de linhas de `sessoes`.
// ---------------------------------------------------------------------------
let linhas = [];
let falharNoProximoInsert = false;
let tabelaNaoExiste = false;
const hash = (t) => crypto.createHash('sha256').update(String(t), 'utf8').digest();
const mesmoHash = (a, b) => Buffer.compare(a, b) === 0;

async function consultar(sql, params = []) {
  // A mensagem é a do Postgres, literal: é por ela que o código reconhece o
  // caso, e um texto aproximado aqui faria o teste passar com um `if` que a
  // produção não dispara.
  if (tabelaNaoExiste) throw new Error('relation "sessoes" does not exist');
  const texto = String(sql).replace(/\s+/g, ' ').trim();

  if (/^insert into sessoes/.test(texto)) {
    if (falharNoProximoInsert) throw new Error('insert falhou de propósito');
    const linha = {
      token_hash: params[0], user_id: params[1],
      criada_em: new Date().toISOString(), expira_em: params[2],
      encerrada_em: null, motivo: null, ip: params[3]
    };
    linhas.push(linha);
    return { rows: [linha] };
  }
  if (/^select .* from sessoes where token_hash = \$1/.test(texto)) {
    const achada = linhas.find((l) => mesmoHash(l.token_hash, params[0]));
    return { rows: achada ? [achada] : [] };
  }
  // Encerrar UMA (logout, virada): casa por token e só se estiver viva.
  if (/^update sessoes .* where token_hash = \$1 and encerrada_em is null/.test(texto)) {
    const alvo = linhas.filter((l) => mesmoHash(l.token_hash, params[0]) && !l.encerrada_em);
    alvo.forEach((l) => { l.encerrada_em = new Date().toISOString(); l.motivo = params[1]; });
    return { rows: alvo.map((l) => ({ token_hash: l.token_hash })) };
  }
  // Derrubar as do usuário (sessão única).
  if (/^update sessoes .* where user_id = \$1 and encerrada_em is null/.test(texto)) {
    const alvo = linhas.filter((l) => l.user_id === params[0] && !l.encerrada_em);
    alvo.forEach((l) => { l.encerrada_em = new Date().toISOString(); l.motivo = params[1]; });
    return { rows: alvo.map((l) => ({ token_hash: l.token_hash })) };
  }
  // Varredura, passo 1: o que venceu.
  if (/^update sessoes .* where encerrada_em is null and expira_em <= now\(\)/.test(texto)) {
    const agora = Date.now();
    const alvo = linhas.filter((l) => !l.encerrada_em && new Date(l.expira_em).getTime() <= agora);
    alvo.forEach((l) => { l.encerrada_em = new Date().toISOString(); l.motivo = 'fim-do-dia'; });
    return { rows: alvo.map((l) => ({ token_hash: l.token_hash })) };
  }
  // Varredura, passo 2: o histórico velho.
  if (/^delete from sessoes where encerrada_em is not null/.test(texto)) {
    const limite = Date.now() - Number(params[0]) * 60 * 60 * 1000;
    const apagar = linhas.filter((l) => l.encerrada_em && new Date(l.encerrada_em).getTime() < limite);
    linhas = linhas.filter((l) => !apagar.includes(l));
    return { rows: apagar.map((l) => ({ token_hash: l.token_hash })) };
  }
  throw new Error(`consulta não prevista no dublê: ${texto}`);
}

// A transação de verdade: desfaz tudo se o callback estourar. É o que permite
// conferir que abrirUnica não deixa meio-estado.
async function emTransacao(callback) {
  const antes = linhas.map((l) => ({ ...l }));
  try {
    return await callback({ query: consultar });
  } catch (erro) {
    linhas = antes;
    throw erro;
  }
}

dublar('../lib/db/conexao', { consultar, emTransacao });
const sessoes = require('../lib/db/sessoes');

const UMA_HORA = 60 * 60 * 1000;

(async () => {
  console.log('--- 1. o token não é gravado; o hash é ---');
  const token = 'token-de-256-bits-fingido-para-o-teste';
  await sessoes.abrirUnica({ token, userId: 'user-a', expiraEm: Date.now() + UMA_HORA, ip: '10.0.0.7' });
  const gravada = linhas[0];
  const comoTexto = JSON.stringify(linhas, (k, v) => (Buffer.isBuffer(v) ? v.toString('hex') : v));
  check('o token não aparece em nenhuma coluna', !comoTexto.includes(token));
  check('o que está na chave é o SHA-256 dele', mesmoHash(gravada.token_hash, hash(token)));
  check('  32 bytes', gravada.token_hash.length === 32, String(gravada.token_hash.length));
  // Sem isto, "não gravou o token" poderia significar "não gravou nada".
  check('e a sessão é encontrável pelo token', (await sessoes.buscar(token))?.userId === 'user-a');
  check('token que ninguém emitiu não encontra nada', (await sessoes.buscar('inventado')) === null);
  // O mapa em memória herdava de Object.prototype e respondia algo truthy para
  // '__proto__'. A consulta parametrizada não tem herança para consultar.
  check('  nem os nomes do protótipo de objeto', (await sessoes.buscar('__proto__')) === null);
  check('o ip nasce gravado, para a auditoria', gravada.ip === '10.0.0.7');

  console.log('\n--- 2. sessão única por usuário, numa transação ---');
  linhas = [];
  await sessoes.abrirUnica({ token: 'maquina-a', userId: 'user-a', expiraEm: Date.now() + UMA_HORA });
  await sessoes.abrirUnica({ token: 'outro-dono', userId: 'user-b', expiraEm: Date.now() + UMA_HORA });
  const segunda = await sessoes.abrirUnica({ token: 'maquina-b', userId: 'user-a', expiraEm: Date.now() + UMA_HORA });
  check('a entrada nova derrubou uma máquina', segunda.derrubadas === 1, String(segunda.derrubadas));
  const a = await sessoes.buscar('maquina-a');
  check('a máquina A está encerrada', Boolean(a.encerradaEm));
  check('  e sabe dizer por quê', a.motivo === 'outro-dispositivo', a.motivo);
  check('a máquina B está viva', (await sessoes.buscar('maquina-b')).encerradaEm === null);
  // Derrubar por usuário e não por token: a sessão de outra pessoa não é da
  // conta desta entrada.
  check('a sessão de OUTRO usuário não foi tocada', (await sessoes.buscar('outro-dono')).encerradaEm === null);

  console.log('\n--- 3. pela metade, não: ou vale o login inteiro, ou nada muda ---');
  // Se derrubar valesse e abrir falhasse, a pessoa ficaria sem sessão nenhuma:
  // expulsa da máquina antiga e sem entrar na nova.
  falharNoProximoInsert = true;
  let estourou = false;
  try {
    await sessoes.abrirUnica({ token: 'maquina-c', userId: 'user-a', expiraEm: Date.now() + UMA_HORA });
  } catch (_) { estourou = true; }
  falharNoProximoInsert = false;
  check('o login falhou', estourou);
  check('e a sessão que ele ia derrubar continua viva', (await sessoes.buscar('maquina-b')).encerradaEm === null);
  check('  sem deixar a nova pela metade', (await sessoes.buscar('maquina-c')) === null);

  console.log('\n--- 4. o motivo não é reescrito por quem chega depois ---');
  linhas = [];
  await sessoes.abrirUnica({ token: 'so-minha', userId: 'user-a', expiraEm: Date.now() + UMA_HORA });
  check('o logout encerra', (await sessoes.encerrar('so-minha', 'logout')) === true);
  check('  com o motivo certo', (await sessoes.buscar('so-minha')).motivo === 'logout');
  // Sem o `encerrada_em is null` no WHERE, a varredura que passasse depois
  // trocaria 'logout' por 'fim-do-dia' e a tela explicaria a coisa errada.
  check('encerrar de novo não faz nada', (await sessoes.encerrar('so-minha', 'fim-do-dia')) === false);
  check('  e o motivo original fica', (await sessoes.buscar('so-minha')).motivo === 'logout');

  console.log('\n--- 5. a varredura: vencer é diferente de esquecer ---');
  linhas = [];
  await sessoes.abrirUnica({ token: 'de-ontem', userId: 'user-a', expiraEm: Date.now() - UMA_HORA });
  await sessoes.abrirUnica({ token: 'de-hoje', userId: 'user-b', expiraEm: Date.now() + UMA_HORA });
  const varrida = await sessoes.varrer();
  check('venceu uma', varrida.expiradas === 1, String(varrida.expiradas));
  // A linha FICA, com o motivo: quem deixou a tela aberta na sexta precisa ler
  // "o dia virou" na segunda, e não "Não autenticado".
  check('a vencida continua no banco, encerrada', (await sessoes.buscar('de-ontem'))?.motivo === 'fim-do-dia');
  check('a de hoje não foi tocada', (await sessoes.buscar('de-hoje')).encerradaEm === null);

  const velha = linhas.find((l) => l.motivo === 'fim-do-dia');
  velha.encerrada_em = new Date(Date.now() - 13 * UMA_HORA).toISOString();
  const limpeza = await sessoes.varrer();
  check('encerrada há mais de 12h é apagada', limpeza.limpas === 1, String(limpeza.limpas));
  check('  e some mesmo', (await sessoes.buscar('de-ontem')) === null);
  check('a viva continua lá', (await sessoes.buscar('de-hoje')) !== null);

  console.log('\n--- 5b. o deploy que sobe o código antes da migração ---');
  // Acontece uma vez, e o sintoma sem isto é o pior possível: ninguém entra, e
  // a tela diz "Erro interno no servidor (código a1b2c3)". Quem está no VPS com
  // o escritório parado precisa da frase, não de uma caça ao log.
  tabelaNaoExiste = true;
  const capturar = async (fn) => { try { await fn(); return null; } catch (e) { return e; } };
  const erroBusca = await capturar(() => sessoes.buscar('qualquer'));
  const erroLogin = await capturar(() => sessoes.abrirUnica({ token: 'x', userId: 'user-a', expiraEm: Date.now() }));
  tabelaNaoExiste = false;
  check('a busca explica o que fazer', /migracoes:aplicar/.test(erroBusca?.message || ''), erroBusca?.message);
  check('  com 503, não 500', erroBusca?.status === 503, String(erroBusca?.status));
  check('o login também', /migracoes:aplicar/.test(erroLogin?.message || ''));
  check('  e cita o arquivo da migração', /fase-cl-sessao-no-banco/.test(erroLogin?.message || ''));

  // -------------------------------------------------------------------------
  // O LADO DO SERVIDOR. Aqui é leitura de código de propósito: o que se afirma
  // é a AUSÊNCIA de um jeito de errar, e ausência não se exercita chamando.
  // -------------------------------------------------------------------------
  console.log('\n--- 6. o servidor não guarda mais sessão na memória dele ---');
  const servidor = ler('server.js');
  const codigo = semComentarios(servidor);
  check('o mapa em memória não existe mais', !/let sessions = Object\.create\(null\)/.test(codigo));
  check('  nem sobrou leitura dele', !/sessions\[/.test(codigo));
  check('  nem o mapa de encerradas', !/sessoesEncerradas/.test(codigo));
  check('a sessão vem do banco', /db\.sessoes\.buscar\(/.test(codigo));
  check('o login abre a sessão única numa transação', /db\.sessoes\.abrirUnica\(/.test(codigo));
  check('o logout encerra com motivo', /db\.sessoes\.encerrar\(token, 'logout'\)/.test(codigo));
  // Uma consulta por ponto que precisa da sessão seriam duas por requisição.
  check('e a consulta é lembrada por requisição', /const sessaoLembrada = new WeakMap\(\)/.test(codigo));

  console.log('\n--- 7. uma requisição que falha não derruba o servidor ---');
  // ERA o modo de falha principal: `createServer(async ...)` devolve uma Promise
  // que o Node ignora, e rejeição sem dono encerra o processo.
  check('o handler é uma função com nome', /async function tratarRequisicao\(req, res\)/.test(codigo));
  check('  e quem chama tem catch', /tratarRequisicao\(req, res\)\.catch\(/.test(codigo));
  check('  o erro sai pelo caminho que não vaza', /sendErro\(res, erro, 'Erro interno no servidor', 500\)/.test(codigo));
  // Responder JSON de erro por cima de um corpo já começado entrega os dois
  // colados ao cliente.
  check('  e não tenta responder duas vezes', /res\.headersSent \|\| res\.writableEnded/.test(codigo));

  console.log('\n--- 8. as guardas de processo, e a diferença entre as duas ---');
  check('anota Promise rejeitada sem dono', /process\.on\('unhandledRejection'/.test(codigo));
  check('anota exceção não capturada', /process\.on\('uncaughtException'/.test(codigo));
  const guardaRejeicao = (/process\.on\('unhandledRejection',[\s\S]*?\n\}\);/.exec(codigo) || [''])[0];
  const guardaExcecao = (/process\.on\('uncaughtException',[\s\S]*?\n\}\);/.exec(codigo) || [''])[0];
  // A assimetria é a decisão: `catch` esquecido não corrompe nada, e derrubar o
  // servidor por isso é trocar um bug pequeno por uma parada geral.
  check('rejeição sem dono NÃO encerra o processo', !/process\.exit/.test(guardaRejeicao));
  // Exceção não capturada estourou em lugar desconhecido: seguir servindo é
  // servir de um estado que ninguém conferiu. Sair só ficou barato porque a
  // sessão agora sobrevive ao reinício.
  check('exceção não capturada encerra, para subir limpo', /process\.exit\(1\)/.test(guardaExcecao));
  // A varredura é `async` dentro de setInterval: sem try/catch, ela mesma
  // viraria a rejeição sem dono que este conserto veio eliminar.
  check('a varredura periódica não pode derrubar nada', /await db\.sessoes\.varrer\(\);\s*\n\s*\} catch/.test(codigo));

  console.log(`\n===== ${falhas === 0 ? 'TODOS OS CHECKS PASSARAM' : falhas + ' FALHA(S)'} =====`);
  process.exit(falhas ? 1 : 0);
})().catch((erro) => {
  console.error('erro inesperado no teste:', erro);
  process.exit(1);
});
