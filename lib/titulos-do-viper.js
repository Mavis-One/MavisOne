// AS CONTAS A PAGAR DO VIPER DE UMA NOTA DE ENTRADA (19/10/2026).
//
// Pedido do usuário: "o sistema está passando a entrada de NF em duplicidade e
// criando títulos em duplicidade". A nota lançada no Viper chegou ao MavisONE
// só como título (as importações de 11/09 e de 14/10), sem entrada: a lista de
// Notas contra CNPJ a mostra como pendente, e dar entrada nela criava os
// títulos (e o estoque) de novo. No banco local, 277 das 540 notas recebidas
// estavam nesse caso.
//
// O título do Viper não guarda a chave da nota — só o número, no texto, e o
// fornecedor:
//   - importação de 11/09 (ViperERP): "Referente a NF DE ENTRADA de codigo
//     1218 - Nº 9262, emitida em ...";
//   - importação de 14/10 (planilha, observação "Importado do Viper em ..."):
//     "<observação> — NF 9262".
// O título do próprio MavisONE ("Despesa de compra · NF-e 12345 · Parcela
// 1/3") não casa: ele já é a entrada, e a chave única dela barra a repetição.

const semAcento = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
const digitos = (v) => String(v || '').replace(/\D/g, '');

/** "Kaccau Elétric Ltda." -> "KACCAU ELETRIC LTDA" (para casar pelo nome). */
function nomeComparavel(nome) {
  return semAcento(nome).toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
}

/** O número da nota que o título do Viper cita, sem zeros à esquerda (ou null). */
function numeroDaNotaNoTitulo(descricao, observacao) {
  const d = String(descricao || '');
  const daEntrada = /NF DE ENTRADA[\s\S]*?N[º°]\.?\s*0*(\d+)(?!\d)/i.exec(d);
  if (daEntrada) return daEntrada[1];
  if (/^Importado do Viper em /.test(String(observacao || ''))) {
    const daPlanilha = /(?:^|[^\w-])NF\s+0*(\d+)(?!\d)/.exec(d);
    if (daPlanilha) return daPlanilha[1];
  }
  return null;
}

/**
 * O índice: número da nota + fornecedor (pelo CNPJ/CPF do cadastro, e pelo
 * nome, para o título sem cadastro ligado) -> títulos.
 * `linhas`: { id, code, amount, due_date, description, note,
 * client_supplier_name, documento } — ver indiceDosTitulosDoViper no servidor.
 */
function montarIndice(linhas) {
  const indice = new Map();
  const guardar = (chave, titulo) => {
    if (!indice.has(chave)) indice.set(chave, []);
    indice.get(chave).push(titulo);
  };
  for (const l of linhas || []) {
    const numero = numeroDaNotaNoTitulo(l.description, l.note);
    if (!numero) continue;
    const titulo = { id: l.id, code: l.code, amount: Number(l.amount || 0), dueDate: l.due_date || '' };
    const documento = digitos(l.documento);
    if (documento) guardar(`doc:${documento}|${numero}`, titulo);
    const nome = nomeComparavel(l.client_supplier_name);
    if (nome) guardar(`nome:${nome}|${numero}`, titulo);
  }
  return indice;
}

/** Os títulos do Viper desta nota (pelo CNPJ ou pelo nome do emitente). */
function titulosDaNota(indice, { numero, emitenteDocumento, emitenteNome }) {
  const n = String(numero || '').replace(/^0+/, '');
  if (!n || !indice) return [];
  const achados = new Map();
  [`doc:${digitos(emitenteDocumento)}|${n}`, `nome:${nomeComparavel(emitenteNome)}|${n}`]
    .forEach((chave) => (indice.get(chave) || []).forEach((t) => achados.set(t.id, t)));
  return [...achados.values()].sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)));
}

module.exports = { nomeComparavel, numeroDaNotaNoTitulo, montarIndice, titulosDaNota };
