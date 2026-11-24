// LEITOR DE EXTRATO OFX (12/10/2026).
//
// Pedido do usuário: aceitar o arquivo OFX na conciliação bancária, além do
// CSV. OFX é o formato que praticamente todo banco brasileiro exporta (Itaú,
// Bradesco, BB, Caixa, Santander, Sicoob, Sicredi, Inter...).
//
// Lê as duas formas do arquivo:
//   - OFX 1.x (SGML): cabeçalho "OFXHEADER:100" e tags SEM fechamento
//     (<TRNAMT>-25.50 e a linha acaba);
//   - OFX 2.x (XML): <TRNAMT>-25.50</TRNAMT>.
// Cada <STMTTRN> vira uma movimentação: data (DTPOSTED), valor (TRNAMT, o
// sinal diz entrada/saída), descrição (MEMO e NAME juntos) e o FITID — o
// identificador que o banco dá a cada lançamento. É ele que permite importar
// o mesmo arquivo duas vezes sem duplicar, e ainda assim aceitar dois PIX
// iguais no mesmo dia (cada um tem o seu FITID).
//
// Função pura (o navegador lê o arquivo; o teste roda sem navegador).
(function (raiz) {
  /**
   * O texto do arquivo.
   *
   * UTF-8 DE VERDADE GANHA DO CABEÇALHO (23/11/2026). O extrato do Itaú diz
   * "CHARSET:1252" e grava os acentos em UTF-8: lido como 1252, "ARAÚJO" virava
   * "ARAÃšJO", e o nome do cliente deixava de casar na conciliação. Um arquivo
   * que é mesmo 1252 e tem acento quase nunca forma UTF-8 válido ("É" é o byte
   * C9 sozinho), então a prova é decodificar como UTF-8 estrito: deu certo e há
   * byte acima de 127, é UTF-8. Sem acento nenhum, tanto faz.
   */
  function decodificar(bytes) {
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    let utf8 = null;
    try {
      utf8 = new TextDecoder('utf-8', { fatal: true }).decode(u8);
    } catch (e) {
      // Não é UTF-8 válido: é Windows-1252, declarado ou não (banco que não
      // preenche o cabeçalho direito).
      return new TextDecoder('windows-1252').decode(u8);
    }
    if (u8.some((b) => b > 0x7f)) return utf8;
    const inicio = new TextDecoder('latin1').decode(u8.slice(0, 600));
    const cp1252 = /CHARSET:\s*(1252|ISO-8859-1|LATIN)/i.test(inicio) || /encoding="?(windows-1252|iso-8859-1)/i.test(inicio);
    return cp1252 ? new TextDecoder('windows-1252').decode(u8) : utf8;
  }

  // O caminho de volta, para consertar o que já entrou errado: o texto em
  // 1252 vira bytes de novo e é lido como UTF-8 ("ARAÃšJO" -> "ARAÚJO").
  let byteDoCaractere1252 = null;
  function bytesEm1252(texto) {
    if (!byteDoCaractere1252) {
      byteDoCaractere1252 = new Map();
      const leitor = new TextDecoder('windows-1252');
      for (let b = 0; b < 256; b += 1) byteDoCaractere1252.set(leitor.decode(Uint8Array.of(b)), b);
    }
    const saida = new Uint8Array(texto.length);
    for (let i = 0; i < texto.length; i += 1) {
      const b = byteDoCaractere1252.get(texto[i]);
      if (b === undefined) return null;
      saida[i] = b;
    }
    return saida;
  }

  /**
   * "ARAÃšJO" -> "ARAÚJO": desfaz o UTF-8 lido como 1252 (as movimentações que
   * entraram antes da correção acima). Só troca quando o texto inteiro volta a
   * ser UTF-8 válido — "JOÃO" e "TAINÃ SILVA" ficam como estão.
   */
  function consertarAcentos(texto) {
    const t = String(texto == null ? '' : texto);
    if (!/[ÃÂ]/.test(t)) return t;
    const bytes = bytesEm1252(t);
    if (!bytes) return t;
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch (e) {
      return t;
    }
  }

  /** Valor de uma tag, nas duas formas (com ou sem fechamento). */
  function tag(bloco, nome) {
    const re = new RegExp(`<${nome}>([^<\\r\\n]*)`, 'i');
    const m = re.exec(bloco);
    return m ? m[1].trim() : '';
  }

  /** 20261012120000[-3:BRT] -> 2026-10-12 */
  function data(valor) {
    const m = /^(\d{4})(\d{2})(\d{2})/.exec(String(valor || ''));
    return m ? `${m[1]}-${m[2]}-${m[3]}` : '';
  }

  /** "-25.50", "-25,50", "1.234,56" -> número com sinal */
  function valor(texto) {
    let t = String(texto || '').trim().replace(/\s/g, '');
    if (/,\d{1,2}$/.test(t)) t = t.replace(/\./g, '').replace(',', '.');
    const n = Number(t);
    return Number.isFinite(n) ? n : NaN;
  }

  function decodificarEntidades(t) {
    return String(t || '')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  }

  /**
   * @returns { conta: { banco, agencia, numero }, transacoes: [{ date, description,
   *            amount, type, fitid }], ignoradas: [{ motivo, trecho }] }
   */
  function lerOfx(texto) {
    const t = String(texto || '');
    if (!/<OFX>/i.test(t) || !/<STMTTRN>/i.test(t)) {
      throw new Error('Este arquivo não parece um extrato OFX (não achei <OFX> com lançamentos <STMTTRN>).');
    }
    const conta = {
      banco: tag(t, 'BANKID'),
      agencia: tag(t, 'BRANCHID'),
      numero: tag(t, 'ACCTID')
    };
    const transacoes = [];
    const ignoradas = [];
    const blocos = t.split(/<STMTTRN>/i).slice(1).map((b) => b.split(/<\/STMTTRN>|<\/BANKTRANLIST>/i)[0]);
    for (const b of blocos) {
      const v = valor(tag(b, 'TRNAMT'));
      const dia = data(tag(b, 'DTPOSTED'));
      // MEMO E NAME JUNTOS (04/11/2026). Era um OU o outro, e muito banco põe
      // no MEMO só o tipo ("PIX EMIT.OUTRA IF", "DEB.TIT.COMPE") e no NAME
      // quem pagou ou recebeu — justamente o que a conciliação automática
      // procura. Um contido no outro fica só o maior.
      const limpo = (s) => decodificarEntidades(s).replace(/\s+/g, ' ').trim();
      const memo = limpo(tag(b, 'MEMO'));
      const nome = limpo(tag(b, 'NAME'));
      const descricao = !memo || memo.toUpperCase().includes(nome.toUpperCase()) ? (memo || nome)
        : nome.toUpperCase().includes(memo.toUpperCase()) ? nome : `${memo} - ${nome}`;
      if (!Number.isFinite(v) || v === 0 || !dia) {
        ignoradas.push({ motivo: !dia ? 'sem data' : 'sem valor', trecho: b.replace(/\s+/g, ' ').slice(0, 80) });
        continue;
      }
      transacoes.push({
        date: dia,
        description: descricao || (v < 0 ? 'Débito' : 'Crédito'),
        amount: Math.round(Math.abs(v) * 100) / 100,
        type: v < 0 ? 'saida' : 'entrada',
        fitid: tag(b, 'FITID')
      });
    }
    return { conta, transacoes, ignoradas };
  }

  const api = { lerOfx, decodificar, consertarAcentos };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (raiz) raiz.MavisOfx = api;
})(typeof window !== 'undefined' ? window : null);
