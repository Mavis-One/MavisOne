#!/usr/bin/env node
// Desenho do hub — public/modules/dashboard/index.js
//
// O que este teste guarda:
//   1. as três fontes (gráficos, KPIs, pendências) falharem JUNTAS — uma
//      indisponível não pode apagar a tela inteira;
//   2. o seletor de período mandar só nos gráficos e os KPIs continuarem no
//      mês, deixando a tela mostrando dois intervalos diferentes;
//   3. a sparkline desenhar uma reta com um ponto só, sugerindo estabilidade
//      que ninguém mediu;
//   4. o painel de pendências e o sino da barra superior discordarem;
//   5. o valor abreviado esconder centavo onde ele ainda importa.
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const ler = (p) => fs.readFileSync(path.join(RAIZ, p), 'utf8').replace(/\r\n/g, '\n');
const src = ler('public/modules/dashboard/index.js');
const cssSrc = ler('public/app.css');
const appSrc = ler('public/app.js');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};

// Recorta as funções puras do módulo — ele registra numa global de navegador
// e depende de DOM na hora de desenhar, não na de calcular.
const recortar = (nome) => {
  const inicio = src.indexOf(`function ${nome}(`);
  const fim = src.indexOf('\n}\n', inicio);
  return src.slice(inicio, fim + 3);
};
const F = new Function(
  `${recortar('dashboardSaudacao')}${recortar('dashboardValorCurto')}${recortar('dashboardSparkline')}
   return { dashboardSaudacao, dashboardValorCurto, dashboardSparkline };`
)();

console.log('--- saudação pela hora ---');
check('manhã', F.dashboardSaudacao(9) === 'Bom dia');
check('meio-dia já é tarde', F.dashboardSaudacao(12) === 'Boa tarde');
check('tarde', F.dashboardSaudacao(17) === 'Boa tarde');
check('noite', F.dashboardSaudacao(18) === 'Boa noite');
check('madrugada é "bom dia"', F.dashboardSaudacao(3) === 'Bom dia');

console.log('\n--- valor abreviado ---');
// Sete dígitos com centavos não cabem num cartão estreito.
check('milhão', F.dashboardValorCurto(1284000).numero === '1,28' && F.dashboardValorCurto(1284000).sufixo === 'mi');
check('milhar', F.dashboardValorCurto(423800).numero === '423,8' && F.dashboardValorCurto(423800).sufixo === 'mil');
// Abaixo de mil o centavo ainda importa: R$ 940 não pode virar "R$ 0,9 mil".
check('abaixo de mil sai inteiro', F.dashboardValorCurto(940).numero === '940,00');
check('e sem sufixo', F.dashboardValorCurto(940).sufixo === '');
check('zero não quebra', F.dashboardValorCurto(0).numero === '0,00');
check('negativo mantém o sinal', F.dashboardValorCurto(-1500).numero.startsWith('-'), F.dashboardValorCurto(-1500).numero);
check('nulo vira zero', F.dashboardValorCurto(null).numero === '0,00');

console.log('\n--- sparkline ---');
// Uma reta com um ponto só sugeriria estabilidade que ninguém mediu.
check('menos de 2 pontos não desenha', F.dashboardSparkline([5]) === '' && F.dashboardSparkline([]) === '');
check('lista vazia não quebra', F.dashboardSparkline(undefined) === '');
const linha = F.dashboardSparkline([10, 20, 15]);
check('desenha com 2+ pontos', linha.includes('<polyline'));
check('estica na largura do cartão', /preserveAspectRatio="none"/.test(linha));
// Série constante daria faixa zero e divisão por zero nas coordenadas.
const plana = F.dashboardSparkline([7, 7, 7]);
check('série constante não gera NaN', !/NaN/.test(plana), plana.slice(0, 60));
// Sem eixo e sem rótulo: responde "sobe ou cai?", não "quanto".
check('sem texto no gráfico', !/<text/.test(linha));
check('escondida de leitor de tela', /aria-hidden="true"/.test(linha));

console.log('\n--- as três fontes falham em separado ---');
// Um KPI indisponível não pode apagar os gráficos, nem o painel de pendências
// apagar os KPIs.
check('KPIs têm fallback próprio', /api\(`\/api\/dashboard\?period=[\s\S]{0,90}\.catch\(\(\) => \(\{ kpis: \[\] \}\)\)/.test(src));
check('pendências têm fallback próprio', /api\('\/api\/dashboard\/atencao'\)\.catch\(\(\) => \(\{ itens: \[\] \}\)\)/.test(src));
check('gráficos já tinham', /catch \(error\) \{\s*\n\s*\/\/ Sem os gráficos/.test(src));
// Em série, a tela esperaria a soma dos três tempos.
check('buscadas em paralelo', /await Promise\.all\(\[/.test(src));

console.log('\n--- um seletor só manda em tudo ---');
// Trocar para "Semanal" e o cartão continuar somando o mês faria os dois
// discordarem na mesma tela.
check('granularidade vira período dos KPIs', /const PERIODO_DO_GRANULARITY = \{ day: 'today', week: 'week', month: 'month', year: 'year' \}/.test(src));
check('e é aplicada na busca', /period=\$\{encodeURIComponent\(PERIODO_DO_GRANULARITY\[granularity\]/.test(src));
// Dois grupos de botões deixariam a tela em dois intervalos ao mesmo tempo.
const seletores = (src.match(/data-dashboard-granularity=/g) || []).length;
check('existe um único grupo de botões', seletores === 1, `${seletores} grupo(s)`);
check('o servidor aceita o período', /getPeriodRange\(url\.searchParams\.get\('period'\)/.test(ler('server.js')));

console.log('\n--- pendências: tela e sino não discordam ---');
// Mesma rota nos dois lugares.
check('o painel lê /api/dashboard/atencao', /api\('\/api\/dashboard\/atencao'\)/.test(src));
check('o sino lê a mesma rota', /api\('\/api\/dashboard\/atencao'\)/.test(appSrc));
// Mesmas classes de severidade, então a cor significa o mesmo nos dois.
check('mesma escala de cor', /notif-sev-\$\{escapeHtml\(item\.severidade\)\}/.test(src) && /notif-sev-\$\{escapeHtml\(item\.severidade\)\}/.test(appSrc));
check('cada linha navega', /navigateToModule\(ctx, item\.modulo, item\.sub\)/.test(src));
// Sem texto, painel vazio parece falha de carregamento.
check('painel vazio explica que é boa notícia', /Nada pendente\./.test(src));

console.log('\n--- variação: a cor diz a direção, não o julgamento ---');
// Despesa que sobe é ruim; faturamento que sobe é bom. A cor não pode
// interpretar — quem interpreta é quem lê o título do cartão.
check('três tons de variação', /kpi-delta-sobe/.test(cssSrc) && /kpi-delta-desce/.test(cssSrc) && /kpi-delta-igual/.test(cssSrc));
check('e o motivo está escrito', /Subir não é sempre bom/.test(cssSrc));
// Sem base anterior o cartão não mostra seta — o módulo devolve null.
check('só mostra seta com variação', /const temVariacao = kpi\.variacao !== null && kpi\.variacao !== undefined/.test(src));

console.log('\n--- faixa de alerta ---');
check('a barra respeita 0–100%', /Math\.min\(100, Math\.max\(0, kpi\.faixa\.percentual\)\)/.test(src));
// A faixa do estoque conta ITENS; a das contas, reais. Formatar as duas como
// dinheiro mostraria "R$ 23,00 abaixo do mínimo".
check('faixa por contagem não vira moeda', /kpi\.faixa\.contagem\s*\n?\s*\? `\$\{kpi\.faixa\.valor\}/.test(src));
check('trilho tem tom por severidade', /\.kpi-trilho-perigo/.test(cssSrc) && /\.kpi-trilho-alerta/.test(cssSrc));

console.log('\n--- layout ---');
// Cinco colunas fixas espremeriam o valor a ponto de quebrar a linha.
check('grade de KPI é auto-fit', /\.kpi-grid \{[\s\S]*?repeat\(auto-fit, minmax\(190px, 1fr\)\)/.test(cssSrc));
// Números alinham em coluna; sem isto a leitura de cima a baixo fica torta.
check('números com largura fixa', /\.kpi-valor \{[\s\S]*?font-variant-numeric: tabular-nums;/.test(cssSrc));
// Abaixo de 1100px a coluna do painel ficaria menor que o texto das linhas.
check('gráfico largo só em tela grande', /@media \(min-width: 1100px\) \{\s*\n\s*\.dashboard-charts-grid-principal/.test(cssSrc));
// Atenção continua na coluna estreita ao lado do gráfico — agora do gráfico da
// ABA ATIVA, não só do de vendas, para não sobrar coluna vazia nas outras abas.
check('o painel de pendências fica ao lado do gráfico', /dashboard-charts-grid-principal">\s*\n\s*\$\{graficosVisiveis\[0\][\s\S]{0,200}?\$\{painelAtencao\}/.test(src));

console.log('\n--- favoritos ---');
// O texto antigo mandava "fixar" sem dizer onde — e o botão da barra lateral,
// que era o caminho, deixou de existir quando ela virou só ícones.
check('o vazio diz ONDE fixar', /Fixar módulo" na Área de Trabalho/.test(src));

console.log('\n--- abas de seção ---');
const kpisSrc = ler('lib/kpis.js');
// As abas são DERIVADAS do que existe. Uma lista fixa mostraria "Financeiro"
// vazio para quem não tem o módulo — a permissão já decidiu isso lá atrás.
check('só entra a área que tem conteúdo', /const areasComConteudo = AREAS\.filter\(\(area\) => cartoes\.some\(\(k\) => k\.modulo === area\.key\) \|\| graficoDaArea\[area\.key\]\)/.test(src));
// "Visão geral" e "Vendas" com o mesmo conteúdo são duas abas idênticas.
check('uma área só não vira abas', /const usaAbas = areasComConteudo\.length > 1;/.test(src));
check('a aba inválida cai na visão geral', /abas\.some\(\(a\) => a\.key === state\.dashboardAba\) \? state\.dashboardAba : 'geral'/.test(src));

// O agrupamento sai do próprio cartão. Uma segunda lista dizendo qual cartão é
// de qual módulo ficaria desatualizada no primeiro cartão novo.
['faturamento', 'a-receber', 'a-pagar', 'estoque', 'compras'].forEach((id) => {
  const trecho = kpisSrc.match(new RegExp(`id: '${id}',\\s*\\n\\s*modulo: '[a-z]+',`));
  check(`o cartão ${id} declara o módulo`, Boolean(trecho));
});
const K = require(path.join(RAIZ, 'lib/kpis.js'));
const cartoesTodos = K.montarKpis({
  permissoes: { sales: true, finance: true, stock: true, purchases: true },
  intervalo: { from: '2026-08-01', to: '2026-08-11' }, hoje: '2026-08-11'
});
check('todo cartão tem módulo', cartoesTodos.every((c) => Boolean(c.modulo)));
// O módulo do cartão é a MESMA permissão que o libera — se divergirem, a aba
// mostra um cartão que a pessoa não deveria ver, ou esconde um que ela pode.
const soVendas = K.montarKpis({ permissoes: { sales: true }, intervalo: { from: '2026-08-01', to: '2026-08-11' }, hoje: '2026-08-11' });
check('sem permissão, o cartão nem existe', soVendas.every((c) => c.modulo === 'sales'));

console.log('\n--- o que a aba NÃO pode esconder ---');
// Pendência escondida é pendência perdida: uma nota rejeitada não pode ficar
// invisível porque o usuário estava na aba Vendas.
check('Atenção está fora da filtragem', !/painelAtencao[\s\S]{0,80}abaAtiva/.test(src));
check('e o motivo está escrito', /pendência escondida é pendência\s*\n?\s*\*\s*perdida/.test(src));
// Favoritos é o atalho para sair do painel — escondê-lo custaria um clique em
// toda navegação.
check('Favoritos continua fora das abas', /<section class="panel">\s*\n\s*<div class="dashboard-favoritos-topo">/.test(src));
check('a troca de aba redesenha o painel', /state\.dashboardAba = button\.dataset\.dashboardAba;/.test(src));
// Aba sem gráfico deixaria Atenção pular para a largura cheia.
check('aba sem gráfico mantém a coluna', /dashboard-aba-vazia/.test(src) && /\.dashboard-aba-vazia \{/.test(cssSrc));

console.log(`\n===== ${falhas === 0 ? 'TODOS OS CHECKS PASSARAM' : falhas + ' FALHA(S)'} =====`);
process.exit(falhas ? 1 : 0);
