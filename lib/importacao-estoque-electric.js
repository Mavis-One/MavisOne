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

// O RELATÓRIO "ESTOQUES" DO VIPER (posição atual POR DEPÓSITO) — 13/10/2026.
//
// Pedido do usuário: "importe o arquivo estoques". É o relatório de UM
// depósito (ELECTRIC (ASSISTENCIA)): 2.046 produtos, 891 com saldo, 16.296,61
// unidades. A planilha "Produtos" acima soma TODOS os depósitos da Electric
// (1.027 com saldo, 19.469) — os mesmos 891 batem quantidade por quantidade, e
// sobram 136 itens que não estão neste depósito no Viper.
//
// Decisão do usuário: o "Depósito Electric" fica IGUAL a este relatório — os
// itens dele com o saldo físico, e todo produto com saldo no depósito que não
// está aqui com saldo vai a ZERO (ver o script, que monta a contagem).
const CABECALHO_ESTOQUES = ['Código', 'Produto', 'Marca', 'Empresa', 'Depósito', 'Preço de venda', 'Saldo físico', 'Saldo consignado'];

function lerPlanilhaEstoques(abas) {
  const aba = Array.isArray(abas) ? abas[0] : null;
  const linhas = (Array.isArray(aba) ? aba : (aba && aba.linhas)) || [];
  const posCab = linhas.findIndex((l) => Array.isArray(l) && texto(l[0]) === 'Código' && texto(l[6]) === 'Saldo físico');
  if (posCab < 0) throw new Error('Cabeçalho "Código | Produto | ... | Saldo físico" não encontrado. É o relatório "Estoques" do Viper?');
  const cab = linhas[posCab].map(texto);
  const fora = CABECALHO_ESTOQUES.filter((c, i) => cab[i] !== c);
  if (fora.length) throw new Error(`Colunas fora do lugar esperado: ${fora.join(', ')}. Esperado: ${CABECALHO_ESTOQUES.join(' | ')}.`);
  const empresa = texto((linhas.slice(0, posCab).find((l) => /LTDA|S\/A|EIRELI/i.test(String(l[0]))) || [''])[0]);
  if (!/ELECTRIC/i.test(empresa)) {
    throw new Error(`O relatório é da empresa "${empresa || '?'}", não da SAL INFINITY ELECTRIC.`);
  }

  const itens = [];
  const negativos = [];
  const invalidos = [];
  const vistos = new Set();
  const depositos = new Set();
  let zerados = 0;
  for (const l of linhas.slice(posCab + 1)) {
    if (!Array.isArray(l)) continue;
    const sku = texto(l[0]);
    if (!sku || sku === 'Totais') continue;
    // Linha de OUTRA empresa num relatório "Todas as empresas": não é da
    // Electric, e contá-la aqui seria saldo de outro CNPJ neste depósito.
    if (!/ELECTRIC/i.test(texto(l[3]))) { invalidos.push({ sku, nome: texto(l[1]), quantidade: 0, motivo: `empresa "${texto(l[3])}"` }); continue; }
    depositos.add(texto(l[4]));
    const quantidade = texto(l[6]) === '' ? 0 : numero(l[6]);
    const linha = { sku, nome: texto(l[1]), quantidade };
    if (!Number.isFinite(quantidade)) { invalidos.push({ ...linha, motivo: `saldo "${texto(l[6])}" não é número` }); continue; }
    if (vistos.has(sku)) { invalidos.push({ ...linha, motivo: 'código repetido na planilha' }); continue; }
    vistos.add(sku);
    if (quantidade === 0) { zerados += 1; continue; }
    if (quantidade < 0) { negativos.push(linha); continue; }
    itens.push(linha);
  }
  // Um depósito só: dois no mesmo arquivo seriam somados num depósito daqui.
  if (depositos.size !== 1) {
    throw new Error(`O relatório precisa ser de UM depósito; este tem ${depositos.size}: ${[...depositos].join(', ') || 'nenhum'}.`);
  }
  return {
    formato: 'estoques',
    empresa,
    depositoDoViper: [...depositos][0],
    itens,
    negativos,
    invalidos,
    zerados,
    unidades: Math.round(itens.reduce((t, i) => t + i.quantidade, 0) * 1e4) / 1e4
  };
}

module.exports = { lerPlanilha, lerPlanilhaEstoques, numero, CNPJ_ELECTRIC, CABECALHO_ESTOQUES };
