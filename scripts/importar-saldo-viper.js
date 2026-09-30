#!/usr/bin/env node
/**
 * CARGA INICIAL DO SALDO, A PARTIR DO RELATÓRIO DE ESTOQUE DO VIPER.
 *
 * FONTE: dois PDFs gerados pelo ViperERP em 30/09/2026 às 16:47 e 16:48, com
 * o filtro "Depósito(s): LOJA CENTRO":
 *
 *     Estoque_de_4001_ate_5000.pdf   TOTAIS/MÉDIA  saldo 2.164,00
 *     Estoque_de_5001_ate_5653.pdf   TOTAIS/MÉDIA  saldo 1.666,00
 *
 * OS DOIS SE SOBREPÕEM, E ISSO FOI PROVADO, NÃO SUPOSTO
 * -----------------------------------------------------
 * O relatório está ordenado em ordem alfabética DECRESCENTE. O primeiro
 * arquivo começa em "CIMENTO GRAFITE" e vai até o fim; o segundo começa em
 * "BALDE 8 LTS", que já está DENTRO do primeiro. Ou seja: o arquivo 1 contém
 * tudo o que está no arquivo 2.
 *
 * Somar os dois duplicaria 1.666 unidades. A prova de que o arquivo 1 é
 * superconjunto do 2 são as duas subtrações fechando na casa do centavo:
 *
 *     saldo:  2.164,00 − 1.666,00 = 498,00
 *     custo:  R$ 1.729.646,02 − R$ 1.714.572,80 = R$ 15.073,22
 *
 * E as cinco linhas que existem só no arquivo 1 (as que vêm antes de "BALDE"
 * na ordem do relatório) somam exatamente isso:
 *
 *     CHAPA - CHAPEADO ............  1 × R$ 1.000,00 = R$  1.000,00
 *     CERA CLEANER WAX ............  3 × R$    50,29 = R$    150,87
 *     CAPACETE C2 ................ 485 × R$    28,38 = R$ 13.764,30
 *     CA. 40186 OCULOS SEG .......   7 × R$     6,89 = R$     48,23
 *     Bota Botina Seguranca ......   2 × R$    54,91 = R$    109,82
 *                                                      ------------
 *                                                      R$ 15.073,22
 *
 * Por isso a carga usa SÓ O ARQUIVO 1, e o arquivo 2 serve de conferência.
 *
 * O QUE ESTA CARGA NÃO COBRE
 * --------------------------
 * O relatório tem 5.653 linhas e os dois arquivos cobrem da 4.001 à 5.653 —
 * a cauda do alfabeto, de "CIMENTO" para baixo. As 4.000 primeiras (D a Z)
 * NÃO chegaram. Então isto é uma carga PARCIAL, e é seguro que seja: a
 * contagem de estoque DEFINE o saldo dos produtos que estão nela e não toca
 * em nenhum outro. Rodar a carga do resto depois não duplica nada.
 *
 * POR QUE CONTAGEM E NÃO `update products set stock_quantity`
 * -----------------------------------------------------------
 * lib/db/contagem-estoque.js diz, no cabeçalho: *"Ao FECHAR, cada item vira um
 * movimento de ajuste — e é o fechamento que faz dela a carga inicial
 * (VM-EST-08)"*. E quem grava saldo é `commitStockMovements`, *"o ponto único
 * por onde TODA movimentação do sistema passa"*.
 *
 * Então o saldo entra como DOCUMENTO: tem código, data, responsável e uma
 * linha no razão por produto. Um UPDATE daria o mesmo número sem nada atrás
 * dele — e o Painel de Estoque, as reservas e o custo médio leem o razão.
 *
 * COMO RODAR
 *     node scripts/importar-saldo-viper.js                        (só confere)
 *     node scripts/importar-saldo-viper.js --deposito="Depósito Matriz" --confirmo
 *
 * Sem `--confirmo` NÃO grava nada: imprime o relatório de conferência e sai.
 */
require('dotenv').config();
const http = require('http');

const PORTA = Number(process.env.PORTA_IMPORT || 3000);
const USUARIO = process.env.IMPORT_USER || 'admin';
const SENHA = process.env.IMPORT_PASS || 'admin123';

// ---------------------------------------------------------------------------
// OS 35 SALDOS DO ARQUIVO 1. Transcritos do PDF; `custo` é o Custo (R$)
// unitário que o Viper imprime, e viaja junto porque o razão tem coluna para
// ele — carga inicial sem custo faz o custo médio nascer zerado.
//
// A SOMA TEM DE DAR 2.164. É a única prova de que a transcrição não perdeu
// linha: qualquer esquecimento quebra o total impresso no relatório.
// ---------------------------------------------------------------------------
const SALDOS = [
  { sku: '100624', nome: 'CHAPA - CHAPEADO', qtd: 1, custo: 1000.00 },
  { sku: '101024', nome: 'CERA CLEANER WAX PASTA 300G C/ APLIC - CADILLAC', qtd: 3, custo: 50.29 },
  { sku: '367', nome: 'CAPACETE C2', qtd: 485, custo: 28.38 },
  { sku: '100768', nome: 'CA. 40186 OCULOS SEG. PROTECTOR INCOLOR', qtd: 7, custo: 6.89 },
  { sku: '101023', nome: 'Bota Botina Seguranca Trabalho Couro Resistente Epi Bico Pvc', qtd: 2, custo: 54.91 },
  { sku: '525', nome: 'AUTOPROPELIDO ZILLA USADO', qtd: 1, custo: 3200.00 },
  { sku: '100643', nome: 'Alicate Bomba D,agua 10 st 70412 Bico Papagaio', qtd: 2, custo: 59.99 },
  { sku: '11922', nome: 'AUTOPROPELIDO X13 PRO 1000W', qtd: 2, custo: 8987.55 },
  { sku: '535', nome: 'AUTOPROPELIDO PATINETE XIAOMI', qtd: 1, custo: 1690.00 },
  { sku: '100932', nome: 'AUTOPROPELIDO MAVIS VELLARYS 1000W | 2027', qtd: 101, custo: 3438.47 },
  { sku: '10128', nome: 'AUTOPROPELIDO MAVIS RUNNER 1000W | 2026', qtd: 135, custo: 2754.96 },
  { sku: '10006', nome: 'AUTOPROPELIDO MAVIS PROTOTIPO CS-04 | 2026', qtd: 1, custo: 4028.26 },
  { sku: '10005', nome: 'AUTOPROPELIDO MAVIS PROTOTIPO CS-03 | 2026', qtd: 1, custo: 3612.42 },
  { sku: '10004', nome: 'AUTOPROPELIDO MAVIS PROTOTIPO CS-02 | 2026', qtd: 1, custo: 2805.18 },
  { sku: '9588', nome: 'AUTOPROPELIDO MAVIS NICKY 1000W | 2026', qtd: 1, custo: 3062.85 },
  { sku: '9739', nome: 'AUTOPROPELIDO MAVIS NEXUS 1000W | 2026', qtd: 165, custo: 2310.09 },
  { sku: '9590', nome: 'AUTOPROPELIDO MAVIS MINI MOTO | 2026 | PROTOTIPO', qtd: 1, custo: 2277.35 },
  { sku: '8758', nome: 'AUTOPROPELIDO MAVIS JIMMY 1000W | 2027', qtd: 55, custo: 3359.38 },
  { sku: '8756', nome: 'AUTOPROPELIDO MAVIS FLOW 800W | 2026', qtd: 1, custo: 2615.68 },
  { sku: '9587', nome: 'AUTOPROPELIDO MAVIS FLIC 650W | 2026 | 02', qtd: 58, custo: 1693.34 },
  { sku: '10072', nome: 'AUTOPROPELIDO MAVIS FLAME 500 15 | 2026', qtd: 2, custo: 1585.50 },
  { sku: '9738', nome: 'AUTOPROPELIDO MAVIS CROSS 1000W | 2026', qtd: 9, custo: 4010.41 },
  { sku: '8757', nome: 'AUTOPROPELIDO MAVIS CONNECT 900W | 2026', qtd: 6, custo: 2342.22 },
  { sku: '8759', nome: 'AUTOPROPELIDO MAVIS AYLA+ 800W | 2026', qtd: 2, custo: 1947.48 },
  { sku: '9589', nome: 'AUTOPROPELIDO MAVIS AYLA 500W | 2026 | 02', qtd: 58, custo: 1435.13 },
  { sku: '7779', nome: 'AUTOPROPELIDO MAVIS AYLA 400 2025', qtd: 43, custo: 1570.28 },
  { sku: '9204', nome: 'AUTOPROPELIDO MAVIS ABACOOK 1000W | 2026', qtd: 10, custo: 3666.10 },
  { sku: '8376', nome: 'AUTOPROPELIDO KACCAU W2 800W', qtd: 1, custo: 5483.57 },
  { sku: '238', nome: 'AUTOPROPELIDO KACCAU W2 1000W', qtd: 3, custo: 3929.26 },
  { sku: '236', nome: 'AUTOPROPELIDO KACCAU V8', qtd: 1, custo: 7323.08 },
  { sku: '324', nome: 'AUTOPROPELIDO KACCAU V40', qtd: 1, custo: 6000.00 },
  { sku: '7929', nome: 'AUTOPROPELIDO KACCAU IRUN', qtd: 2, custo: 6753.27 },
  { sku: '101060', nome: 'ABRACADEIRA PLASTICA COR PRETA, TAMANHO 5MM x 300MM', qtd: 1000, custo: 0.10 },
  { sku: '100659', nome: '84587 FURADEIRA DE BANCADA 220V 500W FBF-16 5/8" FERRARI', qtd: 1, custo: 955.12 },
  { sku: '100627', nome: '1 Kg de Cola quente Martelinho Preta', qtd: 1, custo: 46.80 }
];

// O que o PDF imprime na linha TOTAIS/MÉDIA do arquivo 1 e do arquivo 2.
const DO_RELATORIO = {
  arquivo1: { saldo: 2164, custoTotal: 1729646.02 },
  arquivo2: { saldo: 1666, custoTotal: 1714572.80 },
  // As cinco linhas que só o arquivo 1 tem.
  soNoArquivo1: ['100624', '101024', '367', '100768', '101023']
};

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};
const brl = (v) => `R$ ${Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const centavos = (v) => Math.round(Number(v || 0) * 100) / 100;

function req(method, caminho, body, token) {
  return new Promise((ok, bad) => {
    const d = body ? JSON.stringify(body) : null;
    const r = http.request({
      host: '127.0.0.1', port: PORTA, path: caminho, method,
      headers: Object.assign({ 'content-type': 'application/json' },
        d ? { 'content-length': Buffer.byteLength(d) } : {},
        token ? { 'x-auth-token': token } : {})
    }, (res) => { let s = ''; res.on('data', (c) => { s += c; }); res.on('end', () => ok({ status: res.statusCode, body: s })); });
    r.on('error', bad);
    if (d) r.write(d);
    r.end();
  });
}

(async () => {
  const argumentos = process.argv.slice(2);
  const confirmo = argumentos.includes('--confirmo');
  const arg = argumentos.find((a) => a.startsWith('--deposito='));
  const nomeDeposito = arg ? arg.replace('--deposito=', '').replace(/^["']|["']$/g, '') : '';

  console.log('--- 1. a transcrição fecha com o relatório ---');
  const soma = SALDOS.reduce((t, l) => t + l.qtd, 0);
  check('a soma das quantidades é a do TOTAIS do arquivo 1',
    soma === DO_RELATORIO.arquivo1.saldo, `${soma} vs ${DO_RELATORIO.arquivo1.saldo}`);
  const custoTranscrito = centavos(SALDOS.reduce((t, l) => t + l.qtd * l.custo, 0));
  console.log(`      custo total transcrito: ${brl(custoTranscrito)}`);
  console.log(`      custo total do arquivo 1: ${brl(DO_RELATORIO.arquivo1.custoTotal)}`);
  console.log('      (o do PDF inclui as 965 linhas de saldo zero, que não entram aqui)');

  // A PROVA DA SOBREPOSIÇÃO. Se as cinco linhas exclusivas do arquivo 1 não
  // somarem a diferença entre os dois TOTAIS, a leitura dos PDFs está errada
  // e somar os dois arquivos duplicaria estoque.
  const exclusivas = SALDOS.filter((l) => DO_RELATORIO.soNoArquivo1.includes(l.sku));
  const saldoExclusivo = exclusivas.reduce((t, l) => t + l.qtd, 0);
  const custoExclusivo = centavos(exclusivas.reduce((t, l) => t + l.qtd * l.custo, 0));
  const difSaldo = DO_RELATORIO.arquivo1.saldo - DO_RELATORIO.arquivo2.saldo;
  const difCusto = centavos(DO_RELATORIO.arquivo1.custoTotal - DO_RELATORIO.arquivo2.custoTotal);
  check('as 5 linhas exclusivas do arquivo 1 explicam a diferença de saldo',
    saldoExclusivo === difSaldo, `${saldoExclusivo} vs ${difSaldo}`);
  check('  e a diferença de custo, no centavo',
    custoExclusivo === difCusto, `${brl(custoExclusivo)} vs ${brl(difCusto)}`);
  check('  logo o arquivo 2 é subconjunto do 1, e não se soma', saldoExclusivo === difSaldo && custoExclusivo === difCusto);

  const skus = SALDOS.map((l) => l.sku);
  const repetidos = skus.filter((s, i) => skus.indexOf(s) !== i);
  check('nenhum código repetido na carga', repetidos.length === 0, repetidos.join(', ') || `${skus.length} códigos`);
  check('nenhuma quantidade negativa ou não numérica',
    SALDOS.every((l) => Number.isFinite(l.qtd) && l.qtd > 0));

  console.log('\n--- 2. os códigos existem no cadastro ---');
  const login = await req('POST', '/api/login', { username: USUARIO, password: SENHA });
  if (login.status !== 200) {
    console.error(`  XX  login respondeu ${login.status} — o servidor está de pé na porta ${PORTA}?`);
    process.exit(1);
  }
  const token = JSON.parse(login.body).token;
  const meta = JSON.parse((await req('GET', '/api/sales/meta', null, token)).body);
  const porSku = new Map((meta.products || []).map((p) => [String(p.sku), p]));

  const achados = [];
  const ausentes = [];
  const nomeDiverge = [];
  for (const linha of SALDOS) {
    const produto = porSku.get(linha.sku);
    if (!produto) { ausentes.push(`${linha.sku} (${linha.nome})`); continue; }
    achados.push({ ...linha, produto });
    // O nome é conferência, nunca decisão: o Viper abrevia e o MavisONE não.
    const a = String(linha.nome).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
    const b = String(produto.name).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
    if (a !== b) nomeDiverge.push(`${linha.sku}: "${linha.nome}" vs "${produto.name}"`);
  }
  // AUSENTE NÃO É FALHA, É PENDÊNCIA DE CADASTRO. Recusar a carga inteira
  // porque três produtos não existem deixaria de fora também as 1.159
  // unidades que casaram — e a contagem é item por item, então o que casou
  // pode entrar hoje e o resto quando o produto for cadastrado.
  console.log((ausentes.length ? '  -- ' : '  OK ')
    + 'todo código da carga existe em products.sku -> '
    + (ausentes.length ? `${ausentes.length} fora: ${ausentes.join(' | ')}` : `${achados.length} de ${SALDOS.length}`));
  if (nomeDiverge.length) {
    console.log(`      ${nomeDiverge.length} nome(s) escrito(s) diferente nos dois sistemas (conferir, não impede):`);
    nomeDiverge.slice(0, 6).forEach((d) => console.log('        ' + d));
  }

  console.log('\n--- 3. o depósito ---');
  const depositos = (meta.deposits || []).filter((d) => d.status !== 'inativo');
  console.log('      depósitos cadastrados: ' + depositos.map((d) => d.name).join(' | '));
  const deposito = depositos.find((d) => d.name === nomeDeposito);
  if (!nomeDeposito) {
    console.log('\n      Nenhum depósito informado. Use --deposito="<nome exato>".');
  } else {
    check(`"${nomeDeposito}" existe`, Boolean(deposito));
  }

  console.log('\n--- 4. o que a carga vai fazer ---');
  // DOIS TOTAIS, E NÃO UM. A primeira versão imprimia "32 produtos, 2164
  // unidades" — o número transcrito ao lado da contagem de produtos que
  // sobraram, como se as 2.164 fossem entrar. Não são: o que não casou com o
  // cadastro não entra, e some da conta sem aparecer em lugar nenhum.
  const carregavel = achados.reduce((t, l) => t + l.qtd, 0);
  const foraQtd = soma - carregavel;
  const valorCusto = centavos(achados.reduce((t, l) => t + l.qtd * l.custo, 0));
  const foraCusto = centavos(DO_RELATORIO.arquivo1.custoTotal - valorCusto);
  console.log(`      vai entrar ...: ${achados.length} produtos, ${carregavel} unidades, ${brl(valorCusto)} de custo`);
  if (foraQtd > 0) {
    console.log(`      FICA DE FORA .: ${SALDOS.length - achados.length} produtos, ${foraQtd} unidades, ${brl(foraCusto)} de custo`);
    for (const linha of SALDOS.filter((l) => !porSku.get(l.sku))) {
      console.log(`        ${String(linha.qtd).padStart(5)} × ${linha.sku.padEnd(8)} ${linha.nome.slice(0, 52)}`);
    }
    console.log('      Estes três não existem em `products`. Cadastre-os e rode de novo:');
    console.log('      a contagem DEFINE o saldo dos produtos que estão nela, então rodar');
    console.log('      duas vezes não duplica o que já entrou.');
  }
  console.log('      as dez maiores quantidades:');
  [...achados].sort((a, b) => b.qtd - a.qtd).slice(0, 10)
    .forEach((l) => console.log(`        ${String(l.qtd).padStart(5)} × ${l.sku.padEnd(8)} ${String(l.produto.name).slice(0, 52)}`));

  if (!confirmo) {
    console.log(`\n===== ${falhas === 0 ? 'CONFERÊNCIA OK — nada foi gravado' : falhas + ' FALHA(S) — nada foi gravado'} =====`);
    console.log('Para gravar:  node scripts/importar-saldo-viper.js --deposito="<nome>" --confirmo');
    process.exit(falhas ? 1 : 0);
  }

  if (falhas) {
    console.error('\n  XX  há pendência na conferência. Nada foi gravado.');
    process.exit(1);
  }
  if (!deposito) {
    console.error('\n  XX  informe um depósito válido com --deposito="<nome exato>". Nada foi gravado.');
    process.exit(1);
  }

  console.log('\n--- 5. gravando: contagem de estoque ---');
  const criada = await req('POST', '/api/stock/counts', {
    depositId: deposito.id,
    note: 'Carga inicial — relatório de Estoque do ViperERP de 30/09/2026, depósito LOJA CENTRO '
      + '(arquivo Estoque_de_4001_ate_5000.pdf; o de 5001 a 5653 é subconjunto dele). '
      + 'Cobre da linha 4.001 à 5.653 do relatório; as 4.000 primeiras não entraram.'
  }, token);
  if (criada.status !== 200) {
    console.error(`  XX  não abriu a contagem (${criada.status}): ${criada.body.slice(0, 300)}`);
    process.exit(1);
  }
  const contagem = JSON.parse(criada.body).count;
  console.log(`      contagem ${contagem.code} aberta em ${deposito.name}`);

  let gravados = 0;
  const recusados = [];
  for (const linha of achados) {
    const r = await req('POST', `/api/stock/counts/${encodeURIComponent(contagem.id)}/items`, {
      productId: linha.produto.id,
      countedQuantity: linha.qtd,
      note: `Viper ${linha.sku} — custo ${brl(linha.custo)}`
    }, token);
    if (r.status !== 200) { recusados.push(`${linha.sku}: ${r.body.slice(0, 120)}`); continue; }
    gravados += 1;
  }
  console.log(`      ${gravados} de ${achados.length} itens gravados na folha`);
  if (recusados.length) {
    console.log('      RECUSADOS (a contagem fica ABERTA, sem aplicar nada):');
    recusados.forEach((d) => console.log('        ' + d));
    console.error('\n  XX  não vou fechar uma folha incompleta. Corrija e feche pela tela.');
    process.exit(1);
  }

  const fechada = await req('POST', `/api/stock/counts/${encodeURIComponent(contagem.id)}/close`, {}, token);
  if (fechada.status !== 200) {
    console.error(`  XX  não fechou (${fechada.status}): ${fechada.body.slice(0, 300)}`);
    console.error('      A folha está ABERTA com os itens dentro; feche pela tela quando resolver.');
    process.exit(1);
  }
  console.log(`      contagem ${contagem.code} FECHADA — o ajuste virou movimento no razão`);

  console.log('\n--- 6. conferindo o saldo que ficou ---');
  const depoisMeta = JSON.parse((await req('GET', '/api/sales/meta', null, token)).body);
  const saldos = depoisMeta.saldosPorDeposito || {};
  let confere = 0;
  const divergentes = [];
  for (const linha of achados) {
    // A CHAVE TEM PIPE NO FIM: `${productId}|${depositId}|` (server.js:8851).
    // O terceiro pedaço é a cor, e fica vazio quando o produto não tem classe.
    // Sem o pipe final a leitura devolve `undefined` para TODOS, e a
    // conferência acusou "está 0" numa carga que tinha entrado certo — 32
    // movimentos e 1.159 unidades no razão, medidos depois direto no banco.
    const chave = `${linha.produto.id}|${deposito.id}|`;
    const atual = Number(saldos[chave] || 0);
    if (atual === linha.qtd) confere += 1;
    else divergentes.push(`${linha.sku}: esperado ${linha.qtd}, está ${atual}`);
  }
  check('o saldo por depósito bate com a carga', divergentes.length === 0,
    divergentes.slice(0, 5).join(' | ') || `${confere} de ${achados.length}`);

  console.log(`\n===== ${falhas === 0 ? 'SALDO CARREGADO' : falhas + ' FALHA(S)'} =====`);
  process.exit(falhas ? 1 : 0);
})();
