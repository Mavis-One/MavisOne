#!/usr/bin/env node
/**
 * SALVAR UMA REGRA FISCAL NÃO APAGA O QUE O FORMULÁRIO NÃO MOSTRA (fase BJ).
 *
 * O QUE ESTE TESTE PROTEGE
 * ------------------------
 * Existem DOIS formulários gravando na mesma tabela pela mesma rota
 * (PUT /api/fiscal/regras/:id): o de FISCAL > REGRAS FISCAIS, que manda 36
 * campos, e o de CONFIGURAÇÕES > EMPRESA, que manda 20.
 *
 * O UPDATE era TOTAL. buildRegraFiscalFields monta sempre as 37 colunas e
 * converte chave ausente em `null` EXPLÍCITO — e o construtor de SQL só descarta
 * `undefined`. Resultado: cada "Salvar" feito pela tela de Configurações zerava
 * as 17 colunas que só a tela grande conhece, inclusive sem o usuário ter
 * mudado nada.
 *
 * Provado num banco de prova, com uma regra criada completa e um único "Salvar"
 * pela tela de Configurações:
 *
 *   ANTES  -> origem, dentro_do_estado, destinatario_contribuinte, mva_st,
 *             aliquota_icms_st, codigo_beneficio_fiscal, aliquota_ibs,
 *             aliquota_fcp_uf_destino ... TODAS NULL
 *   DEPOIS -> todas intactas (0, false, true, 40.00, 18.00, SC820001, 0.1, 2.00)
 *
 * POR QUE ISSO É PIOR DO QUE PERDER DADO. Três das colunas zeradas (origem,
 * dentro_do_estado, destinatario_contribuinte) são CRITÉRIOS DE CASAMENTO em
 * resolverRegraFiscal. Zeradas, a regra não fica só incompleta: ela vira
 * CORINGA e passa a ser aplicada a operações que nunca foram dela — uma regra de
 * venda interna para contribuinte passa a valer também para consumidor final de
 * outro estado, com a alíquota errada, e a nota sai assim.
 *
 * APAGAR DE PROPÓSITO CONTINUA FUNCIONANDO: `'mvaSt' in payload` é verdadeiro
 * quando o valor é null, então quem manda null explicitamente limpa a coluna. A
 * distinção que faltava era entre "não mandou" e "mandou apagar".
 */
const fiscalDb = require('../lib/db/fiscal');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};

console.log('--- 1. o mapa cobre todas as colunas ---');

const todasAsColunas = Object.keys(fiscalDb.buildRegraFiscalFields({}));
check('o build completo produz a linha inteira', todasAsColunas.length > 30, `${todasAsColunas.length} colunas`);
// Coluna nova sem entrada no mapa voltaria a ser zerada em silêncio pelo update
// parcial — que é exatamente o defeito que esta fase conserta.
const semChave = todasAsColunas.filter((c) => !fiscalDb.CHAVE_DA_COLUNA_REGRA[c]);
check('  e toda coluna sabe de qual chave do payload ela vem',
  semChave.length === 0, semChave.length ? 'SEM ENTRADA NO MAPA: ' + semChave.join(', ') : 'todas mapeadas');

console.log('--- 2. o update só toca no que veio ---');

// O payload exato que public/modules/settings/subs/fiscal.js monta.
const deConfiguracoes = {
  empresaId: 'e1', tipoOperacao: 'VENDA', ncm: '73181500', ufDestino: 'SP', cfop: '6102',
  csosn: '101', cstIcms: '00', aliquotaIcms: '12', cstPis: '01', aliquotaPis: '1.65',
  cstCofins: '01', aliquotaCofins: '7.6', cstIbsCbs: '000', classTrib: '000001',
  aliquotaCbs: '0.9', aliquotaIbsUf: '0.05', aliquotaIbsMun: '0.05',
  prioridade: 5, vigenciaInicio: '2026-01-01', vigenciaFim: null
};

const parcial = fiscalDb.buildRegraFiscalUpdate(deConfiguracoes);
check('o update toca só as colunas enviadas',
  Object.keys(parcial).length === Object.keys(deConfiguracoes).length,
  `${Object.keys(parcial).length} de ${todasAsColunas.length}`);

const preservadas = todasAsColunas.filter((c) => !(c in parcial));
check('  e preserva as demais', preservadas.length === todasAsColunas.length - Object.keys(deConfiguracoes).length,
  `${preservadas.length} preservada(s)`);

// As três que mais doem: são critérios de casamento, não só dado.
['origem', 'dentro_do_estado', 'destinatario_contribuinte'].forEach((coluna) => {
  check(`  ${coluna} (critério de casamento) não é tocada`, !(coluna in parcial));
});
['mva_st', 'aliquota_icms_st', 'codigo_beneficio_fiscal', 'aliquota_ibs', 'aliquota_fcp_uf_destino',
  'cst_icms_st', 'icms_motivo_desoneracao', 'codigo_enquadramento_ipi'].forEach((coluna) => {
  check(`  ${coluna} não é tocada`, !(coluna in parcial));
});

console.log('--- 3. apagar de propósito continua possível ---');

// null EXPLÍCITO é uma ordem de apagar; chave ausente é silêncio. A diferença
// entre as duas é toda a correção.
const comNullExplicito = fiscalDb.buildRegraFiscalUpdate({ ...deConfiguracoes, mvaSt: null });
check('null explícito entra no update', 'mva_st' in comNullExplicito);
check('  e entra como null, não como zero', comNullExplicito.mva_st === null);
const semAChave = fiscalDb.buildRegraFiscalUpdate(deConfiguracoes);
check('chave ausente fica de fora', !('mva_st' in semAChave));

console.log('--- 4. o insert continua completo ---');

// Regra nova precisa da linha inteira, para os defaults de coluna e os NOT NULL
// valerem. Só o UPDATE é parcial.
const completo = fiscalDb.buildRegraFiscalFields(deConfiguracoes);
check('o build de criação continua montando tudo', Object.keys(completo).length === todasAsColunas.length);
check('  com null onde não veio nada', completo.mva_st === null && completo.origem === null);

console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TODOS OS CHECKS PASSARAM =====');
process.exit(falhas ? 1 : 0);
