// Prazo de 24 horas para cancelar NF-e.
//
// A janela conta da AUTORIZAÇÃO, não da emissão: a nota pode ficar minutos —
// ou horas, quando o webhook não chega — entre transmitida e autorizada, e é a
// autorização que a SEFAZ registra.
//
// O que este teste protege:
//   1. a conta em si, inclusive nas bordas (23h59, exatamente 24h, 24h01);
//   2. nota SEM data de autorização não pode ser bloqueada por falta de dado;
//   3. a trava existir no SERVIDOR, não só no botão;
//   4. tela e servidor lerem a MESMA regra, do mesmo arquivo.
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const ler = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};

const prazo = require('../public/modules/shared/prazo_cancelamento');

const AUTORIZACAO = new Date('2026-08-17T10:00:00Z');
const maisHoras = (h) => new Date(AUTORIZACAO.getTime() + h * 3600000);

console.log('--- a janela é de 24 horas, contadas da autorização ---');
check('24 horas é o prazo declarado', prazo.HORAS === 24, String(prazo.HORAS));
check('logo após autorizar, dá para cancelar', prazo.avaliar(AUTORIZACAO, maisHoras(0.01)).dentroDoPrazo);
check('com 23h59 ainda dá', prazo.avaliar(AUTORIZACAO, maisHoras(23.98)).dentroDoPrazo);
// Borda exata: 24h00 ainda vale. Empurrar para fora um cancelamento no minuto
// exato seria negar por arredondamento algo que a SEFAZ aceita.
check('exatamente 24h ainda vale', prazo.avaliar(AUTORIZACAO, maisHoras(24)).dentroDoPrazo);
check('24h e um minuto NÃO vale', prazo.avaliar(AUTORIZACAO, maisHoras(24.02)).dentroDoPrazo === false);
check('uma semana depois, não vale', prazo.avaliar(AUTORIZACAO, maisHoras(168)).dentroDoPrazo === false);

console.log('\n--- o motivo diz o que aconteceu e qual é a saída ---');
const vencido = prazo.avaliar(AUTORIZACAO, maisHoras(50));
check('cita as 24 horas', /24 horas/.test(vencido.motivo));
check('diz quanto tempo passou', /2 dias/.test(vencido.motivo), vencido.motivo.slice(0, 90));
// Botão desligado sem caminho a seguir é beco sem saída.
check('e aponta o extemporâneo como saída', /extempor/i.test(vencido.motivo));
check('em horas quando ainda é pouco', /26 horas/.test(prazo.avaliar(AUTORIZACAO, maisHoras(26)).motivo));

console.log('\n--- falta de dado não pode virar bloqueio ---');
// Nota recém-autorizada cujo carimbo ainda não voltou do webhook seria
// bloqueada para sempre se "sem data" fosse lido como "prazo vencido".
[null, undefined, '', 'nao-e-data'].forEach((valor) => {
  const r = prazo.avaliar(valor, maisHoras(999));
  check(`autorizadoEm ${JSON.stringify(valor)} não bloqueia`, r.dentroDoPrazo === true && r.semReferencia === true);
});
// Relógio do cliente adiantado não pode vencer uma nota do futuro.
check('data de autorização no futuro não vence', prazo.avaliar(maisHoras(5), AUTORIZACAO).dentroDoPrazo);

console.log('\n--- a trava vive no SERVIDOR, não só no botão ---');
// Botão desabilitado é conforto: a rota continua aberta para qualquer chamada.
const serverSrc = ler('server.js');
check('o servidor carrega a MESMA regra do navegador',
  /require\('\.\/public\/modules\/shared\/prazo_cancelamento'\)/.test(serverSrc));
const cancelamento = serverSrc.slice(
  serverSrc.indexOf('async function cancelarNfeFiscal'),
  serverSrc.indexOf('async function emitirCartaCorrecaoFiscal'));
check('a rota de cancelar avalia o prazo', /prazoCancelamento\.avaliar\(nfe\.autorizadoEm\)/.test(cancelamento));
check('e recusa quando venceu', /!prazo\.dentroDoPrazo && !opcoes\.extemporaneo/.test(cancelamento));
// 409 (conflito de estado), não 400: o pedido está bem formado, o que mudou
// foi o tempo.
check('devolve 409, não 400', /err\.status = 409/.test(cancelamento));
check('a mensagem devolvida é a da regra', /new Error\(prazo\.motivo\)/.test(cancelamento));
// Sem declaração explícita, o extemporâneo seria adivinhado pelo prazo — e a
// trava não travaria nada.
check('extemporâneo precisa vir declarado no corpo', /extemporaneo: body\.extemporaneo === true/.test(serverSrc));
check('e a tela declara', /extemporaneo: opcoes\.extemporaneo === true/.test(ler('public/modules/finance/subs/nfe_emitidas.js')));

console.log('\n--- a tela desliga o botão com o motivo ---');
const acoesSrc = ler('public/modules/finance/nfe_actions.js');
check('a ação Cancelar consulta a regra', /MavisPrazoCancelamento/.test(acoesSrc));
check('e devolve o motivo como bloqueio', /prazo\.dentroDoPrazo \? true : prazo\.motivo/.test(acoesSrc));
// Registro manual do Financeiro nunca foi à SEFAZ: não tem prazo dela.
check('registro manual não é afetado', /ctx\.nfe\.origem !== 'fiscal'\) return true/.test(acoesSrc));
// Espelho: o extemporâneo só faz sentido DEPOIS do prazo.
check('o extemporâneo só aparece depois do prazo', /ainda está dentro das 24 horas/.test(acoesSrc));
// Sem o campo, a tela não teria como decidir.
check('a lista manda autorizadoEm', /autorizadoEm: nfe\.autorizadoEm \|\| ''/.test(serverSrc));
check('o banco lê a coluna', /autorizadoEm: row\.autorizado_em/.test(ler('lib/db/fiscal.js')));
check('o index.html carrega a regra', /shared\/prazo_cancelamento\.js/.test(ler('public/index.html')));

console.log('\n--- o gate real das ações, com data velha e data nova ---');
// Não basta conferir o texto do arquivo: o que importa é o que motivoBloqueio
// devolve. Carrega o catálogo com um `window` de mentira, igual ao
// test-nfe-actions.js, e com a regra pendurada nele — que é como o navegador
// vai encontrá-la.
global.window = { MavisPrazoCancelamento: prazo };
(0, eval)(ler('public/modules/finance/nfe_actions.js'));
const A = global.window.MavisNfeActions;

const agora = new Date();
const horasAtras = (h) => new Date(agora.getTime() - h * 3600000).toISOString();
const nota = (over = {}) => ({ id: 'n1', number: '2', status: 'autorizada', origem: 'fiscal', ...over });
function motivo(id, nfe) {
  const ctx = {
    selecionadas: [nfe], nfe, apiFiscalConfigurada: true,
    escapeHtml: (s) => s, showToast() {}, print() {}, cancelar() {}, duplicar() {}, irParaVenda() {},
    baixarArquivo() {}, baixarLote() {}, cartaCorrecao() {}, consultarStatus() {}, statusServico() {}, limparSelecao() {}
  };
  return A.motivoBloqueio(A.CATALOG.find((a) => a.id === id), ctx);
}

const recente = nota({ autorizadoEm: horasAtras(2) });
check('nota de 2h: Cancelar liberado', motivo('cancelar', recente) === null, motivo('cancelar', recente) || 'liberado');
check('e o extemporâneo bloqueado', /ainda está dentro das 24 horas/.test(motivo('cancelamento_extemporaneo', recente) || ''));

const velha = nota({ autorizadoEm: horasAtras(30) });
const bloqueio = motivo('cancelar', velha);
check('nota de 30h: Cancelar BLOQUEADO', Boolean(bloqueio), bloqueio || 'XX LIBEROU');
check('  com o motivo do prazo', /24 horas/.test(bloqueio || ''));
check('e o extemporâneo liberado', motivo('cancelamento_extemporaneo', velha) === null,
  motivo('cancelamento_extemporaneo', velha) || 'liberado');

// Registro manual do Financeiro não foi à SEFAZ: prazo dela não se aplica.
const manual = nota({ origem: 'financeiro', autorizadoEm: horasAtras(500) });
check('registro manual antigo continua cancelável', motivo('cancelar', manual) === null,
  motivo('cancelar', manual) || 'liberado');

// Sem carimbo, a tela não decide sozinha — quem recusa é a SEFAZ.
const semData = nota({ autorizadoEm: '' });
check('sem data de autorização, não bloqueia', motivo('cancelar', semData) === null,
  motivo('cancelar', semData) || 'liberado');

console.log(`\n===== ${falhas === 0 ? 'TODOS OS CHECKS PASSARAM' : falhas + ' FALHA(S)'} =====`);
process.exit(falhas ? 1 : 0);
