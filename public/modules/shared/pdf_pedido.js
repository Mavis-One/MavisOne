// O PDF DO PEDIDO (13/10/2026) — o botão "Baixar" da tela do pedido.
//
// Pedido do usuário: "preciso que o botão baixar baixe o pdf do pedido". O
// botão baixava um JSON com o payload — dado para máquina, não documento.
//
// POR QUE UM GERADOR PRÓPRIO, E NÃO UMA BIBLIOTECA. O projeto tem três
// dependências e nenhuma de PDF; uma biblioteca de PDF no navegador são
// centenas de KB para um documento de texto e tabelas. Este arquivo escreve o
// PDF direto (PDF 1.4, Helvetica e Helvetica-Bold, que todo leitor tem — nada
// de fonte embutida), com o MESMO conteúdo e a mesma ordem da impressão A4
// (salesRecordPrint em public/app.js): cabeçalho da empresa, DADOS DO
// CLIENTE, PRODUTOS E SERVIÇOS, TOTAIS, termos com assinatura e observações.
// Quem monta os textos (já formatados) é a tela; aqui só se desenha.
//
// O LOGO FICOU DE FORA: PNG com transparência exigiria descompactar a imagem.
// Texto em português sai certo: a fonte usa WinAnsiEncoding (á, ç, ã, º...).
//
// Mesmo empacotamento de sales_status.js: o navegador carrega por <script> e o
// teste faz require() do mesmo arquivo.
(function (raiz) {
  // Larguras da Helvetica (AFM padrão), em milésimos do tamanho da fonte, do
  // espaço (32) ao til (126). Letra acentuada usa a largura da letra base.
  const LARG_NORMAL = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
    556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
    1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
    667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
    333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
    556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
  const LARG_NEGRITO = [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278,
    556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
    975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778,
    667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
    333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611,
    611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584];

  // Fora do Latin-1, os poucos que o WinAnsi tem; o resto vira "?".
  const WIN_ANSI = { '€': 0x80, '‚': 0x82, '…': 0x85, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97, '™': 0x99 };

  function codigoWinAnsi(ch) {
    const c = ch.codePointAt(0);
    if (c === 9) return 32;
    if (c >= 32 && c <= 126) return c;
    if (c >= 160 && c <= 255) return c;
    return WIN_ANSI[ch] || 63;
  }

  function larguraDoCaractere(ch, negrito) {
    const tabela = negrito ? LARG_NEGRITO : LARG_NORMAL;
    const c = ch.codePointAt(0);
    if (c >= 32 && c <= 126) return tabela[c - 32];
    // Acentuada: a letra base ("á" -> "a"), que na Helvetica tem a mesma largura.
    const base = ch.normalize('NFD').charAt(0);
    const b = base.codePointAt(0);
    if (base !== ch && b >= 32 && b <= 126) return tabela[b - 32];
    if (ch === '—') return 1000;
    if (ch === '–') return 556;
    return 556;
  }

  function largura(texto, tamanho, negrito) {
    let soma = 0;
    for (const ch of String(texto)) soma += larguraDoCaractere(ch, negrito);
    return (soma * tamanho) / 1000;
  }

  /** Quebra o texto em linhas que cabem em `max` pontos (respeita as quebras do texto). */
  function quebrar(texto, max, tamanho, negrito) {
    const saida = [];
    for (const paragrafo of String(texto ?? '').replace(/\r/g, '').split('\n')) {
      const palavras = paragrafo.split(/ +/);
      let linha = '';
      for (const palavra of palavras) {
        const tentativa = linha ? `${linha} ${palavra}` : palavra;
        if (largura(tentativa, tamanho, negrito) <= max) { linha = tentativa; continue; }
        if (linha) saida.push(linha);
        // Palavra maior que a linha (chave de 44 dígitos, URL): corta por caractere.
        let resto = palavra;
        while (largura(resto, tamanho, negrito) > max) {
          let corte = resto.length;
          while (corte > 1 && largura(resto.slice(0, corte), tamanho, negrito) > max) corte -= 1;
          saida.push(resto.slice(0, corte));
          resto = resto.slice(corte);
        }
        linha = resto;
      }
      saida.push(linha);
    }
    return saida;
  }

  const escapar = (bytes) => bytes.map((b) => (b === 40 || b === 41 || b === 92 ? `\\${String.fromCharCode(b)}` : String.fromCharCode(b))).join('');
  const textoPdf = (texto) => `(${escapar([...String(texto ?? '')].map(codigoWinAnsi))})`;
  const n = (v) => (Math.round(v * 100) / 100).toString();

  // --------------------------------------------------------------- páginas
  const A4 = { largura: 595.28, altura: 841.89 };
  const MARGEM = 34;

  function novoDocumento() {
    const paginas = [];
    let atual = null;
    let y = 0;
    const doc = {
      get y() { return y; },
      set y(v) { y = v; },
      larguraUtil: A4.largura - 2 * MARGEM,
      novaPagina() {
        atual = [];
        paginas.push(atual);
        y = A4.altura - MARGEM;
      },
      /** Garante `altura` pontos livres; senão, página nova. */
      caber(altura) {
        if (!atual || y - altura < MARGEM) doc.novaPagina();
      },
      texto(x, yy, t, tamanho = 9, negrito = false, cor = 0) {
        atual.push(`BT /${negrito ? 'F2' : 'F1'} ${n(tamanho)} Tf ${n(cor)} g ${n(x)} ${n(yy)} Td ${textoPdf(t)} Tj ET`);
      },
      textoDireita(xDireita, yy, t, tamanho = 9, negrito = false) {
        doc.texto(xDireita - largura(t, tamanho, negrito), yy, t, tamanho, negrito);
      },
      textoCentro(xCentro, yy, t, tamanho = 9, negrito = false) {
        doc.texto(xCentro - largura(t, tamanho, negrito) / 2, yy, t, tamanho, negrito);
      },
      retangulo(x, yy, l, a, preenchido = false) {
        atual.push(preenchido ? `0.95 g ${n(x)} ${n(yy)} ${n(l)} ${n(a)} re f 0 g` : `0.6 w ${n(x)} ${n(yy)} ${n(l)} ${n(a)} re S`);
      },
      linha(x1, y1, x2, y2) {
        atual.push(`0.6 w ${n(x1)} ${n(y1)} m ${n(x2)} ${n(y2)} l S`);
      },
      paginas
    };
    doc.novaPagina();
    return doc;
  }

  /** Monta o arquivo PDF a partir das listas de comandos de cada página. */
  function serializar(paginas) {
    const objetos = [];
    const adicionar = (conteudo) => { objetos.push(conteudo); return objetos.length; };
    const catalogo = adicionar(null);
    const arvore = adicionar(null);
    const fonte1 = adicionar('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    const fonte2 = adicionar('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    const kids = [];
    for (const comandos of paginas) {
      const fluxo = comandos.join('\n');
      const conteudo = adicionar(`<< /Length ${fluxo.length} >>\nstream\n${fluxo}\nendstream`);
      kids.push(adicionar(`<< /Type /Page /Parent ${arvore} 0 R /MediaBox [0 0 ${A4.largura} ${A4.altura}] `
        + `/Resources << /Font << /F1 ${fonte1} 0 R /F2 ${fonte2} 0 R >> >> /Contents ${conteudo} 0 R >>`));
    }
    objetos[catalogo - 1] = `<< /Type /Catalog /Pages ${arvore} 0 R >>`;
    objetos[arvore - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;

    // Tudo é byte de 0 a 255 (o texto já está em WinAnsi), então o tamanho
    // em caracteres É o tamanho em bytes — e os offsets do xref batem.
    let saida = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
    const offsets = [];
    objetos.forEach((conteudo, i) => {
      offsets.push(saida.length);
      saida += `${i + 1} 0 obj\n${conteudo}\nendobj\n`;
    });
    const inicioXref = saida.length;
    saida += `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n`;
    saida += offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
    saida += `trailer\n<< /Size ${objetos.length + 1} /Root ${catalogo} 0 R >>\nstartxref\n${inicioXref}\n%%EOF\n`;
    const bytes = new Uint8Array(saida.length);
    for (let i = 0; i < saida.length; i += 1) bytes[i] = saida.charCodeAt(i) & 0xff;
    return bytes;
  }

  // --------------------------------------------------------------- tabelas
  const PAD = 4;

  /**
   * Uma tabela com bordas. `colunas`: [{ largura (fração), alinhar }].
   * `linhas`: arrays de textos. `cabecalho`: textos (negrito, cinza).
   */
  function tabela(doc, { colunas, cabecalho, linhas, tamanho = 8.5, negritoNaLinha = () => false, cabecalhoAlinhar = 'centro' }) {
    const x0 = MARGEM;
    const larguras = colunas.map((c) => c.largura * doc.larguraUtil);
    const desenharLinha = (celulas, { negrito = false, fundo = false, alinharTudo } = {}) => {
      const quebradas = celulas.map((t, i) => quebrar(t, larguras[i] - 2 * PAD, tamanho, negrito));
      const altura = Math.max(...quebradas.map((q) => q.length)) * (tamanho + 2) + 2 * PAD - 2;
      doc.caber(altura);
      let x = x0;
      const topo = doc.y;
      quebradas.forEach((linhasDaCelula, i) => {
        if (fundo) doc.retangulo(x, topo - altura, larguras[i], altura, true);
        doc.retangulo(x, topo - altura, larguras[i], altura);
        const alinhar = alinharTudo || colunas[i].alinhar || 'esquerda';
        linhasDaCelula.forEach((t, k) => {
          const yy = topo - PAD - tamanho + 1 - k * (tamanho + 2);
          if (alinhar === 'direita') doc.textoDireita(x + larguras[i] - PAD, yy, t, tamanho, negrito);
          else if (alinhar === 'centro') doc.textoCentro(x + larguras[i] / 2, yy, t, tamanho, negrito);
          else doc.texto(x + PAD, yy, t, tamanho, negrito);
        });
        x += larguras[i];
      });
      doc.y = topo - altura;
    };
    if (cabecalho) desenharLinha(cabecalho, { negrito: true, fundo: true, alinharTudo: cabecalhoAlinhar });
    linhas.forEach((l, i) => desenharLinha(l, { negrito: negritoNaLinha(i) }));
  }

  function titulo(doc, t) {
    doc.caber(30);
    doc.y -= 16;
    doc.textoCentro(A4.largura / 2, doc.y, t, 10, true);
    doc.y -= 6;
  }

  function paragrafo(doc, t, tamanho = 9) {
    for (const linha of quebrar(t, doc.larguraUtil, tamanho, false)) {
      doc.caber(tamanho + 3);
      doc.y -= tamanho + 3;
      doc.texto(MARGEM, doc.y, linha, tamanho);
    }
  }

  /**
   * O documento. Todos os textos chegam formatados (moeda, data, documento):
   *   { titulo, numero, emissao, validade,
   *     emitente: { nome, linhas: [..], aviso } | null,
   *     cliente: [[rótulo, valor, rótulo, valor], ...],
   *     itens: [[código, ncm, descrição, qtd, unidade, unitário, total], ...], totalItens,
   *     totais: { cabecalho: [...5], valores: [...5] },
   *     termos, observacoes, rodape }
   */
  function montarPdfDoPedido(d) {
    const doc = novoDocumento();
    const direita = A4.largura - MARGEM;

    // Cabeçalho: emitente à esquerda, número e datas à direita.
    const numero = `${String(d.titulo || 'Pedido').toUpperCase()}${d.numero ? ` Nº ${d.numero}` : ''}`;
    doc.textoDireita(direita, doc.y - 11, numero, 12, true);
    doc.textoDireita(direita, doc.y - 24, `Emissão ${d.emissao || '-'}`, 9, true);
    if (d.validade) doc.textoDireita(direita, doc.y - 36, `Validade ${d.validade}`, 9, true);
    const larguraEmitente = doc.larguraUtil - Math.max(largura(numero, 12, true), 120) - 16;
    let yEmit = doc.y - 11;
    if (d.emitente) {
      for (const l of quebrar(d.emitente.nome, larguraEmitente, 10, true)) { doc.texto(MARGEM, yEmit, l, 10, true); yEmit -= 13; }
      for (const linhaDoEmitente of d.emitente.linhas || []) {
        for (const l of quebrar(linhaDoEmitente, larguraEmitente, 8.5, false)) { doc.texto(MARGEM, yEmit, l, 8.5); yEmit -= 11; }
      }
      if (d.emitente.aviso) {
        for (const l of quebrar(d.emitente.aviso, larguraEmitente, 7.5, false)) { doc.texto(MARGEM, yEmit, l, 7.5, false, 0.4); yEmit -= 10; }
      }
    } else {
      doc.texto(MARGEM, yEmit, 'Cabeçalho sem dados da empresa (Configurações › Fiscal).', 9, true);
      yEmit -= 13;
    }
    doc.y = Math.min(yEmit, doc.y - 40) - 2;

    titulo(doc, 'DADOS DO CLIENTE');
    tabela(doc, {
      colunas: [{ largura: 0.14, alinhar: 'direita' }, { largura: 0.36 }, { largura: 0.14, alinhar: 'direita' }, { largura: 0.36 }],
      linhas: (d.cliente || []).map((l) => l.map((t) => String(t ?? ''))),
      tamanho: 8.5
    });

    titulo(doc, 'PRODUTOS E SERVIÇOS');
    const itens = (d.itens || []).map((l) => l.map((t) => String(t ?? '')));
    itens.push(['', '', '', '', '', 'TOTAL', String(d.totalItens || '')]);
    tabela(doc, {
      colunas: [
        { largura: 0.09 }, { largura: 0.1 }, { largura: 0.37 }, { largura: 0.09, alinhar: 'centro' },
        { largura: 0.08, alinhar: 'centro' }, { largura: 0.135, alinhar: 'direita' }, { largura: 0.135, alinhar: 'direita' }
      ],
      cabecalho: ['Código', 'NCM', 'Descrição', 'Qtd.', 'Unidade', 'Valor Unitário', 'Valor Total'],
      linhas: itens,
      negritoNaLinha: (i) => i === itens.length - 1
    });

    titulo(doc, 'TOTAIS');
    tabela(doc, {
      colunas: [0.18, 0.18, 0.2, 0.22, 0.22].map((l) => ({ largura: l, alinhar: 'direita' })),
      cabecalho: d.totais.cabecalho,
      linhas: [d.totais.valores],
      negritoNaLinha: () => false
    });

    if (d.termos) {
      titulo(doc, 'TERMOS E CONDIÇÕES DA VENDA');
      paragrafo(doc, d.termos);
      for (const rotulo of ['Nome:', 'CPF:', 'Assinatura:']) {
        doc.caber(26);
        doc.y -= 24;
        doc.texto(MARGEM, doc.y, rotulo, 9);
        const x = MARGEM + largura(rotulo, 9, false) + 6;
        doc.linha(x, doc.y - 2, x + 230, doc.y - 2);
      }
      doc.y -= 8;
    }
    if (d.observacoes) {
      titulo(doc, 'OBSERVAÇÕES');
      paragrafo(doc, d.observacoes);
    }
    if (d.rodape) {
      doc.y -= 10;
      paragrafo(doc, d.rodape, 7.5);
    }
    return serializar(doc.paginas);
  }

  /** CPF/CNPJ com máscara; o resto sai como veio. */
  function mascaraDocumento(valor) {
    const d = String(valor || '').replace(/\D/g, '');
    if (d.length === 14) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
    if (d.length === 11) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
    return String(valor || '');
  }

  const api = { montarPdfDoPedido, mascaraDocumento, quebrar, largura, codigoWinAnsi };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (raiz) raiz.MavisPdfPedido = api;
})(typeof window !== 'undefined' ? window : null);
