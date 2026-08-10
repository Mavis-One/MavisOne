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
check('Nova Venda -> criar', tipoDe(htmlVendas, 'new_sale') === 'criar', tipoDe(htmlVendas, 'new_sale'));
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

console.log('\n--- fixar no bloco e faixa "mais usadas" ---');
// A barra secundária saiu porque repetia os mesmos itens da Área de Trabalho.
// Com ela foi embora o alfinete, que agora mora no próprio bloco.
const semFavoritos = desenhar('reports');
check('todo bloco tem o botão de fixar', (semFavoritos.match(/data-fixar=/g) || []).length === moduleSubItems.reports.length);
check('sem nada fixado, não existe faixa', !semFavoritos.includes('workspace-favoritos'));
// Bloco virou <div role="button"> porque o alfinete mora dentro dele: <button>
// dentro de <button> é HTML inválido e o navegador desmonta a marcação.
check('bloco não é <button> aninhado', !/<button[^>]*data-open-sub/.test(semFavoritos));
check('bloco continua acessível por teclado', /role="button" tabindex="0"[\s\S]*?data-open-sub/.test(semFavoritos));

// Com favoritos, a faixa aparece no topo com só o que foi fixado.
global.getDashboardPinSet = () => new Set(['reports::vendas', 'reports::estoque', 'sales::nfes']);
global.favoriteIconSvg = () => '<svg></svg>';
const comFavoritos = desenhar('reports');
check('faixa aparece quando há fixados', comFavoritos.includes('workspace-favoritos'));
const atalhos = (comFavoritos.match(/workspace-atalho"/g) || []).length;
check('faixa traz só os 2 fixados DESTE módulo', atalhos === 2, `${atalhos} atalho(s)`);
check('fixado de outro módulo não vaza', !comFavoritos.includes('NF-e Emitidas'));
check('alfinete do fixado marcado como ativo', /workspace-fixar active/.test(comFavoritos));
delete global.getDashboardPinSet;
delete global.favoriteIconSvg;

console.log('\n--- menu lateral acompanha os módulos ---');
// A lista do menu era fixa com 6 nomes; módulo novo ficava invisível.
const menu = (0, eval)('(' + appSrc.slice(appSrc.indexOf('const MENU_MODULOS'), appSrc.indexOf(';', appSrc.indexOf('const MENU_MODULOS'))).replace('const MENU_MODULOS = ', '') + ')');
['fiscal', 'reports', 'fleet', 'crm', 'hr', 'pcp', 'contracts'].forEach((m) => {
  check(`${m} está no menu`, menu.includes(m));
});
check('Configurações fora do menu (abre pela engrenagem)', !menu.includes('settings'));

console.log('\n--- telas construídas x ainda não construídas ---');
// Frota, RH, PCP, Contratos, CRM e Fiscal saíram do "em preparo": têm banco,
// rota e tela. Regras Fiscais era a última pendente do sistema.
const TODAS_PRONTAS = ['fleet', 'crm', 'hr', 'pcp', 'contracts', 'reports', 'fiscal'];
TODAS_PRONTAS.forEach((m) => {
  const pendentes = moduleSubItems[m].filter((i) => i.pendente);
  check(`${m}: nenhuma tela pendente`, pendentes.length === 0, pendentes.map((i) => i.key).join(', ') || `${moduleSubItems[m].length} telas`);
});

const reais = (m) => moduleSubItems[m].filter((i) => !i.pendente).length;
check('fiscal tem as 9 telas reais', reais('fiscal') === 9, `${reais('fiscal')} real(is)`);
// Sem nenhuma tela pendente em lugar nenhum, o menu não pode mais oferecer um
// destino que não abre.
const pendentesNoSistema = Object.entries(moduleSubItems)
  .flatMap(([m, itens]) => itens.filter((i) => i.pendente).map((i) => `${m}.${i.key}`));
check('nenhum módulo tem tela pendente', pendentesNoSistema.length === 0, pendentesNoSistema.join(', ') || 'nenhuma');

// A MECÂNICA de pendente continua tendo que funcionar, mesmo sem nenhuma tela
// pendente de verdade — é o que vai receber a próxima tela que faltar. Como
// não há mais cobaia real, o teste injeta uma: sem isto, apagar a função
// inteira passaria despercebido.
moduleSubItems.__teste_pendente = [
  { key: 'pronta', label: 'Pronta', desc: 'já existe' },
  { key: 'faltando', label: 'Faltando', desc: 'ainda não existe', pendente: true }
];
moduleLabels.__teste_pendente = 'Módulo de Teste';
check('telaPendente encontra a tela marcada', W.telaPendente('__teste_pendente', { activeSub: 'faltando' })?.key === 'faltando');
check('telaPendente ignora tela pronta', W.telaPendente('__teste_pendente', { activeSub: 'pronta' }) === null);
check('telaPendente ignora tela pronta (módulo real)', W.telaPendente('fleet', { activeSub: 'veiculos' }) === null);
check('telaPendente ignora quando não há sub', W.telaPendente('__teste_pendente', { activeSub: null }) === null);
check('e o Fiscal não devolve mais pendente para regras', W.telaPendente('fiscal', { activeSub: 'regras' }) === null);

// E o aviso diz o que falta, em vez de mostrar tabela vazia fingindo cadastro.
let htmlAviso = '';
W.renderPendente(
  { content: { set innerHTML(v) { htmlAviso = v; }, querySelector: () => null }, escapeHtml, state: {}, renderApp() {}, loadModule() {} },
  '__teste_pendente',
  moduleSubItems.__teste_pendente.find((i) => i.pendente)
);
check('aviso NÃO tem tabela vazia fingindo cadastro', !/<table/.test(htmlAviso));
check('aviso mostra o progresso do módulo', /\d+ de \d+ telas/.test(htmlAviso));
delete moduleSubItems.__teste_pendente;
delete moduleLabels.__teste_pendente;

console.log('\n--- toda lista tem o formulário que ela abre ---');
// A lista manda para `newSub`; se essa tela não existir no menu, o botão
// "+ Novo" leva a lugar nenhum.
const PARES = {
  fleet: [['veiculos', 'novo_veiculo'], ['manutencoes', 'nova_manutencao'], ['abastecimentos', 'novo_abastecimento']],
  // Departamentos, Tipo, Categoria e Profissões NÃO entram aqui: são cadastros
  // de apoio com o formulário embutido na própria lista (makeInlineRegisterScreen),
  // então não têm — nem devem ter — um "Novo X" separado no menu.
  hr: [['colaboradores', 'novo_colaborador'], ['expedientes', 'novo_expediente'], ['ferias', 'nova_ausencia'], ['ponto', 'novo_ponto']],
  // Status PCP e Controle Qualidade ficam de fora: são inline, sem "Novo X".
  pcp: [['ordens', 'nova_ordem'], ['setores', 'novo_setor'], ['estrutura', 'nova_estrutura'], ['apontamentos', 'novo_apontamento']],
  contracts: [['contratos', 'novo_contrato'], ['tipos', 'novo_tipo'], ['modelos', 'novo_modelo']]
};
Object.entries(PARES).forEach(([m, pares]) => {
  const chaves = moduleSubItems[m].map((i) => i.key);
  const quebrados = pares.filter(([lista, form]) => !chaves.includes(lista) || !chaves.includes(form));
  check(`${m}: ${pares.length} par(es) lista/formulário no menu`, quebrados.length === 0, quebrados.map((p) => p.join('->')).join(', '));
});

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
// Rótulo entra em atributo (data-busca, title): apóstrofo ou aspas escapados
// errado fecham o atributo no meio e o bloco vira lixo na tela.
//
// Este teste MONTA um módulo com esses caracteres em vez de depender de algum
// rótulo real ter apóstrofo. Antes ele apontava para "Log's Vendas Importadas"
// — e quando esse rótulo foi corrigido para "Logs de Vendas Importadas" (o
// apóstrofo possessivo é do inglês, não do português) o teste passou a não
// vigiar mais nada. A garantia é "qualquer rótulo é escapado", não "existe um
// rótulo com apóstrofo".
// Os pedaços usam um sentinela improvável (ZQX) porque o template tem
// comentários HTML com aspas: procurar por uma palavra comum acharia o
// comentário e acusaria um problema que não existe.
moduleSubItems.__teste_escape = [
  { key: 'aspas', label: `Log's "ZQXA" & <b>`, desc: `descrição com ' e "ZQXB"` }
];
moduleLabels.__teste_escape = 'Teste de Escape';
const htmlEscape = desenhar('__teste_escape');
delete moduleSubItems.__teste_escape;
delete moduleLabels.__teste_escape;

check('apóstrofo escapado', htmlEscape.includes('Log&#39;s'));
check('aspas duplas escapadas', htmlEscape.includes('&quot;ZQXA&quot;'));
check('& e < escapados', htmlEscape.includes('&amp;') && htmlEscape.includes('&lt;b&gt;'));
check('nenhum apóstrofo cru dentro de atributo', !/data-busca="[^"]*'/.test(htmlEscape));
// O jeito direto de dizer a mesma coisa: nenhum trecho cru do rótulo sobrou.
// Se `"ZQXA"` aparecer com as aspas de verdade, o atributo já fechou cedo.
check('nenhuma aspa dupla crua no HTML', !htmlEscape.includes('"ZQXA"') && !htmlEscape.includes('"ZQXB"'));
check('nenhuma tag crua vinda do rótulo', !htmlEscape.includes('<b>'));
// E os rótulos de verdade continuam saindo íntegros.
check('rótulo real sem escape sobrando', !/&amp;(amp|quot|#39);/.test(htmlVendas));

console.log(falhas === 0 ? '\n===== TODOS OS CHECKS PASSARAM =====\n' : `\n===== ${falhas} CHECK(S) FALHARAM =====\n`);
process.exit(falhas === 0 ? 0 : 1);
