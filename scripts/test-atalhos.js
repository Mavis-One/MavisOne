#!/usr/bin/env node
// Botão "Atalhos" da barra superior — public/modules/shared/atalhos.js
//
// O que quebra em silêncio aqui:
//   1. um atalho de navegação apontando para uma sub-tela que não existe mais
//      (o menu abre, o clique leva a lugar nenhum e nada dá erro);
//   2. um atalho de criação chamando uma rota que o server.js não tem;
//   3. um campo obrigatório da rota que a janela flutuante não pede — o
//      usuário preenche tudo, clica em Cadastrar e leva um erro do servidor;
//   4. o atalho aparecendo para quem não tem o módulo, o que troca a ausência
//      do item por um "Sem permissão" na cara.
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const ler = (p) => fs.readFileSync(path.join(RAIZ, p), 'utf8').replace(/\r\n/g, '\n');

const appSrc = ler('public/app.js');
const serverSrc = ler('server.js');
const indexSrc = ler('public/index.html');

// Carrega o módulo com um window falso — ele é uma IIFE que só depende de DOM
// na hora de desenhar, não na carga.
global.window = {};
(0, eval)(ler('public/modules/shared/atalhos.js'));
const A = global.window.MavisAtalhos;

function extrairConst(nome) {
  const inicio = appSrc.indexOf(`const ${nome} = {`);
  const abre = appSrc.indexOf('{', inicio);
  const fecha = appSrc.indexOf('\n};', abre);
  return (0, eval)('(' + appSrc.slice(abre, fecha + 2) + ')');
}
const moduleSubItems = extrairConst('moduleSubItems');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};

console.log(`atalhos: ${A.ATALHOS_CRIAR.length} de criação, ${A.ATALHOS_IR.length} de navegação\n`);

console.log('--- todo atalho de navegação leva a uma tela que existe ---');
A.ATALHOS_IR.forEach((atalho) => {
  const telas = moduleSubItems[atalho.modulo] || [];
  const existe = telas.some((t) => t.key === atalho.sub);
  check(`${atalho.label} -> ${atalho.modulo}/${atalho.sub}`, existe, existe ? '' : 'SUB-TELA INEXISTENTE');
});

console.log('\n--- toda janela de criação chama uma rota que existe ---');
A.ATALHOS_CRIAR.forEach((atalho) => {
  const temRota = serverSrc.includes(`pathname === '${atalho.endpoint}' && req.method === 'POST'`);
  check(`${atalho.label} -> POST ${atalho.endpoint}`, temRota, temRota ? '' : 'ROTA INEXISTENTE');
});

console.log('\n--- a janela pede o que a rota exige ---');
// Cada rota tem validações próprias; aqui checa-se que o campo que a rota
// recusa em branco está declarado como obrigatório na janela.
const OBRIGATORIOS = {
  '/api/cadastros/pessoas': ['document'],          // "CPF/CNPJ inválido"
  '/api/stock/products': ['name', 'sku'],          // "Informe o nome"/"Informe o SKU"
  '/api/finance/entries': ['description', 'amount'] // "Informe a descrição"/"valor maior que zero"
};
A.ATALHOS_CRIAR.forEach((atalho) => {
  const exigidos = OBRIGATORIOS[atalho.endpoint] || [];
  const marcados = atalho.campos.filter((c) => c.required).map((c) => c.name);
  const faltando = exigidos.filter((nome) => !marcados.includes(nome));
  check(`${atalho.label}: obrigatórios da rota`, faltando.length === 0, faltando.join(', ') || marcados.join(', '));
});

console.log('\n--- cliente e fornecedor se distinguem pelo papel ---');
// Os dois gravam na MESMA tabela de pessoas; sem o papel certo, o fornecedor
// nasceria como cliente e sumiria dos filtros de compra.
const cliente = A.ATALHOS_CRIAR.find((a) => a.id === 'novo_cliente');
const fornecedor = A.ATALHOS_CRIAR.find((a) => a.id === 'novo_fornecedor');
check('cliente recebe o papel Cliente', cliente.extras.roles.includes('Cliente'), cliente.extras.roles.join(','));
check('fornecedor recebe o papel Fornecedor', fornecedor.extras.roles.includes('Fornecedor'), fornecedor.extras.roles.join(','));
check('os dois usam a mesma rota de pessoas', cliente.endpoint === fornecedor.endpoint);
// Os papéis existem mesmo na lista de Cadastros? Um papel inventado não
// apareceria em filtro nenhum.
check('os papéis existem no cadastro de pessoas', /'Cliente', 'Transportadora', 'Técnico', 'Fornecedor'/.test(appSrc));

console.log('\n--- o produto do atalho já nasce emitível ---');
// Sem NCM e origem a emissão de NF-e para com "Nenhuma regra fiscal
// encontrada". Pedir na janela evita descobrir isso só na hora de emitir.
const produto = A.ATALHOS_CRIAR.find((a) => a.id === 'novo_produto');
const camposProduto = produto.campos.map((c) => c.name);
check('pede NCM', camposProduto.includes('ncm'));
check('pede origem', camposProduto.includes('origem'));
check('origem tem as 9 oficiais (0 a 8)', produto.campos.find((c) => c.name === 'origem').opcoes.length === 9);

console.log('\n--- o menu respeita a permissão de módulo ---');
// Mostrar o atalho e devolver "Sem permissão" no clique é pior do que não
// mostrar. Cada atalho declara o módulo que exige.
A.ATALHOS_CRIAR.concat(A.ATALHOS_IR).forEach((atalho) => {
  check(`${atalho.label} declara módulo`, Boolean(atalho.modulo), atalho.modulo || 'SEM MÓDULO');
});
const soVendas = A.barraHtml((s) => String(s), (m) => m === 'sales');
check('quem só tem Vendas não vê Novo Cliente', !soVendas.includes('Novo Cliente'));
check('mas vê os atalhos de Vendas', soVendas.includes('Novo Pedido'));
const semNada = A.barraHtml((s) => String(s), () => false);
check('sem módulo nenhum, o botão nem aparece', semNada === '', semNada.slice(0, 40));

console.log('\n--- ligado na barra superior ---');
check('index.html carrega o atalhos.js', indexSrc.includes('/modules/shared/atalhos.js'));
check('e antes do app.js', indexSrc.indexOf('/modules/shared/atalhos.js') < indexSrc.indexOf('/app.js'));
check('renderApp desenha a barra', /MavisAtalhos\.barraHtml\(escapeHtml, hasModuleAccess\)/.test(appSrc));
check('e liga os cliques', /MavisAtalhos\?\.ligar\(/.test(appSrc));
// A janela usa o mesmo `api` das telas: é ele que trata 401 de sessão
// encerrada. Um fetch próprio deixaria o atalho vivo com sessão morta.
check('a janela usa o api compartilhado', /ligar\(\{\s*\n\s*api,/.test(appSrc));

console.log('\n--- o menu realmente fecha ---');
// O bug que isto guarda: o atributo `hidden` só esconde porque a folha do
// NAVEGADOR diz `[hidden] { display: none }`. Qualquer regra de autor com
// `display` vence essa — então .atalhos-menu com `display: flex` deixava o
// `hidden` sem efeito, e o menu ficava aberto sobre todas as telas. O JS
// parecia certo (`menu.hidden = true`) e não mudava nada na tela.
const cssSrc = ler('public/app.css');
const atalhosSrc = ler('public/modules/shared/atalhos.js');

// Toda classe que o JS esconde por `hidden` e que declara `display` no CSS
// precisa de um par `[hidden]` para desempatar.
const classesComHidden = [...atalhosSrc.matchAll(/class="([^"]*)"[^>]*\shidden[\s>]/g)]
  .flatMap((m) => m[1].split(/\s+/))
  .filter(Boolean);
const idsComHidden = [...atalhosSrc.matchAll(/id="(\w+)"[^>]*\shidden[\s>]/g)].map((m) => m[1]);
check('o teste achou os elementos que usam hidden', classesComHidden.length > 0, classesComHidden.join(', '));

classesComHidden.forEach((classe) => {
  const bloco = new RegExp(`\\.${classe}\\s*\\{[^}]*\\}`, 'g');
  const declaraDisplay = [...cssSrc.matchAll(bloco)].some((m) => /display\s*:/.test(m[0]));
  if (!declaraDisplay) {
    check(`.${classe}: não declara display, hidden funciona sozinho`, true);
    return;
  }
  const temGuarda = new RegExp(`\\.${classe}\\[hidden\\]\\s*\\{[^}]*display\\s*:\\s*none`).test(cssSrc);
  check(`.${classe}: declara display, então precisa de [hidden]`, temGuarda, temGuarda ? '' : 'HIDDEN SEM EFEITO — o elemento nunca some');
});
check('o menu de atalhos tem a guarda', /\.atalhos-menu\[hidden\]\s*\{\s*display:\s*none/.test(cssSrc));
check('o menu nasce fechado a cada render', /menu\.hidden = true;\s*\n\s*botao\.setAttribute\('aria-expanded', 'false'\)/.test(atalhosSrc));

console.log('\n--- os listeners de documento não se acumulam ---');
// ligar() roda a cada renderApp(), e renderApp é chamado em toda navegação.
// Registrar no documento a cada chamada deixaria um par de listeners por tela
// visitada, cada um preso a um menu já removido do DOM.
const vezesRenderApp = (appSrc.match(/renderApp\(\)/g) || []).length;
check('renderApp é chamado muitas vezes', vezesRenderApp > 10, `${vezesRenderApp} chamadas`);
check('o documento é ligado uma vez só', /if \(documentoLigado\) return;/.test(atalhosSrc));
check('o listener busca o menu na hora do evento', /const menuAtual = \(\) => document\.getElementById\('atalhosMenu'\)/.test(atalhosSrc));
// Guardar o elemento numa closure faria o listener velho mexer num menu morto.
const trechoLigar = atalhosSrc.slice(atalhosSrc.indexOf('function ligarDocumentoUmaVez'), atalhosSrc.indexOf('function ligar(ctx)'));
check('e não guarda referência presa ao render', !/menu\.contains/.test(trechoLigar) || /const menu = menuAtual\(\)/.test(trechoLigar));

console.log(`\n===== ${falhas === 0 ? 'TODOS OS CHECKS PASSARAM' : falhas + ' FALHA(S)'} =====`);
process.exit(falhas ? 1 : 0);
