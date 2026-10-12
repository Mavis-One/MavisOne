/**
 * OS PEDIDOS DO VIPER, DA "LISTAGEM DE VENDAS" PARA DOCUMENTOS (12/10/2026).
 *
 * Função pura: recebe as abas lidas por lib/xlsx-leitor.js e devolve os
 * pedidos e orçamentos que a rota POST /api/sales/importacao/viper grava, mais
 * o que ficou de fora e por quê. É o mesmo caminho das NF-e importadas
 * (lib/importacao-nfe-viper.js): histórico, sem estoque e sem financeiro.
 *
 * A LISTAGEM traz, por documento: número, tipo (VEN = pedido, ORC =
 * orçamento), faturado, o número da NF-e/NFC-e ("278 (Aprovada)"), empresa,
 * data, cliente, total, vendedor e cancelado. NÃO traz itens nem a categoria
 * do Viper — por isso o pedido entra só com o cabeçalho.
 *
 * A CATEGORIA, que no MavisONE diz a filial (lib/filial-da-venda.js: o sufixo
 * depois da barra), sai da empresa, pelo sufixo que a MAIORIA dos pedidos
 * daquela empresa recebeu na importação de 11/09/2026 (Guaramirim usava
 * "Kaccau" no Viper, e a meta da filial está nesse nome). Matriz e Electric
 * ficam sem sufixo: no histórico elas se dividiam entre vários.
 *
 * NÚMERO FORA DA FAIXA (> 20.000) não entra: o reparo da numeração do
 * MavisONE pula para depois do maior código. Na listagem de 01-10/10/2026
 * havia um 14.334.125 (erro de digitação) e quatro vendas da Electric numa
 * numeração à parte (27.001 a 27.004) — com qualquer um deles, todo pedido
 * novo do MavisONE passaria a nascer depois dele. Ficam de fora, listados.
 *
 * Pedido e orçamento COMPARTILHAM a numeração no MavisONE: o mesmo número
 * em um VEN e um ORC do Viper (aconteceu com o 16.060) entra uma vez só.
 */
const CATEGORIA_BASE = 'Venda de Materiais e Serviços';
const SUFIXO_DA_EMPRESA = {
  'SAL INFINITY PLUS COMERCIO LTDA FILIAL 02 (MARCOLLA)': 'Marcolla',
  'SAL INFINITY PLUS COMERCIO LTDA FILIAL 03 (ARAQUARI)': 'Araquari',
  'SAL INFINITY PLUS COMERCIO LTDA FILIAL 04 (SAO BENTO DO SUL)': 'São Bento do Sul',
  'SAL INFINITY PLUS COMERCIO LTDA FILIAL 05 (TIMBO)': 'Timbo',
  'SAL INFINITY PLUS COMERCIO LTDA FILIAL 06 (GUARAMIRIM)': 'Kaccau',
  'SAL INFINITY PLUS COMERCIO LTDA FILIAL 08 (CENTRO - JOINVILLE)': 'Joinville Centro',
  'SAL INFINITY PLUS COMERCIO LTDA FILIAL 09 (IRIRIU - JOINVILLE)': 'Iririu',
  'SAL INFINITY PLUS COMERCIO LTDA FILIAL 10 (BARRA)': 'Barra',
  'SAL INFINITY PLUS COMERCIO LTDA (MATRIZ)': '',
  'SAL INFINITY ELECTRIC LTDA': ''
};
const MAIOR_NUMERO_ACEITO = 20000;

const texto = (v, max = 200) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const valor = (v) => {
  const n = Number(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
};
const data = (v) => {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(texto(v));
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
};

/** "278 (Aprovada)" -> { numero: '278', situacao: 'Aprovada' }; "-" -> null. */
function notaDaLinha(v) {
  const m = /^(\d+)\s*(?:\(([^)]*)\))?/.exec(texto(v));
  return m ? { numero: m[1], situacao: texto(m[2], 30) } : null;
}

function montarPedidos(abas) {
  const aba = abas[0];
  const posCab = aba.linhas.findIndex((l) => l.includes('Número') && l.includes('Doc.'));
  if (posCab < 0) throw new Error('Cabeçalho da Listagem de Vendas (Número, Doc., ...) não encontrado.');
  const cab = aba.linhas[posCab];
  const ix = (n) => { const i = cab.indexOf(n); if (i < 0) throw new Error(`Coluna "${n}" não encontrada.`); return i; };
  const c = {
    num: ix('Número'), doc: ix('Doc.'), fat: ix('Faturado'), nf: ix('NFe/ NFCe'), emp: ix('Empresa'),
    data: ix('Data Emissão'), cli: ix('Cliente'), total: ix('Total'), vend: ix('Vendedor'), canc: ix('Canc.')
  };
  const documentos = [];
  const ignorados = [];
  const vistos = new Set();
  aba.linhas.slice(posCab + 1).forEach((l, i) => {
    const linha = posCab + i + 2;
    const numero = texto(l[c.num], 20);
    if (!/^\d+$/.test(numero)) return;
    const empresa = texto(l[c.emp]);
    const tipoViper = texto(l[c.doc]).toUpperCase();
    if (Number(numero) > MAIOR_NUMERO_ACEITO) {
      ignorados.push({ linha, numero, motivo: 'número fora da faixa do Viper (acima de 20.000)' });
      return;
    }
    if (!(empresa in SUFIXO_DA_EMPRESA)) { ignorados.push({ linha, numero, motivo: `empresa fora do MavisONE: ${empresa}` }); return; }
    if (!['VEN', 'ORC'].includes(tipoViper)) { ignorados.push({ linha, numero, motivo: `tipo de documento não tratado: ${tipoViper}` }); return; }
    const dia = data(l[c.data]);
    if (!dia) { ignorados.push({ linha, numero, motivo: 'data não reconhecida' }); return; }
    if (vistos.has(numero)) { ignorados.push({ linha, numero, motivo: 'número repetido na planilha (pedido e orçamento dividem a numeração)' }); return; }
    vistos.add(numero);

    const cancelado = texto(l[c.canc]).toLowerCase() === 'sim';
    const faturado = texto(l[c.fat]).toLowerCase() === 'sim';
    const tipo = tipoViper === 'ORC' ? 'orcamento' : 'pedido';
    // Os status que a importação de 11/09/2026 usou (ver o commit 21f4236).
    let status;
    if (tipo === 'orcamento') status = 'orcamento';
    else if (cancelado) status = 'pedido-cancelado';
    else if (faturado) status = 'pedido-faturado';
    else status = 'pedido';
    const sufixo = SUFIXO_DA_EMPRESA[empresa];
    documentos.push({
      tipo,
      codigo: Number(numero),
      empresa,
      data: dia,
      cliente: texto(l[c.cli], 120),
      vendedor: texto(l[c.vend], 120),
      total: valor(l[c.total]),
      status,
      cancelado,
      faturado,
      categoria: sufixo ? `${CATEGORIA_BASE} / ${sufixo}` : CATEGORIA_BASE,
      nota: notaDaLinha(l[c.nf])
    });
  });
  const conta = (f) => documentos.reduce((m, d) => { const k = f(d); m[k] = (m[k] || 0) + 1; return m; }, {});
  return {
    documentos,
    ignorados,
    resumo: {
      total: documentos.length,
      porTipo: conta((d) => d.tipo),
      porStatus: conta((d) => d.status),
      comNota: documentos.filter((d) => d.nota).length,
      porEmpresa: conta((d) => d.empresa),
      faixa: documentos.length ? [Math.min(...documentos.map((d) => d.codigo)), Math.max(...documentos.map((d) => d.codigo))] : null
    }
  };
}

module.exports = { montarPedidos, notaDaLinha, SUFIXO_DA_EMPRESA, MAIOR_NUMERO_ACEITO };
