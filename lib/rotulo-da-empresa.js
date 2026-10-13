/**
 * O NOME DA EMPRESA NOS CAMPOS DE ESCOLHA: o da filial (13/10/2026).
 *
 * As lojas têm a MESMA razão social ("SAL INFINITY PLUS COMERCIO LTDA"), e o
 * campo Filial do cadastro de depósito mostrava onze linhas iguais. Vendas já
 * resolvia com o nome fantasia (rotuloDaEmpresa em public/app.js); o Estoque
 * recebia só a razão social.
 *
 * Ordem: nome fantasia; sem ele, razão social + cidade + número da filial no
 * CNPJ (os 4 dígitos depois da barra). E se ainda assim dois rótulos saírem
 * iguais (fantasia repetida), o número da filial desempata.
 */
const texto = (v) => String(v || '').trim();

/** "43792899000216" -> "0002"; CPF ou vazio -> "". */
function numeroDaFilial(documento) {
  const digitos = String(documento || '').replace(/\D/g, '');
  return digitos.length === 14 ? digitos.slice(8, 12) : '';
}

function rotuloDaEmpresa(empresa) {
  const fantasia = texto(empresa && empresa.tradeName);
  if (fantasia) return fantasia;
  const nome = texto(empresa && empresa.name);
  const extras = [texto(empresa && empresa.city), numeroDaFilial(empresa && empresa.document)].filter(Boolean);
  return extras.length ? `${nome} — ${extras.join(' ')}` : nome;
}

/** A lista inteira, com desempate quando dois rótulos coincidem. */
function opcoesDeEmpresa(empresas) {
  const lista = (empresas || []).map((c) => ({ id: c.id, name: rotuloDaEmpresa(c), filial: numeroDaFilial(c.document) }));
  const vezes = new Map();
  for (const o of lista) vezes.set(o.name, (vezes.get(o.name) || 0) + 1);
  return lista.map((o) => ({
    id: o.id,
    name: vezes.get(o.name) > 1 && o.filial && !o.name.endsWith(o.filial) ? `${o.name} (${o.filial})` : o.name
  }));
}

module.exports = { rotuloDaEmpresa, opcoesDeEmpresa, numeroDaFilial };
