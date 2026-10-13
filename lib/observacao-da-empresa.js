/**
 * O TEXTO PADRÃO DA EMPRESA DO PEDIDO (13/10/2026).
 *
 * O pedido escolhe a empresa de Cadastros › Empresas (`data.companies`, ids
 * "company-…"); o termo mora na empresa FISCAL (Configurações › Empresa,
 * `observacaoPadraoNfe`), que se liga ao estabelecimento por `empresaId`. A
 * ponte é o CNPJ: empresa do cadastro -> estabelecimento com o mesmo CNPJ ->
 * empresa fiscal. Sem estabelecimento com o CNPJ inteiro, vale a empresa
 * fiscal da mesma raiz (os 8 primeiros dígitos) — o termo é por CNPJ raiz.
 *
 * Resolvido AQUI, no servidor, e entregue pronto em /api/sales/meta: o
 * vendedor não tem acesso a /api/fiscal/* (o perfil é negado por padrão), e o
 * texto tem de chegar a ele mesmo assim.
 */
const digitos = (v) => String(v || '').replace(/\D/g, '');

/**
 * @param companies         data.companies
 * @param estabelecimentos  fiscalDb.getEstabelecimentos()
 * @param empresas          fiscalDb.getEmpresas()
 * @returns Map companyId -> texto ('' quando a empresa não tem termo)
 */
function observacoesDasEmpresas(companies, estabelecimentos, empresas) {
  const textoDaEmpresa = new Map((empresas || []).map((e) => [e.id, String(e.observacaoPadraoNfe || '').trim()]));
  const empresaDoCnpj = new Map((estabelecimentos || []).map((e) => [digitos(e.cnpj), e.empresaId]));
  const empresaDaRaiz = new Map((empresas || []).map((e) => [digitos(e.cnpjRaiz).slice(0, 8), e.id]));
  const saida = new Map();
  for (const c of companies || []) {
    const cnpj = digitos(c.document);
    const empresaId = empresaDoCnpj.get(cnpj) || (cnpj.length === 14 ? empresaDaRaiz.get(cnpj.slice(0, 8)) : '');
    saida.set(c.id, (empresaId && textoDaEmpresa.get(empresaId)) || '');
  }
  return saida;
}

module.exports = { observacoesDasEmpresas };
