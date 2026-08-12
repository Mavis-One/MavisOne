#!/usr/bin/env node
// Painéis por módulo — a conta de cada indicador, e o que eles se recusam a
// afirmar.
//
// O RISCO DE UM PAINEL NÃO É ERRAR A CONTA: É AFIRMAR O QUE NÃO SABE
// -------------------------------------------------------------------
// Um cartão zerado parece uma empresa parada. Uma variação de 0% afirma que
// nada mudou quando o que houve foi falta de base de comparação. Uma seta verde
// em custo comemora um problema. Um índice de qualidade de 0% se lê como "tudo
// reprovado" quando o que houve foi "nada inspecionado". Nenhuma dessas falhas
// dá erro: elas produzem um número plausível e errado, que alguém usa para
// decidir.
//
// Roda sem banco e sem rede.
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const ler = (p) => fs.readFileSync(path.join(RAIZ, p), 'utf8').replace(/\r\n/g, '\n');

let falhas = 0;
const check = (nome, cond, detalhe) => {
  if (cond) {
    console.log(`  OK  ${nome}`);
  } else {
    falhas += 1;
    console.log(`  XX  ${nome}${detalhe ? ` -> ${detalhe}` : ''}`);
  }
};

const P = require(path.join(RAIZ, 'lib/painel-modulos.js'));
const serverSrc = ler('server.js');
const painelSrc = ler('public/modules/shared/painel.js');
const htmlSrc = ler('public/index.html');

const HOJE = '2026-08-11';
const IV = P.intervaloDoPeriodo('mes', HOJE);
const kpi = (r, id) => r.kpis.find((k) => k.id === id);

console.log('--- o recorte de período ---');
check('30 dias termina hoje', IV.to === HOJE && IV.from === '2026-07-13');
// Comparar 7 dias com o mês passado inteiro produziria quedas de 80% toda
// semana. O anterior tem SEMPRE o mesmo tamanho e encosta no início do atual.
const ant = P.anterior(IV);
check('o anterior tem o mesmo tamanho', ant.dias === IV.dias);
check('e encosta no início do atual', ant.to === '2026-07-12');
// Um gráfico com 365 rótulos não é legível; um com 2 não é gráfico.
check('até um mês, um ponto por dia', P.fatias(IV).length === 30);
check('acima disso, por mês de calendário', P.fatias(P.intervaloDoPeriodo('ano', HOJE)).every((f) => /^\d\d\/\d\d$/.test(f.label)));

console.log('\n--- variação: null não é zero ---');
// Zero afirma que não mudou. null diz que não há base — e o cartão simplesmente
// não mostra seta, em vez de inventar estabilidade.
check('sem base, devolve null', P.variacao(100, 0) === null);
check('com base, calcula', P.variacao(150, 100) === 50);
check('queda é negativa', P.variacao(50, 100) === -50);

console.log('\n--- Compras ---');
const compras = P.painelCompras({
  compras: [
    { date: '2026-08-05', supplierId: 'f1', supplier: 'Aço Norte', total: 1200, quantity: 10 },
    { date: '2026-08-09', supplierId: 'f1', supplier: 'Aço Norte', total: 800, quantity: 4 },
    { date: '2026-07-20', supplierId: 'f2', supplier: 'Ferro Sul', total: 1000, quantity: 5 }
  ],
  intervalo: IV
});
check('soma o período', kpi(compras, 'compras-total').valor === 3000);
check('ticket médio é total/compras', kpi(compras, 'compras-ticket').valor === 1000);
check('conta fornecedores distintos', kpi(compras, 'compras-fornecedores').valor === 2);
check('agrupa por fornecedor', compras.porFornecedor[0].label === 'Aço Norte' && compras.porFornecedor[0].valor === 2000);
// Comprar mais não é bom nem ruim por si — depende de estoque e de venda.
check('total comprado não inverte cor', !kpi(compras, 'compras-total').inverterCor);

console.log('\n--- Estoque ---');
const estoque = P.painelEstoque({
  produtos: [
    { id: 'p1', name: 'A', stockQuantity: 10, costPrice: 5, situation: 'normal', balances: [{ depositId: 'd1', quantity: 10 }], unallocated: 0 },
    { id: 'p2', name: 'B', stockQuantity: 2, costPrice: 100, situation: 'abaixo-minimo', balances: [{ depositId: '', quantity: 0 }], unallocated: 2 }
  ],
  movimentos: [
    { date: '2026-08-02', type: 'entrada', quantity: 10 },
    { date: '2026-08-06', type: 'saida', quantity: 3 }
  ],
  depositos: [{ id: 'd1', name: 'Galpão A' }],
  reservas: null,
  intervalo: IV
});
check('valor é quantidade x custo', kpi(estoque, 'estoque-valor').valor === 250);
check('conta o que está abaixo do mínimo', kpi(estoque, 'estoque-critico').valor === 1);
check('e marca alerta', kpi(estoque, 'estoque-critico').tom === 'alerta');
// Sem histórico de valor de estoque não há base honesta — uma seta aqui seria
// lida como tendência.
check('valor em estoque não finge tendência', kpi(estoque, 'estoque-valor').variacao === null);
// A rosca só é honesta se as fatias SOMAREM o total. Produto sem depósito tem
// de aparecer, senão as fatias não fecham com o cartão.
check('produto sem depósito não some da rosca', estoque.porDeposito.some((f) => f.label === 'Sem depósito' && f.valor === 200));
check('a rosca fecha com o cartão', estoque.porDeposito.reduce((s, f) => s + f.valor, 0) === kpi(estoque, 'estoque-valor').valor);
// Reserva não calculada não pode virar "0 reservado".
check('sem reservas, o cartão diz que não calculou', /reservas não calculadas/.test(kpi(estoque, 'estoque-reservado').detalhe));

console.log('\n--- Fiscal ---');
const fiscal = P.painelFiscal({
  notas: [
    { status: 'autorizada', valorTotal: 5000, autorizadoEm: '2026-08-03', tipoOperacaoFiscal: 'VENDA' },
    { status: 'rejeitada', valorTotal: 900, dataEmissao: '2026-08-04' },
    { status: 'cancelada', valorTotal: 300, autorizadoEm: '2026-08-05' }
  ],
  intervalo: IV
});
// Nota cancelada não é faturamento — somá-la faria o painel fiscal discordar
// do de Vendas.
check('valor autorizado ignora canceladas', kpi(fiscal, 'fiscal-valor').valor === 5000);
check('rejeitada conta como erro', kpi(fiscal, 'fiscal-erro').valor === 1);
check('e erro é má notícia', kpi(fiscal, 'fiscal-erro').inverterCor === true);
check('toda nota cai em um grupo', fiscal.porStatus.reduce((s, g) => s + g.valor, 0) === 3);

console.log('\n--- Frota: custo que sobe não é boa notícia ---');
const frota = P.painelFrota({
  veiculos: [{ id: 'v1', plate: 'ABC-1234', status: 'ativo' }, { id: 'v2', plate: 'XYZ-9', status: 'inativo' }],
  manutencoes: [{ vehicleId: 'v1', date: '2026-08-02', cost: 900, kind: 'corretiva' }],
  abastecimentos: [{ vehicleId: 'v1', date: '2026-08-08', liters: 120, total: 720 }],
  intervalo: IV
});
check('soma combustível e manutenção', kpi(frota, 'frota-custo').valor === 1620);
// Sem inverterCor, "Frota +40%" apareceria em verde, comemorando um problema.
check('custo da frota inverte a cor', kpi(frota, 'frota-custo').inverterCor === true);
check('combustível também', kpi(frota, 'frota-combustivel').inverterCor === true);
check('preço do litro é total/litros', kpi(frota, 'frota-preco-litro').valor === 6);
check('só conta veículo ativo', kpi(frota, 'frota-veiculos').valor === 1);
// Combustível é contínuo, manutenção vem em picos: somados, um esconde o outro.
check('as duas linhas são separadas', frota.tendencia[0].combustivel !== undefined && frota.tendencia[0].manutencao !== undefined);

console.log('\n--- RH ---');
const rh = P.painelRh({
  colaboradores: [
    { id: 'c1', admittedAt: '2024-01-10', salary: 3000, departmentId: 'd1' },
    { id: 'c2', admittedAt: '2026-08-01', salary: 0, departmentId: 'd1' },
    { id: 'c3', admittedAt: '2023-05-01', dismissedAt: '2026-08-05', salary: 5000 }
  ],
  afastamentos: [{ employeeId: 'c1', kind: 'Férias', startDate: '2026-08-01', endDate: '2026-08-20' }],
  departamentos: [{ id: 'd1', name: 'Produção' }],
  intervalo: IV, hoje: HOJE
});
check('desligado não conta como ativo', kpi(rh, 'rh-ativos').valor === 2);
check('a folha soma só os ativos', kpi(rh, 'rh-folha').valor === 3000);
// Salário em branco faria a folha parecer menor do que é. Dizer quantos faltam
// é a diferença entre um número e um número confiável.
check('e avisa quantos estão sem salário', /1 sem salário cadastrado/.test(kpi(rh, 'rh-folha').detalhe));
check('afastado hoje é o que começou e não terminou', kpi(rh, 'rh-afastados').valor === 1);
check('desligamento inverte a cor', kpi(rh, 'rh-desligamentos').inverterCor === true);
// Afastamento sem data de fim é o caso "sem previsão de retorno" — não pode
// sumir da conta por falta de um campo.
const rhSemFim = P.painelRh({
  colaboradores: [], afastamentos: [{ startDate: '2026-08-01' }], departamentos: [], intervalo: IV, hoje: HOJE
});
check('afastamento em aberto continua contando', kpi(rhSemFim, 'rh-afastados').valor === 1);

console.log('\n--- PCP ---');
const pcp = P.painelPcp({
  ordens: [
    { id: 'o1', status: 'aberta', quantity: 100, quantityDone: 20, dueDate: '2026-08-01', sectorId: 's1' },
    { id: 'o2', status: 'concluida', quantity: 50, quantityDone: 50 }
  ],
  apontamentos: [{ orderId: 'o1', date: '2026-08-07', quantity: 20 }],
  setores: [{ id: 's1', name: 'Corte' }],
  inspecoes: [{ date: '2026-08-07', quantidadeInspecionada: 20, quantidadeAprovada: 17 }],
  intervalo: IV, hoje: HOJE
});
check('concluída sai do andamento', kpi(pcp, 'pcp-abertas').valor === 1);
check('atrasada é a que passou da entrega', kpi(pcp, 'pcp-atrasadas').valor === 1);
check('produzido vem do apontamento', kpi(pcp, 'pcp-produzido').valor === 20);
check('qualidade é aprovado/inspecionado', kpi(pcp, 'pcp-qualidade').valor === 85);
// A fila do setor é o que FALTA produzir: um setor com 10 OPs quase prontas
// pesa menos que um com 2 intocadas, e o total esconderia isso.
check('a fila do setor é o que falta', pcp.porSetor[0].valor === 80);
// 0% se lê como "tudo reprovado" — o oposto de "nada foi medido".
const pcpSemInspecao = P.painelPcp({ ordens: [], apontamentos: [], setores: [], inspecoes: [], intervalo: IV, hoje: HOJE });
check('sem inspeção, o painel diz isso', /nenhuma inspeção no período/.test(kpi(pcpSemInspecao, 'pcp-qualidade').detalhe));

console.log('\n--- Contratos: o valor MENSAL equivalente ---');
// Um anual de R$ 120 mil e um mensal de R$ 120 mil somariam igual, e a receita
// recorrente ficaria doze vezes maior do que é.
check('anual vira 1/12', P.valorMensal({ value: 120000, billingCycle: 'anual' }) === 10000);
check('mensal fica igual', P.valorMensal({ value: 2000, billingCycle: 'mensal' }) === 2000);
// Chutar "mensal" num ciclo desconhecido inflaria o número que o financeiro usa
// para projetar caixa.
check('pagamento único não é recorrência', P.valorMensal({ value: 9000, billingCycle: 'unico' }) === 0);
check('ciclo desconhecido também não', P.valorMensal({ value: 9000, billingCycle: 'quinzenal' }) === 0);
const contratos = P.painelContratos({
  contratos: [
    { id: 'k1', title: 'Locação A', value: 120000, billingCycle: 'anual', status: 'ativo', endDate: '2026-09-01', typeId: 't1' },
    { id: 'k2', title: 'Suporte B', value: 2000, billingCycle: 'mensal', status: 'ativo', endDate: '2027-01-01', typeId: 't1' },
    { id: 'k3', title: 'Antigo', value: 500, billingCycle: 'mensal', status: 'ativo', endDate: '2026-07-01' }
  ],
  tipos: [{ id: 't1', name: 'Serviço' }], intervalo: IV, hoje: HOJE
});
check('a recorrência soma o mensal equivalente', kpi(contratos, 'contratos-recorrente').valor === 12500);
check('vence em 30 dias', kpi(contratos, 'contratos-30').valor === 1);
// Contrato passou da data e segue ativo: ou renova, ou encerra. Ficar assim é
// o estado que ninguém decidiu.
check('vencido em aberto aparece', kpi(contratos, 'contratos-vencidos').valor === 1);

console.log('\n--- as rotas ---');
// ANTES do bloco genérico: o regex dele leria "dashboard" como recurso e
// devolveria 404.
const posPainel = serverSrc.indexOf("const rotaPainel = pathname.match");
const posGenerica = serverSrc.indexOf("const rotaModulo = pathname.match");
check('a rota de painel vem antes da genérica', posPainel > 0 && posPainel < posGenerica);
check('cobre os sete módulos', /purchases\|stock\|fiscal\|fleet\|hr\|pcp\|contracts\)\\\/dashboard/.test(serverSrc));
check('e exige o módulo do usuário', /!user\.allowedModules\.includes\(modulo\)/.test(serverSrc));
// Mensagem crua do banco não vai para a tela.
check('erro do banco não vaza para a tela', /Não foi possível montar o painel deste módulo\./.test(serverSrc));
// A mesma lista que a tela "NF-e Emitidas" mostra: painel e listagem não podem
// discordar.
check('o fiscal lê a mesma lista da tela de notas', /painelFiscal\(\{ notas: await db\.getNfes\(\)/.test(serverSrc));

console.log('\n--- o kit é um só ---');
// O gráfico nasceu dentro do Financeiro e virou global por acidente: Dashboard
// Geral e Relatórios passaram a chamá-lo confiando na ordem das tags <script>.
check('o gráfico saiu do Financeiro', !/^function financeBuildChartSvg/m.test(ler('public/modules/finance/subs/dashboard.js')));
check('e mora no kit', /function graficoLinha\(series, escapeHtml/.test(painelSrc));
check('o nome antigo continua valendo', /window\.financeBuildChartSvg = window\.MavisPainel\.graficoLinha;/.test(painelSrc));
check('o kit carrega antes de todo módulo', htmlSrc.indexOf('shared/painel.js') < htmlSrc.indexOf('purchases/index.js'));
// Sete telas desenhando o próprio cartão divergiriam no primeiro ajuste.
check('uma fábrica para as sete telas', /function telaDeModulo\(\{ modulo, titulo, subtitulo, blocos \}\)/.test(painelSrc));
['purchases', 'stock', 'fiscal', 'fleet', 'hr', 'pcp', 'contracts'].forEach((m) => {
  const tela = ler(`public/modules/${m}/subs/painel.js`);
  check(`${m} usa a fábrica`, /window\.MavisPainel\.telaDeModulo\(\{/.test(tela));
  check(`${m} está no index.html`, htmlSrc.includes(`/modules/${m}/subs/painel.js`));
});

console.log('\n--- o cartão respeita o formato ---');
// Prefixar tudo com R$ faria "R$ 12" significar doze reais quando são doze
// veículos.
const Painel = { valorCurto: null };
const trechoFormato = painelSrc.match(/function valorCurto\(valor, formato = 'moeda'\)[\s\S]*?\n  \}/);
check('valorCurto aceita formato', Boolean(trechoFormato));
check('número não leva R$', /const prefixo = formato === 'moeda' \? 'R\$' : '';/.test(painelSrc));
// "12,00 colaboradores" é ruído.
check('contagem não leva centavo', /Contagem não tem centavo/.test(painelSrc));
check('percentual leva %', /sufixo: '%'/.test(painelSrc));

console.log('\n--- o painel que não carregou DIZ que não carregou ---');
// Zero em todos os cartões parece uma empresa parada, não uma consulta que
// falhou.
check('há lugar para o erro', /Não foi possível carregar o painel\./.test(painelSrc));
check('e o período continua de pé', /periodo \? seletorPeriodo\(periodo, escapeHtml\) : ''/.test(painelSrc));

console.log(`\n===== ${falhas === 0 ? 'TODOS OS CHECKS PASSARAM' : falhas + ' FALHA(S)'} =====`);
process.exit(falhas ? 1 : 0);
