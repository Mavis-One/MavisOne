// ESTOQUE DA ELECTRIC PELA PLANILHA "PRODUTOS" DO VIPER (13/10/2026) — a parte pura.
//
// Pedido do usuário: "importe o novo arquivo produtos somente para o estoque da
// electric". A planilha (Código | Descrição | UN | Tipo | Preço | Estoque | NCM |
// Tipo Tributo | Status | Inclusão) gerada na empresa SAL INFINITY ELECTRIC traz
// 1.027 produtos com estoque positivo — exatamente os 1.027 itens do inventário
// da Electric no Viper (12/10/2026, R$ 756.452,97 a custo médio). É por isso
// que a coluna Estoque é tratada como o saldo da Electric, e só dela.
//
// O QUE ENTRA: a QUANTIDADE. O custo do movimento é o do cadastro daqui (é o
// que a contagem usa ao fechar); a coluna "Preço" não é custo — a 1.027 itens
// ela somaria R$ 3,4 mi, contra R$ 774 mil pelo custo do cadastro.
//
// O QUE FICA DE FORA, e volta listado:
//   - estoque zero (não há o que contar);
//   - estoque NEGATIVO (10 na planilha): contagem física não é negativa, como
//     na carga da matriz de 30/09.
// Nada de cadastro muda: nome, preço, NCM e situação ficam como estão.
'use strict';

const CABECALHO = ['Código', 'Descrição', 'UN', 'Tipo', 'Preço', 'Estoque', 'NCM', 'Tipo Tributo', 'Status', 'Inclusão'];
// A Electric: 46.877.837/0001-14 (Simples Nacional).
const CNPJ_ELECTRIC = '46877837000114';

const texto = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();

/** "1.234,5" e "1234.5" viram 1234.5; vazio ou lixo vira NaN. */
function numero(v) {
  if (typeof v === 'number') return v;
  const t = texto(v);
  if (!t) return NaN;
  const normal = t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t;
  return Number(normal);
}

/**
 * Lê a planilha (saída de lib/xlsx-leitor). Recusa planilha sem o cabeçalho
 * esperado e planilha de outra empresa: estoque da Plus lançado na Electric
 * seria saldo duplicado sem erro nenhum.
 */
function lerPlanilha(abas) {
  const aba = Array.isArray(abas) ? abas[0] : null;
  const linhas = (Array.isArray(aba) ? aba : (aba && aba.linhas)) || [];
  const posCab = linhas.findIndex((l) => Array.isArray(l) && texto(l[0]) === 'Código' && texto(l[5]) === 'Estoque');
  if (posCab < 0) throw new Error('Cabeçalho "Código | Descrição | ... | Estoque" não encontrado. É a planilha "Produtos" do Viper?');
  const cab = linhas[posCab].map(texto);
  const fora = CABECALHO.filter((c, i) => cab[i] !== c);
  if (fora.length) throw new Error(`Colunas fora do lugar esperado: ${fora.join(', ')}. Esperado: ${CABECALHO.join(' | ')}.`);
  const empresa = texto((linhas.slice(0, posCab).find((l) => /LTDA|S\/A|EIRELI/i.test(String(l[0]))) || [''])[0]);
  if (!/ELECTRIC/i.test(empresa)) {
    throw new Error(`A planilha é da empresa "${empresa || '?'}", não da SAL INFINITY ELECTRIC.`);
  }

  const itens = [];
  const negativos = [];
  const invalidos = [];
  const vistos = new Set();
  let zerados = 0;
  for (const l of linhas.slice(posCab + 1)) {
    if (!Array.isArray(l)) continue;
    const sku = texto(l[0]);
    if (!sku) continue;
    // Estoque em branco é o de serviço (MAO-DE OBRA) e do registro-coringa do
    // Viper: não há o que contar, igual a zero.
    const quantidade = texto(l[5]) === '' ? 0 : numero(l[5]);
    const linha = { sku, nome: texto(l[1]), quantidade };
    if (!Number.isFinite(quantidade)) { invalidos.push({ ...linha, motivo: `estoque "${texto(l[5])}" não é número` }); continue; }
    if (vistos.has(sku)) { invalidos.push({ ...linha, motivo: 'código repetido na planilha' }); continue; }
    vistos.add(sku);
    if (quantidade === 0) { zerados += 1; continue; }
    if (quantidade < 0) { negativos.push(linha); continue; }
    itens.push(linha);
  }
  return {
    empresa,
    itens,
    negativos,
    invalidos,
    zerados,
    unidades: Math.round(itens.reduce((t, i) => t + i.quantidade, 0) * 1e4) / 1e4
  };
}

module.exports = { lerPlanilha, numero, CNPJ_ELECTRIC };
