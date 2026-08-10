#!/usr/bin/env node
// Telas de Frota, RH, PCP e Contratos x descritores de lib/db/modulos.js.
//
// A falha que este teste pega não dá erro em lugar nenhum: um campo no
// formulário cujo nome não existe em `campos` do recurso é simplesmente
// IGNORADO na gravação. O usuário preenche, salva, vê "Registro criado" — e o
// dado não foi. Só aparece quando alguém repara que a coluna está sempre vazia.
//
// O mesmo vale para `listKey`/`itemKey`: se a tela lê `res.workSchedules` e o
// descritor devolve `res.schedules`, a lista abre vazia sem nenhum erro.
//
// Roda sem banco e sem rede: carrega os arquivos de tela com fábricas falsas
// que só capturam a configuração declarada.
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');

// lib/db/modulos.js carrega o cliente do Supabase, que recusa a subir sem
// credencial. Este teste não consulta o banco — só lê os DESCRITORES — então
// entram credenciais de mentira, o suficiente para o módulo carregar. Se
// alguma consulta escapar daqui, ela falha na hora em vez de tocar num banco
// de verdade, que é o comportamento desejado num teste offline.
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'chave-de-teste';

const RECURSOS = require(path.join(RAIZ, 'lib', 'db', 'modulos')).RECURSOS;

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};

// --- carrega as telas com fábricas falsas -----------------------------------
const capturadas = [];
const noop = () => '';
global.window = { MavisSubscreenRegistry: {} };
global.window.MavisCadastros = {
  escape: (v) => String(v ?? ''),
  formatBRL: noop, formatDate: noop, badge: noop, statusBadge: noop,
  pageHead: noop, section: noop, options: noop, field: noop, fieldGrid: noop,
  normalizeText: (v) => String(v ?? ''), loadMeta: async () => ({}),
  trashIcon: '', editIcon: '',
  makeListScreen: (cfg) => { capturadas.push({ tipo: 'lista', cfg }); return async () => {}; },
  makeFormScreen: (cfg) => { capturadas.push({ tipo: 'formulario', cfg }); return async () => {}; },
  makeInlineRegisterScreen: (cfg) => { capturadas.push({ tipo: 'inline', cfg }); return async () => {}; }
};

const ARQUIVOS = [
  'public/modules/fleet/subs/frota.js',
  'public/modules/hr/subs/rh.js',
  'public/modules/pcp/subs/pcp.js',
  'public/modules/contracts/subs/contratos.js'
];
ARQUIVOS.forEach((arq) => {
  const caminho = path.join(RAIZ, arq);
  if (!fs.existsSync(caminho)) { check(`${arq} existe`, false, 'ARQUIVO NÃO ENCONTRADO'); return; }
  (0, eval)(fs.readFileSync(caminho, 'utf8').replace(/\r\n/g, '\n'));
});

console.log(`\ntelas carregadas: ${capturadas.length}`);
check('as fábricas capturaram telas', capturadas.length >= 20, String(capturadas.length));

// --- cruzamento -------------------------------------------------------------
const recursoDoEndpoint = (endpoint) => String(endpoint || '').replace(/^\/api\//, '');

console.log('\n--- toda tela aponta para um recurso que existe ---');
capturadas.forEach(({ cfg }) => {
  const recurso = recursoDoEndpoint(cfg.endpoint);
  check(`${cfg.title} → ${recurso}`, Boolean(RECURSOS[recurso]), RECURSOS[recurso] ? '' : 'RECURSO INEXISTENTE');
});

console.log('\n--- a chave da lista e do item batem com o descritor ---');
// Errar aqui abre a tela vazia, sem erro nenhum.
capturadas.forEach(({ tipo, cfg }) => {
  const def = RECURSOS[recursoDoEndpoint(cfg.endpoint)];
  if (!def) return;
  if (cfg.listKey !== undefined) {
    check(`${cfg.title}: listKey`, cfg.listKey === def.lista, `tela "${cfg.listKey}" x banco "${def.lista}"`);
  }
  if (cfg.itemKey !== undefined) {
    check(`${cfg.title}: itemKey`, cfg.itemKey === def.item, `tela "${cfg.itemKey}" x banco "${def.item}"`);
  }
  if (tipo === 'formulario') {
    check(`${cfg.title}: declara itemKey`, Boolean(cfg.itemKey), cfg.itemKey || 'AUSENTE — o form abriria em branco ao editar');
  }
});

console.log('\n--- todo campo do formulário existe no descritor ---');
// O campo que não existe em `campos` é descartado em silêncio na gravação.
capturadas.filter((t) => t.tipo !== 'lista').forEach(({ cfg }) => {
  const def = RECURSOS[recursoDoEndpoint(cfg.endpoint)];
  if (!def) return;
  const campos = [
    ...(cfg.fields || []),
    ...(cfg.sections || []).flatMap((s) => s.fields || []),
    ...(cfg.tabs || []).flatMap((t) => (t.sections || []).flatMap((s) => s.fields || []))
  ].map((f) => f.name);
  const orfaos = campos.filter((nome) => !(nome in def.campos));
  check(`${cfg.title}: ${campos.length} campo(s)`, orfaos.length === 0,
    orfaos.length ? `NÃO GRAVAM: ${orfaos.join(', ')}` : 'todos gravam');
});

console.log('\n--- todo filtro de lista é um campo que existe ---');
// Filtro sobre campo inexistente nunca casa nada e a lista some ao filtrar.
capturadas.filter((t) => t.tipo === 'lista').forEach(({ cfg }) => {
  const def = RECURSOS[recursoDoEndpoint(cfg.endpoint)];
  if (!def || !(cfg.filters || []).length) return;
  const orfaos = (cfg.filters || []).map((f) => f.name).filter((nome) => !(nome in def.campos));
  check(`${cfg.title}: filtros`, orfaos.length === 0, orfaos.join(', ') || 'todos válidos');
});

console.log('\n--- toda lista com "+ Novo" tem editStateKey ---');
// Sem a chave, o botão de editar manda para o formulário sem dizer QUAL
// registro — e o form abre em branco, como se fosse um cadastro novo.
capturadas.filter((t) => t.tipo === 'lista').forEach(({ cfg }) => {
  if (!cfg.newSub) return;
  check(`${cfg.title}: editStateKey`, Boolean(cfg.editStateKey), cfg.editStateKey || 'AUSENTE');
});

console.log('\n--- lista e formulário do mesmo recurso usam a MESMA editStateKey ---');
// Chaves diferentes fazem o "editar" abrir um formulário em branco.
const porRecurso = {};
capturadas.forEach(({ tipo, cfg }) => {
  if (tipo === 'inline' || !cfg.editStateKey) return;
  const recurso = recursoDoEndpoint(cfg.endpoint);
  (porRecurso[recurso] = porRecurso[recurso] || []).push(cfg.editStateKey);
});
Object.entries(porRecurso).forEach(([recurso, chaves]) => {
  check(`${recurso}`, new Set(chaves).size === 1, [...new Set(chaves)].join(' x '));
});

console.log('\n--- cadastro embutido não tem "+ Novo" apontando para lugar nenhum ---');
capturadas.filter((t) => t.tipo === 'inline').forEach(({ cfg }) => {
  check(`${cfg.title}: sem newSub`, !cfg.newSub, cfg.newSub || 'ok');
  check(`${cfg.title}: tem campos`, (cfg.fields || []).length > 0, `${(cfg.fields || []).length} campo(s)`);
});

console.log('\n--- o produzido da ordem é recalculado pelos apontamentos ---');
// Antes, `quantity_done` nunca era escrito por ninguém: a tela prometia que os
// apontamentos atualizavam o produzido e o campo ficava zerado para sempre —
// "Produzido" e "Falta" mentiam sem dar erro.
const serverSrc = fs.readFileSync(path.join(RAIZ, 'server.js'), 'utf8').replace(/\r\n/g, '\n');
check('a função de recálculo existe', /async function recalcularProduzidoDaOrdem/.test(serverSrc));
check('recalcula do zero (soma), não por incremento', /filter\(\(a\) => a\.orderId === ordemId\)[\s\S]{0,120}reduce/.test(serverSrc));
// Recorta o bloco da rota genérica de módulos: server.js tem dezenas de rotas
// e procurar "req.method === 'POST'" no arquivo inteiro acharia outra qualquer.
const inicioRotaModulo = serverSrc.indexOf("const rotaModulo = pathname.match");
const blocoRotaModulo = serverSrc.slice(inicioRotaModulo, serverSrc.indexOf('Módulo Relatórios', inicioRotaModulo));
check('o bloco da rota genérica foi recortado', inicioRotaModulo > 0 && blocoRotaModulo.length > 1000, `${blocoRotaModulo.length} caracteres`);
// Recorta cada ramo até o começo do seguinte, em vez de contar caracteres: o
// ramo cresce quando ganha regra nova, e uma janela fixa passaria a mentir.
const RAMOS = ['POST', 'PUT', 'DELETE'];
RAMOS.forEach((metodo, indice) => {
  const inicio = blocoRotaModulo.indexOf(`req.method === '${metodo}'`);
  const proximo = RAMOS[indice + 1] ? blocoRotaModulo.indexOf(`req.method === '${RAMOS[indice + 1]}'`) : blocoRotaModulo.length;
  const ramo = inicio > 0 ? blocoRotaModulo.slice(inicio, proximo > inicio ? proximo : blocoRotaModulo.length) : '';
  check(`${metodo} de apontamento recalcula`, /recalcularProduzidoDaOrdem/.test(ramo), ramo ? '' : 'RAMO NÃO ENCONTRADO');
});
// Editar o apontamento pode mudá-lo de ordem: a antiga precisa ser recalculada
// também, senão continua contando o que saiu dela.
check('PUT que troca de ordem recalcula as DUAS', /anterior\.orderId !== registro\.orderId/.test(serverSrc));
// Excluir precisa ler o registro ANTES: depois não há como saber a ordem.
check('DELETE lê o apontamento antes de apagar', /const removido = recurso === 'pcp\/entries' \? await modulosDb\.obter/.test(serverSrc));

console.log('\n--- apontar produção mexe no estoque dos dois lados ---');
// Entra produto acabado, saem os componentes da ficha técnica com a perda.
check('a função de consumo existe', /async function aplicarConsumoDeProducao/.test(serverSrc));
check('lê a ficha técnica do produto da ordem', /listar\('pcp\/bom'\)\)\.filter\(\(linha\) => linha\.productId === ordem\.productId\)/.test(serverSrc));
check('aplica a perda do processo', /1 \+ Number\(linha\.lossPercent \|\| 0\) \/ 100/.test(serverSrc));
// Projeta tudo antes de gravar: faltando componente, nada é aplicado — senão a
// ordem fica pela metade, com uns produtos baixados e outros não.
check('valida o saldo ANTES de gravar qualquer coisa', /Monta o efeito de cada produto antes de gravar/.test(serverSrc));
check('recusa com o nome do componente e o quanto falta', /Estoque insuficiente de "\$\{produto\.name\}"/.test(serverSrc));
// Uma função só para produzir e estornar: o estorno é a mesma conta com o
// sinal trocado, e duas funções divergiriam na primeira correção.
check('estorno é o mesmo caminho com sinal trocado', /delta.*positivo produz, negativo/is.test(serverSrc));
check('POST valida o estoque antes de criar o apontamento',
  /Estoque ANTES de gravar o apontamento[\s\S]{0,300}mexerNoEstoqueDaProducao/.test(serverSrc));
check('PUT na mesma ordem aplica só a diferença', /novaQtd - Number\(anterior\.quantity \|\| 0\)/.test(serverSrc));
check('PUT que troca de ordem desfaz na antiga e aplica na nova',
  /mexerNoEstoqueDaProducao\(anterior\.orderId, -Number\(anterior\.quantity[\s\S]{0,200}mexerNoEstoqueDaProducao\(novaOrdem, novaQtd/.test(serverSrc));
check('DELETE estorna o consumo', /mexerNoEstoqueDaProducao\(removido\.orderId, -Number\(removido\.quantity/.test(serverSrc));

console.log('\n--- pedido de venda gera ordem de produção ---');
check('rota POST /api/pcp/orders/from-sale', serverSrc.includes("pathname === '/api/pcp/orders/from-sale' && req.method === 'POST'"));
// Precisa vir ANTES do bloco genérico: o regex leria "orders/from-sale" como
// recurso "orders" com id "from-sale" e devolveria 405.
check('e vem ANTES da rota genérica de módulos',
  serverSrc.indexOf("'/api/pcp/orders/from-sale'") < serverSrc.indexOf('const rotaModulo = pathname.match'));
check('só pedido, não orçamento', /Só pedido gera ordem de produção/.test(serverSrc));
check('só item COM ficha técnica vira ordem', /temFicha\.has\(item\.productId\)/.test(serverSrc));
check('não duplica ordem do mesmo pedido', /existentes\.some\(\(o\) => o\.productId === item\.productId\)/.test(serverSrc));
check('grava o vínculo com o pedido (orderId)', /orderId: pedido\.id/.test(serverSrc));

console.log('\n--- PCP: etapa fixa x status cadastrado ---');
// A etapa é o que o código lê ('concluida' fecha a ordem). O status é rótulo
// da empresa. Fundir os dois quebraria a lógica no primeiro nome digitado.
const migracaoPcp = fs.readFileSync(path.join(RAIZ, 'supabase/migrations/fase-w-pcp-chao-de-fabrica.sql'), 'utf8');
['pcp_sectors', 'pcp_statuses', 'pcp_quality_checks'].forEach((tabela) => {
  check(`create table ${tabela}`, new RegExp(`create table if not exists ${tabela}\\b`).test(migracaoPcp));
});
check('pcp_orders ganha sector_id', /add column if not exists sector_id\b/.test(migracaoPcp));
check('pcp_orders ganha status_id', /add column if not exists status_id\b/.test(migracaoPcp));
check('o status cadastrado declara a etapa a que pertence', /etapa text not null[\s\S]{0,120}check \(etapa in/.test(migracaoPcp));
check('a coluna status (etapa) continua com CHECK fixo', /check \(status in \('aberta', 'em_producao', 'concluida', 'cancelada'\)\)/.test(
  fs.readFileSync(path.join(RAIZ, 'supabase/migrations/fase-r-modulos-novos.sql'), 'utf8')));
check('setor e status na ordem são SET NULL', !/references pcp_(sectors|statuses)\(id\) on delete cascade/i.test(migracaoPcp));
// A inspeção não existe fora da ordem — CASCADE aqui é o correto.
check('inspeção de qualidade é CASCADE na ordem', /references pcp_orders\(id\) on delete cascade/i.test(migracaoPcp));
// Reprovado é derivado de inspecionado − aprovado; guardar os três criaria um
// número que pode discordar dos outros dois.
check('quantidade reprovada NÃO é coluna', !/quantidade_reprovada/.test(migracaoPcp));

console.log('\n--- Contratos: tipo é diferente de modelo ---');
// Tipo é a classificação ("Locação de equipamento"); modelo é o texto com as
// cláusulas. Fundir os dois faria um tipo novo exigir um texto inteiro.
const migracaoTipos = fs.readFileSync(path.join(RAIZ, 'supabase/migrations/fase-x-tipos-de-contrato.sql'), 'utf8');
check('create table contract_types', /create table if not exists contract_types\b/.test(migracaoTipos));
check('contracts ganha type_id', /add column if not exists type_id\b/.test(migracaoTipos));
check('tipo e modelo são tabelas separadas', /template_id text references contract_templates\(id\)/.test(migracaoTipos));
check('excluir tipo não apaga contrato (SET NULL)', /references contract_types\(id\) on delete set null/.test(migracaoTipos));
check('natureza limitada a receita/despesa/ambos', /check \(natureza in \('receita', 'despesa', 'ambos'\)\)/.test(migracaoTipos));

console.log('\n--- e o aviso prévio é usado, não só guardado ---');
// Campo que ninguém lê é campo que mente. O prazo do tipo tem que aparecer na
// lista de contratos E na tela de vencimentos.
const contratosSrc = fs.readFileSync(path.join(RAIZ, 'public/modules/contracts/subs/contratos.js'), 'utf8');
check('coluna existe na migração', /aviso_previa_dias integer not null default 30/.test(migracaoTipos));
check('o meta devolve o prazo junto do tipo', /avisoPreviaDias: t\.avisoPreviaDias/.test(serverSrc));
check('a lista de contratos calcula o aviso', /const avisoDoContrato =/.test(contratosSrc));
check('e tem coluna "Aviso prévio"', /label: 'Aviso prévio'/.test(contratosSrc));
check('Vencimentos separa quem já entrou no prazo de aviso', /const dentroDoAviso =/.test(contratosSrc));
// Contrato sem tipo não pode ficar sem aviso nenhum: cai no padrão de 30 dias.
check('sem tipo, usa 30 dias como padrão', /avisoPreviaDias \?\? 30/.test(contratosSrc));

console.log('\n--- o odômetro do veículo avança com as leituras ---');
// A migração dizia que "os abastecimentos e as manutenções escrevem aqui" e
// nada escrevia: a coluna Odômetro da lista de Veículos mentia desde o
// primeiro abastecimento.
const frotaSrc = fs.readFileSync(path.join(RAIZ, 'public/modules/fleet/subs/frota.js'), 'utf8');
check('a função de avanço existe', /async function avancarOdometroDoVeiculo/.test(serverSrc));
// AVANÇA, não recalcula: odômetro é leitura, não soma. Diferente do produzido
// da ordem de produção, que é recalculado do zero.
check('só avança (leitura menor é ignorada)', /km <= Number\(veiculo\.odometer \|\| 0\)\) return/.test(serverSrc));
['POST', 'PUT'].forEach((metodo) => {
  const i = blocoRotaModulo.indexOf(`req.method === '${metodo}'`);
  const fim = metodo === 'POST' ? blocoRotaModulo.indexOf("req.method === 'PUT'") : blocoRotaModulo.indexOf("req.method === 'DELETE'");
  check(`${metodo} de abastecimento/manutenção avança o odômetro`,
    i > 0 && /avancarOdometroDoVeiculo/.test(blocoRotaModulo.slice(i, fim > i ? fim : blocoRotaModulo.length)));
});
// Excluir NÃO faz voltar: o quilômetro foi rodado de verdade.
const ramoDelete = blocoRotaModulo.slice(blocoRotaModulo.indexOf("req.method === 'DELETE'"));
check('DELETE não faz o odômetro voltar', !/avancarOdometroDoVeiculo/.test(ramoDelete));
check('o meta manda o odômetro atual do veículo', /odometer: v\.odometer/.test(serverSrc));
check('leitura abaixo da atual é marcada na tela', /abaixo do atual/.test(frotaSrc));
check('consumo entre abastecimentos é derivado das outras linhas', /const consumoMedio = \(item, todos\)/.test(frotaSrc));
check('primeiro abastecimento não inventa consumo', /primeiro<\/span>/.test(frotaSrc));
// O render recebe a lista inteira, não a filtrada — senão o consumo mudaria
// conforme o filtro.
check('a fábrica passa a lista inteira ao render', /c\.render\(item, meta, items\)/.test(
  fs.readFileSync(path.join(RAIZ, 'public/modules/cadastros/shared.js'), 'utf8')));

console.log('\n--- contrato gera financeiro pelo ciclo de cobrança ---');
// A conta das datas está em test-contrato-financeiro.js; aqui só o contrato
// da rota — o que não pode ser furado por descuido.
check('rota POST /api/contracts/billing', serverSrc.includes("pathname === '/api/contracts/billing' && req.method === 'POST'"));
check('e vem ANTES da rota genérica de módulos',
  serverSrc.indexOf("'/api/contracts/billing'") < serverSrc.indexOf('const rotaModulo = pathname.match'));
// Quem cria lançamento é o Financeiro: ter permissão de contratos não pode
// abrir uma porta lateral para escrever lá.
check('exige acesso ao módulo Financeiro', /Gerar o financeiro do contrato exige acesso ao módulo Financeiro/.test(serverSrc));
check('cliente vira RECEITA, fornecedor vira DESPESA', /partyKind === 'fornecedor' \? 'DESPESA' : 'RECEITA'/.test(serverSrc));
// Rodar de novo para estender o horizonte não pode dobrar o que já existe.
check('não duplica parcela já existente', /jaExistem\.has\(linha\.dueDate\)\) continue/.test(serverSrc));
check('parcela cancelada não conta como existente', /status !== 'cancelado'/.test(serverSrc));
check('rascunho e encerrado não geram', /Contrato \$\{contrato\.status\} não gera financeiro/.test(serverSrc));
check('a lista de contratos tem a ação por linha', /rowActions: \[\{/.test(contratosSrc));
check('a fábrica de lista suporta ações por linha', /config\.rowActions \|\| \[\]/.test(
  fs.readFileSync(path.join(RAIZ, 'public/modules/cadastros/shared.js'), 'utf8')));

console.log('\n--- todo recurso novo de RH tem tabela na migração ---');
const migracao = fs.readFileSync(path.join(RAIZ, 'supabase/migrations/fase-u-rh-organizacional.sql'), 'utf8');
['hr_departments', 'hr_work_schedules', 'hr_employee_types', 'hr_employee_categories'].forEach((tabela) => {
  check(`create table ${tabela}`, new RegExp(`create table if not exists ${tabela}\\b`).test(migracao));
});
['department_id', 'work_schedule_id', 'employee_type_id', 'employee_category_id'].forEach((coluna) => {
  check(`hr_employees ganha ${coluna}`, new RegExp(`add column if not exists ${coluna}\\b`).test(migracao));
});
check('hr_positions ganha cbo', /add column if not exists cbo\b/.test(migracao));
// SET NULL e não CASCADE: excluir um departamento não pode apagar a ficha de
// quem estava lotado nele.
check('os vínculos são ON DELETE SET NULL', !/references hr_(departments|work_schedules|employee_types|employee_categories)\(id\) on delete cascade/i.test(migracao));

console.log(`\n===== ${falhas === 0 ? 'TODOS OS CHECKS PASSARAM' : falhas + ' FALHA(S)'} =====`);
process.exit(falhas ? 1 : 0);
