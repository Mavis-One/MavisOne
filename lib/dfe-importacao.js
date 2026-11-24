/**
 * NOTAS ANTIGAS CONTRA O CNPJ, PELO ARQUIVO XML (19/11/2026).
 *
 * Pedido do usuário: "preciso puxar notas mais antigas, faça um botão que
 * somente o ADMIN vê pra puxar notas mais antigas".
 *
 * POR QUE PELO ARQUIVO, E NÃO PELA SEFAZ
 * --------------------------------------
 * A SEFAZ só distribui (DistDFe, por NSU ou por chave) o que o Ambiente
 * Nacional recebeu nos ÚLTIMOS 90 DIAS (NT 2014.002). A Focus começou a guardar
 * as notas destes CNPJs em agosto/2026 e, por isso, a mais antiga que ela tem é
 * de 12/05/2026 — conferido no banco: a lista começa nessa data. Um botão de
 * "buscar mais antigas" na SEFAZ voltaria vazio. O que existe das notas
 * anteriores é o XML guardado por quem as recebeu: o Viper, o contador, o
 * e-mail do fornecedor. O usuário escolheu importar esses arquivos.
 *
 * Função pura: XML entra, objeto sai. Quem grava é a rota (server.js).
 *
 * O QUE SE ACEITA
 *   - a NF-e completa (nfeProc com protNFe, ou a NFe sem o protocolo), modelo
 *     55, de produção;
 *   - o evento de CANCELAMENTO (110111) homologado: marca a nota como cancelada,
 *     para que ninguém dê entrada nela.
 * O QUE SE RECUSA, dizendo o porquê: o resumo (resNFe), a NFC-e, a nota de
 * homologação, a denegada, e qualquer outro evento.
 */

const { parseXml, achar, txt, num, erroXml, LIMITE_XML_BYTES } = require('./nfeXml');

const digitos = (valor) => String(valor || '').replace(/\D/g, '');

// 100 autorizada; 150 autorizada fora de prazo. Denegada (110, 301, 302, 303)
// e qualquer rejeição não são nota que circulou.
const STATUS_AUTORIZADA = new Set(['100', '150']);
// 135 evento registrado; 136 registrado sem vínculo; 155 cancelamento fora de
// prazo homologado.
const STATUS_EVENTO_ACEITO = new Set(['135', '136', '155']);
const EVENTO_CANCELAMENTO = '110111';

/**
 * Lê um arquivo XML de nota recebida.
 *
 * Devolve { tipo: 'nota', nota } ou { tipo: 'cancelamento', chave, protocolo }.
 * Lança erro (status 400) com a mensagem para o usuário quando o arquivo não
 * serve.
 */
function lerArquivoRecebido(xml) {
  const texto = String(xml || '');
  if (!texto.trim()) throw erroXml('Arquivo vazio.');
  if (Buffer.byteLength(texto, 'utf8') > LIMITE_XML_BYTES) throw erroXml('Arquivo grande demais para ser uma NF-e.');

  let raiz;
  try {
    raiz = parseXml(texto);
  } catch (erro) {
    throw erroXml(erro && erro.message ? `Não é um XML válido (${erro.message}).` : 'Não é um XML válido.');
  }

  // O EVENTO (procEventoNFe, ou o envEvento/evento solto).
  const infEvento = achar(raiz, 'infEvento');
  if (infEvento && !achar(raiz, 'infNFe')) {
    const tipoEvento = txt(infEvento, 'tpEvento');
    const chave = digitos(txt(infEvento, 'chNFe'));
    if (tipoEvento !== EVENTO_CANCELAMENTO) {
      throw erroXml(`É um evento (${tipoEvento || 'sem tipo'}), não uma nota. Só o cancelamento (110111) é aproveitado.`);
    }
    if (chave.length !== 44) throw erroXml('Evento de cancelamento sem a chave da nota.');
    // O retorno da SEFAZ (retEvento) diz se o cancelamento valeu. Sem ele, o
    // arquivo é só o pedido — não prova que a nota foi cancelada.
    const retorno = achar(raiz, 'retEvento');
    const statusRetorno = retorno ? txt(achar(retorno, 'infEvento') || retorno, 'cStat') : '';
    if (!STATUS_EVENTO_ACEITO.has(statusRetorno)) {
      throw erroXml(statusRetorno
        ? `Cancelamento não homologado pela SEFAZ (status ${statusRetorno}).`
        : 'Pedido de cancelamento sem o retorno da SEFAZ: não prova que a nota foi cancelada.');
    }
    return {
      tipo: 'cancelamento',
      chave,
      protocolo: txt(achar(retorno, 'infEvento') || retorno, 'nProt')
    };
  }

  const inf = achar(raiz, 'infNFe');
  if (!inf) {
    if (achar(raiz, 'resNFe')) {
      throw erroXml('É só o RESUMO da nota (resNFe), sem os itens. Use o XML completo.');
    }
    throw erroXml('Não encontrei a NF-e neste arquivo (falta o <infNFe>).');
  }

  const ide = achar(inf, 'ide');
  const protocolo = achar(raiz, 'infProt');
  const chave = digitos(inf.atributos.Id || '') || digitos(txt(protocolo, 'chNFe'));
  if (chave.length !== 44) throw erroXml('NF-e sem chave de acesso válida.');

  const modelo = txt(ide, 'mod');
  if (modelo && modelo !== '55') {
    throw erroXml(`É ${modelo === '65' ? 'NFC-e (modelo 65)' : `modelo ${modelo}`}; aqui entram só NF-e (modelo 55).`);
  }
  if (txt(ide, 'tpAmb') === '2') {
    throw erroXml('Nota de HOMOLOGAÇÃO (teste), sem valor fiscal.');
  }

  const statusProtocolo = protocolo ? txt(protocolo, 'cStat') : '';
  if (protocolo && !STATUS_AUTORIZADA.has(statusProtocolo)) {
    throw erroXml(`Nota não autorizada pela SEFAZ (status ${statusProtocolo || 'vazio'}: ${txt(protocolo, 'xMotivo') || 'sem motivo'}).`);
  }

  const emitente = achar(inf, 'emit');
  const destinatario = achar(inf, 'dest');
  const total = achar(achar(inf, 'total'), 'ICMSTot');
  return {
    tipo: 'nota',
    nota: {
      chave,
      modelo: modelo || '55',
      serie: txt(ide, 'serie'),
      numero: txt(ide, 'nNF'),
      // dhEmi inteiro (com hora e fuso), como a Focus manda: a coluna é
      // timestamptz e a tela mostra a hora. Layout 2.00 só tinha dEmi.
      dataEmissao: txt(ide, 'dhEmi') || txt(ide, 'dEmi') || null,
      emitenteDocumento: digitos(txt(emitente, 'CNPJ') || txt(emitente, 'CPF')),
      emitenteNome: txt(emitente, 'xNome'),
      destinatarioDocumento: digitos(txt(destinatario, 'CNPJ') || txt(destinatario, 'CPF')),
      valorTotal: num(total, 'vNF'),
      protocolo: protocolo ? { numero: txt(protocolo, 'nProt'), status: statusProtocolo, recebidoEm: txt(protocolo, 'dhRecbto') } : null
    }
  };
}

module.exports = { lerArquivoRecebido, STATUS_AUTORIZADA, EVENTO_CANCELAMENTO };
