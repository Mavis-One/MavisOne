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
// nova_nfe_avulsa não tem arquivo próprio: é apelido registrado dentro do
// emitir_nfe_focus.js. Por isso as duas fontes bastam para cobrir os três.
const fontesFinance = nfeEmitidasSrc + emitirFocusSrc;
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
// "Nova NF-e Avulsa" é apelido de emitir_nfe_focus.js desde a unificação — o
// arquivo que tinha esse nome era código morto e foi apagado (ver
// test-nfe-avulsa.js). Sobra uma tela real a conferir aqui.
[['nfe_emitidas.js', nfeEmitidasSrc]].forEach(([nome, src]) => {
  check(`${nome} define moduloAtual()`, /const moduloAtual = \(\) =>/.test(src));
  check(`${nome} considera o Fiscal`, /activeModule === 'fiscal'/.test(src));
});
// Sobram os saltos legítimos: para a venda (sales) e para o lançamento
// (lancamentos), telas que existem em um módulo só.
const fixosRestantes = [...nfeEmitidasSrc.matchAll(/loadModule\('finance'\)/g)].length;
check('nfe_emitidas só mantém o loadModule fixo do salto para Lançamentos', fixosRestantes === 1, `${fixosRestantes} ocorrência(s)`);

console.log('\n--- Vendas mostra a MESMA lista, não uma paralela ---');
// Vendas tinha lista própria, alimentada por /api/sales/records?view=nfes, que
// lê `data.nfes` — o registro MANUAL antigo. Nota transmitida à SEFAZ vive na
// tabela `nfe` e não entrava ali. Medido em 17/08/2026: Vendas mostrava 1 nota
// e a lista unificada, 9 — as duas NF-e AUTORIZADAS, com DANFE e protocolo,
// eram invisíveis. E nada avisava: cabeçalho, tabela e contagem pareciam
// certos, então quem conferisse faturamento por Vendas concluiria que as notas
// não saíram.
const blocoVendasNfes = appSrc.slice(appSrc.indexOf("if (sub === 'nfes')"), appSrc.indexOf("if (sub === 'new_nfe')"));
check('o bloco de Vendas foi encontrado', blocoVendasNfes.length > 100, `${blocoVendasNfes.length} caracteres`);
check('Vendas delega para a tela do Financeiro',
  /MavisSubscreenRegistry\?\.finance\?\.nfe_emitidas/.test(blocoVendasNfes));
// A consulta paralela é o que fazia a lista divergir — não pode voltar.
check('e não consulta mais a lista paralela', !/view=nfes/.test(blocoVendasNfes));
check('nem monta tabela própria de NF-e', !/<thead>[\s\S]{0,200}Número/.test(blocoVendasNfes));
// Mesma defesa do espelho do Fiscal: falta da tela vira mensagem, não branco.
check('resolve na chamada e explica se faltar',
  /typeof tela !== 'function'/.test(blocoVendasNfes) && /não está carregada agora/.test(blocoVendasNfes));
// O menu de Vendas prometia DANFE, XML e cancelamento numa tela que não tinha
// nenhum dos três. Agora tem — e a promessa precisa continuar verdadeira.
const itemVendas = moduleSubItems.sales.find((i) => i.key === 'nfes');
check('o item de Vendas continua no menu', Boolean(itemVendas), itemVendas ? itemVendas.label : 'AUSENTE');
check('e as três telas apontam para o mesmo lugar',
  Boolean(moduleSubItems.finance.find((i) => i.key === 'nfe_emitidas'))
  && Boolean(moduleSubItems.fiscal.find((i) => i.key === 'nfe_emitidas'))
  && Boolean(itemVendas));

console.log('\n--- e "Nova NF-e Avulsa" de Vendas é a tela da Focus ---');
// Aqui havia um formulário de SEIS campos digitados à mão (número, cliente,
// data, valor, status, chave) gravando em `data.nfes`. Ele NÃO emitia: nenhuma
// linha saía para a SEFAZ. Produzia um registro com "número" e "chave"
// escolhidos por quem digitou, exibido na lista ao lado das notas de verdade.
//
// Nota fiscal não se digita: é transmitida, e número, série, chave e protocolo
// vêm da SEFAZ. O formulário era um caminho para inventar documento fiscal por
// engano.
const blocoNovaNfe = appSrc.slice(appSrc.indexOf("if (sub === 'new_nfe')"), appSrc.indexOf("if (sub === 'import_logs')"));
check('o bloco foi encontrado', blocoNovaNfe.length > 100, `${blocoNovaNfe.length} caracteres`);
check('Vendas delega para a tela da Focus',
  /MavisSubscreenRegistry\?\.finance\?\.nova_nfe_avulsa/.test(blocoNovaNfe));
check('o formulário digitado à mão saiu', !/salesNfeForm/.test(appSrc));
// A trava que importa: nenhuma TELA pode voltar a criar nota manual por aqui.
const criaNfeManual = /type: 'nfe'/.test(appSrc);
check('nenhuma tela cria mais NF-e manual', !criaNfeManual);
check('e a delegação explica se a tela faltar',
  /typeof tela !== 'function'/.test(blocoNovaNfe) && /emitir_nfe_focus\.js/.test(blocoNovaNfe));
// O apelido é o que faz a delegação funcionar; se ele sumir, Vendas cai na
// mensagem de "não carregada" sem ninguém perceber.
check('finance ainda registra o apelido nova_nfe_avulsa',
  /MavisSubscreenRegistry\.finance\.nova_nfe_avulsa\s*=/.test(emitirFocusSrc));

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

console.log('\n--- o cadastro fiscal tem entrada de menu própria ---');
// Ela existia só como destino de um botão dentro de "Empresa". Fora desta
// lista, o label do topo vem vazio (é daqui que ele é lido) e a tela abre sem
// nome nem caminho, como se fosse a mesma tela de onde se veio.
const chavesSettings = (moduleSubItems.settings || []).map((i) => i.key);
check('settings tem a subtela fiscal', chavesSettings.includes('fiscal'), chavesSettings.join(', '));
const itemFiscalSettings = (moduleSubItems.settings || []).find((i) => i.key === 'fiscal');
check('e ela tem label (senão o título do topo fica em branco)', Boolean(itemFiscalSettings?.label), itemFiscalSettings?.label);
const settingsIndexSrc = ler('public/modules/settings/index.js');
check('e o index de Configurações a aceita', /allowedSubs = \[[^\]]*'fiscal'/.test(settingsIndexSrc));

console.log('\n--- o token da Focus tem os três estados: gravar, apagar e não mexer ---');
const telaFiscalSrc = ler('public/modules/settings/subs/fiscal.js');
// Só "gravar se veio preenchido" deixava o estabelecimento sem caminho de volta
// para "sem token": um token errado podia ser sobrescrito, nunca removido.
check('a tela oferece remover o token salvo', /name="removerFocusToken"/.test(telaFiscalSrc));
check('só quando existe token para remover', /isEditing && estabForm\.focusTokenConfigured \?/.test(telaFiscalSrc));
check('e pede confirmação antes (não tem desfazer)', /payload\.removerFocusToken\) \{[\s\S]{0,200}confirmModal/.test(telaFiscalSrc));
check('o remover entra no payload', /removerFocusToken: formData\.get\('removerFocusToken'\) === 'on'/.test(telaFiscalSrc));
// Campo desabilitado não entra no FormData: é assim que os dois pedidos nunca
// chegam juntos ao servidor.
check('marcar remover desabilita o campo de token', /campoToken\.disabled = removerTokenCheck\.checked/.test(telaFiscalSrc));
check('o banco apaga token e data de cadastro', /removerFocusToken\) \{\n\s*fields\.focus_token_cifrado = null;\n\s*fields\.focus_cadastrado_em = null;/.test(dbFiscalSrc));
check('e o apagar tem precedência sobre o gravar', /removerFocusToken\)[\s\S]{0,160}\} else if \(payload\.focusToken\)/.test(dbFiscalSrc));

console.log('\n--- recusa do banco chega legível na tela ---');
// A trigger estabelecimento_valida_cnpj_raiz já escreve a mensagem pronta;
// passar pelo assertNoError prefixava com o nome da função interna.
check('P0001 (raise da trigger) preserva a mensagem', /error\.code === 'P0001'[\s\S]{0,120}new Error\(error\.message\)/.test(dbFiscalSrc));
check('CNPJ repetido diz que é CNPJ repetido', /23505[\s\S]{0,160}Já existe um estabelecimento cadastrado com este CNPJ/.test(dbFiscalSrc));
check('e as duas escritas usam esse tratamento', (dbFiscalSrc.match(/assertEstabelecimentoValido\(error, '(create|update)Estabelecimento'\)/g) || []).length === 2);
check('a trigger que gera o P0001 existe no schema', /estabelecimento_valida_cnpj_raiz/.test(ler('supabase/schema.sql')));

console.log(falhas === 0 ? '\n===== TODOS OS CHECKS PASSARAM =====\n' : `\n===== ${falhas} CHECK(S) FALHARAM =====\n`);
process.exit(falhas === 0 ? 0 : 1);
