// O PDF DOS RELATÓRIOS (17/10/2026).
//
// Pedido do usuário: "criar um relatório no Financeiro de títulos pagos, com
// a opção de salvar em PDF, com o mesmo formato que aparece atualmente, porém
// só salva em Excel". O PDF sai do MESMO resultado que vai para a planilha
// (lib/relatorios/motor.js, paraPdf): todas as linhas, as colunas e os totais
// do relatório, com os valores escritos como a tela os mostra (catalogo.js,
// formatar) — R$, dd/mm/aaaa, percentual.
//
// O desenho é o do motor do PDF do pedido (pdf_pedido.js): Helvetica, sem
// biblioteca. Página deitada quando as colunas não cabem em pé. Cabeçalho com
// o título, o período e quando foi emitido; "Página X de Y" no pé de cada uma.
//
// Mesmo empacotamento dos outros módulos compartilhados: o navegador carrega
// por <script>, o servidor e os testes fazem require().
(function (raiz) {
  const motor = typeof module !== 'undefined' && module.exports ? require('./pdf_pedido') : raiz.MavisPdfPedido;

  const FORMATO_MOEDA = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  const FORMATO_PERCENTUAL = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const FORMATO_INTEIRO = new Intl.NumberFormat('pt-BR');
  const FORMATO_QUANTIDADE = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 });
  const NUMERICOS = ['moeda', 'percentual', 'inteiro', 'quantidade', 'numero'];

  /** O texto da célula, como a tela do relatório (catalogo.js) o escreve. */
  function formatar(tipo, valor) {
    if (valor === null || valor === undefined || valor === '') return '';
    const n = Number(valor);
    switch (tipo) {
      case 'moeda': return FORMATO_MOEDA.format(n).replace(/ /g, ' ');
      case 'percentual': return `${FORMATO_PERCENTUAL.format(n)}%`;
      case 'inteiro': return FORMATO_INTEIRO.format(Math.round(n));
      case 'quantidade':
      case 'numero': return FORMATO_QUANTIDADE.format(n);
      case 'data': {
        const s = valor instanceof Date ? valor.toISOString().slice(0, 10) : String(valor).slice(0, 10);
        return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s.split('-').reverse().join('/') : String(valor);
      }
      default: return String(valor);
    }
  }

  const TAMANHO = 7.5;
  const PAD = 4;
  const LARGURA_MINIMA = 34;
  // Coluna de texto longo (descrição) não passa disto antes de quebrar linha.
  const LARGURA_MAXIMA = 230;

  /**
   * A largura de cada coluna. Data, código e número ficam com a largura do
   * maior valor (nunca quebram no meio: "01/10/202 6" não se lê); o título
   * deles quebra só entre palavras. As de texto (descrição, fornecedor) dividem
   * o que sobra na proporção do seu maior texto, e quebram linha.
   */
  function largurasDasColunas(colunas, linhasTexto, larguraUtil) {
    const amostra = linhasTexto.slice(0, 300);
    const maiorValor = (i) => amostra.reduce((m, l) => Math.max(m, motor.largura(l[i] || '', TAMANHO, false)), 0);
    const maiorPalavraDoTitulo = (c) => String(c.rotulo || '').split(/\s+/).reduce((m, p) => Math.max(m, motor.largura(p, TAMANHO, true)), 0);
    const ehTexto = (c) => !NUMERICOS.includes(c.tipo) && c.tipo !== 'data' && c.tipo !== 'codigo';
    const comFolga = (l) => l + 2 * PAD + 2;
    // A maior PALAVRA de uma coluna de texto: abaixo dela, a palavra se parte.
    const maiorPalavra = (i) => amostra.reduce((m, l) => String(l[i] || '').split(/\s+/)
      .reduce((mm, p) => Math.max(mm, motor.largura(p, TAMANHO, false)), m), 0);
    const naturais = colunas.map((c, i) => Math.min(LARGURA_MAXIMA, Math.max(LARGURA_MINIMA, comFolga(ehTexto(c)
      ? Math.max(maiorValor(i), motor.largura(c.rotulo, TAMANHO, true))
      : Math.max(maiorValor(i), maiorPalavraDoTitulo(c))))));
    const minimas = colunas.map((c, i) => (ehTexto(c)
      ? Math.min(naturais[i], Math.max(LARGURA_MINIMA, comFolga(Math.max(maiorPalavra(i), maiorPalavraDoTitulo(c)))))
      : naturais[i]));
    const somaMinima = minimas.reduce((s, l) => s + l, 0);
    let larguras;
    if (somaMinima >= larguraUtil) {
      // Colunas demais: todas na proporção do mínimo.
      larguras = minimas.map((l) => l * (larguraUtil / somaMinima));
    } else {
      // Cada uma no seu mínimo; o que sobra vai para as de texto, na medida do
      // que elas ainda queriam (a descrição fica com a maior parte).
      const querem = colunas.map((c, i) => (ehTexto(c) ? Math.max(0, naturais[i] - minimas[i]) : 0));
      const somaQuerem = querem.reduce((s, q) => s + q, 0);
      const sobra = larguraUtil - somaMinima;
      larguras = minimas.map((m, i) => m + (somaQuerem > 0 ? Math.min(querem[i], sobra * (querem[i] / somaQuerem)) : 0));
      // Ainda sobrou (tudo coube no natural): reparte entre as de texto.
      const resto = larguraUtil - larguras.reduce((s, l) => s + l, 0);
      const quantasDeTexto = colunas.filter(ehTexto).length;
      if (resto > 0 && quantasDeTexto) larguras = larguras.map((l, i) => (ehTexto(colunas[i]) ? l + resto / quantasDeTexto : l));
    }
    return larguras.map((l) => l / larguraUtil);
  }

  /**
   * { titulo, subtitulo, emitidoEm, colunas: [{ campo, rotulo, tipo }], linhas: [{ campo: valor }],
   *   totais: { campo: valor } } -> Uint8Array do PDF.
   */
  function montarPdfDoRelatorio({ titulo = 'Relatório', subtitulo = '', emitidoEm = '', colunas = [], linhas = [], totais = {} }) {
    const linhasTexto = linhas.map((l) => colunas.map((c) => formatar(c.tipo, l[c.campo])));
    const temTotal = Object.keys(totais || {}).length > 0;
    const linhaTotal = temTotal
      ? colunas.map((c, i) => (Object.prototype.hasOwnProperty.call(totais, c.campo) ? formatar(c.tipo, totais[c.campo]) : (i === 0 ? 'Total' : '')))
      : null;
    const todasAsLinhas = linhaTotal ? [...linhasTexto, linhaTotal] : linhasTexto;
    // Em pé quando cabe; com mais de 7 colunas, deitada.
    const emPe = motor.novoDocumento();
    const doc = colunas.length > 7 ? motor.novoDocumento({ paisagem: true }) : emPe;
    const fracoes = largurasDasColunas(colunas, todasAsLinhas, doc.larguraUtil);

    // Cabeçalho.
    doc.y -= 4;
    for (const t of motor.quebrar(titulo, doc.larguraUtil, 12, true)) { doc.y -= 13; doc.texto(motor.MARGEM, doc.y, t, 12, true); }
    const linhaInfo = [subtitulo, emitidoEm ? `Emitido em ${emitidoEm}` : ''].filter(Boolean).join('   ·   ');
    if (linhaInfo) { doc.y -= 12; doc.texto(motor.MARGEM, doc.y, linhaInfo, 8, false, 0.35); }
    doc.y -= 10;

    if (!linhasTexto.length) {
      doc.y -= 12;
      doc.texto(motor.MARGEM, doc.y, 'Nenhum registro.', 9);
    } else {
      motor.tabela(doc, {
        colunas: colunas.map((c, i) => ({ largura: fracoes[i], alinhar: NUMERICOS.includes(c.tipo) ? 'direita' : 'esquerda' })),
        cabecalho: colunas.map((c) => c.rotulo),
        linhas: linhaTotal ? [...linhasTexto, linhaTotal] : linhasTexto,
        tamanho: TAMANHO,
        cabecalhoAlinhar: 'esquerda',
        negritoNaLinha: (i) => Boolean(linhaTotal) && i === linhasTexto.length
      });
    }

    // Pé de página.
    const total = doc.paginas.length;
    doc.paginas.forEach((comandos, i) => {
      const texto = `Página ${i + 1} de ${total}`;
      const x = doc.pagina.largura - motor.MARGEM - motor.largura(texto, 7.5, false);
      comandos.push(`BT /F1 7.5 Tf 0.35 g ${x.toFixed(2)} ${(motor.MARGEM / 2).toFixed(2)} Td (${texto}) Tj ET`);
    });
    return motor.serializar(doc.paginas, doc.pagina);
  }

  const api = { montarPdfDoRelatorio, formatar };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (raiz) raiz.MavisPdfRelatorio = api;
})(typeof window !== 'undefined' ? window : null);
