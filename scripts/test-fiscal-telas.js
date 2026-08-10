// As telas novas do módulo Fiscal, sem banco e sem rede.
//
// Cobre o que quebra em silêncio:
//   1. o espelho de NF-e apontando para uma tela que o Financeiro não registra
//      mais (a tela abriria vazia, sem erro nenhum);
//   2. a navegação entre "NF-e Emitidas" e "Nova NF-e Avulsa" voltando com
//      'finance' fixo — quem entrasse pelo Fiscal seria jogado no Financeiro;
//   3. item de menu sem tela registrada, e tela registrada fora do menu;
//   4. a leitura de eventos filtrando por nfe_id (era esse filtro que fazia a
//      inutilização, gravada há tempo, não aparecer em lugar nenhum).
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
// Normaliza CRLF: os arquivos são gravados com quebra do Windows, e recortar
// corpo de função procurando '\n}\n' não casava com '\r\n}\r\n'. O recorte
// saía vazio — e um corpo vazio faz todo check do tipo "NÃO contém X" passar
// sozinho, que é pior do que falhar.
const ler = (p) => fs.readFileSync(path.join(RAIZ, p), 'utf8').replace(/\r\n/g, '\n');

const appSrc = ler('public/app.js');
const dbFiscalSrc = ler('lib/db/fiscal.js');
const serverSrc = ler('server.js');
const indexSrc = ler('public/index.html');
const espelhoSrc = ler('public/modules/fiscal/subs/nfe_espelho.js');
const nfeEmitidasSrc = ler('public/modules/finance/subs/nfe_emitidas.js');
const novaNfeSrc = ler('public/modules/finance/subs/nova_nfe_avulsa.js');

function extrairConst(nome) {
  const i = appSrc.indexOf(`const ${nome} = {`);
  const a = appSrc.indexOf('{', i);
  const f = appSrc.indexOf('\n};', a);
  return (0, eval)('(' + appSrc.slice(a, f + 2) + ')');
}
const moduleSubItems = extrairConst('moduleSubItems');

let falhas = 0;
const check = (n, c, d) => { console.log(`${c ? '  OK ' : '  XX '} ${n}${d ? ' -> ' + d : ''}`); if (!c) falhas++; };

const chavesFiscal = moduleSubItems.fiscal.map((i) => i.key);

console.log('\n--- as telas pedidas estão no menu do Fiscal ---');
const ESPERADAS = ['nfe_emitidas', 'emitir_nfe_focus', 'nova_nfe_avulsa', 'inutilizadas', 'inutilizar', 'eventos', 'logs', 'tabelas', 'regras'];
ESPERADAS.forEach((k) => {
  const item = moduleSubItems.fiscal.find((i) => i.key === k);
  check(`fiscal.${k}`, Boolean(item), item ? item.label : 'AUSENTE');
});
check('nenhuma chave repetida', new Set(chavesFiscal).size === chavesFiscal.length);

console.log('\n--- toda tela do menu tem quem a desenhe ---');
// Lê os arquivos do módulo de verdade, em vez de confiar numa lista à parte.
const registradas = new Set();
(function anda(dir) {
  for (const nome of fs.readdirSync(dir)) {
    const p = path.join(dir, nome);
    if (fs.statSync(p).isDirectory()) { anda(p); continue; }
    if (!nome.endsWith('.js')) continue;
    const src = fs.readFileSync(p, 'utf8');
    for (const m of src.matchAll(/MavisSubscreenRegistry\.fiscal\.([a-z_0-9]+)\s*=/gi)) registradas.add(m[1]);
  }
})(path.join(RAIZ, 'public/modules/fiscal'));
moduleSubItems.fiscal.filter((i) => !i.pendente).forEach((i) => {
  check(`fiscal.${i.key} tem tela registrada`, registradas.has(i.key), registradas.has(i.key) ? '' : 'SEM TELA — abriria em branco');
});

console.log('\n--- e nenhuma tela registrada ficou fora do menu ---');
const foraDoMenu = [...registradas].filter((k) => !chavesFiscal.includes(k));
check('nenhuma tela órfã', foraDoMenu.length === 0, foraDoMenu.join(', ') || 'nenhuma');

console.log('\n--- todos os arquivos novos são carregados pelo index.html ---');
['shared.js', 'subs/eventos.js', 'subs/inutilizar.js', 'subs/logs.js', 'subs/regras.js', 'subs/nfe_espelho.js'].forEach((arq) => {
  check(`index.html carrega fiscal/${arq}`, indexSrc.includes(`/modules/fiscal/${arq}`));
});
// shared.js define MavisFiscalDocs, que os subs recebem NA CARGA (IIFE). Se
// vier depois, eles recebem undefined e o módulo inteiro morre no load.
const posShared = indexSrc.indexOf('/modules/fiscal/shared.js');
const posPrimeiroSub = Math.min(
  ...['subs/eventos.js', 'subs/inutilizar.js', 'subs/logs.js', 'subs/regras.js']
    .map((a) => indexSrc.indexOf(`/modules/fiscal/${a}`))
    .filter((i) => i >= 0)
);
check('shared.js carrega ANTES dos subs que o consomem', posShared >= 0 && posShared < posPrimeiroSub,
  `shared em ${posShared}, primeiro sub em ${posPrimeiroSub}`);

console.log('\n--- o espelho aponta para telas que o Financeiro registra ---');
// O espelho delega em vez de copiar. Se o Financeiro parar de registrar, o
// Fiscal perde as duas — este check é quem avisa.
const emitirFocusSrc = ler('public/modules/finance/subs/emitir_nfe_focus.js');
const fontesFinance = nfeEmitidasSrc + novaNfeSrc + emitirFocusSrc;
['nfe_emitidas', 'nova_nfe_avulsa', 'emitir_nfe_focus'].forEach((k) => {
  check(`espelho declara fiscal.${k}`, espelhoSrc.includes(`fiscal.${k}`));
  const registradoEmFinance = new RegExp(`MavisSubscreenRegistry\\.finance\\.${k}\\s*=`).test(fontesFinance);
  check(`finance ainda registra ${k}`, registradoEmFinance, registradoEmFinance ? '' : 'O ESPELHO FICARIA VAZIO');
});
check('o espelho resolve na chamada, não na carga',
  /function\s*\(ctx\)|=>\s*\{/.test(espelhoSrc) && espelhoSrc.includes('MavisSubscreenRegistry.finance?.'));

console.log('\n--- a volta entre as irmãs respeita o módulo de origem ---');
// Este é o erro que o espelho cria se ninguém olhar: clicar "+ Nova NF-e"
// dentro do Fiscal e ser jogado no Financeiro.
[['nfe_emitidas.js', nfeEmitidasSrc], ['nova_nfe_avulsa.js', novaNfeSrc]].forEach(([nome, src]) => {
  check(`${nome} define moduloAtual()`, /const moduloAtual = \(\) =>/.test(src));
  check(`${nome} considera o Fiscal`, /activeModule === 'fiscal'/.test(src));
});
// Sobram os saltos legítimos: para a venda (sales) e para o lançamento
// (lancamentos), telas que existem em um módulo só.
const fixosRestantes = [...nfeEmitidasSrc.matchAll(/loadModule\('finance'\)/g)].length;
check('nfe_emitidas só mantém o loadModule fixo do salto para Lançamentos', fixosRestantes === 1, `${fixosRestantes} ocorrência(s)`);
check('nova_nfe_avulsa não tem mais loadModule fixo', !/loadModule\('finance'\)/.test(novaNfeSrc));

console.log('\n--- a leitura de eventos enxerga a inutilização ---');
// getNfeEventos filtra por nfe_id; inutilização tem nfe_id NULO. Era por isso
// que ela nunca aparecia. getEventosFiscais não pode repetir esse filtro.
check('getEventosFiscais existe', /async function getEventosFiscais/.test(dbFiscalSrc));
check('e está exportada', /^\s*getEventosFiscais,/m.test(dbFiscalSrc));
const inicioFn = dbFiscalSrc.indexOf('async function getEventosFiscais');
const corpo = dbFiscalSrc.slice(inicioFn);
const fimFn = corpo.indexOf('\n}\n');
// Guarda contra o recorte silencioso: um corpo vazio faria os checks de
// ausência abaixo passarem sem olhar nada.
check('o corpo da função foi recortado de verdade', inicioFn >= 0 && fimFn > 200, `${fimFn} caracteres`);
const corpoFn = corpo.slice(0, fimFn + 2);
check('NÃO filtra por nfe_id (senão a inutilização some de novo)', !/eq\(['"]nfe_id/.test(corpoFn));
check('filtra por estabelecimento', /eq\('estabelecimento_id'/.test(corpoFn));
check('traz a nota embutida numa consulta só', /nfe\(/.test(corpoFn));

console.log('\n--- a rota de eventos existe e pede a permissão certa ---');
check('rota GET /api/fiscal/eventos', serverSrc.includes("pathname === '/api/fiscal/eventos' && req.method === 'GET'"));
check('resolve para fiscal.visualizar', serverSrc.includes("if (pathname === '/api/fiscal/eventos') return 'visualizar';"));
// Só aceita os três tipos que a tabela permite: qualquer outro vira "sem
// filtro", e não um filtro que não casa com nada.
check('o tipo do filtro é validado contra a lista da tabela',
  /\['CCE', 'CANCELAMENTO', 'INUTILIZACAO'\]\.includes/.test(serverSrc));

console.log('\n--- a tela de inutilizar repete as regras da SEFAZ ---');
const inutSrc = ler('public/modules/fiscal/subs/inutilizar.js');
check('exige 15 caracteres de justificativa, como o servidor', /MIN_JUSTIFICATIVA = 15/.test(inutSrc));
check('barra faixa invertida', /fim < ini/.test(inutSrc));
// A confirmação tem que repetir o NÚMERO: é o número que se erra aqui.
check('a confirmação mostra a faixa', /Inutilizar \$\{quantos\}[\s\S]{0,80}do \$\{ini\} ao \$\{fim\}/.test(inutSrc));
check('avisa que não tem volta', /não tem volta|Não tem volta/i.test(inutSrc));

console.log('\n--- Regras Fiscais saiu de "pendente" e virou tela de verdade ---');
const regrasItem = moduleSubItems.fiscal.find((i) => i.key === 'regras');
check('não está mais marcada como pendente', !regrasItem.pendente, regrasItem.pendente ? 'ainda pendente' : 'ok');
const regrasSrc = ler('public/modules/fiscal/subs/regras.js');
check('registra fiscal.regras', /MavisSubscreenRegistry\.fiscal\.regras\s*=/.test(regrasSrc));

console.log('\n--- a tela alcança TODAS as colunas de regra_fiscal ---');
// O CRUD de Configurações só escreve um terço delas. Se a tela do Fiscal
// esquecer uma, o campo volta a ser inalcançável pela interface — e ninguém
// percebe, porque a coluna continua existindo e a emissão lê NULL calado.
const COLUNAS = [
  'tipoOperacao', 'ncm', 'origem', 'ufDestino', 'dentroDoEstado', 'destinatarioContribuinte',
  'cfop', 'csosn', 'cstIcms', 'modalidadeBcIcms', 'aliquotaIcms', 'reducaoBcIcms',
  'aliquotaInternaUfDestino', 'aliquotaFcpUfDestino',
  'cstIcmsSt', 'mvaSt', 'aliquotaIcmsSt', 'cstPis', 'aliquotaPis', 'cstCofins', 'aliquotaCofins',
  'cstIpi', 'aliquotaIpi', 'codigoEnquadramentoIpi', 'prioridade', 'vigenciaInicio', 'vigenciaFim',
  'observacaoFisco'
];
// O campo pode vir escrito à mão (`name="cfop"`) ou montado pelos helpers
// campoCodigo/campoTriEstado, que recebem o nome como argumento — os dois
// terminam no mesmo input, então valem igual aqui.
const temCampo = (c) => new RegExp(`name="${c}"`).test(regrasSrc)
  || new RegExp(`campo(Codigo|TriEstado)\\('${c}'`).test(regrasSrc);
const ausentes = COLUNAS.filter((c) => !temCampo(c));
check('todo campo da tabela tem input na tela', ausentes.length === 0, ausentes.join(', ') || 'nenhum faltando');
// E o submit tem que ENVIAR todos: ter o input e não mandar o valor é a
// mesma falha, só que mais difícil de ver.
const semEnvio = COLUNAS.filter((c) => !new RegExp(`'${c}'`).test(regrasSrc));
check('e todos entram no payload do submit', semEnvio.length === 0, semEnvio.join(', ') || 'nenhum faltando');

console.log('\n--- alíquota ZERO é gravada como 0, não como NULL ---');
// `valor || null` transformaria 0 em NULL, e 0% é o que uma regra de CST 40
// (isento) precisa gravar — não é "campo em branco".
check('buildRegraFiscalFields usa numeroOuNulo', /function numeroOuNulo/.test(dbFiscalSrc));
check('e não usa `|| null` nas alíquotas', !/aliquota_icms: payload\.aliquotaIcms \|\| null/.test(dbFiscalSrc));

console.log('\n--- o simulador responde com a MESMA função da emissão ---');
check('rota GET /api/fiscal/regras/simular', serverSrc.includes("pathname === '/api/fiscal/regras/simular' && req.method === 'GET'"));
check('usa resolverRegraFiscal (a da emissão)', /simular[\s\S]{0,1400}fiscalDb\.resolverRegraFiscal/.test(serverSrc));
check('simular é leitura: pede fiscal.visualizar', serverSrc.includes("if (pathname === '/api/fiscal/regras/simular') return 'visualizar';"));
// Ordem importa: o startsWith('/api/fiscal/regras/') logo abaixo devolveria
// 'regras' e quem só consulta não conseguiria simular.
check('e vem ANTES da regra genérica de /regras/',
  serverSrc.indexOf("'/api/fiscal/regras/simular') return 'visualizar'") < serverSrc.indexOf("startsWith('/api/fiscal/regras/')) return 'regras'"));

console.log('\n--- o NCM do produto chega mesmo ao banco ---');
// Era o furo entre cadastrar produto e emitir nota: os campos fiscais viviam
// só no db.json local, e a emissão lê o Supabase — a regra nunca casava.
const estoqueSrc = ler('lib/db/estoque.js');
const stockCoreSrc = ler('lib/stock-core.js');
check('upsertProduct grava as colunas fiscais', /camposFiscaisDoProduto\(payload\)/.test(estoqueSrc));
['ncm', 'cest', 'unidade_comercial', 'unidade_tributavel', 'ean', 'origem', 'numero_fci'].forEach((coluna) => {
  check(`coluna ${coluna} mapeada`, new RegExp(`'${coluna}'`).test(estoqueSrc));
});
// Campo omitido não pode virar null: a baixa de estoque de um pedido chama
// upsertProduct com o produto inteiro e apagaria o NCM sem querer.
check('campo omitido não é escrito (não apaga o NCM na baixa de estoque)',
  /payload\[chave\] === undefined\) continue/.test(estoqueSrc));
check('NCM e EAN saíram do meta local', !/'ean', 'ncm'/.test(stockCoreSrc));
check('e são lidos da coluna, com o meta como fallback',
  /ncm: product\.ncm \|\| meta\.ncm/.test(stockCoreSrc));
check('a rota de produto envia os campos fiscais', /unidadeTributavel: String\(body\.unidadeTributavel/.test(serverSrc));

console.log('\n--- a emissão usa o cadastro do produto, não o digitado ---');
check('emitirNfeFiscal lê o produto por produtoId', /bruto\.produtoId \? await db\.getProductById/.test(serverSrc));
check('NCM do cadastro tem precedência sobre o digitado', /ncm: produto\.ncm \|\| bruto\.ncm/.test(serverSrc));
check('item sem NCM é recusado com mensagem que diz onde resolver',
  /está sem NCM[\s\S]{0,200}Estoque → Produtos/.test(serverSrc));
check('/api/finance/meta expõe os produtos com classificação fiscal', /produtos: \(await db\.getProducts\(\)\)/.test(serverSrc));

console.log('\n--- o gate do Fiscal aceita quem tem o módulo Fiscal ---');
// 'fiscal' é módulo escolhível na tela de Usuários; sem ele aqui, marcar o
// módulo + as permissões não dava acesso nenhum.
check("o gate considera allowedModules 'fiscal'", /allowedModules\.includes\('fiscal'\)/.test(serverSrc));

console.log(falhas === 0 ? '\n===== TODOS OS CHECKS PASSARAM =====\n' : `\n===== ${falhas} CHECK(S) FALHARAM =====\n`);
process.exit(falhas === 0 ? 0 : 1);
