// CONTAS A PAGAR E A RECEBER DO VIPER (13/10/2026) — a parte pura.
//
// Planilhas "Contas a Pagar" e "Contas a Receber" do Viper: os títulos EM
// ABERTO. Decisões do usuário (12/10/2026):
//   - importar todo o em aberto (ele reexporta sem filtro de vencimento — a
//     primeira exportação trazia só outubro);
//   - título que está em aberto no MavisONE e não aparece mais no Viper FICA
//     COMO ESTÁ (não se dá baixa por dedução);
//   - ESPELHO (14/10/2026): o financeiro fica igual à planilha. O que aparece
//     QUITADO lá e está em aberto aqui recebe baixa; Em Aberto diferente é
//     baixado ou ajustado — ver acaoDoEspelho. A planilha não traz data nem
//     conta do pagamento: a baixa sai na data do vencimento (ou hoje, se ele
//     ainda não chegou) e sem conta;
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
  // Os QUITADOS no Viper não entram como título novo, mas servem ao espelho
  // (14/10/2026): o que está em aberto aqui e já foi pago lá recebe baixa.
  const quitados = [];
  for (const l of linhas.slice(posCab + 1)) {
    const empresa = texto(l[0]);
    if (!empresa || /^total$/i.test(empresa)) continue;
    const documento = texto(l[2], 60);
    const base = { documento, pessoa: texto(l[1]) };
    if (EMPRESAS_IGNORADAS.test(empresa)) { ignorados.push({ ...base, motivo: 'empresa fora da importação (KACCAU/Blumenau)' }); continue; }
    const aberto = valor(l[8]);
    const status = texto(l[9]);
    const vencimento = iso(l[5]);
    const titulo = {
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
    };
    if (/^pago$/i.test(status) || !(aberto > 0)) {
      ignorados.push({ ...base, motivo: 'já quitado' });
      if (vencimento && documento) quitados.push({ ...titulo, aberto: 0 });
      continue;
    }
    if (!vencimento) { ignorados.push({ ...base, motivo: 'sem vencimento' }); continue; }
    if (!documento) { ignorados.push({ ...base, motivo: 'sem número/documento' }); continue; }
    titulos.push(titulo);
  }
  return { titulos, ignorados, quitados };
}

/**
 * O que entra. `existentes`: [{ id, type, document, clientSupplierName,
 * amount, dueDate }] — todos os lançamentos (abertos e pagos), para nada
 * voltar como novo.
 */
/**
 * Quem reconhece um título nos lançamentos existentes. Cada lançamento casa com
 * UM título só, e o casador lembra disso entre chamadas: os títulos em aberto
 * casam primeiro, os quitados depois, com o que sobrou (espelho, 14/10/2026).
 *
 * O documento é indexado, e não procurado com regex lançamento a lançamento:
 * com os quitados são ~30 mil linhas contra dezenas de milhares de lançamentos.
 * Mesmo critério de antes — o documento inteiro, ou o que vem depois de um
 * "· " ("LF26756 · L 36541" casa "L 36541").
 */
function criarCasador(existentes, linhasDaPlanilha = []) {
  const lista = existentes || [];
  // O MESMO DOCUMENTO EM PESSOAS DIFERENTES (14/10/2026). No Viper, "L 32017"
  // é da THE BLACK e também da VIVA COMÉRCIO. Casar só pelo documento ligou a
  // linha de um ao lançamento do outro, e o espelho trocou os valores entre
  // eles (pego na segunda rodada da prova local). Com candidatos pelo
  // documento, vale o da mesma pessoa, depois o do mesmo vencimento; o
  // candidato que não bate em nenhum dos dois só vale quando o documento é
  // único na planilha — que é o caso da carga de 11/09, gravada com o nome
  // de outro relatório.
  const vezesNaPlanilha = new Map();
  for (const t of linhasDaPlanilha || []) {
    const k = `${t.tipo}|${String(t.documento).trim()}`;
    vezesNaPlanilha.set(k, (vezesNaPlanilha.get(k) || 0) + 1);
  }
  const porDoc = new Map();
  for (const e of lista) {
    const partes = String(e.document || '').trim().split('· ');
    for (let i = 0; i < partes.length; i += 1) {
      const k = `${e.type}|${partes.slice(i).join('· ').trim()}`;
      if (!porDoc.has(k)) porDoc.set(k, []);
      if (!porDoc.get(k).includes(e)) porDoc.get(k).push(e);
    }
  }
  const chave = (tipo, pessoa, quantia, venc) => `${tipo}|${nomeComparavel(pessoa)}|${Number(quantia).toFixed(2)}|${String(venc || '').slice(0, 10)}`;
  const livres = new Map();
  for (const e of lista) {
    const k = chave(e.type, e.clientSupplierName, e.amount, e.dueDate);
    livres.set(k, [...(livres.get(k) || []), e]);
  }
  const usados = new Set();
  // ENTRE LANÇAMENTOS IGUAIS (mesma pessoa, valor e vencimento — o
  // "CONSUMIDOR NÃO IDENTIFICADO" de R$ 150 em 30/09/2024), o título em
  // aberto no Viper prefere o lançamento em aberto aqui, e o quitado prefere o
  // quitado. Sem isso a escolha seguia a ordem do banco, que muda depois das
  // gravações: a segunda rodada reabria um e baixava o outro, trocando os dois.
  const emAbertoAqui = (e) => !(e.emAberto !== undefined ? Number(e.emAberto) <= 0.005 : String(e.status || '').toLowerCase() === 'paid');
  const consumir = (k, emAberto) => {
    const lista = (livres.get(k) || []).filter((e) => !usados.has(e.id));
    if (!lista.length) return null;
    const escolhido = lista.find((e) => emAbertoAqui(e) === emAberto) || lista[0];
    usados.add(escolhido.id);
    return escolhido.id;
  };
  return function casar(t) {
    const abertoNoViper = t.aberto > 0;
    const chaveDoc = `${t.tipo}|${String(t.documento).trim()}`;
    // No mesmo estado primeiro, pelo mesmo motivo de `consumir`.
    const candidatos = (porDoc.get(chaveDoc) || []).filter((e) => !usados.has(e.id))
      .sort((a, b) => Number(emAbertoAqui(b) === abertoNoViper) - Number(emAbertoAqui(a) === abertoNoViper));
    const pessoa = nomeComparavel(t.pessoa);
    const mesmaPessoa = (e) => nomeComparavel(e.clientSupplierName) === pessoa;
    const mesmoVencimento = (e) => String(e.dueDate || '').slice(0, 10) === t.vencimento;
    const doDocumento = candidatos.find((e) => mesmaPessoa(e) && mesmoVencimento(e))
      || candidatos.find(mesmaPessoa)
      || candidatos.find(mesmoVencimento)
      || ((vezesNaPlanilha.get(chaveDoc) || 1) === 1 && candidatos.length === 1 ? candidatos[0] : null);
    if (doDocumento) { usados.add(doDocumento.id); return { existenteId: doDocumento.id, como: 'documento' }; }
    const pelaChave = consumir(chave(t.tipo, t.pessoa, t.valorOriginal, t.vencimento), abertoNoViper)
      || (abertoNoViper && t.aberto !== t.valorOriginal ? consumir(chave(t.tipo, t.pessoa, t.aberto, t.vencimento), abertoNoViper) : null);
    return pelaChave ? { existenteId: pelaChave, como: 'pessoa+valor+vencimento' } : null;
  };
}

function planejar(titulos, existentes, casar = criarCasador(existentes, titulos)) {
  const novos = [];
  const jaExistem = [];
  for (const t of titulos) {
    const casou = casar(t);
    if (casou) jaExistem.push({ ...t, ...casou });
    else novos.push(t);
  }
  return { novos, jaExistem, casar };
}

/** Os quitados no Viper que têm lançamento aqui (com o casador do planejar). */
function casarQuitados(quitados, casar) {
  const casados = [];
  for (const t of quitados || []) {
    const casou = casar(t);
    if (casou) casados.push({ ...t, ...casou });
  }
  return casados;
}

const centavos = (n) => Math.round(Number(n || 0) * 100) / 100;

/**
 * O QUE O ESPELHO FAZ COM UM LANÇAMENTO QUE JÁ EXISTE (14/10/2026).
 *
 * Decisão do usuário: o financeiro fica igual à planilha do Viper. Compara o
 * EM ABERTO daqui com o "Em Aberto" de lá:
 *   - igual: nada;
 *   - aqui tem MAIS em aberto e lá houve quitação (Quitado > 0, ou título
 *     pago): BAIXA da diferença — o pagamento foi feito no Viper;
 *   - aqui tem mais em aberto e lá NÃO houve quitação: o valor do título mudou
 *     lá (renegociação) — AJUSTA o valor daqui, se ele não tem baixa;
 *   - aqui tem MENOS em aberto: ajusta o valor se não há baixa; com baixa, ou
 *     quitado aqui e em aberto lá, só REPORTA — desfazer uma baixa feita no
 *     MavisONE (com conta e data) por causa de uma planilha não se faz calado.
 *
 *   - quitado aqui SÓ pela baixa presumida da carga de 11/09: REABRE (desfaz
 *     essa baixa) e segue a regra acima.
 *
 * `situacao`: { amount, status, emAberto, temBaixas, nBaixas, baixasPresumidas }
 * do lançamento daqui.
 */
function acaoDoEspelho(t, situacao) {
  const s = situacao || {};
  const viper = centavos(t.aberto);
  const aqui = centavos(s.emAberto);
  const quitadoAqui = String(s.status || '').toLowerCase() === 'paid' || aqui <= 0.005;
  if (quitadoAqui) {
    if (viper <= 0.009) return { acao: 'nada' };
    // A BAIXA PRESUMIDA DA CARGA DE 11/09. Aquela carga supôs que título
    // vencido estava pago ("presumida: vencido e sem baixa no Viper") — e o
    // Viper diz que não está. Se TODAS as baixas do lançamento são dessas, o
    // espelho as desfaz e o título volta a ficar em aberto; e aí o resto da
    // regra decide (o Viper pode ter quitado uma parte).
    if (s.baixasPresumidas > 0 && s.baixasPresumidas === s.nBaixas) {
      const depois = acaoDoEspelho(t, { amount: s.amount, status: 'pending', emAberto: s.amount, temBaixas: false, nBaixas: 0, baixasPresumidas: 0 });
      return { acao: 'reabrir', depois };
    }
    return { acao: 'divergencia', motivo: 'quitado no MavisONE, em aberto no Viper' };
  }
  const diferenca = centavos(aqui - viper);
  if (Math.abs(diferenca) <= 0.009) return { acao: 'nada' };
  if (diferenca > 0 && (t.quitado > 0 || viper === 0)) {
    return { acao: 'baixar', valor: diferenca, total: viper === 0 };
  }
  if (!s.temBaixas) return { acao: 'ajustar', novoValor: centavos(Number(s.amount || 0) - diferenca) };
  return { acao: 'divergencia', motivo: `em aberto aqui ${aqui.toFixed(2)}, no Viper ${viper.toFixed(2)}, e o título já tem baixa no MavisONE` };
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

module.exports = {
  CABECALHO_PAGAR, CABECALHO_RECEBER, lerPlanilha, planejar, comoLancamento, nomeComparavel,
  criarCasador, casarQuitados, acaoDoEspelho
};
