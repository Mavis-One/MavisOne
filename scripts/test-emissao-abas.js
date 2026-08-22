// A tela de emissão de NF-e: estrutura das abas e o que acontece ao clicar em
// "Emitir NF-e" com campo obrigatório em branco.
//
// Dois defeitos reais, medidos em 17/08/2026, que este teste existe para não
// deixar voltar:
//
//   1. Faltava a ABERTURA do painel da aba "3. Itens". A tag de fechamento
//      ficou sem par e fechou o div.panel antes da hora — os painéis
//      "4. Pagamento" e "5. Observações" caíram para FORA do <form>. O
//      FormData parou de enxergar forma de pagamento e observações, e a nota
//      saía com o padrão sem ninguém pedir. Nada avisava.
//
//   2. Sete campos obrigatórios do destinatário vivem numa aba escondida. O
//      navegador recusava o envio por causa deles e não conseguia mostrar
//      mensagem em campo invisível: clicar em "Emitir NF-e" não produzia NADA
//      — sem bolha, sem aviso, sem erro no console.
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

console.log('--- toda aba tem painel, e todo painel tem aba ---');
// É a regra que pegaria o defeito 1 direto: existia botão data-tab="itens" sem
// nenhum data-tab-panel="itens" correspondente.
const unico = (re) => [...new Set([...src.matchAll(re)].map((m) => m[1]))].sort();
const abas = unico(/data-tab="([a-z_]+)"/g);
const paineis = unico(/data-tab-panel="([a-z_]+)"/g);
console.log(`    abas   : ${abas.join(', ')}`);
console.log(`    painéis: ${paineis.join(', ')}`);
const semPainel = abas.filter((a) => !paineis.includes(a));
const semAba = paineis.filter((p) => !abas.includes(p));
check('nenhuma aba sem painel', semPainel.length === 0, semPainel.join(', ') || 'ok');
check('nenhum painel sem aba', semAba.length === 0, semAba.join(', ') || 'ok');

console.log('\n--- as <div> do formulário fecham certo ---');
// O defeito 1 era exatamente isto: uma tag de fechamento a mais. Contar é
// grosseiro, mas pega o caso que aconteceu — e o estrago dele era invisível na
// leitura, porque o HTML "parecia" certo.
const inicioForm = src.indexOf('<form id="nfeFocusForm"');
const fimForm = src.indexOf('</form>', inicioForm);
check('achei o formulário', inicioForm > -1 && fimForm > inicioForm, `${inicioForm}..${fimForm}`);
const formulario = src.slice(inicioForm, fimForm).replace(/<!--[\s\S]*?-->/g, '');
const abre = (formulario.match(/<div\b/g) || []).length;
const fecha = (formulario.match(/<\/div>/g) || []).length;
check('abre e fecha o mesmo tanto de div', abre === fecha, `${abre} aberturas, ${fecha} fechamentos`);

console.log('\n--- a tabela de itens mora DENTRO do painel dela ---');
// Fora do painel, ela aparecia em todas as abas ao mesmo tempo.
const painelItens = src.indexOf('data-tab-panel="itens"');
const tabelaItens = src.indexOf('id="nfeFocusItemsBody"');
check('o painel de itens existe', painelItens > -1);
check('e vem ANTES da tabela', painelItens > -1 && painelItens < tabelaItens, `painel ${painelItens}, tabela ${tabelaItens}`);

console.log('\n--- os campos de pagamento e observações ficam no formulário ---');
// Se caírem para fora, o FormData os ignora em silêncio e a nota sai com o
// padrão. Ordem no arquivo: os dois painéis precisam estar antes do </form>.
['name="paymentType"', 'name="formaPagamento"', 'name="observacoesAdicionais"'].forEach((campo) => {
  const pos = src.indexOf(campo);
  check(`${campo} está dentro do form`, pos > inicioForm && pos < fimForm, pos === -1 ? 'NÃO EXISTE' : String(pos));
});

console.log('\n--- clicar em Emitir com campo escondido em branco AVISA ---');
// attachHandlers é a ÚLTIMA função do arquivo: a fatia vai daqui até o fim.
// A primeira versão usava attachItemsHandlers como limite e pegava trecho
// vazio, porque aquela função vem ANTES — sete checks falhavam sem que houvesse
// nada de errado no código.
const handlers = src.slice(src.indexOf('function attachHandlers'));
check('existe a função que troca de aba', /const abrirAba = \(alvo\) =>/.test(handlers));
// Captura: o `invalid` precisa ser visto ANTES de o navegador escolher de qual
// campo reclamar.
// A janela do regex precisa caber o bloco inteiro; ela ficou curta quando o
// aviso na tela e o foco entraram, e o check falhou sem nada estar errado.
check('escuta `invalid` na fase de captura', /addEventListener\('invalid'[\s\S]{0,2500}\}, true\)/.test(handlers));
check('e abre a aba do campo reprovado', /if \(painel && painel\.hidden\) abrirAba\(painel\.dataset\.tabPanel\)/.test(handlers));
// Só o primeiro: os demais do mesmo lote esconderiam o campo que vai receber a
// mensagem.
check('trata só o primeiro campo do lote', /if \(jaAbriuAbaInvalida\) return;/.test(handlers));
check('e rearma para a próxima tentativa', /setTimeout\(\(\) => \{ jaAbriuAbaInvalida = false; \}, 0\)/.test(handlers));
// A bolha nativa não aparece para os campos da tabela de itens: eles usam
// data-field e não têm `name`, e o Chrome desiste com "not focusable".
check('avisa na tela, sem depender da bolha do navegador', /showToast\(aba[\s\S]{0,200}Falta preencher em/.test(handlers));
check('e devolve o foco ao campo depois de abrir a aba', /evento\.target\.focus\(\)/.test(handlers));

console.log(`\n===== ${falhas === 0 ? 'TODOS OS CHECKS PASSARAM' : falhas + ' FALHA(S)'} =====`);
process.exit(falhas ? 1 : 0);
