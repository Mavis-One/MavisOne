// PRODUTOS DO VIPER PELA PLANILHA "PRODUTOS" (12/10/2026) — a parte pura.
//
// A planilha veio da SAL INFINITY ELECTRIC, mas o cadastro de produtos do
// Viper é UM SÓ para o grupo, e o do MavisONE também (a tabela `products` não
// tem empresa; o que é de cada empresa é o saldo, por depósito). Medido contra
// o banco local: 5.509 dos 5.781 códigos já existem aqui com o mesmo código.
//
// O QUE ENTRA, por decisão do usuário (12/10/2026):
//   - os produtos cujo CÓDIGO não existe no MavisONE, com nome, NCM, preço da
//     planilha e a situação (ativo/inativo);
//   - o NCM da planilha nos produtos que existem e estão SEM NCM aqui.
//
// O QUE NÃO ENTRA, e por quê:
//   - ESTOQUE: a coluna é o total do GRUPO, não da Electric — 863 dos 1.037
//     itens com saldo batem exatamente com o relatório sem filtro de 02/10
//     (todos os depósitos). Pôr isso num depósito inventaria saldo.
//   - PREÇO dos que já existem: o "Preço" da planilha é o custo em 2.995
//     produtos (igual ao nosso custo) e cerca da metade do nosso preço em 500.
//   - NCM DIFERENTE do daqui (39): o usuário escolheu não trocar NCM que já
//     existe.
//   - NOME dos que já existem: 1.024 diferem só na escrita (o "-" do Viper, as
//     minúsculas); o daqui fica.
'use strict';

const CABECALHO = ['Código', 'Descrição', 'UN', 'Tipo', 'Preço', 'Estoque', 'NCM', 'Tipo Tributo', 'Status', 'Inclusão'];

const numero = (v) => {
  if (typeof v === 'number') return v;
  const t = String(v ?? '').trim();
  if (!t) return 0;
  // "1.234,56" (Brasil) ou "1234.56" (o xlsx já como número em texto)
  const n = Number(/,\d+$/.test(t) ? t.replace(/\./g, '').replace(',', '.') : t);
  return Number.isFinite(n) ? n : 0;
};

/** Nome no padrão do sistema: maiúscula, sem espaço sobrando. */
const nomeDoProduto = (nome) => String(nome || '').replace(/\s+/g, ' ').trim().toLocaleUpperCase('pt-BR');

/**
 * Lê a planilha. `abas` é o que lib/xlsx-leitor devolve (lista de abas, cada
 * uma lista de linhas). Recusa planilha que não tenha o cabeçalho esperado —
 * coluna trocada de lugar gravaria preço no NCM sem erro nenhum.
 */
function lerPlanilha(abas) {
  const aba = Array.isArray(abas) ? abas[0] : null;
  const linhas = (Array.isArray(aba) ? aba : (aba && aba.linhas)) || [];
  const posCab = linhas.findIndex((l) => Array.isArray(l) && String(l[0]).trim() === 'Código');
  if (posCab < 0) throw new Error('Cabeçalho "Código | Descrição | ..." não encontrado. É a planilha "Produtos" do Viper?');
  const cab = linhas[posCab].map((c) => String(c).trim());
  const fora = CABECALHO.filter((c, i) => cab[i] !== c);
  if (fora.length) throw new Error(`Colunas fora do lugar esperado: ${fora.join(', ')}. Esperado: ${CABECALHO.join(' | ')}.`);
  const empresa = String((linhas.slice(0, posCab).find((l) => /LTDA|S\/A|EIRELI|ME\b/i.test(String(l[0]))) || [''])[0]).trim();

  const itens = [];
  const ignorados = [];
  const vistos = new Set();
  for (const l of linhas.slice(posCab + 1)) {
    const codigo = String(l[0] ?? '').trim();
    if (!codigo) continue;
    const nome = nomeDoProduto(l[1]);
    if (!nome) { ignorados.push({ codigo, motivo: 'sem descrição' }); continue; }
    const chave = codigo.toLowerCase();
    if (vistos.has(chave)) { ignorados.push({ codigo, motivo: 'código repetido na planilha' }); continue; }
    vistos.add(chave);
    const ncm = String(l[6] ?? '').replace(/\D/g, '');
    itens.push({
      codigo,
      nome,
      unidade: String(l[2] || 'UN').trim().toUpperCase() || 'UN',
      tipo: String(l[3] || '').trim(),
      preco: Math.max(0, Math.round(numero(l[4]) * 100) / 100),
      ncm: ncm.length === 8 ? ncm : '',
      tributo: String(l[7] || '').trim(),
      ativo: String(l[8] || '').trim().toLowerCase() !== 'inativo',
      inclusao: String(l[9] || '').trim()
    });
  }
  return { empresa, itens, ignorados };
}

/**
 * Compara com o cadastro de destino. `catalogo` = [{ id, sku, ncm }].
 * O código do Viper é o SKU daqui (foi assim que o catálogo entrou).
 */
function planejar(itens, catalogo) {
  const porSku = new Map();
  for (const p of catalogo || []) porSku.set(String(p.sku || '').trim().toLowerCase(), p);
  const novos = [];
  const ncmParaPreencher = [];
  let existentes = 0;
  for (const item of itens) {
    const atual = porSku.get(item.codigo.toLowerCase());
    if (!atual) { novos.push(item); continue; }
    existentes += 1;
    const ncmAtual = String(atual.ncm || '').replace(/\D/g, '');
    if (!ncmAtual && item.ncm) ncmParaPreencher.push({ id: atual.id, codigo: item.codigo, nome: item.nome, ncm: item.ncm });
  }
  return { novos, ncmParaPreencher, existentes };
}

module.exports = { CABECALHO, lerPlanilha, planejar, nomeDoProduto };
