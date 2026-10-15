// A tela de emissão de NF-e: os blocos, o botão Emitir único e o que acontece
// ao clicar nele com campo obrigatório em branco.
//
// ERA test-emissao-abas.js. Desde 15/10/2026 a emissão é uma página só, em
// blocos (pedido do usuário: "faça a mesma coisa que você fez com a edição de
// produtos na tela de emissão de NF e retire o botão emitir NF de todas as
// abas e deixe apenas um geral no canto superior direito").
//
// Provado no navegador (servidor local, NF-e avulsa, emissão bloqueada no
// próprio navegador para nada ir à Focus): oito blocos e nenhuma aba; um só
// "Emitir NF-e", no topo; digitar o item fez Impostos e Totais aparecerem
// sozinhos (ICMS R$ 51,00 sobre R$ 300,00); frete de R$ 20 levou o total a
// R$ 320,00 e a modalidade a CIF, com o cursor ficando no Frete; Emitir com o
// logradouro em branco rolou até ele, com a bolha do navegador e o aviso
// "Falta preencher em "Destinatário"".
//
// Os dois defeitos de 17/08/2026 que o teste antigo vigiava continuam aqui:
//
//   1. Faltava a ABERTURA do painel dos itens: a tag de fechamento sem par
//      fechava o div.panel antes da hora, e pagamento e observações caíam para
//      FORA do <form> — a nota saía com o padrão sem ninguém pedir.
//   2. Campo obrigatório em branco fazia o Emitir não produzir NADA (estava
//      numa aba escondida). Em blocos o campo está na página, mas longe do
//      botão, que agora fica no topo.
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const ler = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};

const src = ler('public/modules/finance/subs/emitir_nfe_focus.js');
const css = ler('public/app.css');

console.log('--- uma página só, em blocos, na ordem das antigas abas ---');
const blocos = [...src.matchAll(/data-bloco="([a-z_]+)">\s*<h4 class="nfe-bloco-titulo">([^<]+)<\/h4>/g)].map((m) => `${m[1]}:${m[2]}`);
console.log(`    blocos: ${blocos.join(', ')}`);
check('os nove blocos com título (o de complemento só na nota complementar)', JSON.stringify(blocos) === JSON.stringify([
  'emitente:Emitente', 'destinatario:Destinatário', 'complemento:Complemento de ICMS', 'itens:Itens', 'impostos:Impostos',
  'transporte:Transporte', 'pagamento:Pagamento', 'totais:Totais', 'observacoes:Observações'
]));
check('nenhuma aba sobrou', !/cadastro-tab|data-tab-panel|data-tab=/.test(src));
check('nenhum bloco nasce escondido', !/class="nfe-bloco"[^>]*hidden/.test(src));
check('os blocos têm o visual dos do cadastro de produto', /\.nfe-bloco \{\s*display: grid; gap: 14px;\s*padding: 16px 18px;\s*border: 1px solid var\(--border\);\s*border-radius: 14px;/.test(css));

console.log('\n--- as tags do formulário fecham certo ---');
// O defeito 1 era exatamente isto: uma tag de fechamento a mais. Contar é
// grosseiro, mas pega o caso que aconteceu — e o estrago dele era invisível na
// leitura, porque o HTML "parecia" certo.
const inicioForm = src.indexOf('<form id="nfeFocusForm"');
const fimForm = src.indexOf('</form>', inicioForm);
check('achei o formulário', inicioForm > -1 && fimForm > inicioForm, `${inicioForm}..${fimForm}`);
const formulario = src.slice(inicioForm, fimForm).replace(/<!--[\s\S]*?-->/g, '');
['div', 'section'].forEach((tag) => {
  const abre = (formulario.match(new RegExp(`<${tag}\\b`, 'g')) || []).length;
  const fecha = (formulario.match(new RegExp(`</${tag}>`, 'g')) || []).length;
  check(`abre e fecha o mesmo tanto de ${tag}`, abre === fecha, `${abre} aberturas, ${fecha} fechamentos`);
});

console.log('\n--- a tabela de itens mora DENTRO do bloco dela ---');
const blocoItens = src.indexOf('data-bloco="itens"');
const tabelaItens = src.indexOf('id="nfeFocusItemsBody"');
const blocoSeguinte = src.indexOf('data-bloco="impostos"');
check('o bloco de itens existe', blocoItens > -1);
check('e a tabela está entre ele e o seguinte', blocoItens < tabelaItens && tabelaItens < blocoSeguinte, `itens ${blocoItens}, tabela ${tabelaItens}, impostos ${blocoSeguinte}`);

console.log('\n--- os campos de pagamento e observações ficam no formulário ---');
// Se caírem para fora, o FormData os ignora em silêncio e a nota sai com o padrão.
['name="paymentType"', 'name="formaPagamento"', 'name="observacoesAdicionais"'].forEach((campo) => {
  const pos = src.indexOf(campo);
  check(`${campo} está dentro do form`, pos > inicioForm && pos < fimForm, pos === -1 ? 'NÃO EXISTE' : String(pos));
});

console.log('\n--- um só botão Emitir, no canto superior direito ---');
check('o Emitir está no topo, ligado ao form pelo atributo form',
  /<div class="cadastro-list-actions nfe-acoes-topo">[\s\S]{0,700}<button type="submit" form="nfeFocusForm" id="nfeFocusSubmitBtn">Emitir NF-e<\/button>/.test(src));
check('e é o único', (src.match(/id="nfeFocusSubmitBtn"/g) || []).length === 1);
check('o rodapé do formulário não tem mais botão de enviar', !/type="submit"/.test(formulario));
check('o envio continua achando o botão pelo id', /const submitBtn = document\.getElementById\('nfeFocusSubmitBtn'\);/.test(src));

console.log('\n--- os blocos que dependem do resto se refazem sozinhos ---');
check('mudar o total agenda prévia, transporte e duplicatas',
  /function refreshGrandTotal\(\) \{[\s\S]{0,200}agendarBlocosDependentes\(\);/.test(src)
  && /function agendarBlocosDependentes\(\) \{[\s\S]{0,300}carregarPrevia\(\);\s*renderTransporte\(\);\s*atualizarCobrancaSugerida\(\);/.test(src));
check('  e o destinatário também', /querySelector\('\[data-bloco="destinatario"\]'\)\?\.addEventListener\('change', agendarBlocosDependentes\)/.test(src));
check('  a prévia sai já no desenho', /if \(!ehComplemento\(\)\) carregarPrevia\(\);/.test(src));
check('  e a resposta velha não sobrescreve a nova', /const este = \+\+pedidoDePrevia;/.test(src) && /if \(este !== pedidoDePrevia\) return;/.test(src));
check('nota incompleta mostra o que falta, sem vermelho', /previaAguardando = falta;/.test(src) && /<p class="muted">\$\{escapeHtml\(previaAguardando\)\}<\/p>/.test(src));
check('o redesenho devolve o foco a quem digitava (Impostos, Totais, Transporte, Duplicatas)',
  (src.match(/const devolverFoco = guardarFoco\(caixa\);/g) || []).length === 4);

console.log('\n--- o CST / CSOSN fica no grupo ICMS ---');
// 15/10/2026, pedido do usuário: "coloque o cst da primeira tela na aba do ICMS".
check('no ICMS, primeiro, e não mais na Classificação',
  src.includes("{ titulo: 'ICMS', campos: [['cstIcms', 'CST / CSOSN'], ['baseIcms', 'Base'],")
  && !/titulo: 'Classificação', campos: \[[^\]]*\]*[^\n]*'cstIcms'/.test(src));

console.log('\n--- clicar em Emitir com campo em branco AVISA ---');
// attachHandlers é a ÚLTIMA função grande do arquivo: a fatia vai daqui até o fim.
const handlers = src.slice(src.indexOf('function attachHandlers'));
// Captura: o `invalid` precisa ser visto ANTES de o navegador escolher de qual
// campo reclamar.
check('escuta `invalid` na fase de captura', /addEventListener\('invalid'[\s\S]{0,2500}\}, true\)/.test(handlers));
check('e traz o bloco do campo para a tela', /const bloco = evento\.target\.closest\('\.nfe-bloco'\);\s*bloco\?\.scrollIntoView/.test(handlers));
check('trata só o primeiro campo do lote', /if \(jaAbriuAbaInvalida\) return;/.test(handlers));
check('e rearma para a próxima tentativa', /setTimeout\(\(\) => \{ jaAbriuAbaInvalida = false; \}, 0\)/.test(handlers));
// A bolha nativa não aparece para os campos da tabela de itens: eles usam
// data-field e não têm `name`, e o Chrome desiste com "not focusable".
check('avisa na tela, com o nome do bloco', /bloco\.querySelector\('\.nfe-bloco-titulo'\)[\s\S]{0,200}Falta preencher em/.test(handlers));
check('e devolve o foco ao campo', /evento\.target\.focus\(\)/.test(handlers));

console.log(`\n===== ${falhas === 0 ? 'TODOS OS CHECKS PASSARAM' : falhas + ' FALHA(S)'} =====`);
process.exit(falhas ? 1 : 0);
