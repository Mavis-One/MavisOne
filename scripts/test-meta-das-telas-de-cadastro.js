#!/usr/bin/env node
// CADA TELA DAS FÁBRICAS PEDE DA META SÓ O QUE LÊ — E LÊ TUDO O QUE PEDE.
//
// O PROBLEMA, MEDIDO (rodada de desempenho, out/2026)
// ---------------------------------------------------
// As fábricas de public/modules/cadastros/shared.js desenham ~54 telas
// (Cadastros, RH, PCP, Frota, Contratos), e toda abertura pedia a meta inteira
// do módulo antes de desenhar. A de Cadastros:
//
//     /api/cadastros/meta ...... 1.403 KB cru / 372 KB gzip, ~700 ms
//
// Dez telas de Cadastros não liam NADA dela (Contatos, Empresas, Status de
// Venda...), e outras seis liam uma lista de 0,1 a 13 KB (usuários,
// estabelecimentos, contas). Contatos abria em 1,7 s, dos quais 1,6 s
// esperando a meta.
//
// O QUE MUDOU
// -----------
//   - `metaPartes: [...]` nas telas de Cadastros: /api/cadastros/meta?partes=
//     monta e devolve só aquelas chaves; `[]` não pede nada;
//   - `metaEndpoint: null` nas telas de RH, PCP, Frota e Contratos que não leem
//     a meta do próprio módulo;
//   - a meta e a lista (ou o registro em edição) saem JUNTAS, e não em fila.
//
// O RISCO QUE ESTE TESTE SEGURA
// -----------------------------
// Parte esquecida não dá erro: dá select vazio. E num formulário de EDIÇÃO é
// pior — o select fica só com "Nenhuma", o salvar manda '' e o servidor grava
// '' por cima do vínculo (lib/cadastros-core.js: `text(body.x ?? current.x)`).
// Perda de dado em silêncio.
//
// POR EXECUÇÃO, E NÃO SÓ POR REGEX. Cada `options(meta)` e cada
// `render(item, meta, itens)` das telas roda com uma meta que ANOTA as chaves
// lidas (Proxy). Um grep por `meta.X` erra para os dois lados: acusa a variável
// local `meta` de agenda.js (prioridade da tarefa) e não enxerga
// `({ users }) => users`. A regex fica como segunda rede, só nas funções que
// recebem a meta como parâmetro.
//
// E as fábricas REAIS rodam também (num vm, com DOM de mentira), para conferir
// o endereço que cada tela pede de verdade e que meta e lista saem juntas.
//
// SEM BANCO.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RAIZ = path.join(__dirname, '..');
const ler = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8').replace(/\r\n/g, '\n');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};

const COMUNS = [
  'public/modules/shared/rotulo_produto.js',
  'public/modules/shared/campo_de_busca.js',
  'public/modules/shared/bandeira_cartao.js',
  'public/modules/cadastros/shared.js'
];
const DIR_CADASTROS = 'public/modules/cadastros/subs';
const OUTROS = [
  'public/modules/hr/subs/rh.js',
  'public/modules/pcp/subs/pcp.js',
  'public/modules/fleet/subs/frota.js',
  'public/modules/contracts/subs/contratos.js'
];

// Um contexto novo por arquivo: nada de uma tela vaza para a outra.
function novoContexto() {
  const window = { MavisSubscreenRegistry: {} };
  const sandbox = {
    window,
    document: { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] },
    console,
    // Só é chamado quando uma lista passa do limite e vira campo de busca.
    renderSearchableSelect: () => '<input />'
  };
  vm.createContext(sandbox);
  for (const rel of COMUNS) vm.runInContext(ler(rel), sandbox, { filename: rel });
  return sandbox;
}

// Captura as configs SEM desenhar: as fábricas reais ficam guardadas para a
// segunda metade do teste.
function capturarConfigs(rel) {
  const sb = novoContexto();
  const C = sb.window.MavisCadastros;
  const configs = [];
  for (const nome of ['makeListScreen', 'makeFormScreen', 'makeInlineRegisterScreen']) {
    const original = C[nome];
    C[nome] = (cfg) => { configs.push({ fabrica: nome, cfg }); return original(cfg); };
  }
  vm.runInContext(ler(rel), sb, { filename: rel });
  return { sb, configs };
}

// Meta que anota cada chave lida. Devolve [] para qualquer chave: o que se
// quer saber é SE a tela lê, não o que ela faria com o dado.
function metaQueAnota() {
  const lidas = new Set();
  const proxy = new Proxy({}, {
    get(_, chave) {
      if (typeof chave === 'string' && chave !== 'then') lidas.add(chave);
      return [];
    },
    ownKeys() { lidas.add('<todas, por espalhamento>'); return []; }
  });
  return { proxy, lidas };
}

// Item "permissivo": todo campo existe e é texto, para entrar nos ramos que só
// leem a meta quando o item tem valor (contas_bancarias.js só procura o
// estabelecimento quando a conta tem estabelecimentoId).
const itemPermissivo = new Proxy({}, {
  get: (_, k) => (k === Symbol.toPrimitive ? () => 'x' : (['brands', 'formas', 'roles'].includes(k) ? [] : 'x'))
});

function camposDe(cfg) {
  return [
    ...(cfg.filters || []), ...(cfg.fields || []),
    ...(cfg.sections || []).flatMap((s) => s.fields || []),
    ...(cfg.tabs || []).flatMap((t) => (t.sections || []).flatMap((s) => s.fields || []))
  ];
}

// O que a tela lê da meta, executando cada função que a recebe.
function leiturasPorExecucao(cfg) {
  const { proxy, lidas } = metaQueAnota();
  camposDe(cfg).forEach((def) => {
    if (typeof def.options === 'function') { try { def.options(proxy); } catch (e) { /* lido até onde deu */ } }
  });
  (cfg.columns || []).forEach((col) => { try { col.render(itemPermissivo, proxy, [itemPermissivo]); } catch (e) { /* idem */ } });
  return [...lidas];
}

// Segunda rede, por texto: SÓ nas funções que recebem a meta como parâmetro
// (options: o 1º; render: o 2º). Assim a variável local `meta` de agenda.js
// não conta, e `meta.X` dentro de uma função que recebe a meta conta.
function parametros(fn) {
  const fonte = Function.prototype.toString.call(fn);
  const m = /^\s*(?:async\s*)?(?:function\s*[\w$]*\s*)?\(([^)]*)\)/.exec(fonte) || /^\s*(?:async\s+)?([\w$]+)\s*=>/.exec(fonte);
  return m ? m[1].split(',').map((p) => p.trim().replace(/=.*$/, '').trim()) : [];
}
function leiturasPorTexto(cfg) {
  const achadas = new Set();
  const varrer = (fn, posicao) => {
    if (typeof fn !== 'function') return;
    const nome = parametros(fn)[posicao];
    if (!nome || !/^[\w$]+$/.test(nome)) return;
    const corpo = Function.prototype.toString.call(fn);
    for (const m of corpo.matchAll(new RegExp(`\\b${nome.replace('$', '\\$')}\\.([\\w$]+)`, 'g'))) achadas.add(m[1]);
  };
  camposDe(cfg).forEach((def) => varrer(def.options, 0));
  (cfg.columns || []).forEach((col) => varrer(col.render, 1));
  return [...achadas];
}

// Função da config que cita a meta de qualquer jeito: QUALQUER função
// pendurada na config, em qualquer profundidade — inclusive `ctx.meta` de uma
// ação de linha, que nenhuma execução acima alcança.
function funcoesDa(valor, vistos = new Set()) {
  if (!valor || typeof valor !== 'object' || vistos.has(valor)) return [];
  vistos.add(valor);
  return Object.values(valor).flatMap((v) => (typeof v === 'function' ? [v] : funcoesDa(v, vistos)));
}
function citaMeta(cfg) {
  return funcoesDa(cfg).filter((fn) => {
    const corpo = Function.prototype.toString.call(fn);
    // A lista crua de parâmetros (antes do `=>` ou do corpo): pega também a
    // meta desestruturada, `(item, { meta }) =>`.
    const cabeca = /^[^=>{]*\(([^)]*)\)|^\s*(?:async\s+)?([\w$]+)\s*=>/.exec(corpo);
    const recebeMeta = Boolean(cabeca) && /\bmeta\b/.test(cabeca[1] || cabeca[2] || '');
    return recebeMeta || /\.meta\b/.test(corpo) || /\{[^}]*\bmeta\b[^}]*\}\s*=/.test(corpo);
  }).length > 0;
}

// --- 1. as partes que o servidor conhece --------------------------------------
console.log('--- 1. o servidor conhece cada parte, e monta cada uma ---');
const servidor = ler('server.js');
const listaServidor = /const PARTES_DA_META_DE_CADASTROS = Object\.freeze\(\[([\s\S]*?)\]\);/.exec(servidor);
check('a lista única de partes existe no server.js', Boolean(listaServidor));
const PARTES = listaServidor ? [...listaServidor[1].matchAll(/'([^']+)'/g)].map((m) => m[1]) : [];
check('  com as onze chaves da meta inteira', PARTES.length === 11, PARTES.join(', '));
const rota = servidor.slice(
  servidor.indexOf("if (pathname === '/api/cadastros/meta' && req.method === 'GET')"),
  servidor.indexOf("if (pathname === '/api/cadastros/product-cashbacks' && req.method === 'GET')")
);
PARTES.forEach((parte) => {
  check(`  a rota monta \`${parte}\` só quando pedida`, new RegExp(`if \\(quer\\('${parte}'\\)\\)`).test(rota));
});
check('parte desconhecida é recusada com 400, citando as válidas',
  /desconhecidas\.length[\s\S]{0,300}As partes são: \$\{PARTES_DA_META_DE_CADASTROS\.join/.test(rota) && /\}, 400\);/.test(rota));
check('a permissão é conferida ANTES de qualquer carga',
  rota.indexOf('getCurrentUser(req)') > -1 && rota.indexOf('getCurrentUser(req)') < rota.indexOf('loadData()'));
check('a meta não lê mais o Financeiro inteiro', !/syncFinanceData\(/.test(rota));
check('  só as contas, e antes de usá-las',
  /quer\('bankAccounts'\) \? syncContasBancarias\(data\)/.test(rota)
  && rota.indexOf('syncContasBancarias(data)') < rota.indexOf('resposta.bankAccounts = data.bankAccounts'));
check('  com o helper buscando as contas na mesma função de sempre',
  /async function syncContasBancarias\(data\) \{\s*\n\s*data\.bankAccounts = await db\.getBankAccounts\(\);/.test(servidor));
check('cadastro e NF-e continuam sincronizados antes do uso',
  /await syncCadastroData\(data\)/.test(rota) && /syncNfeData\(data\)/.test(rota));

// --- 2. o endereço, por config ------------------------------------------------
console.log('\n--- 2. a regra do endereço (enderecoDaMeta) ---');
{
  const C = novoContexto().window.MavisCadastros;
  check('nada declarado: a meta inteira de Cadastros, como sempre',
    C.enderecoDaMeta({}) === '/api/cadastros/meta');
  check('metaPartes: [] não pede nada', C.enderecoDaMeta({ metaPartes: [] }) === null);
  check('metaPartes com partes pede só elas',
    C.enderecoDaMeta({ metaPartes: ['directory', 'users'] }) === '/api/cadastros/meta?partes=directory,users');
  check('metaEndpoint null vale mais que metaPartes',
    C.enderecoDaMeta({ metaEndpoint: null, metaPartes: ['users'] }) === null);
  check('metaEndpoint de outro módulo vale mais que metaPartes',
    C.enderecoDaMeta({ metaEndpoint: '/api/hr/meta', metaPartes: ['users'] }) === '/api/hr/meta');
}

// --- 3. cada tela ----------------------------------------------------------------
const telas = [];
for (const arq of fs.readdirSync(path.join(RAIZ, DIR_CADASTROS)).filter((f) => f.endsWith('.js')).sort()) {
  const rel = `${DIR_CADASTROS}/${arq}`;
  const { configs } = capturarConfigs(rel);
  configs.forEach(({ fabrica, cfg }) => telas.push({ rel, nome: arq.replace(/\.js$/, ''), modulo: 'cadastros', fabrica, cfg }));
}
for (const rel of OUTROS) {
  const { configs } = capturarConfigs(rel);
  configs.forEach(({ fabrica, cfg }) => telas.push({ rel, nome: cfg.title, modulo: cfg.module, fabrica, cfg }));
}

console.log('\n--- 3. Cadastros: toda tela declara metaPartes, e as partes cobrem o que ela lê ---');
const deCadastros = telas.filter((t) => t.modulo === 'cadastros');
check('as fábricas de Cadastros desenham 20 telas', deCadastros.length === 20, String(deCadastros.length));
deCadastros.forEach(({ nome, cfg }) => {
  const declaradas = Array.isArray(cfg.metaPartes) ? cfg.metaPartes : null;
  const exec = leiturasPorExecucao(cfg);
  const texto = leiturasPorTexto(cfg);
  const lidas = [...new Set([...exec, ...texto])];
  const faltando = declaradas ? lidas.filter((k) => !declaradas.includes(k)) : ['(sem metaPartes)'];
  const desconhecidas = (declaradas || []).filter((p) => !PARTES.includes(p));
  const aToa = (declaradas || []).filter((p) => !lidas.includes(p));
  const ok = declaradas && cfg.metaEndpoint === undefined && !faltando.length && !desconhecidas.length && !aToa.length
    && (declaradas.length || !citaMeta(cfg));
  check(`${nome.padEnd(22)} pede [${(declaradas || []).join(', ')}]`, ok,
    faltando.length ? `LÊ SEM PEDIR: ${faltando.join(', ')}`
      : desconhecidas.length ? `PARTE QUE O SERVIDOR NÃO CONHECE: ${desconhecidas.join(', ')}`
        : aToa.length ? `PEDE SEM LER: ${aToa.join(', ')}`
          : cfg.metaEndpoint !== undefined ? 'usa metaEndpoint em vez de metaPartes'
            : (!declaradas.length && citaMeta(cfg)) ? 'não pede a meta mas uma função cita meta' : undefined);
});

console.log('\n--- 4. RH, PCP, Frota e Contratos: quem não lê a meta não a pede ---');
const deOutros = telas.filter((t) => t.modulo !== 'cadastros');
check('as telas dos outros módulos foram carregadas', deOutros.length >= 30, String(deOutros.length));
deOutros.forEach(({ modulo, nome, cfg }) => {
  const lidas = [...new Set([...leiturasPorExecucao(cfg), ...leiturasPorTexto(cfg)])];
  const cita = citaMeta(cfg);
  if (cfg.metaEndpoint === null) {
    check(`${modulo}: ${nome} não pede e não lê`, !lidas.length && !cita, lidas.length ? `LÊ: ${lidas.join(', ')}` : (cita ? 'uma função cita meta' : undefined));
  } else {
    // Pede a meta do próprio módulo: tem de ler alguma coisa dela, senão é
    // a mesma espera por nada que a parte acima tirou.
    check(`${modulo}: ${nome} pede ${cfg.metaEndpoint} e lê [${lidas.join(', ')}]`,
      typeof cfg.metaEndpoint === 'string' && (lidas.length > 0 || cita),
      !(lidas.length > 0 || cita) ? 'PEDE A META E NÃO LÊ NADA: use metaEndpoint: null' : undefined);
  }
});

// --- 5. as fábricas reais ---------------------------------------------------------
// Desenha cada tela com as fábricas de verdade e confere o endereço pedido, as
// leituras feitas pelo próprio desenho (o campo de busca também consulta a
// meta) e que meta e lista saem juntas.
console.log('\n--- 5. as fábricas de verdade: o que cada tela pede, e quando ---');

(async () => {
  // Desenho por arquivo: todas as telas registradas, cada uma uma vez.
  const arquivos = [...new Set(telas.map((t) => t.rel))];
  let desenhadas = 0;
  let erradas = 0;
  for (const rel of arquivos) {
    const sb = novoContexto();
    const C = sb.window.MavisCadastros;
    const ordemDasConfigs = [];
    for (const nomeFab of ['makeListScreen', 'makeFormScreen', 'makeInlineRegisterScreen']) {
      const original = C[nomeFab];
      C[nomeFab] = (cfg) => {
        const desenhar = original(cfg);
        ordemDasConfigs.push(cfg);
        return Object.assign(desenhar, { __cfg: cfg });
      };
    }
    vm.runInContext(ler(rel), sb, { filename: rel });
    const registro = Object.values(sb.window.MavisSubscreenRegistry).flatMap((r) => Object.values(r));
    for (const desenhar of registro.filter((r) => r && r.__cfg)) {
      const cfg = desenhar.__cfg;
      const pedidos = [];
      const lidas = new Set();
      C.carregarMetaDaTela = (config) => {
        pedidos.push(C.enderecoDaMeta(config));
        return Promise.resolve(new Proxy({}, {
          get(_, chave) { if (typeof chave === 'string' && chave !== 'then') lidas.add(chave); return []; }
        }));
      };
      let html = '';
      const content = {
        set innerHTML(v) { html = v; }, get innerHTML() { return html; },
        querySelectorAll: () => [], querySelector: () => null
      };
      const state = { cadastroDraft: {} };
      if (cfg.listKey) state.cadastroDraft[`${cfg.listKey}Filters`] = { show: true };
      const api = async (url) => {
        if (cfg.listKey && url === cfg.endpoint) return { [cfg.listKey]: [{ id: 'i1', name: 'Item' }] };
        return {};
      };
      try {
        await desenhar({ content, api, state, showToast: () => {}, loadModule: () => {}, confirmModal: async () => false });
      } catch (erro) {
        erradas += 1;
        check(`${cfg.module || 'cadastros'}: ${cfg.title} desenha`, false, erro.message);
        continue;
      }
      desenhadas += 1;
      const esperado = C.enderecoDaMeta(cfg);
      const declaradas = cfg.metaEndpoint === undefined && Array.isArray(cfg.metaPartes) ? cfg.metaPartes : null;
      const lidasForaDoPedido = esperado === null
        ? [...lidas]
        : (declaradas ? [...lidas].filter((k) => !declaradas.includes(k)) : []);
      if (pedidos.length !== 1 || pedidos[0] !== esperado || lidasForaDoPedido.length || !html) {
        erradas += 1;
        check(`${cfg.module || 'cadastros'}: ${cfg.title}`, false,
          `pediu ${JSON.stringify(pedidos)} (esperado ${JSON.stringify(esperado)}); leu fora do pedido: ${lidasForaDoPedido.join(', ') || '-'}; html ${html.length} B`);
      }
    }
  }
  check(`as ${telas.length} telas desenham com a fábrica real, pedindo o endereço da config`,
    erradas === 0 && desenhadas === telas.length, `${desenhadas} desenhadas, ${erradas} com problema`);

  // --- 6. meta e lista saem juntas ------------------------------------------------
  console.log('\n--- 6. a meta não segura a lista (nem o registro em edição) ---');
  const emParalelo = async (fabrica, cfgExtra, stateExtra) => {
    const sb = novoContexto();
    const C = sb.window.MavisCadastros;
    const pedidos = [];
    let soltar;
    const portao = new Promise((r) => { soltar = r; });
    const api = (url) => { pedidos.push(url); return portao.then(() => (url.startsWith('/api/cadastros/meta') ? { users: [] } : { itens: [], item: { id: 'x1' } })); };
    const cfg = {
      title: 'T', endpoint: '/api/x', listKey: 'itens', itemKey: 'item', editStateKey: 'editX', listSub: 'l',
      metaPartes: ['users'], columns: [{ label: 'A', render: (i) => String(i.id) }], fields: [{ name: 'a', label: 'A' }],
      sections: [{ title: 'S', fields: [{ name: 'a', label: 'A' }] }], ...cfgExtra
    };
    const content = { set innerHTML(v) {}, querySelectorAll: () => [], querySelector: () => null };
    const desenho = C[fabrica](cfg)({
      content, api, state: { cadastroDraft: {}, ...stateExtra }, showToast: () => {}, loadModule: () => {}, confirmModal: async () => false
    });
    // Dá a vez para as fábricas dispararem tudo o que dispariam sem esperar.
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
    const antesDeResponder = pedidos.slice();
    soltar();
    await desenho;
    return antesDeResponder;
  };
  const lista = await emParalelo('makeListScreen', {}, {});
  check('lista: meta e lista pedidas antes de qualquer resposta', lista.length === 2, JSON.stringify(lista));
  const inline = await emParalelo('makeInlineRegisterScreen', {}, {});
  check('cadastro simples: idem', inline.length === 2, JSON.stringify(inline));
  const form = await emParalelo('makeFormScreen', {}, { editX: 'x1' });
  check('formulário em edição: meta e registro juntos', form.length === 2, JSON.stringify(form));

  // --- 7. a meta que volta incompleta avisa --------------------------------------
  console.log('\n--- 7. a meta por partes que volta sem uma parte avisa ---');
  {
    const C = novoContexto().window.MavisCadastros;
    const toasts = [];
    const meta = await C.loadMeta(async () => ({ users: [{ id: 'u' }] }), (m, t) => toasts.push(t), '/api/cadastros/meta?partes=users,directory', ['users', 'directory']);
    check('faltou `directory`: o aviso aparece', toasts.length === 1 && toasts[0] === 'warning', JSON.stringify(toasts));
    check('  e a tela recebe [] no lugar, não undefined', Array.isArray(meta.directory) && meta.directory.length === 0);
    const toasts2 = [];
    await C.loadMeta(async () => ({ users: [] }), (m, t) => toasts2.push(t), '/api/cadastros/meta?partes=users', ['users']);
    check('com tudo o que pediu, nenhum aviso', toasts2.length === 0);
    const vazia = await C.loadMeta(async () => { throw new Error('x'); }, () => {}, null);
    check('sem endereço, a meta vazia tem as onze chaves', PARTES.every((p) => Array.isArray(vazia[p])), Object.keys(vazia).join(','));
  }

  console.log(falhas === 0 ? '\n===== TODOS OS CHECKS PASSARAM =====' : `\n===== ${falhas} FALHA(S) =====`);
  process.exit(falhas === 0 ? 0 : 1);
})().catch((erro) => {
  console.error('O teste quebrou:', erro);
  process.exit(1);
});
