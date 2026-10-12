// CONTAS A PAGAR E A RECEBER DO VIPER (13/10/2026) — a parte pura.
//
// Planilhas "Contas a Pagar" e "Contas a Receber" do Viper: os títulos EM
// ABERTO. Decisões do usuário (12/10/2026):
//   - importar todo o em aberto (ele reexporta sem filtro de vencimento — a
//     primeira exportação trazia só outubro);
//   - título que está em aberto no MavisONE e não aparece mais no Viper FICA
//     COMO ESTÁ (não se dá baixa por dedução);
//   - KACCAU e SAL INFINITY BY BLUMENAU ficam de fora, como nas NF-e.
//
// O QUE JÁ EXISTE NÃO ENTRA DE NOVO. Três maneiras de reconhecer:
//   1. o mesmo documento ("COMPRA-2901/1", "VEN-16321/1", "L 36541") — o "L"
//      é o número de lançamento do Viper, que a carga de 11/09 já gravou como
//      "LF26756 · L 33705";
//   2. mesmo tipo, mesma pessoa, mesmo valor e mesmo vencimento — a carga de
//      11/09 veio de outro relatório e identifica pela NF, não pela compra;
//   3. cada lançamento existente casa com UM título só: duas parcelas iguais
//      do mesmo fornecedor no mesmo dia são duas, e não uma.
//
// Título com quitação parcial entra pelo que FALTA (Em Aberto), com o valor
// original e o quitado na observação: o pagamento parcial foi feito no Viper,
// e lançá-lo aqui exigiria conta e data que a planilha não traz.
'use strict';

const { EMPRESAS_DA_LISTAGEM } = require('./importacao-nfe-viper');

const CABECALHO_PAGAR = ['Empresa', 'Fornecedor', 'Número/Documento', 'NFe', 'Emissão', 'Vencimento', 'Valor', 'Quitado', 'Em Aberto', 'Status', 'Observação'];
const CABECALHO_RECEBER = ['Empresa', 'Cliente', 'Número/Documento', 'NFe/ NFCe', 'Emissão', 'Vencimento', 'Valor', 'Quitado', 'Em Aberto', 'Status', 'Observação'];
const EMPRESAS_IGNORADAS = /KACCAU|BLUMENAU/i;

const iso = (br) => {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(String(br || '').trim());
  return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
};
const valor = (v) => {
  if (typeof v === 'number') return Math.round(v * 100) / 100;
  const t = String(v ?? '').trim();
  if (!t) return 0;
  const n = Number(/,\d{1,2}$/.test(t) ? t.replace(/\./g, '').replace(',', '.') : t);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
};
const texto = (v, max = 200) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/** Nome comparável: sem acento, sem o CNPJ de MEI no começo ("49.292.546 FULANA"). */
function nomeComparavel(nome) {
  return String(nome || '').normalize('NFD').replace(/\p{M}/gu, '').toUpperCase()
    .replace(/^[\d.]+\s+/, '').replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Lê uma planilha. `tipo`: 'DESPESA' (a pagar) ou 'RECEITA' (a receber).
 * Recusa a planilha se o cabeçalho não for o esperado.
 */
function lerPlanilha(abas, tipo) {
  const aba = Array.isArray(abas) ? abas[0] : null;
  const linhas = (Array.isArray(aba) ? aba : (aba && aba.linhas)) || [];
  const posCab = linhas.findIndex((l) => Array.isArray(l) && String(l[0]).trim() === 'Empresa');
  if (posCab < 0) throw new Error('Cabeçalho "Empresa | Fornecedor/Cliente | ..." não encontrado. É a planilha de contas do Viper?');
  const esperado = tipo === 'RECEITA' ? CABECALHO_RECEBER : CABECALHO_PAGAR;
  const cab = linhas[posCab].map((c) => String(c).trim());
  const fora = esperado.filter((c, i) => cab[i] !== c);
  if (fora.length) {
    throw new Error(`Colunas fora do lugar na planilha de contas a ${tipo === 'RECEITA' ? 'receber' : 'pagar'}: ${fora.join(', ')}.`);
  }
  const titulos = [];
  const ignorados = [];
  for (const l of linhas.slice(posCab + 1)) {
    const empresa = texto(l[0]);
    if (!empresa || /^total$/i.test(empresa)) continue;
    const documento = texto(l[2], 60);
    const base = { documento, pessoa: texto(l[1]) };
    if (EMPRESAS_IGNORADAS.test(empresa)) { ignorados.push({ ...base, motivo: 'empresa fora da importação (KACCAU/Blumenau)' }); continue; }
    const aberto = valor(l[8]);
    const status = texto(l[9]);
    if (/^pago$/i.test(status) || !(aberto > 0)) { ignorados.push({ ...base, motivo: 'já quitado' }); continue; }
    const vencimento = iso(l[5]);
    if (!vencimento) { ignorados.push({ ...base, motivo: 'sem vencimento' }); continue; }
    if (!documento) { ignorados.push({ ...base, motivo: 'sem número/documento' }); continue; }
    titulos.push({
      tipo,
      empresa,
      cnpjEmpresa: EMPRESAS_DA_LISTAGEM[empresa] || '',
      pessoa: texto(l[1]),
      documento,
      nota: texto(l[3], 20),
      emissao: iso(l[4]) || vencimento,
      vencimento,
      valorOriginal: valor(l[6]),
      quitado: valor(l[7]),
      aberto,
      statusViper: status,
      observacao: texto(l[10], 300)
    });
  }
  return { titulos, ignorados };
}

const escaparRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * O que entra. `existentes`: [{ id, type, document, clientSupplierName,
 * amount, dueDate }] — todos os lançamentos (abertos e pagos), para nada
 * voltar como novo.
 */
function planejar(titulos, existentes) {
  const porDocumento = (tipo, doc) => {
    const re = new RegExp(`(^|· )${escaparRegex(doc)}$`);
    return (existentes || []).filter((e) => e.type === tipo && re.test(String(e.document || '').trim()));
  };
  const chave = (tipo, pessoa, quantia, venc) => `${tipo}|${nomeComparavel(pessoa)}|${Number(quantia).toFixed(2)}|${String(venc || '').slice(0, 10)}`;
  const livres = new Map();
  for (const e of existentes || []) {
    const k = chave(e.type, e.clientSupplierName, e.amount, e.dueDate);
    livres.set(k, [...(livres.get(k) || []), e.id]);
  }
  const usados = new Set();
  const consumir = (k) => {
    const lista = (livres.get(k) || []).filter((id) => !usados.has(id));
    if (!lista.length) return null;
    usados.add(lista[0]);
    return lista[0];
  };

  const novos = [];
  const jaExistem = [];
  for (const t of titulos) {
    const doDocumento = porDocumento(t.tipo, t.documento).find((e) => !usados.has(e.id));
    if (doDocumento) { usados.add(doDocumento.id); jaExistem.push({ ...t, existenteId: doDocumento.id, como: 'documento' }); continue; }
    const pelaChave = consumir(chave(t.tipo, t.pessoa, t.valorOriginal, t.vencimento))
      || (t.aberto !== t.valorOriginal ? consumir(chave(t.tipo, t.pessoa, t.aberto, t.vencimento)) : null);
    if (pelaChave) { jaExistem.push({ ...t, existenteId: pelaChave, como: 'pessoa+valor+vencimento' }); continue; }
    novos.push(t);
  }
  return { novos, jaExistem };
}

/** O lançamento que o título vira (o documento externo segue o número LF). */
function comoLancamento(t, { estabelecimentoId = '', pessoaId = '' } = {}) {
  const partes = [t.observacao || `Título ${t.documento}`];
  if (t.nota) partes.push(`NF ${t.nota}`);
  const nota = [
    `Importado do Viper em ${new Date().toLocaleDateString('pt-BR')} — ${t.documento} (${t.empresa})`,
    t.quitado > 0 ? `Valor original R$ ${t.valorOriginal.toFixed(2).replace('.', ',')}, já quitado no Viper R$ ${t.quitado.toFixed(2).replace('.', ',')}` : '',
    `Situação no Viper: ${t.statusViper}`
  ].filter(Boolean).join(' | ');
  return {
    type: t.tipo,
    date: t.emissao,
    dueDate: t.vencimento,
    amount: t.aberto,
    description: partes.join(' — ').slice(0, 300),
    document: t.documento,
    note: nota,
    clientSupplierName: t.pessoa,
    clientSupplierId: pessoaId,
    estabelecimentoId,
    status: 'pending'
  };
}

module.exports = { CABECALHO_PAGAR, CABECALHO_RECEBER, lerPlanilha, planejar, comoLancamento, nomeComparavel };
