#!/usr/bin/env node
// Trilha de auditoria — emissão, cancelamento, CC-e e inutilização de NF-e.
//
// POR QUE ISTO IMPORTA MAIS DO QUE O RESTO DA AUDITORIA
// -----------------------------------------------------
// A trilha vivia em `data/db.json`: arquivo no disco local do servidor. Para
// um documento fiscal, esse é o pior lugar possível — é a ÚNICA prova de quem
// emitiu, quem cancelou e com que justificativa, e sumia junto com a máquina.
// A tabela `audit_logs` e as funções addAuditLog/getAuditLogs existiam desde o
// começo e nunca tinham sido ligadas.
//
// O que este teste guarda:
//   1. nenhuma ação fiscal voltar a gravar no arquivo;
//   2. a falha de gravação NÃO derrubar a operação — quando este código roda,
//      a nota já foi transmitida à SEFAZ, e lançar aqui não desfaz nada;
//   3. o registro que falhou não sumir: cai no arquivo local e continua
//      aparecendo na tela, marcado;
//   4. cancelamento e inutilização levarem a justificativa junto — sem ela o
//      registro só diz que alguém fez algo.
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const ler = (p) => fs.readFileSync(path.join(RAIZ, p), 'utf8').replace(/\r\n/g, '\n');

const serverSrc = ler('server.js');
const settingsSrc = ler('lib/db/settings.js');
const schemaSrc = ler('banco/schema.sql');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};

console.log('--- nada fiscal grava mais no arquivo local ---');
const escritas = [...serverSrc.matchAll(/data\.auditLogs\.push\(/g)];
// A única sobrevivente é a queda de emergência dentro de registrarAuditoria.
check('sobrou exatamente uma gravação em arquivo', escritas.length === 1, `${escritas.length} ocorrência(s)`);
const registrar = serverSrc.slice(serverSrc.indexOf('async function registrarAuditoria'), serverSrc.indexOf('async function addFinanceAuditLog'));
check('e ela está dentro do fallback', /data\.auditLogs\.push\(/.test(registrar));
check('marcada como pendente de sincronia', /pendenteDeSincronia: true/.test(registrar));

console.log('\n--- toda ação fiscal passa pelo ponto único ---');
const ACOES = [
  ['emitirNfeFiscal', 'emissão'],
  ['cancelarNfeFiscal', 'cancelamento'],
  ['emitirCartaCorrecaoFiscal', 'carta de correção'],
  ['inutilizarNumeracaoFiscal', 'inutilização de numeração']
];
ACOES.forEach(([acao, rotulo]) => {
  check(`${rotulo} registra`, new RegExp(`registrarAuditoria\\(\\{[\\s\\S]{0,200}action: '${acao}'`).test(serverSrc)
    || new RegExp(`action: '${acao}'`).test(serverSrc));
  check(`  ${rotulo} não usa mais o arquivo`,
    !new RegExp(`data\\.auditLogs\\.push\\([\\s\\S]{0,120}${acao}`).test(serverSrc));
});

console.log('\n--- o que o fisco pergunta depois fica gravado ---');
// "Alguém cancelou uma nota" não serve: a justificativa é exigência da SEFAZ e
// é o que explica a decisão meses depois.
check('cancelamento guarda a justificativa', /action: 'cancelarNfeFiscal'[\s\S]{0,220}details: \{ justificativa \}/.test(serverSrc));
check('carta de correção guarda o texto', /action: 'emitirCartaCorrecaoFiscal'[\s\S]{0,220}details: \{ correcao \}/.test(serverSrc));
check('inutilização guarda a faixa e o motivo', /action: 'inutilizarNumeracaoFiscal'[\s\S]{0,400}numeroInicial,\s*numeroFinal,\s*justificativa/.test(serverSrc));

console.log('\n--- falhar a auditoria não pode desfazer a operação ---');
// Quando este código roda, a nota JÁ está na SEFAZ. Propagar o erro faria a
// rota responder falha para uma emissão que aconteceu.
check('registrarAuditoria não propaga o erro', /catch \(error\) \{[\s\S]{0,200}console\.error\('Falha ao gravar auditoria/.test(registrar));
check('não há throw dentro dela', !/\bthrow\b/.test(registrar));
check('e o fallback também é protegido', /catch \(erroLocal\)/.test(registrar));

console.log('\n--- os chamadores esperam a gravação ---');
// addFinanceAuditLog virou async: sem await, a gravação corre solta e pode
// ficar pelo caminho quando a resposta já foi enviada.
const semAwait = [...serverSrc.matchAll(/(?<!await )addFinanceAuditLog\(/g)]
  .filter((m) => !serverSrc.slice(Math.max(0, m.index - 30), m.index).includes('function'));
check('toda chamada de addFinanceAuditLog tem await', semAwait.length === 0, `${semAwait.length} sem await`);
// `async function registrarAuditoria` e `return registrarAuditoria(` não
// contam: o primeiro é a definição, e devolver a promessa de dentro de uma
// função async é aguardar no chamador, que já usa await.
const semAwaitReg = [...serverSrc.matchAll(/(?<!await |function |return )registrarAuditoria\(\{/g)];
check('toda chamada de registrarAuditoria tem await', semAwaitReg.length === 0, `${semAwaitReg.length} sem await`);
check('o retorno de promessa está numa função async',
  /async function addFinanceAuditLog[\s\S]{0,200}return registrarAuditoria\(/.test(serverSrc));

console.log('\n--- a leitura vem do banco, sem esconder o que falhou ---');
const rota = serverSrc.slice(serverSrc.indexOf("const logs = ") - 1200, serverSrc.indexOf('pendentesDeSincronia') + 200);
check('lê do Supabase', /db\.getAuditLogs\(\{ limit, offset \}\)/.test(serverSrc));
check('não lê a lista inteira do arquivo', !/const logs = \(data\.auditLogs \|\| \[\]\)\.slice\(\)\.reverse\(\)/.test(serverSrc));
// Ignorar os pendentes esconderia justamente o registro que quase se perdeu.
check('mostra também os pendentes de sincronia', /log\.pendenteDeSincronia/.test(serverSrc));
check('e informa quantos são', /pendentesDeSincronia: pendentes\.length/.test(serverSrc));
check('falha de leitura não derruba a tela', /Falha ao ler auditoria do Supabase/.test(serverSrc));

console.log('\n--- a camada de banco está pronta ---');
check('addAuditLog existe', /async function addAuditLog\(/.test(settingsSrc));
check('getAuditLogs existe', /async function getAuditLogs\(/.test(settingsSrc));
check('as duas são exportadas', /module\.exports = \{[^}]*addAuditLog[^}]*getAuditLogs/.test(settingsSrc));
check('db.js espalha settings', /\.\.\.settings/.test(ler('db.js')));
check('a tabela existe no schema', /create table if not exists audit_logs/.test(schemaSrc));
// details jsonb é o que permite guardar justificativa e faixa inutilizada.
check('a tabela tem details jsonb', /details jsonb/.test(schemaSrc));

console.log(`\n===== ${falhas === 0 ? 'TODOS OS CHECKS PASSARAM' : falhas + ' FALHA(S)'} =====`);
process.exit(falhas ? 1 : 0);
