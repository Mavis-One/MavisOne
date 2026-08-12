// Kit de painel — os blocos que TODO dashboard de módulo usa.
//
// POR QUE EXISTE
// --------------
// O gráfico de tendência nasceu dentro de modules/finance/subs/dashboard.js e
// virou global por acidente: o Dashboard Geral e Relatórios passaram a chamar
// `financeBuildChartSvg` confiando na ordem das tags <script>. Funcionava, mas
// qualquer reordenação do index.html quebrava duas telas que nem mencionam o
// Financeiro — e o cartão de KPI, que só existia no Dashboard Geral, teria de
// ser copiado para cada módulo novo.
//
// Com um painel por módulo isso deixa de ser detalhe: sete telas desenhando o
// próprio cartão divergiriam no primeiro ajuste de layout, e o usuário veria
// "Faturamento" de um jeito em Vendas e de outro em Compras.
//
// O QUE ESTE ARQUIVO NÃO FAZ
// --------------------------
// Não busca dado e não sabe o que é faturamento, OP ou contrato. Recebe número
// pronto e devolve HTML. A conta mora em lib/painel-modulos.js, no servidor,
// onde é testável sem navegador.
window.MavisPainel = (function () {
  const esc = (v) => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');

  /**
   * Valor curto para o cartão.
   *
   * Milhão e mil abreviados porque o cartão é estreito e sete dígitos com
   * centavos não cabem — mas abaixo de mil o valor sai inteiro, onde o centavo
   * ainda importa.
   *
   * `formato` existe porque nem todo painel mede dinheiro: número de veículos,
   * de colaboradores e de OPs em atraso não levam R$, e prefixar tudo com "R$"
   * faria "R$ 12" significar doze reais quando são doze veículos.
   */
  function valorCurto(valor, formato = 'moeda') {
    const n = Number(valor || 0);
    const abs = Math.abs(n);
    const prefixo = formato === 'moeda' ? 'R$' : '';
    if (formato === 'percentual') {
      return { prefixo: '', numero: n.toLocaleString('pt-BR', { maximumFractionDigits: 1 }), sufixo: '%' };
    }
    if (formato === 'numero') {
      if (abs >= 1000000) return { prefixo, numero: (n / 1000000).toLocaleString('pt-BR', { maximumFractionDigits: 2 }), sufixo: 'mi' };
      if (abs >= 10000) return { prefixo, numero: (n / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 }), sufixo: 'mil' };
      // Contagem não tem centavo: "12,00 colaboradores" é ruído.
      return { prefixo, numero: n.toLocaleString('pt-BR', { maximumFractionDigits: 0 }), sufixo: '' };
    }
    if (abs >= 1000000) return { prefixo, numero: (n / 1000000).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }), sufixo: 'mi' };
    if (abs >= 1000) return { prefixo, numero: (n / 1000).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }), sufixo: 'mil' };
    return { prefixo, numero: n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }), sufixo: '' };
  }

  /** Valor por extenso, para tooltip e ranking — onde cabe o número inteiro. */
  function valorCheio(valor, formato = 'moeda') {
    const n = Number(valor || 0);
    if (formato === 'moeda') return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    if (formato === 'percentual') return `${n.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
    return n.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
  }

  /**
   * Sparkline do cartão.
   *
   * Sem eixo e sem rótulo de propósito: responde "está subindo ou caindo?", não
   * "quanto". Quem quer o número exato abre o gráfico logo abaixo.
   */
  function sparkline(serie) {
    const valores = (serie || []).map((v) => Number(v || 0));
    // Com menos de dois pontos não há tendência a desenhar, e uma linha reta
    // sugeriria estabilidade que não foi medida.
    if (valores.length < 2) return '';
    const max = Math.max(...valores);
    const min = Math.min(...valores);
    const faixa = max - min || 1;
    const pontos = valores.map((v, i) => {
      const x = (i * 120) / (valores.length - 1);
      const y = 24 - ((v - min) / faixa) * 20;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    return `
      <svg class="kpi-spark" viewBox="0 0 120 26" preserveAspectRatio="none" aria-hidden="true">
        <polyline points="${pontos.join(' ')}" fill="none" stroke="currentColor" stroke-width="1.8"
          stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke" />
      </svg>`;
  }

  /**
   * Cartão de indicador.
   *
   * `variacao` null some da tela em vez de virar "0%": zero afirma que não
   * mudou; null diz que não há base de comparação (mês anterior sem dado,
   * indicador sem histórico). São coisas diferentes e o usuário decide
   * diferente com cada uma.
   */
  function cartaoKpi(kpi, escapeHtml = esc) {
    const v = valorCurto(kpi.valor, kpi.formato);
    const temVariacao = kpi.variacao !== null && kpi.variacao !== undefined;
    const subiu = temVariacao && kpi.variacao > 0;
    const caiu = temVariacao && kpi.variacao < 0;
    // Em custo e despesa, subir é ruim. `inverterCor` deixa cada painel dizer
    // o que é boa notícia — sem isso, "Gasto com frota +40%" apareceria em
    // verde, comemorando um problema.
    const tom = !temVariacao ? 'igual'
      : (subiu !== Boolean(kpi.inverterCor) ? 'sobe' : 'desce');
    return `
      <article class="kpi-card${kpi.tom === 'alerta' ? ' kpi-card-alerta' : ''}">
        <h3>${escapeHtml(kpi.titulo)}</h3>
        <p class="kpi-valor">${v.prefixo ? `${v.prefixo} ` : ''}${v.numero}${v.sufixo ? ` <small>${v.sufixo}</small>` : ''}</p>
        <p class="kpi-sub">
          ${temVariacao ? `<span class="kpi-delta kpi-delta-${tom}">${subiu ? '▲' : caiu ? '▼' : '='} ${Math.abs(kpi.variacao).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%</span>` : ''}
          <span>${escapeHtml(kpi.detalhe || '')}</span>
        </p>
        ${kpi.faixa ? `
          <div class="kpi-faixa">
            <div class="kpi-trilho kpi-trilho-${escapeHtml(kpi.faixa.tom || 'normal')}">
              <i style="width:${Math.min(100, Math.max(0, kpi.faixa.percentual))}%"></i>
            </div>
            <div class="kpi-faixa-legenda">
              <span>${kpi.faixa.contagem ? escapeHtml(String(kpi.faixa.valor)) : valorCheio(kpi.faixa.valor, kpi.formato)}</span>
              <span>${escapeHtml(kpi.faixa.rotulo || '')}</span>
            </div>
          </div>` : ''}
        ${kpi.serie && kpi.serie.length > 1 ? sparkline(kpi.serie) : ''}
      </article>
    `;
  }

  /**
   * Gráfico de tendência (linhas por período).
   *
   * Veio de modules/finance/subs/dashboard.js sem mudar o desenho — o mesmo
   * traço que o Financeiro já tinha, para os painéis não parecerem de sistemas
   * diferentes. A única adição é `formato`: o tooltip formatava sempre em reais,
   * e um gráfico de "OPs concluídas" mostrava "R$ 12,00" ao passar o mouse.
   */
  function graficoLinha(series, escapeHtml = esc, lines, { formato = 'moeda' } = {}) {
    const width = 760;
    const height = 220;
    const paddingTop = 16;
    const paddingBottom = 26;
    const chartHeight = height - paddingTop - paddingBottom;
    const n = Math.max(series.length, 1);
    const step = n > 1 ? width / (n - 1) : width;
    const baseY = paddingTop + chartHeight;

    const activeLines = lines || [
      { key: 'receitas', cssClass: 'finance-chart-line-receita' },
      { key: 'despesas', cssClass: 'finance-chart-line-despesa' },
      { key: 'saldo', cssClass: 'finance-chart-line-saldo' }
    ];
    const maxVal = Math.max(1, ...series.map((s) => Math.max(...activeLines.map((line) => Math.abs(Number(s[line.key]) || 0)))));

    const pointsFor = (key) => series.map((s, i) => {
      const x = n > 1 ? i * step : width / 2;
      const y = baseY - (Number(s[key]) / maxVal) * chartHeight;
      return { x, y, s };
    });

    const linePath = (points) => points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    const dots = (points, cls, key) => points.map((p) => `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3.5" class="finance-chart-dot ${cls}"><title>${escapeHtml(p.s.label)}: ${valorCheio(p.s[key], formato)}</title></circle>`).join('');

    const linesData = activeLines.map((line) => ({ ...line, points: pointsFor(line.key) }));

    const labels = series.map((s, i) => {
      const x = n > 1 ? i * step : width / 2;
      return `<text x="${x.toFixed(1)}" y="${height - 6}" text-anchor="middle" class="finance-chart-label">${escapeHtml(s.label)}</text>`;
    }).join('');

    return `
      <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" class="finance-chart-svg" role="img" aria-label="Gráfico de tendência por período">
        <line x1="0" y1="${baseY}" x2="${width}" y2="${baseY}" class="finance-chart-axis"></line>
        ${linesData.map((line) => `<polyline points="${linePath(line.points)}" class="${line.cssClass}"></polyline>`).join('')}
        ${linesData.map((line) => dots(line.points, line.cssClass, line.key)).join('')}
        ${labels}
      </svg>
    `;
  }

  /**
   * Barras horizontais — comparação entre categorias.
   *
   * HTML e CSS em vez de SVG, ao contrário do gráfico de linha: aqui o rótulo é
   * texto de tamanho variável ("Manutenção preventiva", "Caminhão Mercedes
   * 1113"), e texto dentro de SVG não quebra linha nem respeita a fonte do
   * tema. A barra é uma div com largura percentual, que o navegador já sabe
   * alinhar.
   *
   * A escala é relativa ao MAIOR item, não a um total: o objetivo é comparar
   * entre si, e escalar pelo total esmagaria todas as barras quando houvesse
   * um item dominante.
   */
  function graficoBarras(itens, escapeHtml = esc, { formato = 'moeda', tom = 'primary', vazio = 'Sem dados no período.' } = {}) {
    const lista = (itens || []).filter((i) => i && Number(i.valor) !== 0);
    if (!lista.length) return `<p class="painel-vazio">${escapeHtml(vazio)}</p>`;
    const maior = Math.max(...lista.map((i) => Math.abs(Number(i.valor) || 0))) || 1;
    return `
      <div class="painel-barras">
        ${lista.map((item) => `
          <div class="painel-barra-linha" title="${escapeHtml(item.label)}: ${valorCheio(item.valor, formato)}">
            <span class="painel-barra-rotulo">${escapeHtml(item.label)}</span>
            <span class="painel-barra-trilho">
              <i class="painel-barra-preenche painel-barra-${escapeHtml(item.tom || tom)}" style="width:${((Math.abs(Number(item.valor) || 0) / maior) * 100).toFixed(1)}%"></i>
            </span>
            <span class="painel-barra-valor">${valorCheio(item.valor, formato)}</span>
          </div>
        `).join('')}
      </div>
    `;
  }

  /**
   * Rosca — composição de um total.
   *
   * Só vale quando as fatias SOMAM o total. Usar rosca para comparar coisas
   * independentes (faturamento x estoque) mentiria: sugeriria que uma é parte
   * da outra. Para isso existe graficoBarras.
   *
   * Sem fatia zerada na tela: um arco de 0° vira um risco no anel e uma linha
   * na legenda dizendo "0%", que ninguém precisa ler.
   */
  function graficoRosca(fatias, escapeHtml = esc, { formato = 'moeda', vazio = 'Sem dados no período.' } = {}) {
    const lista = (fatias || []).filter((f) => f && Number(f.valor) > 0);
    const total = lista.reduce((s, f) => s + Number(f.valor || 0), 0);
    if (!total) return `<p class="painel-vazio">${escapeHtml(vazio)}</p>`;

    // stroke-dasharray num círculo: cada fatia é um traço do comprimento da sua
    // fração, deslocado pelo que já foi desenhado. Sem cálculo de arco e sem
    // caminho SVG à mão — e o anel continua redondo em qualquer tamanho.
    const raio = 60;
    const circunferencia = 2 * Math.PI * raio;
    let acumulado = 0;
    const arcos = lista.map((fatia, i) => {
      const fracao = Number(fatia.valor) / total;
      const traco = fracao * circunferencia;
      const arco = `<circle cx="80" cy="80" r="${raio}" fill="none" stroke-width="22"
        class="painel-rosca-fatia painel-rosca-${i % 6}"
        stroke-dasharray="${traco.toFixed(2)} ${(circunferencia - traco).toFixed(2)}"
        stroke-dashoffset="${(-acumulado).toFixed(2)}"
        transform="rotate(-90 80 80)"><title>${escapeHtml(fatia.label)}: ${valorCheio(fatia.valor, formato)}</title></circle>`;
      acumulado += traco;
      return arco;
    }).join('');

    return `
      <div class="painel-rosca">
        <svg viewBox="0 0 160 160" class="painel-rosca-svg" role="img" aria-label="Composição do total">
          ${arcos}
        </svg>
        <ul class="painel-rosca-legenda">
          ${lista.map((fatia, i) => `
            <li>
              <i class="painel-rosca-marca painel-rosca-${i % 6}"></i>
              <span class="painel-rosca-nome">${escapeHtml(fatia.label)}</span>
              <span class="painel-rosca-valor">${valorCheio(fatia.valor, formato)}</span>
              <span class="painel-rosca-pct">${((Number(fatia.valor) / total) * 100).toFixed(0)}%</span>
            </li>
          `).join('')}
        </ul>
      </div>
    `;
  }

  /**
   * Ranking — os N maiores, com o número ao lado.
   *
   * Difere de graficoBarras por mostrar POSIÇÃO (1º, 2º...) e um detalhe por
   * linha. É a resposta a "quem", não a "quanto comparado a quem".
   */
  function ranking(itens, escapeHtml = esc, { formato = 'moeda', vazio = 'Sem dados no período.' } = {}) {
    const lista = itens || [];
    if (!lista.length) return `<p class="painel-vazio">${escapeHtml(vazio)}</p>`;
    return `
      <ol class="painel-ranking">
        ${lista.map((item, i) => `
          <li>
            <span class="painel-ranking-pos">${i + 1}</span>
            <span class="painel-ranking-nome">
              <strong>${escapeHtml(item.label)}</strong>
              ${item.detalhe ? `<span class="muted">${escapeHtml(item.detalhe)}</span>` : ''}
            </span>
            <span class="painel-ranking-valor">${valorCheio(item.valor, formato)}</span>
          </li>
        `).join('')}
      </ol>
    `;
  }

  /** Bloco padrão: título, subtítulo opcional e conteúdo. */
  function bloco(titulo, conteudo, { subtitulo = '', largo = false, escapeHtml = esc } = {}) {
    return `
      <section class="panel painel-bloco ${largo ? 'painel-bloco-largo' : ''}">
        <div class="painel-bloco-topo">
          <h3>${escapeHtml(titulo)}</h3>
          ${subtitulo ? `<p class="muted">${escapeHtml(subtitulo)}</p>` : ''}
        </div>
        ${conteudo}
      </section>
    `;
  }

  /**
   * Períodos — o MESMO seletor em todos os painéis.
   *
   * Cada módulo escolhendo seu próprio conjunto ("últimos 30 dias" aqui, "mês
   * atual" ali) faria dois painéis abertos lado a lado mostrarem recortes
   * diferentes sem avisar.
   */
  const PERIODOS = [
    { key: 'hoje', label: 'Hoje', dias: 1 },
    { key: 'semana', label: '7 dias', dias: 7 },
    { key: 'mes', label: '30 dias', dias: 30 },
    { key: 'trimestre', label: '90 dias', dias: 90 },
    { key: 'ano', label: '12 meses', dias: 365 }
  ];

  function seletorPeriodo(ativo, escapeHtml = esc) {
    return `
      <div class="finance-period-group painel-periodos" role="tablist" aria-label="Período">
        ${PERIODOS.map((p) => `
          <button type="button" role="tab" aria-selected="${p.key === ativo}"
                  class="finance-pill finance-pill-sm ${p.key === ativo ? 'active' : ''}"
                  data-painel-periodo="${escapeHtml(p.key)}">${escapeHtml(p.label)}</button>
        `).join('')}
      </div>
    `;
  }

  /**
   * Layout do painel. Um só, para os sete módulos.
   *
   * `erro` tem lugar próprio em vez de virar um bloco vazio: painel que não
   * carregou precisa dizer isso, senão zero em todos os cartões parece uma
   * empresa parada.
   */
  function layout({ titulo, subtitulo, periodo, kpis = [], blocos = [], erro = '', escapeHtml = esc }) {
    return `
      <div class="painel-modulo">
        <section class="painel-cabecalho">
          <div>
            <h2>${escapeHtml(titulo)}</h2>
            ${subtitulo ? `<p class="muted">${escapeHtml(subtitulo)}</p>` : ''}
          </div>
          ${periodo ? seletorPeriodo(periodo, escapeHtml) : ''}
        </section>

        ${erro ? `<div class="panel painel-erro"><strong>Não foi possível carregar o painel.</strong><p class="muted">${escapeHtml(erro)}</p></div>` : ''}

        ${kpis.length ? `<section class="kpi-grid">${kpis.map((k) => cartaoKpi(k, escapeHtml)).join('')}</section>` : ''}

        ${blocos.length ? `<div class="painel-grade">${blocos.join('')}</div>` : ''}
      </div>
    `;
  }

  /** Liga os botões de período. Um só handler, igual em todos os painéis. */
  function ligarPeriodo(content, aoTrocar) {
    content.querySelectorAll('[data-painel-periodo]').forEach((botao) => {
      botao.addEventListener('click', () => aoTrocar(botao.dataset.painelPeriodo));
    });
  }

  /**
   * Fábrica da tela de painel — a mesma para os sete módulos.
   *
   * Cada painel difere só em DUAS coisas: de onde vêm os dados (a rota, que é
   * `/api/<modulo>/dashboard`) e quais blocos desenhar. Todo o resto — período,
   * cartões, tratamento de erro, redesenho ao trocar o período — é idêntico, e
   * sete cópias divergiriam no primeiro ajuste.
   *
   * O período fica em `state`, com chave por módulo: quem estava vendo 12 meses
   * em Contratos e vai a Frota não deve levar o recorte junto, porque a decisão
   * de período é sobre o que se está olhando.
   */
  function telaDeModulo({ modulo, titulo, subtitulo, blocos }) {
    return async function renderPainelModulo(ctx) {
      const { content, api, state } = ctx;
      const chave = `painelPeriodo_${modulo}`;
      const periodo = state[chave] || 'mes';

      let dados = null;
      let erro = '';
      try {
        dados = await api(`/api/${modulo}/dashboard?periodo=${encodeURIComponent(periodo)}`);
      } catch (e) {
        // Sem toast: o erro já aparece dentro do painel, com o título e o
        // seletor de período ainda de pé para o usuário tentar outro recorte.
        // Um toast por cima diria a mesma coisa duas vezes.
        erro = e.message || 'Erro ao carregar o painel.';
      }

      content.innerHTML = layout({
        titulo,
        subtitulo,
        periodo,
        kpis: dados ? (dados.kpis || []) : [],
        blocos: dados ? blocos(dados, ctx) : [],
        erro
      });

      ligarPeriodo(content, (novo) => {
        state[chave] = novo;
        renderPainelModulo(ctx);
      });
    };
  }

  return {
    PERIODOS,
    telaDeModulo,
    valorCurto,
    valorCheio,
    sparkline,
    cartaoKpi,
    graficoLinha,
    graficoBarras,
    graficoRosca,
    ranking,
    bloco,
    seletorPeriodo,
    ligarPeriodo,
    layout
  };
})();

// O nome antigo continua valendo: Financeiro, Dashboard Geral e Relatórios já
// chamavam `financeBuildChartSvg` por global, e trocar as três chamadas junto
// com a mudança de arquivo misturaria dois assuntos num commit só. O desenho é
// o mesmo — literalmente a mesma função.
window.financeBuildChartSvg = window.MavisPainel.graficoLinha;
