#!/usr/bin/env node
/**
 * A GARANTIA DO EQUIPAMENTO É CONTADA, NÃO DIGITADA (fase BB).
 *
 * O QUE ESTE TESTE PROTEGE
 * ------------------------
 * 1. A CONTA DA GARANTIA. O cadastro tinha um campo "Garantia até": uma data que
 *    alguém digita. Ninguém digita — e quando digita, digita errado. A data
 *    existe num documento: a NF-e que vendeu a máquina.
 *
 * 2. O FIM DE MÊS NÃO TRANSBORDA. 31/01 + 1 mês dá 03/03 na conta ingênua do
 *    JavaScript (31 de fevereiro "transborda"). Uma garantia que vence dois dias
 *    depois do previsto é a diferença entre cobrar e não cobrar um conserto.
 *
 * 3. SEM GARANTIA NÃO É VENCIDA. A máquina que nunca teve garantia e a que teve
 *    e acabou pedem conversas diferentes com o cliente.
 *
 * 4. OS DOIS MODOS NÃO CONVIVEM. Prazo em meses e data fixa são MODOS: com os
 *    dois valendo ao mesmo tempo, um dia eles discordam e ninguém sabe qual vale.
 *
 * 5. AS GUARDAS DE EXCLUSÃO VOLTARAM A FUNCIONAR. Elas liam `data.finance`,
 *    `data.stockMovements` e `data.equipments` — coleções que foram para o
 *    Postgres e desde então chegavam VAZIAS. Não falhavam: respondiam "ninguém
 *    usa", sempre. Provado contra a API: um depósito com movimentação no razão
 *    foi excluído com `success: true`. Há um depósito órfão no banco de antes
 *    da descoberta (`dep-1786191726703-ssa5yc`, 3 movimentos).
 */
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const ler = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};

const garantia = require('../public/modules/shared/garantia');

console.log('--- 1. a conta dos meses ---');
check('12 meses', garantia.somarMeses('2026-06-15', 12) === '2027-06-15',
  garantia.somarMeses('2026-06-15', 12));
check('24 meses', garantia.somarMeses('2026-03-15', 24) === '2028-03-15',
  garantia.somarMeses('2026-03-15', 24));
// A conta ingenua daria 2026-03-03: 31 de fevereiro "transborda".
check('31/01 + 1 mês prende em 28/02', garantia.somarMeses('2026-01-31', 1) === '2026-02-28',
  garantia.somarMeses('2026-01-31', 1));
check('  e 31/01 + 12 volta a ser 31/01', garantia.somarMeses('2026-01-31', 12) === '2027-01-31',
  garantia.somarMeses('2026-01-31', 12));
check('29/02 de ano bissexto + 12 prende em 28/02',
  garantia.somarMeses('2024-02-29', 12) === '2025-02-28', garantia.somarMeses('2024-02-29', 12));
check('data inválida devolve vazio', garantia.somarMeses('não é data', 12) === '');

console.log('\n--- 2. a garantia diz de onde saiu ---');
const daNota = garantia.calcular({ modo: 'prazo', meses: 12, inicio: '2026-06-15', inicioRotulo: 'NF-e 999001' });
check('conta a partir da nota', daNota.ate === '2027-06-15', daNota.ate);
// Sem o porque, o usuario ve uma data e nao tem como conferir se esta certa.
check('  e nomeia a nota no porquê', /NF-e 999001/.test(daNota.porque), daNota.porque);
const semInicio = garantia.calcular({ modo: 'prazo', meses: 12 });
check('sem data de início não inventa', semInicio.ate === '', `"${semInicio.ate}"`);
check('  e explica o que falta', /falta a data de início/.test(semInicio.porque), semInicio.porque);
const semPrazo = garantia.calcular({ modo: 'prazo', inicio: '2026-06-15' });
check('sem prazo não inventa', semPrazo.ate === '' && /Sem prazo/.test(semPrazo.porque), semPrazo.porque);

console.log('\n--- 3. os dois modos não convivem ---');
// No modo 'data' os meses sao ignorados; no modo 'prazo', a data escrita e' que
// e' ignorada. Com os dois valendo, um dia eles discordam.
const fixa = garantia.calcular({ modo: 'data', dataFixa: '2030-12-31', meses: 12, inicio: '2026-01-01' });
check('modo data ignora os meses', fixa.ate === '2030-12-31', fixa.ate);
check('  e diz que foi manual', /manualmente/.test(fixa.porque));
const prazo = garantia.calcular({ modo: 'prazo', meses: 12, inicio: '2026-01-01', dataFixa: '2030-12-31' });
check('modo prazo ignora a data escrita', prazo.ate === '2027-01-01', prazo.ate);
check('modo desconhecido cai em prazo',
  garantia.calcular({ modo: 'inventado', meses: 6, inicio: '2026-01-01' }).ate === '2026-07-01');

console.log('\n--- 4. sem garantia não é vencida ---');
check('sem data', garantia.situacao('') === 'sem-garantia');
check('vencida', garantia.situacao('2020-01-01', '2026-09-03') === 'vencida');
check('vigente', garantia.situacao('2030-01-01', '2026-09-03') === 'vigente');
// "Garantia de 12 meses" que acaba na vespera e' um dia a menos do que foi
// vendido — e e' o dia em que a maquina quebra.
check('o DIA do vencimento ainda está na garantia',
  garantia.situacao('2026-09-03', '2026-09-03') === 'vigente');
check('  e o dia seguinte não', garantia.situacao('2026-09-03', '2026-09-04') === 'vencida');
check('dias restantes', garantia.diasRestantes('2026-09-13', '2026-09-03') === 10);
check('  negativo quando venceu', garantia.diasRestantes('2026-09-01', '2026-09-03') === -2);
check('  null sem garantia', garantia.diasRestantes('') === null);

console.log('\n--- 5. a nota vence a data de aquisição ---');
const dados = ler('lib/db/equipamentos.js');
// A nota e' o documento; a data de aquisicao e' o que alguem lembrou de digitar.
check('a data de início sai da nota quando ela existe',
  /inicio: temNota \? notaDaVenda\.data : payload\.purchaseDate/.test(dados));
check('  e o rótulo nomeia a nota', /inicioRotulo: temNota \? `NF-e/.test(dados));
// Coluna, e nao conta na leitura: "quais garantias vencem este mes?" e' consulta.
check('o resultado é gravado em coluna', /warranty_until: calculada\.ate \|\| null/.test(dados));

console.log('\n--- 6. o servidor ---');
const servidor = ler('server.js');
check('equipments saiu da rota genérica do db.json',
  !/cadastroCollectionMatch[\s\S]{0,200}\|equipments\|/.test(servidor));
check('  e está em NAO_PERSISTIR', /'equipments',\s+\/\/ fase BB/.test(servidor));
check('tem rotas próprias',
  /const equipamentoMatch = pathname\.match\(\/\^\\\/api\\\/cadastros\\\/equipments/.test(servidor));
check('a validação é reusada, não copiada',
  /cadastrosCore\.CADASTRO_COLLECTIONS\.equipments/.test(servidor));
// Id errado deixaria a garantia contada a partir de lugar nenhum.
check('NF-e inexistente é recusada', /NF-e não encontrada/.test(servidor));
check('as duas tabelas de nota são consultadas',
  /function notaDoEquipamento[\s\S]*?data\.nfe \|\| \[\][\s\S]*?data\.nfes \|\| \[\]/.test(servidor));
// Nota cancelada nao vendeu nada.
check('nota morta não entra na lista de escolha',
  /const morta = \(status\) =>[\s\S]{0,200}'CANCELADO'/.test(servidor));

console.log('\n--- 7. as guardas de exclusão voltaram a perguntar ao banco ---');
check('a de contraparte existe', /async function contrapartidaEmUso\(id\)/.test(servidor));
check('  e olha o financeiro E os equipamentos',
  /comFinanceiro[\s\S]{0,400}equipamentosDb\.contarPor\('pessoa', id\)/.test(servidor));
check('a de depósito existe', /async function depositoEmUso\(id\)/.test(servidor));
check('  e olha o razão E os equipamentos',
  /razaoEstoque\.contarPorDeposito\(id\)[\s\S]{0,120}equipamentosDb\.contarPor\('deposito', id\)/.test(servidor));
// Trazer o razao inteiro para responder "tem algum?" cresce com o historico.
check('o razão responde por contagem, não por varredura',
  /select count\(\*\)::int as n from stock_movements where deposit_id = \$1/.test(ler('lib/db/estoque-razao.js')));
const core = ler('lib/cadastros-core.js');
check('o cadastros-core não lê mais as coleções que foram para o banco',
  !/data\.finance \|\| \[\]\)\.some\(\(entry\) => entry\.clientSupplierId/.test(core)
  && !/data\.stockMovements \|\| \[\]\)\.some/.test(core)
  && !/data\.equipments \|\| \[\]\)\.some/.test(core));
check('  e as três chamadas passaram a esperar (await)',
  (servidor.match(/await contrapartidaEmUso\(id\)/g) || []).length === 2
  && /await depositoEmUso\(id\)/.test(servidor));

console.log('\n--- 8. a migração ---');
const mig = ler('banco/migrations/fase-bb-equipamento-e-garantia-pela-nota.sql');
check('cria a tabela', /create table if not exists equipments/.test(mig));
['nfe_id', 'warranty_mode', 'warranty_months', 'warranty_until'].forEach((c) => {
  check(`  com ${c}`, new RegExp(`\\s${c}\\s`).test(mig));
});
// Serie vazia e' comum e legitima; um NULL nao pode bloquear os outros.
check('o índice de série é parcial',
  /create unique index if not exists idx_equipments_serie[\s\S]*?where serial_number <> ''/.test(mig));
check('liga RLS', /alter table if exists equipments enable row level security/.test(mig));

console.log('\n--- 9. a tela ---');
const form = ler('public/modules/cadastros/subs/novo_equipamento.js');
check('o formulário escolhe a NF-e', /name: 'nfeId'[\s\S]{0,200}meta\.notasFiscais/.test(form));
check('  e tem os dois modos', /name: 'warrantyMode'[\s\S]{0,300}'Data fixa \(garantia negociada\)'/.test(form));
check('  e o prazo em meses', /name: 'warrantyMonths'/.test(form));
const lista = ler('public/modules/cadastros/subs/equipamentos.js');
check('a lista mostra a NF-e', /label: 'NF-e'/.test(lista));
// Data que ninguem consegue conferir volta a ser data em que ninguem confia.
check('  e a garantia leva o porquê junto', /item\.warrantyPorque/.test(lista));
check('  com "sem garantia" separado de "vencida"',
  /warrantySituacao === 'sem-garantia'/.test(lista) && /warrantySituacao === 'vencida'/.test(lista));
check('o catálogo é carregado pelo navegador',
  /modules\/shared\/garantia\.js/.test(ler('public/index.html')));

console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TODOS OS CHECKS PASSARAM =====');
process.exit(falhas ? 1 : 0);
