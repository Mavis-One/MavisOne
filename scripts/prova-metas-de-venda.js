#!/usr/bin/env node
// AS METAS DE VENDA, pelo HTTP, contra o servidor e o banco de verdade.
//
// NAO entra em `npm test`: sobe o server.js e escreve em `metas_de_venda`.
//
//   node scripts/prova-metas-de-venda.js
//
// OS TRES DEFEITOS QUE ELA GUARDA, medidos em 30/09/2026
// ------------------------------------------------------
//
// 1. A SOMATORIA DESAPARECIA. Duas metas de filial de R$ 100 mil e R$ 400 mil
//    davam R$ 500 mil em "Todas as filiais". Bastava UMA meta de escopo
//    `empresa` de R$ 300 mil -- cadastravel em Configuracoes > Metas de Venda,
//    onde "Loja" era a PRIMEIRA opcao do seletor -- e o numero virava R$ 300
//    mil. As duas de filial eram descartadas, sem nada na tela dizendo isso.
//
// 2. A META DE LOJA NAO MEDE NADA. Ela se compara com `orders.company_id`,
//    vazio em 14.864 de 14.864 pedidos. Ficava em 0% para sempre.
//
// 3. A LINHA "PEDIDOS" CONTAVA TRANSFERENCIA ENTRE FILIAIS: R$ 8.778.283,24 em
//    2026, 37,7% da linha. Era por isso que ela ficava tao acima de "Faturado".
//
// Esta prova COMMITA (passa pelo HTTP, nao ha transacao para desfazer). Ela
// limpa antes e depois, e so toca em metas de competencia 2099-01 e nas
// referencias de teste -- nunca em meta que alguem cadastrou.
require('dotenv').config();
const path = require('path');
const { spawn } = require('child_process');
const { consultar } = require('../lib/db/conexao.js');
const filialDaVenda = require('../lib/filial-da-venda.js');
const salesStatus = require('../public/modules/shared/sales_status.js');

const RAIZ = path.join(__dirname, '..');
const PORTA = 3197;
const BASE = 'http://127.0.0.1:' + PORTA;
// Competencia de teste bem longe de qualquer mes real, para nunca colidir com
// meta de verdade. As vendas dela sao zero, e e por isso que a soma das metas
// (o denominador) e o que esta prova mede -- nao o percentual.
const MES_TESTE = '2099-01';

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};
const brl = (v) => (v === null || v === undefined ? 'null' : 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2 }));
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

async function subirServidor() {
  const proc = spawn('node', [path.join(RAIZ, 'server.js')], {
    cwd: RAIZ, env: { ...process.env, PORT: String(PORTA) }, stdio: ['ignore', 'pipe', 'pipe']
  });
  let log = '';
  proc.stdout.on('data', (d) => { log += d; });
  proc.stderr.on('data', (d) => { log += d; });
  for (let i = 0; i < 60; i++) {
    await esperar(250);
    try { const r = await fetch(BASE + '/login.html'); if (r.status < 500) return { proc, log: () => log }; }
    catch (_) { /* subindo */ }
  }
  throw new Error('servidor nao subiu. log:\n' + log);
}

let token = '';
async function chamar(caminho, opcoes = {}) {
  const r = await fetch(BASE + caminho, {
    ...opcoes,
    headers: { 'content-type': 'application/json', ...(token ? { 'x-auth-token': token } : {}), ...(opcoes.headers || {}) }
  });
  const texto = await r.text();
  let corpo = null;
  try { corpo = JSON.parse(texto); } catch (_) { corpo = texto.slice(0, 200); }
  return { status: r.status, corpo };
}

const limpar = () => consultar("delete from metas_de_venda where competencia = $1::date", [MES_TESTE + '-01']);

(async () => {
  await limpar();
  const servidor = await subirServidor();
  try {
    let r = await chamar('/api/login', { method: 'POST', body: JSON.stringify({ username: 'admin', password: 'admin123' }) });
    if (r.status !== 200) throw new Error('sem sessao');
    token = r.corpo.token || '';

    // As duas filiais com mais venda, para as metas apontarem para algo real.
    const { rows: pedidos } = await consultar("select category from orders where category like '%/%'");
    const filiais = filialDaVenda.listarFiliais(pedidos).slice(0, 2).map((f) => f.nome);
    check('achou duas filiais para o teste', filiais.length === 2, filiais.join(', '));

    console.log('\n--- 1. a rota RECUSA criar meta de Loja ---');
    r = await chamar('/api/metas', {
      method: 'POST',
      body: JSON.stringify({ escopo: 'empresa', referenciaId: 'qualquer', competencia: MES_TESTE, valor: 300000 })
    });
    check('escopo empresa -> 400', r.status === 400, `${r.status}`);
    check('  e a mensagem diz o motivo e o que fazer',
      r.corpo && /company_id/.test(r.corpo.error || '') && /Cadastre como Filial/.test(r.corpo.error || ''),
      r.corpo && (r.corpo.error || '').slice(0, 88));

    console.log('\n--- 2. duas metas de filial, e a SOMA ---');
    for (const [i, f] of filiais.entries()) {
      r = await chamar('/api/metas', {
        method: 'POST',
        body: JSON.stringify({ escopo: 'filial', referenciaId: f, competencia: MES_TESTE, valor: i === 0 ? 100000 : 400000 })
      });
      check(`meta de ${f} salva`, r.status === 200, `${r.status}`);
    }
    const metasLib = require('../lib/metas.js');
    const lerSoma = async () => {
      const { rows } = await consultar('select * from metas_de_venda where competencia = $1::date', [MES_TESTE + '-01']);
      const lista = rows.map(require('../lib/db/metas.js').mapear);
      const escolhidas = metasLib.metasDoRecorte(lista, { mesmaFilial: filialDaVenda.mesmaFilial });
      return {
        total: metasLib.metaDoPeriodo(escolhidas, { from: MES_TESTE + '-01', to: MES_TESTE + '-31' }),
        referencias: metasLib.referenciasDaMeta(escolhidas)
      };
    };
    let soma = await lerSoma();
    check('"Todas as filiais" = 500.000', soma.total === 500000, brl(soma.total));
    check('  e cobre as duas referencias', soma.referencias.length === 2, soma.referencias.join(', '));

    console.log('\n--- 3. E ESTE E O DEFEITO CONSERTADO: a meta de Loja nao rouba a soma ---');
    // Entra pelo BANCO, e nao pela rota: a rota recusa agora. E exatamente a
    // situacao de quem ja tem uma meta de Loja cadastrada de antes.
    await consultar(
      `insert into metas_de_venda (id, escopo, referencia_id, competencia, valor, created_by, created_by_name)
       values ('meta-prova-loja', 'empresa', 'emp-prova', $1::date, 300000, '', 'prova')`,
      [MES_TESTE + '-01']
    );
    soma = await lerSoma();
    check('com uma meta de Loja de 300.000, a soma CONTINUA 500.000',
      soma.total === 500000, brl(soma.total) + ' (antes do conserto seria R$ 300.000,00)');
    check('  e a meta de Loja nao entra nas referencias',
      !soma.referencias.includes('emp-prova'), soma.referencias.join(', '));

    console.log('\n--- 4. a meta de Loja continua VISIVEL e REMOVIVEL ---');
    r = await chamar('/api/metas?escopo=empresa&de=' + MES_TESTE + '-01&ate=' + MES_TESTE + '-01');
    const daLoja = ((r.corpo && r.corpo.metas) || []).find((m) => m.referenciaId === 'emp-prova');
    check('o GET a devolve', !!daLoja, daLoja ? brl(daLoja.valor) : 'nao achada');
    if (daLoja) {
      r = await chamar('/api/metas/' + encodeURIComponent(daLoja.id), { method: 'DELETE' });
      check('  e o DELETE a remove', r.status === 200, `${r.status}`);
    }

    console.log('\n--- 5. a linha "Pedidos" do grafico nao conta transferencia ---');
    r = await chamar('/api/dashboard/charts?period=year&granularity=month');
    check('a rota do grafico respondeu', r.status === 200, `${r.status}`);
    const serie = (r.corpo && r.corpo.salesChartSeries) || [];
    const pedidosNaSerie = serie.reduce((s, b) => s + Number(b.pedidos || 0), 0);

    // A JANELA SAI DOS BUCKETS QUE A ROTA DEVOLVEU, e nao de um intervalo
    // escrito aqui. A primeira versao desta prova comparava com 2026 inteiro e
    // falhava por R$ 2,8 milhoes -- `buildPeriodBuckets(granularity)` monta a
    // janela dele (os ultimos doze meses), e `from`/`to` da URL nao a mudam.
    // Era o teste que estava errado, nao o codigo.
    check('a serie tem buckets com janela', serie.length > 0 && serie[0].from && serie[serie.length - 1].to,
      serie.length ? `${serie.length} buckets, ${serie[0].from} a ${serie[serie.length - 1].to}` : '0');
    const de = serie[0].from;
    const ate = serie[serie.length - 1].to;

    const { rows: ordens } = await consultar(
      'select category, total_amount, date, status from orders where date between $1 and $2', [de, ate]
    );
    const somar = (filtro) => ordens.filter(filtro).reduce((s, o) => s + Number(o.total_amount || 0), 0);
    const naoCancelado = (o) => !salesStatus.ehCancelado(o.status);
    const comTransferencia = somar(naoCancelado);
    const semTransferencia = somar((o) => naoCancelado(o) && filialDaVenda.ehVenda(o));
    const transferido = Math.round((comTransferencia - semTransferencia) * 100) / 100;
    console.log(`  no banco, de ${de} a ${ate} (a janela da propria serie):`);
    console.log('    todo pedido nao cancelado .... ' + brl(comTransferencia));
    console.log('    sem movimentacao interna ..... ' + brl(semTransferencia));
    console.log('    a diferenca .................. ' + brl(transferido));
    check('ha transferencia para conferir', transferido > 0, brl(transferido));
    check('a linha Pedidos bate com a conta SEM transferencia',
      Math.abs(pedidosNaSerie - semTransferencia) < 1,
      brl(pedidosNaSerie) + ' vs ' + brl(semTransferencia));
    check('  e NAO com a conta que a incluia',
      Math.abs(pedidosNaSerie - comTransferencia) > 1,
      'diferenca de ' + brl(Math.abs(pedidosNaSerie - comTransferencia)));

    console.log('\n--- 6. o cartao Faturamento e a cobertura da meta ---');
    r = await chamar('/api/dashboard?period=month');
    check('a rota do painel respondeu', r.status === 200, `${r.status}`);
    const cartao = ((r.corpo && r.corpo.kpis) || []).find((k) => k.id === 'faturamento');
    check('o cartao Faturamento existe', !!cartao);
    // Sem meta no mes corrente, nao ha faixa -- e e' o comportamento honesto.
    check('sem meta no mes, nao ha faixa (e nao 0%)',
      cartao && (cartao.faixa === null || cartao.faixa === undefined),
      cartao ? JSON.stringify(cartao.faixa) : '-');
    check('  e sem faixa nao ha cobertura a mostrar',
      cartao && !cartao.metaCobertura, cartao ? JSON.stringify(cartao.metaCobertura) : '-');

    console.log('\n--- 7. o log do servidor esta limpo ---');
    const erros = (servidor.log().match(/^.*(Error|Erro ao|nao consegui).*$/gm) || []);
    check('nenhum erro no log', erros.length === 0, erros.slice(0, 2).join(' | ') || 'limpo');
  } catch (e) {
    console.error('\nERRO NA PROVA:', e.message);
    falhas++;
  } finally {
    servidor.proc.kill();
    await limpar();
    await consultar("delete from metas_de_venda where id = 'meta-prova-loja'");
    console.log('\n(as metas de prova foram removidas)');
  }

  console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== A SOMA DAS METAS RESISTE =====');
  process.exit(falhas ? 1 : 0);
})();
