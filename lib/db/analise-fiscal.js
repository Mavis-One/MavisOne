// A ANÁLISE FISCAL DO CADASTRO, LADO DO BANCO (fase DO).
//
// Lê produtos, as tabelas oficiais e quais grupos tributários estão em ST, e
// entrega tudo a lib/analise-fiscal.js, que decide os alertas.
//
// "EM ST" SAI DAS REGRAS FISCAIS, e não do nome do grupo: um grupo está em ST
// quando a regra fiscal dele resulta em CST de substituição (10, 30, 60, 70)
// ou CSOSN (201, 202, 203, 500). É a mesma regra que a emissão aplica — um
// grupo chamado "ST" sem regra de ST não muda a nota, e não deve mudar o
// alerta.

const { consultar } = require('./conexao');
const { analisarCadastro } = require('../analise-fiscal');

async function analisar() {
  const [{ rows: cargas }, { rows: ncm }, { rows: cest }, { rows: st }, { rows: produtos }] = await Promise.all([
    consultar('select tabela, versao, linhas, carregado_em from fiscal_tabela_carga'),
    consultar('select codigo, descricao_completa, data_fim from fiscal_ncm'),
    consultar('select cest, segmento_nome, descricao, ncm_prefixos from fiscal_cest'),
    consultar(`select distinct grupo_tributario_id from regra_fiscal
                where grupo_tributario_id is not null
                  and (cst_icms in ('10', '30', '60', '70') or csosn in ('201', '202', '203', '500'))`),
    consultar('select id, sku, name, ncm, cest, grupo_tributario_id, tipo_produto_fiscal from products')
  ]);
  const gruposSt = new Set(st.map((r) => r.grupo_tributario_id));
  const tabelas = Object.fromEntries(cargas.map((c) => [c.tabela, { versao: c.versao, linhas: c.linhas, carregadoEm: c.carregado_em }]));
  if (!tabelas.NCM || !tabelas.CEST) return { tabelas, semTabelas: true, analisados: 0, comAlerta: 0, alertas: [] };

  const resultado = analisarCadastro({
    produtos: produtos.map((p) => ({
      id: p.id, sku: p.sku, nome: p.name, ncm: p.ncm, cest: p.cest,
      emSt: gruposSt.has(p.grupo_tributario_id), escritural: p.tipo_produto_fiscal === 'ESCRITURAL'
    })),
    ncm: new Map(ncm.map((n) => [String(n.codigo).trim(), { descricaoCompleta: n.descricao_completa, dataFim: n.data_fim }])),
    cest: new Map(cest.map((c) => [String(c.cest).trim(), { segmentoNome: c.segmento_nome, descricao: c.descricao, ncmPrefixos: c.ncm_prefixos }]))
  });
  return { tabelas, semTabelas: false, ...resultado };
}

module.exports = { analisar };
