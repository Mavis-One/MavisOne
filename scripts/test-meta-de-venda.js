#!/usr/bin/env node
/**
 * META DE VENDA (fase DC) — sem banco e sem servidor.
 *
 * O QUE FALTAVA, e estava escrito no código. O cabeçalho de lib/kpis.js dizia:
 * *"O mockup previa '85% da meta'. Não há cadastro de meta em lugar nenhum...
 * cartão com número derivado de nada é pior do que cartão sem número, porque
 * parece confiável."* A barra do cartão existia e media outra coisa — proporção
 * vencida. Faltava o alvo.
 *
 * O QUE ESTE TESTE PROTEGE, E POR QUE CADA COISA
 * ---------------------------------------------
 * 1. O RATEIO POR DIAS CORRIDOS. Meta se combina por mês; o Início tem quatro
 *    recortes. Comparar o faturamento de uma terça com a meta do mês daria 3% e
 *    não significaria nada.
 *
 * 2. O PERÍODO QUE CRUZA O MÊS conta os DOIS meses. É onde o erro de fronteira
 *    mora: 28/09 a 04/10 é 3/30 de setembro mais 4/31 de outubro.
 *
 * 3. SEM META, NÃO HÁ FAIXA — null, e não zero. Zero diria "a meta é zero e
 *    você a superou", que é a mentira mais fácil de acreditar. É a mesma
 *    decisão do `variacao()` devolvendo null sem base de comparação.
 *
 * 4. OS DOIS ESCOPOS NÃO SE SOMAM. A meta da loja já contém as dos vendedores
 *    dela; somar as duas pediria o dobro. Quem escolhe qual usar é a rota, pelo
 *    escopo de vendas de quem pergunta — é o que faz o valor do cartão e o alvo
 *    dele medirem o mesmo universo.
 *
 * 5. SÓ ADMINISTRADOR ESCREVE. Meta é instrumento de cobrança: quem pode mudar
 *    o próprio alvo não tem alvo.
 *
 * 6. A COMPETÊNCIA É O DIA 1. Sem a normalização, '2026-09-15' e '2026-09-01'
 *    passariam os dois pela unicidade e o mês teria dois alvos.
 */
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const ler = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');
const { semComentarios } = require('./sem-comentarios');

const metas = require(path.join(RAIZ, 'lib/metas'));

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`  ${cond ? 'OK  ' : 'XX  '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};

const SETEMBRO = { competencia: '2026-09-01', valor: 300 };
const OUTUBRO = { competencia: '2026-10-01', valor: 310 };
const DOIS = [SETEMBRO, OUTUBRO];

// ---------------------------------------------------------------------------
console.log('--- 1. os meses que um intervalo toca ---');
const umDia = metas.mesesDoIntervalo({ from: '2026-09-25', to: '2026-09-25' });
check('um dia toca um mês, com 1 de 30 dias',
  umDia.length === 1 && umDia[0].dias === 1 && umDia[0].diasDoMes === 30, JSON.stringify(umDia));
// O ERRO DE FRONTEIRA. Um período que atravessa o mês tem de aparecer como dois.
const cruza = metas.mesesDoIntervalo({ from: '2026-09-28', to: '2026-10-04' });
check('28/09 a 04/10 toca DOIS meses', cruza.length === 2, JSON.stringify(cruza));
check('  3 dias de setembro (de 30)', cruza[0].dias === 3 && cruza[0].diasDoMes === 30);
check('  e 4 de outubro (de 31)', cruza[1].dias === 4 && cruza[1].diasDoMes === 31);
check('o ano toca 12 meses', metas.mesesDoIntervalo({ from: '2026-01-01', to: '2026-12-31' }).length === 12);
// Fevereiro de ano bissexto: 2028 tem 29 dias, e o rateio divide pelo mês real.
check('fevereiro de 2028 tem 29 dias',
  metas.mesesDoIntervalo({ from: '2028-02-01', to: '2028-02-29' })[0].diasDoMes === 29);
check('intervalo invertido não devolve mês nenhum',
  metas.mesesDoIntervalo({ from: '2026-09-30', to: '2026-09-01' }).length === 0);
check('data inválida também não', metas.mesesDoIntervalo({ from: 'ontem', to: 'hoje' }).length === 0);
check('  e ausente também', metas.mesesDoIntervalo().length === 0);

console.log('\n--- 2. o rateio por dias corridos ---');
check('mês inteiro: a meta cheia', metas.metaDoPeriodo(DOIS, { from: '2026-09-01', to: '2026-09-30' }) === 300);
check('um dia: 300 / 30 = 10', metas.metaDoPeriodo(DOIS, { from: '2026-09-25', to: '2026-09-25' }) === 10);
// 300 × 3/30 + 310 × 4/31 = 30 + 40 = 70
check('cruzando o mês: 30 + 40 = 70',
  metas.metaDoPeriodo(DOIS, { from: '2026-09-28', to: '2026-10-04' }) === 70,
  String(metas.metaDoPeriodo(DOIS, { from: '2026-09-28', to: '2026-10-04' })));
check('o ano soma os meses cadastrados', metas.metaDoPeriodo(DOIS, { from: '2026-01-01', to: '2026-12-31' }) === 610);
// SEM META NO PERÍODO: null, e não zero.
check('mês sem meta devolve null', metas.metaDoPeriodo(DOIS, { from: '2026-03-01', to: '2026-03-31' }) === null);
check('lista vazia devolve null', metas.metaDoPeriodo([], { from: '2026-09-01', to: '2026-09-30' }) === null);
check('lista ausente devolve null', metas.metaDoPeriodo(undefined, { from: '2026-09-01', to: '2026-09-30' }) === null);
check('intervalo inválido devolve null', metas.metaDoPeriodo(DOIS, { from: 'x', to: 'y' }) === null);
// DUAS METAS DO MESMO MÊS SOMAM — é o caso de várias lojas ou vários vendedores
// no mesmo escopo. Quem NÃO pode somar são escopos diferentes, e quem separa
// isso é a rota.
check('duas referências no mesmo mês somam',
  metas.metaDoPeriodo([SETEMBRO, { competencia: '2026-09-01', valor: 200 }], { from: '2026-09-01', to: '2026-09-30' }) === 500);
// Competência com dia diferente de 1 é normalizada na comparação: dado que
// escapou pela API antiga não pode sumir do rateio.
check('competência com dia != 1 ainda casa com o mês',
  metas.metaDoPeriodo([{ competencia: '2026-09-17', valor: 300 }], { from: '2026-09-01', to: '2026-09-30' }) === 300);

console.log('\n--- 3. a faixa do cartão ---');
check('metade do alvo: 50%', metas.faixaDaMeta(150, 300).percentual === 50);
check('alvo batido: 100% e sem tom de alarme',
  metas.faixaDaMeta(300, 300).percentual === 100 && metas.faixaDaMeta(300, 300).tom === '');
// NÃO CORTA EM 100%: o mês excepcional é informação. A barra da TELA limita a
// largura; o número pode passar.
check('acima do alvo: 150%, e não cortado em 100', metas.faixaDaMeta(450, 300).percentual === 150);
check('83% é atenção (dá para virar)', metas.faixaDaMeta(250, 300).tom === 'atencao');
check('50% é alerta (não fecha sozinho)', metas.faixaDaMeta(150, 300).tom === 'alerta');
check('sem alvo, faixa nula', metas.faixaDaMeta(100, 0) === null);
check('  e alvo nulo também', metas.faixaDaMeta(100, null) === null);
check('o rótulo é "da meta"', metas.faixaDaMeta(1, 2).rotulo === 'da meta');
// A MESMA FORMA das outras faixas: a barra do cartão já existia.
check('mesma forma das outras faixas',
  ['valor', 'percentual', 'rotulo', 'tom', 'contagem'].every((k) => k in metas.faixaDaMeta(1, 2)));
check('  e contagem = false (é dinheiro, não quantidade)', metas.faixaDaMeta(1, 2).contagem === false);

console.log('\n--- 4. os dois escopos, e o que não se soma ---');
// A fase DD acrescentou 'filial' (ver scripts/test-meta-por-filial.js). O que
// este bloco protege continua: nenhum escopo além dos declarados.
check('só empresa, vendedor e filial', JSON.stringify(metas.ESCOPOS) === JSON.stringify(['empresa', 'vendedor', 'filial']));
const migracao = ler('banco/migrations/fase-dc-meta-de-venda.sql');
// O RÓTULO DIZIA "só admite os dois", e isso deixou de ser verdade do sistema
// quando a fase DD abriu o CHECK para três — a migração DC continua com dois,
// então o check PASSAVA dizendo uma coisa errada. Teste cuja mensagem contradiz
// o sistema é pior do que teste ausente: o próximo a ler acredita nele.
//
// O que se confere aqui é o que a DC criou. Quem confere o CHECK em vigor é
// test-meta-por-filial.js, junto da migração que o alterou.
check('a DC nasceu com empresa e vendedor',
  /check \(escopo in \('empresa', 'vendedor'\)\)/.test(migracao),
  'a DD abriu para filial — ver test-meta-por-filial.js');
check('a competência é obrigada a ser o dia 1',
  /check \(extract\(day from competencia\) = 1\)/.test(migracao));
check('uma meta por escopo, referência e mês',
  /create unique index if not exists idx_metas_unica\s*\n\s*on metas_de_venda \(escopo, referencia_id, competencia\)/.test(migracao));
check('valor negativo é recusado', /check \(valor >= 0\)/.test(migracao));
// Zero é válido e tem significado: "esta loja não tem meta este mês" dito
// explicitamente é diferente de não ter linha.
check('  mas zero é aceito', /default 0 check \(valor >= 0\)/.test(migracao));
check('referência vazia é recusada', /check \(btrim\(referencia_id\) <> ''\)/.test(migracao));
check('e a tabela tem RLS', /alter table metas_de_venda enable row level security/.test(migracao));

console.log('\n--- 5. o cartão usa a meta ---');
const kpisSrc = semComentarios(ler('lib/kpis.js'));
check('kpiFaturamento recebe a meta',
  /function kpiFaturamento\(\{ pedidos, intervalo, serie, statusQueFaturam, meta, metaCobre = null \}\)/.test(kpisSrc));
// O NUMERADOR DA FAIXA DEIXOU DE SER O VALOR DO CARTAO (30/09/2026).
//
// Era `faixaDaMeta(valor, meta)`, e `valor` e' o faturamento INTEIRO do
// recorte. Quando a meta e' a soma das metas de filial isso compara coisas
// diferentes: 6,5% do faturado de 2026 (R$ 874.912, medido) nao pertence a
// filial nenhuma -- entrava no numerador sem ter alvo no denominador, e o
// percentual saia inflado por uma margem que ninguem sabia qual era.
//
// `metaCobre` e' o faturamento das MESMAS referencias que formam a meta,
// calculado na rota. Nulo quando nao ha recorte a fazer, e ai o numerador
// volta a ser o valor do cartao -- que e' o caso do vendedor comparando com
// a meta dele.
check('  e a faixa compara com metaCobre quando ele existe',
  /faixa: metas\.faixaDaMeta\(metaCobre === null \? valor : metaCobre, meta\)/.test(kpisSrc));
check('  e o VALOR do cartao continua o faturamento inteiro',
  /const valor = soma\(doIntervalo/.test(kpisSrc),
  'o cartao se chama Faturamento e continua sendo o faturamento');
check('montarKpis repassa metaDeVenda', /meta: metaDeVenda/.test(kpisSrc));
// O módulo é PURO: quem decide de quem é a meta é a rota.
check('e kpis.js não sabe de quem é a meta',
  !/escopo|sellerId|empresa/i.test(kpisSrc.split('faixa: metas.faixaDaMeta')[0].slice(-400)),
  'este modulo nao sabe quem esta olhando');

console.log('\n--- 6. a rota escolhe o escopo de quem pergunta ---');
const servidor = semComentarios(ler('server.js'));
// A escolha foi para metasLib.metasDoRecorte na fase DD, para o cartão e a
// linha de meta do gráfico usarem a MESMA regra. O comportamento é provado lá
// (scripts/test-meta-por-filial.js); aqui, que o cartão a chama com o escopo.
check('o cartão escolhe a meta pelo escopo de quem pergunta',
  /metasLib\.metasDoRecorte\(\s*await metasDb\.listarPorCompetencias\(competencias\),\s*\{ sellerIds: escopoVendas\.sellerIds, mesmaFilial: filialDaVenda\.mesmaFilial \}/.test(servidor));
// `mesmaFilial` PASSOU A SER OBRIGATORIO aqui, e a ausencia dele era um
// defeito calado: o default de metasDoRecorte comparava `a === b` cru, e uma
// meta cadastrada em "Timbó" nao casaria com a filial "Timbo" dos pedidos.
// O comparador canonico mora em lib/filial-da-venda.js.
check('  com o comparador canonico de filial, e nao o `===` cru',
  /mesmaFilial: filialDaVenda\.mesmaFilial/.test(servidor));
check('  quem vê tudo compara com a meta das EMPRESAS',
  metas.metasDoRecorte([{ escopo: 'empresa', valor: 1 }, { escopo: 'vendedor', referenciaId: 'v', valor: 2 }])
    .every((m) => m.escopo === 'empresa'));
check('  e quem vê só as próprias, com a dela',
  metas.metasDoRecorte([{ escopo: 'empresa', valor: 1 }, { escopo: 'vendedor', referenciaId: 'v', valor: 2 }], { sellerIds: ['v'] })
    .every((m) => m.escopo === 'vendedor' && m.referenciaId === 'v'));
check('a meta entra rateada no cartão', /metaDeVenda = metasLib\.metaDoPeriodo\(minhas, intervalo\)/.test(servidor));
// FALHA CALADA: o Início não pode deixar de abrir porque a tabela de metas
// ainda não existe no VPS.
check('e a leitura falha calada se a tabela não existir',
  /catch \(erroMeta\) \{[\s\S]{0,160}?nao consegui ler as metas/.test(servidor));

console.log('\n--- 7. quem escreve, e quem lê ---');
check('escrever exige administrador',
  /Apenas administrador define meta de venda/.test(servidor)
  && /Apenas administrador exclui meta de venda/.test(servidor));
// O PORTÃO DE LEITURA É `settings`, e a primeira versão errou nisto: exigia
// `podeVerRelatorios`, o vendedor comum não tem `reports`, e a prova que
// verificava "ele vê só a meta dele" passou À TOA — a requisição levava 403 e
// o `.every()` de uma lista vazia é sempre verdadeiro.
check('ler exige o módulo settings, onde a tela mora',
  /if \(!admin && !user\.allowedModules\.includes\('settings'\)\) \{/.test(servidor));
check('o vendedor comum vê só a meta dele',
  /lista = lista\.filter\(\(m\) => m\.escopo === 'vendedor' && meus\.has\(m\.referenciaId\)\)/.test(servidor));
// undefined DESAPARECE do JSON: a tela receberia o campo ausente em vez de um
// "não", e funciona por acidente enquanto quem lê usa Boolean().
check('podeEditar vai como booleano de verdade', /podeEditar: Boolean\(admin\)/.test(servidor));
check('a competência é normalizada no dia 1 na rota',
  /const competencia = `\$\{mes\.slice\(0, 7\)\}-01`;/.test(servidor));
// on conflict: salvar de novo ATUALIZA. Sem isto, corrigir a meta de setembro
// somaria as duas e a loja apareceria com o dobro.
const dbMetas = semComentarios(ler('lib/db/metas.js'));
check('salvar de novo atualiza, não soma',
  /on conflict \(escopo, referencia_id, competencia\) do update/.test(dbMetas));
// O driver devolve Date para coluna `date`; toISOString() converteria para UTC
// e a competência de 01/09 voltaria 31/08 num fuso a oeste.
check('a competência é lida sem passar por UTC',
  /competencia instanceof Date\s*\n\s*\? `\$\{row\.competencia\.getFullYear\(\)\}/.test(dbMetas));
check('  e o rateio não mora no SQL', !/extract|interval|generate_series/i.test(dbMetas),
  'a regra e uma so, em lib/metas.js');

console.log('\n--- 8. a tela ---');
const tela = ler('public/modules/settings/subs/metas.js');
const app = ler('public/app.js');
const roteador = ler('public/modules/settings/index.js');
const html = ler('public/index.html');
check('a tela existe e está no roteador', /'metas'\]/.test(roteador) || /, 'metas'/.test(roteador));
check('  no menu de Configurações', /key: 'metas', label: 'Metas de Venda'/.test(app));
check('  e o <script> está na página', /settings\/subs\/metas\.js/.test(html));
// Os parágrafos explicativos da tela (rateio mensal, "mês sem meta não mostra
// barra", "os totais não se somam") saíram em 01/10/2026, a pedido do usuário:
// a tela não carrega mais texto fixo de explicação, e estes checks deixaram de
// cobrar esse texto.
check('a lista de referências troca com o escopo', /function preencherReferencias\(\)/.test(tela));
check('quem não pode editar vê o motivo', /quem muda o próprio alvo não tem alvo/.test(tela));

console.log('\n--- 9. o recorte Anual, que mostrava o mês ---');
// Defeito irmão, achado ao ligar a meta: a tela manda quatro recortes
// (today/week/month/year) e `getPeriodRange` tinha ramo para três. `year` caía
// no default e voltava o MÊS. Medido: Mensal e Anual davam o mesmo
// R$ 564.276,11, quando 2026 fechava R$ 13.481.995,78.
check('getPeriodRange trata year',
  /if \(period === 'year'\) \{\s*\n\s*return \{ from: `\$\{today\.getFullYear\(\)\}-01-01`, to: `\$\{today\.getFullYear\(\)\}-12-31` \};/.test(servidor));
// A GUARDA CONTRA A PRÓXIMA DIVERGÊNCIA: as duas listas de recortes moram em
// arquivos diferentes, e foi só uma ficar para trás.
const dashSrc = ler('public/modules/dashboard/index.js');
const mapa = dashSrc.match(/const PERIODO_DO_GRANULARITY = \{([^}]*)\}/);
check('achei o mapa de recortes da tela', Boolean(mapa));
const periodosDaTela = [...(mapa ? mapa[1] : '').matchAll(/'([^']+)'/g)].map((m) => m[1]);
check(`a tela manda ${periodosDaTela.length} recortes`, periodosDaTela.length === 4, periodosDaTela.join(', '));
for (const periodo of periodosDaTela) {
  check(`  '${periodo}' tem ramo em getPeriodRange`,
    new RegExp(`period === '${periodo}'`).test(servidor) || periodo === 'month',
    periodo === 'month' ? 'e o default' : undefined);
}

console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TODOS OS CHECKS PASSARAM =====');
process.exit(falhas ? 1 : 0);
