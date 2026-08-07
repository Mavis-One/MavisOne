// Testa a Área de Trabalho dos módulos contra as listas REAIS do app.js.
//
// O valor do teste está em ler moduleSubItems/moduleLabels do próprio app.js:
// se alguém cadastrar uma tela nova sem descrição, ou mudar um rótulo de um
// jeito que troque o ícone, o erro aparece aqui e não na tela do usuário.
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const appSrc = fs.readFileSync(path.join(RAIZ, 'public/app.js'), 'utf8');

// Recorta um `const NOME = { ... };` de nível superior do app.js e avalia.
// O fechamento é o primeiro "\n};" depois da abertura — funciona porque estas
// duas constantes são declaradas na coluna 0 e nada dentro delas fecha assim.
function extrairConst(nome) {
  const inicio = appSrc.indexOf(`const ${nome} = {`);
  if (inicio === -1) throw new Error(`não achei "const ${nome}" no app.js`);
  const abre = appSrc.indexOf('{', inicio);
  const fecha = appSrc.indexOf('\n};', abre);
  if (fecha === -1) throw new Error(`não achei o fim de "${nome}"`);
  return (0, eval)('(' + appSrc.slice(abre, fecha + 2) + ')');
}

const moduleSubItems = extrairConst('moduleSubItems');
const moduleLabels = extrairConst('moduleLabels');

// O arquivo do browser lê estas duas pelo nome puro (são `const` no app.js, que
// não viram propriedade de window) — então aqui elas precisam existir no global.
global.window = {};
global.moduleSubItems = moduleSubItems;
global.moduleLabels = moduleLabels;
(0, eval)(fs.readFileSync(path.join(RAIZ, 'public/modules/shared/module_workspace.js'), 'utf8'));
const W = global.window.MavisWorkspace;

const escapeHtml = (v = '') => String(v)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};

// DOM mínimo: o render só escreve innerHTML e pendura listeners. querySelector
// devolvendo null é tratado por optional chaining no arquivo real.
function desenhar(moduleName) {
  let html = '';
  const content = {
    set innerHTML(v) { html = v; },
    get innerHTML() { return html; },
    querySelectorAll: () => [],
    querySelector: () => null
  };
  W.render({ content, state: {}, escapeHtml, renderApp() {}, loadModule() {} }, moduleName);
  return html;
}

const MODULOS = [
  'sales', 'purchases', 'stock', 'finance', 'settings', 'cadastros',
  'fiscal', 'reports', 'fleet', 'crm', 'hr', 'pcp', 'contracts'
];

console.log('\n--- toda tela tem descrição (senão o bloco nasce vazio) ---');
let semDesc = [];
MODULOS.forEach((m) => {
  (moduleSubItems[m] || []).forEach((item) => {
    if (!item.desc || !String(item.desc).trim()) semDesc.push(`${m}.${item.key}`);
  });
});
check('todas as telas descritas', semDesc.length === 0, semDesc.join(', ') || `${MODULOS.reduce((s, m) => s + moduleSubItems[m].length, 0)} telas`);

console.log('\n--- cada módulo desenha um bloco por tela ---');
MODULOS.forEach((m) => {
  const html = desenhar(m);
  const blocos = (html.match(/data-open-sub="/g) || []).length;
  const esperado = moduleSubItems[m].length;
  check(`${m}: ${esperado} telas`, blocos === esperado, `${blocos} bloco(s)`);
  // O nome do módulo já aparece no cabeçalho da página; repeti-lo aqui era
  // ruído. Este check trava a decisão: nada de título dentro da área.
  check(`${m}: sem repetir o nome do módulo`, !/<h[1-6][\s>]/.test(html));
  check(`${m}: campo de filtro presente`, html.includes('id="workspaceFilter"'));
  const faltando = moduleSubItems[m].filter((i) => !html.includes(`data-open-sub="${escapeHtml(i.key)}"`));
  check(`${m}: nenhuma tela ficou de fora`, faltando.length === 0, faltando.map((i) => i.key).join(', '));
});

console.log('\n--- ícone certo para cada natureza de tela ---');
// A ordem das regras importa: "Nova NF-e Avulsa" é tela de CRIAÇÃO, e a regra
// de criar tem que vencer a de nota fiscal. Este é o caso que quebra se alguém
// reordenar REGRAS_ICONE.
const htmlVendas = desenhar('sales');
const htmlFin = desenhar('finance');
const htmlCfg = desenhar('settings');
const tipoDe = (html, key) => {
  const trecho = html.slice(0, html.indexOf(`data-open-sub="${key}"`));
  const m = trecho.match(/workspace-tile workspace-tile-(\w+)"[^"]*$/);
  return m ? m[1] : (trecho.match(/workspace-tile-(\w+)/g) || []).pop()?.replace('workspace-tile-', '');
};
check('Novo Pedido -> criar', tipoDe(htmlVendas, 'new_order') === 'criar', tipoDe(htmlVendas, 'new_order'));
check('Nova NF-e Avulsa -> criar (e NÃO documento)', tipoDe(htmlVendas, 'new_nfe') === 'criar', tipoDe(htmlVendas, 'new_nfe'));
check('NF-e Emitidas -> documento', tipoDe(htmlVendas, 'nfes') === 'documento', tipoDe(htmlVendas, 'nfes'));
check('Painel Vendas -> painel', tipoDe(htmlVendas, 'sales_dashboard') === 'painel', tipoDe(htmlVendas, 'sales_dashboard'));
check('Importar Vendas -> importar', tipoDe(htmlVendas, 'import_sales') === 'importar', tipoDe(htmlVendas, 'import_sales'));
check('Dashboard (financeiro) -> painel', tipoDe(htmlFin, 'dashboard') === 'painel', tipoDe(htmlFin, 'dashboard'));
check('Papéis e Permissões -> config', tipoDe(htmlCfg, 'access_control') === 'config', tipoDe(htmlCfg, 'access_control'));
check('Pedidos e Orçamentos -> lista (padrão)', tipoDe(htmlVendas, 'orders_quotes') === 'lista', tipoDe(htmlVendas, 'orders_quotes'));

console.log('\n--- busca do filtro ignora acento ---');
// "orcamento" tem que achar "Orçamento", senão o filtro só serve para quem
// digita com acento.
check('data-busca sem acento e minúsculo', /data-busca="[^"]*orcamento/.test(htmlVendas));
check('data-busca inclui a descrição, não só o rótulo', /data-busca="[^"]*filtros/.test(htmlVendas));

console.log('\n--- telas ainda não construídas ---');
// Uma tela `pendente` tem que ser reconhecível ANTES do clique e, ao abrir,
// dizer o que falta. O erro a evitar é o que já foi apagado uma vez deste
// sistema: tabela vazia dando a entender que o cadastro funciona e está sem
// registros.
const PENDENTES_ESPERADOS = ['fleet', 'crm', 'hr', 'pcp', 'contracts'];
PENDENTES_ESPERADOS.forEach((m) => {
  const html = desenhar(m);
  const todas = moduleSubItems[m].length;
  const marcadas = (html.match(/is-pendente/g) || []).length;
  check(`${m}: todas as ${todas} telas marcadas como pendentes`, marcadas === todas, `${marcadas}`);
  check(`${m}: etiqueta visível no bloco`, html.includes('em preparo'));
});

// Fiscal e Relatórios têm telas REAIS — se tudo virasse pendente, o módulo
// teria sido entregue vazio sem ninguém notar.
const reais = (m) => moduleSubItems[m].filter((i) => !i.pendente).length;
check('fiscal tem tela real (Tabelas Fiscais)', reais('fiscal') >= 1, `${reais('fiscal')} real(is)`);
check('reports tem as 4 telas reais', reais('reports') === 4, `${reais('reports')} real(is)`);

// A rota pendente é resolvida pelo próprio arquivo, não por cada módulo.
check('telaPendente encontra a tela marcada', W.telaPendente('fleet', { activeSub: 'veiculos' })?.key === 'veiculos');
check('telaPendente ignora tela real', W.telaPendente('reports', { activeSub: 'vendas' }) === null);
check('telaPendente ignora quando não há sub', W.telaPendente('fleet', { activeSub: null }) === null);

// E a tela de aviso diz o que destrava, em vez de "em breve".
let htmlAviso = '';
W.renderPendente(
  { content: { set innerHTML(v) { htmlAviso = v; }, querySelector: () => null }, escapeHtml, state: {}, renderApp() {}, loadModule() {} },
  'fleet',
  moduleSubItems.fleet[0]
);
check('aviso nomeia a migração que destrava', htmlAviso.includes('fase-r-modulos-novos.sql'));
check('aviso NÃO tem tabela vazia fingindo cadastro', !/<table/.test(htmlAviso));
check('aviso mostra o progresso do módulo', /\d+ de \d+ telas/.test(htmlAviso));

console.log('\n--- título e submenu na área de trabalho ---');
// Sem sub-tela escolhida, nenhuma tela está aberta: o cabeçalho tem que mostrar
// só o nome do módulo e o submenu não pode destacar nada. Isso quebrou uma vez
// porque os dois pontos tinham um "ou a tela padrão do módulo" herdado de
// quando abrir Vendas caía direto em Pedidos — o título anunciava
// "Vendas > Pedidos e Orçamentos" com essa tela fechada. O teste lê o fonte
// para o padrão não voltar sem ninguém notar.
const semFallback = (linha) => /^\s*const \w+ = state\.activeSub;\s*$/m.test(linha);
const fonteTitulo = appSrc.match(/const activeSubKey = .*/)[0];
const fonteSubmenu = appSrc.match(/const activeKey = .*/)[0];
check('título não inventa sub-tela quando não há nenhuma', semFallback(fonteTitulo), fonteTitulo.trim());
check('submenu não destaca sub-tela quando não há nenhuma', semFallback(fonteSubmenu), fonteSubmenu.trim());

// E com uma tela escolhida o rótulo continua saindo da lista.
const rotulo = (chave) => (moduleSubItems.sales.find((i) => i.key === chave)?.label || '');
check('com tela aberta, o rótulo aparece', rotulo('nfes') === 'NF-e Emitidas', rotulo('nfes'));
check('sem tela aberta, rótulo vazio', rotulo(null) === '', `"${rotulo(null)}"`);

console.log('\n--- quando a área de trabalho deve abrir ---');
check('módulo sem sub-tela escolhida', W.deveAbrir('sales', { activeSub: null }) === true);
check('com sub-tela escolhida, não', W.deveAbrir('sales', { activeSub: 'nfes' }) === false);
check('Dashboard Geral nunca (tem tela própria)', W.deveAbrir('dashboard', { activeSub: null }) === false);
check('módulo desconhecido, não', W.deveAbrir('inexistente', { activeSub: null }) === false);

console.log('\n--- rótulo com aspas não quebra o HTML ---');
// "Log's Vendas Importadas" tem apóstrofo: se escapar errado, o atributo fecha
// no meio e o bloco vira lixo na tela.
check("apóstrofo de \"Log's\" escapado", htmlVendas.includes('Log&#39;s Vendas Importadas'));
check('nenhum apóstrofo cru dentro de atributo', !/data-busca="[^"]*'/.test(htmlVendas));

console.log(falhas === 0 ? '\n===== TODOS OS CHECKS PASSARAM =====\n' : `\n===== ${falhas} CHECK(S) FALHARAM =====\n`);
process.exit(falhas === 0 ? 0 : 1);
