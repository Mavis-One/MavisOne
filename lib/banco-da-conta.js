/**
 * O BANCO DE UMA CONTA BANCÁRIA (13/10/2026).
 *
 * Pedido do usuário: relatório de contas a pagar e a receber filtrando por
 * conta E por banco. As 28 contas vieram do Viper com o campo "banco" vazio
 * (só duas com "341"), mas o nome diz o banco: "ITAU PLUS", "SICOOB PLUS 01
 * (MAXICREDITO)", "VIACREDI KACCAU". Então, nesta ordem: o código de
 * compensação (bank_code, ou o campo banco quando é só número), o campo banco
 * escrito, e o nome da conta.
 *
 * "CAIXA DINHEIRO" é o caixa da loja, não a Caixa Econômica — por isso a
 * Caixa Econômica só casa com "CAIXA ECONOMICA"/"CEF" ou o código 104.
 */
const POR_CODIGO = {
  1: 'Banco do Brasil', 33: 'Santander', 77: 'Inter', 85: 'Ailos (Viacredi)', 104: 'Caixa Econômica Federal',
  197: 'Stone', 237: 'Bradesco', 260: 'Nubank', 290: 'PagBank', 323: 'Mercado Pago', 336: 'C6 Bank',
  341: 'Itaú', 748: 'Sicredi', 756: 'Sicoob'
};

// A ordem importa: o primeiro que casa ganha ("CAIXA ECONOMICA" antes de "CAIXA").
const POR_NOME = [
  [/\bbanco do brasil\b|\bbb\b/, 'Banco do Brasil'],
  [/\bcaixa econ|\bcef\b/, 'Caixa Econômica Federal'],
  [/\bcaixa\b|\bcaix\b|\bdinheiro\b/, 'Caixa (dinheiro)'],
  [/\bitau\b/, 'Itaú'],
  [/\bsicoob\b/, 'Sicoob'],
  [/\bviacredi\b|\bailos\b/, 'Ailos (Viacredi)'],
  [/\bsicredi\b/, 'Sicredi'],
  [/\bcresol\b/, 'Cresol'],
  [/\bbradesco\b/, 'Bradesco'],
  [/\bsantander\b/, 'Santander'],
  [/\bnubank\b|\bnu pagamentos\b/, 'Nubank'],
  [/\binter\b/, 'Inter'],
  [/\bmercado ?pago\b/, 'Mercado Pago'],
  [/\bpagbank\b|\bpagseguro\b/, 'PagBank'],
  [/\bstone\b/, 'Stone'],
  [/\bc6\b/, 'C6 Bank']
];

const SEM_BANCO = 'Outros';

const chave = (v) => String(v || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

function porCodigo(v) {
  const s = String(v ?? '').trim();
  if (!/^\d{1,3}$/.test(s)) return '';
  return POR_CODIGO[Number(s)] || '';
}

function porNome(v) {
  const s = chave(v);
  if (!s.trim()) return '';
  const achado = POR_NOME.find(([re]) => re.test(s));
  return achado ? achado[1] : '';
}

/** { name, bank, bankCode } -> "Itaú", "Sicoob", ... ou "Outros". */
function bancoDaConta(conta) {
  const c = conta || {};
  return porCodigo(c.bankCode) || porCodigo(c.bank) || porNome(c.bank) || porNome(c.name) || SEM_BANCO;
}

/** Os bancos distintos de uma lista de contas, em ordem alfabética, "Outros" no fim. */
function bancosDasContas(contas) {
  const nomes = [...new Set((contas || []).map(bancoDaConta))];
  return nomes.sort((a, b) => (a === SEM_BANCO) - (b === SEM_BANCO) || a.localeCompare(b, 'pt-BR'));
}

module.exports = { bancoDaConta, bancosDasContas, SEM_BANCO };
