#!/usr/bin/env node
/**
 * TIPOS DE GRÁFICO NO INÍCIO (15/10/2026). Pedido do usuário: "coloque uma
 * opção lateral para alterar os tipos de gráficos: grade, pizza, prédios".
 *
 * Provado no navegador (banco local, temas claro e escuro): Fluxo de Vendas e
 * Fluxo Financeiro com Linhas / Colunas / Pizza / Grade ao lado; 36 colunas
 * (12 meses × 3 séries), pizza de Receitas × Despesas (51% / 49%), grade com
 * 12 meses e o total; a escolha fica nas preferências e volta do servidor.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let falhas = 0;
const check = (nome, cond) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}`);
  if (!cond) falhas += 1;
};
const ler = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

// O painel roda no navegador: carrega num `window` de mentira.
const janela = {};
vm.runInNewContext(ler('public/modules/shared/painel.js'), { window: janela, document: undefined, console });
const P = janela.MavisPainel;
const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const serieFin = [
  { label: '09/26', receitas: 100, despesas: 60, saldo: 40 },
  { label: '10/26', receitas: 50, despesas: 90, saldo: -40 }
];
const linhasVendas = [
  { key: 'faturado', cssClass: 'finance-chart-line-receita', rotulo: 'Faturado' },
  { key: 'pedidos', cssClass: 'finance-chart-line-blue', rotulo: 'Pedidos', pizzaMenos: 'faturado', rotuloPizza: 'Pedidos a faturar' },
  { key: 'orcamentos', cssClass: 'finance-chart-line-purple', rotulo: 'Orçamentos' },
  { key: 'meta', cssClass: 'finance-chart-line-meta', rotulo: 'Meta' }
];
const serieVendas = [
  { label: '09/26', faturado: 80, pedidos: 100, orcamentos: 20, meta: 150 },
  { label: '10/26', faturado: 20, pedidos: 20, orcamentos: 0, meta: 150 }
];

check('quatro tipos: linhas, colunas, pizza e grade', JSON.stringify(P.TIPOS_DE_GRAFICO.map((t) => t.valor)) === '["linhas","colunas","pizza","grade"]');
check('tipo desconhecido cai em linhas', P.grafico('qualquer', serieFin, esc) === P.graficoLinha(serieFin, esc));

const colunas = P.graficoColunas(serieFin, esc);
check('colunas: uma por série em cada período (2 × 3)', (colunas.match(/class="painel-coluna /g) || []).length === 6);
check('  com a cor da linha de cada série', colunas.includes('painel-serie-receita') && colunas.includes('painel-serie-despesa') && colunas.includes('painel-serie-saldo'));
check('  meta não vira coluna', !P.graficoColunas(serieVendas, esc, linhasVendas).includes('Meta:'));

const pizzaFin = P.graficoPizza(serieFin, esc);
check('pizza do financeiro: receitas × despesas, sem o saldo', pizzaFin.includes('Receitas') && pizzaFin.includes('Despesas') && !pizzaFin.includes('Saldo'));
check('  150 contra 150 = 50% cada', (pizzaFin.match(/>50%</g) || []).length === 2);
// A moeda sai com espaço não separável (Intl): normaliza para comparar.
const pizzaVendas = P.graficoPizza(serieVendas, esc, linhasVendas).replace(/\u00a0/g, ' ');
check('pizza de vendas: pedidos entram sem o faturado (não conta duas vezes)',
  pizzaVendas.includes('Pedidos a faturar') && pizzaVendas.includes('R$ 20,00') && pizzaVendas.includes('R$ 100,00') && !pizzaVendas.includes('Meta'));
check('  pizza cheia (traço do dobro do raio)', pizzaVendas.includes('r="40"') && pizzaVendas.includes('stroke-width="80"'));
check('  sem valor: mensagem em vez de pizza vazia', P.graficoPizza([{ label: 'x', receitas: 0, despesas: 0 }], esc).includes('painel-vazio'));

const grade = P.graficoGrade(serieFin, esc);
check('grade: um período por linha e o total no rodapé', (grade.match(/<tr><td>/g) || []).length === 2 && grade.includes('<tfoot><tr><th>Total</th>'));

const seletor = P.seletorTipoGrafico('vendas', 'pizza', esc);
check('opção lateral: botão por tipo, o escolhido marcado', (seletor.match(/data-grafico-tipo="vendas:/g) || []).length === 4
  && /painel-tipo-grafico active" data-grafico-tipo="vendas:pizza"/.test(seletor));

const dash = ler('public/modules/dashboard/index.js');
check('Início: os dois gráficos com a opção lateral', dash.includes("P.seletorTipoGrafico('vendas', tipoVendas, escapeHtml)") && dash.includes("P.seletorTipoGrafico('financeiro', tipoFinanceiro, escapeHtml)"));
check('  a escolha fica nas preferências e redesenha sem buscar de novo',
  dash.includes("salvarPreferencia('dashboard_graficos', novos)") && /data-grafico-tipo[\s\S]{0,600}reusar: 'tudo'/.test(dash));
check('  legenda das linhas some na pizza e na grade', dash.includes("comLegenda(tipoVendas) ? '' : 'hidden'") && ler('public/app.css').includes('.finance-chart-legend[hidden] { display: none; }'));

console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TUDO OK =====');
process.exit(falhas ? 1 : 0);
