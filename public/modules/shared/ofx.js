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
// sinal diz entrada/saída), descrição (MEMO, senão NAME) e o FITID — o
// identificador que o banco dá a cada lançamento. É ele que permite importar
// o mesmo arquivo duas vezes sem duplicar, e ainda assim aceitar dois PIX
// iguais no mesmo dia (cada um tem o seu FITID).
//
// Função pura (o navegador lê o arquivo; o teste roda sem navegador).
(function (raiz) {
  /** O texto do arquivo, respeitando o CHARSET do cabeçalho (1252 é o comum). */
  function decodificar(bytes) {
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const inicio = new TextDecoder('latin1').decode(u8.slice(0, 600));
    const cp1252 = /CHARSET:\s*(1252|ISO-8859-1|LATIN)/i.test(inicio) || /encoding="?(windows-1252|iso-8859-1)/i.test(inicio);
    if (cp1252) return new TextDecoder('windows-1252').decode(u8);
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(u8);
    } catch (e) {
      // Não declarou 1252 e não é UTF-8 válido: na prática é Windows-1252
      // (banco que não preenche o cabeçalho direito).
      return new TextDecoder('windows-1252').decode(u8);
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
      const descricao = decodificarEntidades(tag(b, 'MEMO') || tag(b, 'NAME')).replace(/\s+/g, ' ').trim();
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

  const api = { lerOfx, decodificar };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (raiz) raiz.MavisOfx = api;
})(typeof window !== 'undefined' ? window : null);
