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

  // A FONTE DIMINUI ATÉ OS NÚMEROS CABEREM INTEIROS (19/10/2026, pedido do
  // usuário: "todos os relatórios [do Financeiro] com opção de baixar em PDF,
  // de forma ordenada como o sistema"). A DRE Anual tem 16 colunas de valor, e
  // em 7,5 pt o "R$ 1.262.776,64" quebrava no meio. Tenta do maior para o
  // menor; só no último, se nem assim couber, as colunas encolhem na proporção.
  const TAMANHOS = [7.5, 7, 6.5, 6, 5.5];
  const TAMANHO = TAMANHOS[0];
  const PAD = 4;
  const LARGURA_MINIMA = 34;
  // Coluna de texto longo (descrição) não passa disto antes de quebrar linha.
  const LARGURA_MAXIMA = 230;
  // E não passa de duas linhas: a descrição de uma conta a pagar ocupava sete,
  // e a página levava nove títulos. O texto inteiro continua no Excel.
  const MAX_LINHAS_DE_TEXTO = 2;

  const ehTexto = (c) => !NUMERICOS.includes(c.tipo) && c.tipo !== 'data' && c.tipo !== 'codigo';

  /**
   * A largura de cada coluna. Data, código e número ficam com a largura do
   * maior valor (nunca quebram no meio: "01/10/202 6" não se lê); o título
   * deles quebra só entre palavras. As de texto (descrição, fornecedor) dividem
   * o que sobra na proporção do seu maior texto, e quebram linha.
   */
  function largurasDasColunas(colunas, linhasTexto, larguraUtil, tamanho = TAMANHO) {
    return medirColunas(colunas, linhasTexto, larguraUtil, tamanho).fracoes;
  }

  /** O tamanho de fonte e as larguras: o maior tamanho em que tudo cabe. */
  function planejarColunas(colunas, linhasTexto, larguraUtil) {
    for (const tamanho of TAMANHOS) {
      const medida = medirColunas(colunas, linhasTexto, larguraUtil, tamanho);
      if (medida.coube) return { tamanho, fracoes: medida.fracoes, coube: true };
    }
    const menor = TAMANHOS[TAMANHOS.length - 1];
    return { tamanho: menor, fracoes: medirColunas(colunas, linhasTexto, larguraUtil, menor).fracoes, coube: false };
  }

  function medirColunas(colunas, linhasTexto, larguraUtil, tamanho) {
    // Todas as linhas (19/10/2026): o maior valor pode estar depois da 300ª, e
    // o número que não cabe se parte.
    const amostra = linhasTexto;
    const maiorValor = (i) => amostra.reduce((m, l) => Math.max(m, motor.largura(l[i] || '', tamanho, false)), 0);
    const maiorPalavraDoTitulo = (c) => String(c.rotulo || '').split(/\s+/).reduce((m, p) => Math.max(m, motor.largura(p, tamanho, true)), 0);
    const comFolga = (l) => l + 2 * PAD + 2;
    // A maior PALAVRA de uma coluna de texto: abaixo dela, a palavra se parte.
    const maiorPalavra = (i) => amostra.reduce((m, l) => String(l[i] || '').split(/\s+/)
      .reduce((mm, p) => Math.max(mm, motor.largura(p, tamanho, false)), m), 0);
    const naturais = colunas.map((c, i) => Math.min(LARGURA_MAXIMA, Math.max(LARGURA_MINIMA, comFolga(ehTexto(c)
      ? Math.max(maiorValor(i), motor.largura(c.rotulo, tamanho, true))
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
    return { coube: somaMinima <= larguraUtil, fracoes: larguras.map((l) => l / larguraUtil) };
  }

  /** As linhas de uma célula; a de texto para em MAX_LINHAS_DE_TEXTO, com "…". */
  function linhasDaCelula(texto, larguraTexto, tamanho, negrito, limitar) {
    const linhas = motor.quebrar(texto, larguraTexto, tamanho, negrito);
    if (!limitar || linhas.length <= MAX_LINHAS_DE_TEXTO) return linhas;
    const ficam = linhas.slice(0, MAX_LINHAS_DE_TEXTO);
    let ultima = `${ficam[MAX_LINHAS_DE_TEXTO - 1]}…`;
    while (ultima.length > 1 && motor.largura(ultima, tamanho, negrito) > larguraTexto) ultima = `${ultima.slice(0, -2)}…`;
    ficam[MAX_LINHAS_DE_TEXTO - 1] = ultima;
    return ficam;
  }

  /**
   * A TABELA, COMO A TELA DO RELATÓRIO: número à direita (o título dele
   * também), linhas alternadas em cinza claro, o total em negrito — e o
   * CABEÇALHO DAS COLUNAS EM TODA PÁGINA (da segunda em diante, a DRE Anual
   * era uma grade de números sem saber de que mês).
   */
  function desenharTabela(doc, { colunas, larguras, linhas, tamanho, linhaDeTotal }) {
    const passo = tamanho + 2;
    const limite = motor.MARGEM + 6;
    const alinhar = colunas.map((c) => (NUMERICOS.includes(c.tipo) ? 'direita' : 'esquerda'));
    const preparar = (celulas, negrito) => celulas.map((t, i) => linhasDaCelula(t, larguras[i] - 2 * PAD, tamanho, negrito, ehTexto(colunas[i])));
    const alturaDe = (quebradas) => Math.max(1, ...quebradas.map((q) => q.length)) * passo + 2 * PAD - 2;
    const desenhar = (quebradas, { negrito = false, fundo = null } = {}) => {
      const altura = alturaDe(quebradas);
      const topo = doc.y;
      const pagina = doc.paginas[doc.paginas.length - 1];
      let x = motor.MARGEM;
      if (fundo !== null) {
        pagina.push(`${fundo} g ${x.toFixed(2)} ${(topo - altura).toFixed(2)} ${doc.larguraUtil.toFixed(2)} ${altura.toFixed(2)} re f 0 g`);
      }
      quebradas.forEach((linhasDela, i) => {
        doc.retangulo(x, topo - altura, larguras[i], altura);
        linhasDela.forEach((t, k) => {
          const yy = topo - PAD - tamanho + 1 - k * passo;
          if (alinhar[i] === 'direita') doc.textoDireita(x + larguras[i] - PAD, yy, t, tamanho, negrito);
          else doc.texto(x + PAD, yy, t, tamanho, negrito);
        });
        x += larguras[i];
      });
      doc.y = topo - altura;
    };
    const cabecalho = preparar(colunas.map((c) => c.rotulo), true);
    const alturaDoCabecalho = alturaDe(cabecalho);
    const comCabecalho = () => desenhar(cabecalho, { negrito: true, fundo: 0.9 });
    if (doc.y - alturaDoCabecalho - passo * 2 < limite) doc.novaPagina();
    comCabecalho();
    linhas.forEach((celulas, indice) => {
      const ehTotal = Boolean(linhaDeTotal) && indice === linhas.length - 1;
      const quebradas = preparar(celulas, ehTotal);
      if (doc.y - alturaDe(quebradas) < limite) {
        doc.novaPagina();
        comCabecalho();
      }
      desenhar(quebradas, { negrito: ehTotal, fundo: ehTotal ? 0.9 : (indice % 2 ? 0.965 : null) });
    });
  }

  /**
   * { titulo, subtitulo, emitidoEm, colunas: [{ campo, rotulo, tipo }], linhas: [{ campo: valor }],
   *   totais: { campo: valor } } -> Uint8Array do PDF.
   */
  function montarPdfDoRelatorio({ titulo = 'Relatório', subtitulo = '', emitidoEm = '', colunas: colunasDoRelatorio = [], linhas = [], totais = {}, resumo = [] }) {
    const montarLinhas = (cols, semCifrao) => {
      const celula = (c, v) => {
        const t = formatar(c.tipo, v);
        return semCifrao && c.tipo === 'moeda' ? t.replace(/R\$\s/, '') : t;
      };
      const corpo = linhas.map((l) => cols.map((c) => celula(c, l[c.campo])));
      const total = Object.keys(totais || {}).length > 0
        ? cols.map((c, i) => (Object.prototype.hasOwnProperty.call(totais, c.campo) ? celula(c, totais[c.campo]) : (i === 0 ? 'Total' : '')))
        : null;
      return { corpo, total };
    };
    // Em pé quando cabe; com mais de 7 colunas, deitada.
    const emPe = motor.novoDocumento();
    const doc = colunasDoRelatorio.length > 7 ? motor.novoDocumento({ paisagem: true }) : emPe;
    let colunas = colunasDoRelatorio;
    let { corpo: linhasTexto, total: linhaTotal } = montarLinhas(colunas, false);
    let plano = planejarColunas(colunas, linhaTotal ? [...linhasTexto, linhaTotal] : linhasTexto, doc.larguraUtil);
    // NEM NA MENOR FONTE COUBE (a DRE Anual: 15 colunas de valor): o "R$" sai
    // das células e vai para o título da coluna — o número não se parte.
    if (!plano.coube && colunas.some((c) => c.tipo === 'moeda')) {
      colunas = colunasDoRelatorio.map((c) => (c.tipo === 'moeda' ? { ...c, rotulo: `${c.rotulo} (R$)` } : c));
      ({ corpo: linhasTexto, total: linhaTotal } = montarLinhas(colunas, true));
      plano = planejarColunas(colunas, linhaTotal ? [...linhasTexto, linhaTotal] : linhasTexto, doc.larguraUtil);
    }
    const todasAsLinhas = linhaTotal ? [...linhasTexto, linhaTotal] : linhasTexto;
    const { tamanho, fracoes } = plano;

    // Cabeçalho.
    doc.y -= 4;
    for (const t of motor.quebrar(titulo, doc.larguraUtil, 12, true)) { doc.y -= 13; doc.texto(motor.MARGEM, doc.y, t, 12, true); }
    const linhaInfo = [subtitulo, emitidoEm ? `Emitido em ${emitidoEm}` : ''].filter(Boolean).join('   ·   ');
    if (linhaInfo) { doc.y -= 12; doc.texto(motor.MARGEM, doc.y, linhaInfo, 8, false, 0.35); }
    // O RESUMO (19/10/2026): os números que a tela mostra em cartões acima da
    // tabela (a Síntese Financeira: a receber, a pagar, recebido, pago).
    const textoDoResumo = (Array.isArray(resumo) ? resumo : []).filter(Boolean).join('  ·  ');
    if (textoDoResumo) {
      doc.y -= 4;
      for (const t of motor.quebrar(textoDoResumo, doc.larguraUtil, 8.5, true)) { doc.y -= 11; doc.texto(motor.MARGEM, doc.y, t, 8.5, true); }
    }
    doc.y -= 10;

    if (!linhasTexto.length) {
      doc.y -= 12;
      doc.texto(motor.MARGEM, doc.y, 'Nenhum registro.', 9);
    } else {
      desenharTabela(doc, {
        colunas,
        larguras: fracoes.map((f) => f * doc.larguraUtil),
        linhas: todasAsLinhas,
        tamanho,
        linhaDeTotal: Boolean(linhaTotal)
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

  const api = { montarPdfDoRelatorio, formatar, planejarColunas, largurasDasColunas, MAX_LINHAS_DE_TEXTO };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (raiz) raiz.MavisPdfRelatorio = api;
})(typeof window !== 'undefined' ? window : null);
