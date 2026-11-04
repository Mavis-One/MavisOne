// LEITOR DE EXTRATO CSV DE BANCO (04/11/2026).
//
// Pedido do usuário: o CSV que o banco exporta (Sicoob e os outros) entra como
// veio. O leitor antigo só aceitava "data,descricao,valor,tipo" separado por
// vírgula — o do banco vem com ponto e vírgula, cabeçalho em português, linhas
// de título antes dele, valor "1.234,56" ou "1.234,56D", e o nome de quem pagou
// ou recebeu no histórico, às vezes em várias linhas. É esse nome que a
// conciliação automática procura (lib/conciliacao-automatica.js).
//
// O que ele entende:
//   - separador ";", tab ou ",", com aspas e quebra de linha dentro da aspa;
//   - a linha de cabeçalho em qualquer altura (a primeira com Data e Valor, ou
//     Data e Crédito/Débito);
//   - a descrição é a junção das colunas de texto (Histórico, Descrição,
//     Complemento, Favorecido, Nome, CPF/CNPJ...), separadas por " - ";
//   - linha sem data e sem valor, logo depois de um lançamento, continua o
//     histórico dele (o Sicoob põe "Recebimento Pix", o nome e o CPF assim);
//   - valor com sinal, "C"/"D" no fim, entre parênteses, ou em colunas
//     separadas de crédito e débito; coluna "Tipo" com C/D, crédito/débito,
//     entrada/saída;
//   - linha de SALDO fica fora.
//
// Função pura (o navegador lê o arquivo; o teste roda sem navegador).
(function (raiz) {
  const semAcento = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
  const cabecalho = (s) => semAcento(s).toUpperCase().replace(/\(R\$\)|R\$/g, '').replace(/[:.]+$/g, '')
    .replace(/\s+/g, ' ').trim();
  const espaco = (s) => String(s || '').replace(/\s+/g, ' ').trim();

  /** As linhas do CSV, cada uma uma lista de células; aspas e quebra de linha dentro delas. */
  function celulas(texto, sep) {
    const linhas = [];
    let linha = [];
    let celula = '';
    let aspas = false;
    const t = String(texto || '').replace(/^﻿/, '');
    for (let i = 0; i < t.length; i += 1) {
      const c = t[i];
      if (aspas) {
        if (c === '"' && t[i + 1] === '"') { celula += '"'; i += 1; } else if (c === '"') aspas = false;
        else celula += c;
      } else if (c === '"' && !celula.trim()) {
        aspas = true;
        celula = '';
      } else if (c === sep) {
        linha.push(celula);
        celula = '';
      } else if (c === '\n' || c === '\r') {
        if (c === '\r' && t[i + 1] === '\n') i += 1;
        linha.push(celula);
        linhas.push(linha);
        linha = [];
        celula = '';
      } else celula += c;
    }
    if (celula || linha.length) { linha.push(celula); linhas.push(linha); }
    return linhas;
  }

  const COLUNA = {
    data: /^(DATA|DT|DIA)( (DO |DE |DA )?(LANCAMENTO|LANC|MOVIMENTO|MOV|MOVIMENTACAO|OPERACAO|TRANSACAO))?$/,
    valor: /^(VALOR|VLR|VL|MONTANTE|QUANTIA)( (DO |DE |DA )?(LANCAMENTO|LANC|MOVIMENTO|MOVIMENTACAO|OPERACAO|TRANSACAO))?$/,
    credito: /^(VALOR )?(CREDITO|CREDITOS|ENTRADA|ENTRADAS)$/,
    debito: /^(VALOR )?(DEBITO|DEBITOS|SAIDA|SAIDAS)$/,
    tipo: /^(TIPO|C\/D|D\/C|DC|CD|NATUREZA|SINAL|TIPO (DE |DO |DA )?(LANCAMENTO|OPERACAO|TRANSACAO|MOVIMENTO))$/,
    texto: /(HISTORICO|DESCRICAO|LANCAMENTO|MEMO|DETALHE|COMPLEMENTO|FAVORECIDO|BENEFICIARIO|PAGADOR|RECEBEDOR|REMETENTE|DESTINATARIO|NOME|CONTRAPARTE|ORIGEM|DESTINO|OBSERVACAO|INFORMAC|IDENTIFICAC|CPF|CNPJ)/
  };

  /** Onde está cada coluna, ou null se a linha não é o cabeçalho. */
  function mapaDoCabecalho(linha) {
    const nomes = linha.map(cabecalho);
    const achar = (re) => nomes.findIndex((n) => re.test(n) && !/SALDO/.test(n));
    const data = achar(COLUNA.data);
    const valor = achar(COLUNA.valor);
    const credito = achar(COLUNA.credito);
    const debito = achar(COLUNA.debito);
    if (data < 0 || (valor < 0 && (credito < 0 || debito < 0))) return null;
    const tipo = achar(COLUNA.tipo);
    const usadas = new Set([data, valor, credito, debito].filter((i) => i >= 0));
    const texto = nomes.map((n, i) => i).filter((i) => !usadas.has(i) && i !== tipo
      && !/SALDO/.test(nomes[i]) && COLUNA.texto.test(nomes[i]));
    return { data, valor, credito, debito, tipo, texto };
  }

  /** "13/10/2026", "13/10/26", "2026-10-13" (com ou sem hora) -> 2026-10-13 */
  function data(valor) {
    const s = espaco(valor);
    let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})\b/.exec(s);
    if (!m) return '';
    const ano = m[3].length === 2 ? `20${m[3]}` : m[3];
    const mes = Number(m[2]);
    const dia = Number(m[1]);
    if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return '';
    return `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
  }

  /** "-1.234,56", "1.234,56D", "(1.234,56)", "R$ 25,50 C", "25.50" -> número com sinal; vazio -> null */
  function valor(texto) {
    let t = semAcento(texto).toUpperCase().replace(/R\$/g, '').replace(/\s+/g, '');
    if (!t) return null;
    let sinal = 1;
    const sufixo = /(CREDITO|DEBITO|[CD])$/.exec(t);
    if (sufixo) { if (sufixo[1][0] === 'D') sinal = -1; t = t.slice(0, -sufixo[1].length); }
    if (/^\(.*\)$/.test(t)) { sinal = -sinal; t = t.slice(1, -1); }
    if (/^[-+]/.test(t)) { if (t[0] === '-') sinal = -sinal; t = t.slice(1); }
    if (/-$/.test(t)) { sinal = -sinal; t = t.slice(0, -1); }
    if (/,\d{1,2}$/.test(t)) t = t.replace(/\./g, '').replace(',', '.');
    else if (/^\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(t)) t = t.replace(/,/g, '');
    else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');
    if (!/^\d+(\.\d+)?$/.test(t)) return null;
    const n = Number(t);
    return Number.isFinite(n) ? sinal * n : null;
  }

  /** A coluna Tipo: -1 débito, 1 crédito, 0 não diz. */
  function sinalDoTipo(texto) {
    const t = semAcento(texto).toUpperCase().trim();
    if (/^(D|DEB|DEBITO|SAIDA|-)$/.test(t)) return -1;
    if (/^(C|CRED|CREDITO|ENTRADA|\+)$/.test(t)) return 1;
    return 0;
  }

  /**
   * @returns { transacoes: [{ date, description, amount, type }], ignoradas: [{ motivo, trecho }] }
   * Lança erro quando não acha o cabeçalho.
   */
  function lerCsvExtrato(texto) {
    let linhas = null;
    let mapa = null;
    let inicio = -1;
    for (const sep of [';', '\t', ',']) {
      const candidatas = celulas(texto, sep);
      const ate = Math.min(candidatas.length, 40);
      for (let i = 0; i < ate; i += 1) {
        const m = mapaDoCabecalho(candidatas[i]);
        if (m) { linhas = candidatas; mapa = m; inicio = i; break; }
      }
      if (mapa) break;
    }
    if (!mapa) {
      throw new Error('Não reconheci as colunas do CSV: preciso de uma coluna Data e de Valor (ou Crédito e Débito).');
    }

    const transacoes = [];
    const ignoradas = [];
    let ultima = null;
    for (const linha of linhas.slice(inicio + 1)) {
      const cel = (i) => (i >= 0 ? espaco(linha[i]) : '');
      if (!linha.some((c) => espaco(c))) continue;
      const tipoBruto = cel(mapa.tipo);
      const partes = mapa.texto.map(cel).filter(Boolean);
      if (tipoBruto && !sinalDoTipo(tipoBruto)) partes.unshift(tipoBruto);
      const descricao = partes.join(' - ');
      const dia = data(cel(mapa.data));

      let v = null;
      if (mapa.valor >= 0) v = valor(cel(mapa.valor));
      if ((v === null || v === 0) && mapa.credito >= 0 && mapa.debito >= 0) {
        const c = valor(cel(mapa.credito));
        const d = valor(cel(mapa.debito));
        if (c) v = Math.abs(c);
        else if (d) v = -Math.abs(d);
      }
      if (v !== null && sinalDoTipo(tipoBruto)) v = Math.abs(v) * sinalDoTipo(tipoBruto);

      // Continuação do histórico: sem data e sem valor, logo depois de um lançamento.
      if (!dia && (v === null || v === 0)) {
        if (ultima && descricao) ultima.description = `${ultima.description} - ${descricao}`.slice(0, 500);
        continue;
      }
      ultima = null;
      if (/^SALDO\b/.test(semAcento(descricao).toUpperCase()) || /^SALDO\b/.test(semAcento(cel(mapa.data)).toUpperCase())) {
        ignoradas.push({ motivo: 'saldo', trecho: espaco(linha.join(' ')).slice(0, 80) });
        continue;
      }
      if (!dia || v === null || v === 0) {
        ignoradas.push({ motivo: !dia ? 'sem data' : 'sem valor', trecho: espaco(linha.join(' ')).slice(0, 80) });
        continue;
      }
      ultima = {
        date: dia,
        description: (descricao || (v < 0 ? 'Débito' : 'Crédito')).slice(0, 500),
        amount: Math.round(Math.abs(v) * 100) / 100,
        type: v < 0 ? 'saida' : 'entrada'
      };
      transacoes.push(ultima);
    }
    return { transacoes, ignoradas };
  }

  const api = { lerCsvExtrato, valor, data };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (raiz) raiz.MavisExtratoCsv = api;
})(typeof window !== 'undefined' ? window : null);
