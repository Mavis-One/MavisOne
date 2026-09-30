#!/usr/bin/env node
/**
 * A CARGA DO ESTOQUE INTEIRO, LIDA DOS SEIS PDFs DO VIPERERP.
 *
 * O QUE ISTO SUBSTITUI. scripts/importar-saldo-viper.js trazia 35 linhas
 * TRANSCRITAS À MÃO, porque os PDFs não estavam em disco. Elas se provavam pelo
 * TOTAIS impresso, mas cobriam 1.653 das 5.653 linhas — a cauda do alfabeto.
 * Os seis arquivos chegaram; este script LÊ as 5.653 e não transcreve nada.
 * Aquele continua no repositório como o registro do que foi carregado antes.
 *
 * O QUE ELE FAZ, NESTA ORDEM, E POR QUE A ORDEM NÃO PODE MUDAR
 * -----------------------------------------------------------
 *   1. cadastra os produtos que têm saldo e não existem aqui
 *   2. grava custo e preço de venda
 *   3. abre uma contagem, lança o saldo e fecha
 *
 * A ORDEM É O PONTO. `commitStockMovements` grava no razão o `unit_cost` que o
 * CADASTRO tinha NA HORA do movimento. A carga anterior entrou avaliada pelo
 * custo velho do MavisONE: R$ 1.494.117,47 em vez dos R$ 1.729.285,33 do
 * relatório, R$ 235.167,86 a menos. Corrigir o custo DEPOIS não conserta —
 * os movimentos já lançados guardam o custo antigo. Por isso preço vem antes
 * de saldo, sempre.
 *
 * E A CONTAGEM PODE SER REPETIDA: ela DEFINE o saldo dos produtos que estão
 * nela e não toca em nenhum outro (lib/db/contagem-estoque.js). Rodar de novo
 * não duplica — é assim que a carga anterior se corrige.
 *
 * O QUE ELE NÃO FAZ, E POR QUÊ
 * ----------------------------
 * a) NÃO CADASTRA os 170 produtos que estão no relatório sem saldo e não
 *    existem aqui. Isso é importação de catálogo, não carga de estoque, e o
 *    relatório de estoque não traz NCM nem unidade — produto sem NCM não entra
 *    em NF-e. Os 6 que TÊM saldo são cadastrados porque a alternativa é deixar
 *    1.017 unidades fora, e eles saem marcados como pendência fiscal.
 *
 * b) NÃO GRAVA os dois saldos NEGATIVOS do relatório (−3 numa mesa, −5 num
 *    notebook). A contagem recusa quantidade negativa (server.js:14089) e está
 *    certa: contagem física não é negativa. Lançar zero no lugar seria inventar
 *    uma contagem que ninguém fez. Saldo negativo no Viper significa que ele
 *    deu saída de mais do que tinha — é erro de lá, e quem decide é quem
 *    conhece a operação.
 *
 * c) NÃO GRAVA PREÇO DE VENDA quando o Viper traz venda IGUAL ao custo,
 *    centavo por centavo. Isso acontece em 3.741 das 5.647 linhas -- DOIS
 *    TERÇOS do catálogo. Ali o "Valor Venda" não é preço: é campo não
 *    preenchido espelhando o custo. Nas outras 1.906 ele difere de verdade
 *    (1.897 acima do custo, 9 abaixo) e entra.
 *
 *    Gravar o espelho poria dois terços do catálogo à venda com margem zero e
 *    com cara de normalidade. Produto a R$ 0,00 é um defeito que alguém vê;
 *    produto vendido pelo próprio custo é prejuízo que ninguém vê. Os 3.068
 *    produtos que ficam em R$ 0,00 saem declarados como pendência: não existe
 *    preço para eles em nenhum dos dois sistemas.
 *
 * COMO RODAR
 * ----------
 *   node scripts/importar-estoque-viper.js
 *       só confere e não grava nada
 *
 *   node scripts/importar-estoque-viper.js --deposito="Depósito Matriz" --confirmo
 *       grava
 *
 *   --pdfs="<pasta>"   onde estão os Estoque_de_*.pdf (padrão: ~/Downloads)
 *
 * Precisa do servidor de pé (a carga passa pelas rotas, não pelo SQL) e do
 * `pdftotext` no PATH. Os PDFs NÃO entram no repositório: são o custo e o preço
 * de 5.478 produtos.
 */

require('dotenv').config();
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const viper = require('../lib/relatorio-viper');

const PORTA = Number(process.env.PORTA_IMPORT || 3000);
const USUARIO = process.env.IMPORT_USER || 'admin';
const SENHA = process.env.IMPORT_PASS || 'admin123';

// As seis vias do relatório, geradas em 30/09/2026 16:48 com o filtro
// "Depósito(s): LOJA CENTRO". NÃO são faixas disjuntas: cada arquivo traz ~2.000
// linhas a partir da linha pedida, então `1_ate_1000` e `1001_ate_2000`
// compartilham 999 códigos. `viper.unir` junta por código.
const VIAS = [
  'Estoque_de_1_ate_1000.pdf',
  'Estoque_de_1001_ate_2000.pdf',
  'Estoque_de_2001_ate_3000.pdf',
  'Estoque_de_3001_ate_4000.pdf',
  'Estoque_de_4001_ate_5000.pdf',
  'Estoque_de_5001_ate_5653.pdf',
];

// O relatório imprime 5.653 linhas. Delas, 6 têm a coluna Código ilegível (3
// sem código nenhum e 3 com o código da linha anterior repetido) — todas na
// primeira via e todas com saldo ZERO. 5.647 + 3 + 3 = 5.653, e a conta fecha.
const LINHAS_DO_RELATORIO = 5653;
const CODIGOS_LEGIVEIS = 5647;

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas += 1;
};
const brl = (v) => `R$ ${Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const centavos = (v) => Math.round(Number(v || 0) * 100) / 100;
const iguais = (a, b) => Math.round(Number(a || 0) * 100) === Math.round(Number(b || 0) * 100);

function req(method, caminho, body, token) {
  return new Promise((ok, bad) => {
    const d = body ? JSON.stringify(body) : null;
    const r = http.request({
      host: '127.0.0.1', port: PORTA, path: caminho, method,
      headers: Object.assign({ 'content-type': 'application/json' },
        d ? { 'content-length': Buffer.byteLength(d) } : {},
        token ? { 'x-auth-token': token } : {}),
    }, (res) => { let s = ''; res.on('data', (c) => { s += c; }); res.on('end', () => ok({ status: res.statusCode, body: s })); });
    r.on('error', bad);
    if (d) r.write(d);
    r.end();
  });
}

function lerVias(pasta, destino) {
  const lidas = [];
  for (const arquivo of VIAS) {
    const pdf = path.join(pasta, arquivo);
    if (!fs.existsSync(pdf)) {
      console.error(`  XX  não achei ${pdf}`);
      console.error('      passe a pasta com --pdfs="<caminho>"');
      process.exit(1);
    }
    const txt = path.join(destino, `${arquivo.replace(/\.pdf$/i, '')}.txt`);
    // `-table` e não `-layout`: no `-layout` a coluna Código corre mais rápido
    // que a coluna Produto e as linhas saem pareadas erradas. Ver o cabeçalho
    // de lib/relatorio-viper.js — a escolha tem três provas atrás dela.
    execFileSync('pdftotext', ['-table', '-enc', 'UTF-8', '-nopgbrk', pdf, txt], { stdio: 'pipe' });
    lidas.push(viper.parseRelatorio(fs.readFileSync(txt, 'utf8'), arquivo));
  }
  return lidas;
}

(async () => {
  const argumentos = process.argv.slice(2);
  const confirmo = argumentos.includes('--confirmo');
  const valor = (nome) => {
    const a = argumentos.find((x) => x.startsWith(`--${nome}=`));
    return a ? a.replace(`--${nome}=`, '').replace(/^["']|["']$/g, '') : '';
  };
  const nomeDeposito = valor('deposito');
  const pasta = valor('pdfs') || path.join(os.homedir(), 'Downloads');
  const temporario = fs.mkdtempSync(path.join(os.tmpdir(), 'viper-'));

  console.log('--- 1. lendo as seis vias do relatório ---');
  console.log(`      pasta: ${pasta}`);
  const vias = lerVias(pasta, temporario);

  // AS TRÊS PROVAS. Se qualquer uma cair, a leitura não serve e nada é gravado.
  let linhasLidas = 0;
  for (let i = 0; i < vias.length; i += 1) {
    const r = vias[i];
    const totais = viper.conferirTotais(r);
    const aritmetica = viper.conferirAritmetica(r.linhas.concat(r.semCodigo));
    const codigos = viper.conferirCodigos(r);
    linhasLidas += r.linhas.length + r.semCodigo.length;
    const nome = VIAS[i].replace('Estoque_de_', '').replace('.pdf', '');
    check(`${nome.padEnd(14)} TOTAIS bate`, totais.ok, totais.ok ? undefined : JSON.stringify(totais.diferencas || totais.motivo));
    check(`${nome.padEnd(14)} saldo × custo = custo total`, aritmetica.ok, aritmetica.ok ? `${aritmetica.conferidas} linhas` : JSON.stringify(aritmetica.quebras.slice(0, 3)));
    check(`${nome.padEnd(14)} nenhum código duvidoso com saldo`, codigos.ok,
      codigos.ok ? `${codigos.duvidosas} duvidosa(s), todas em zero` : JSON.stringify(codigos.duvidosasComSaldo.map((l) => l.codigo)));
  }
  check('as seis vias somam as 5.653 linhas do relatório + as repetidas',
    linhasLidas === 10306, linhasLidas);

  const { linhas, conflitos } = viper.unir(vias);
  check(`códigos legíveis distintos = ${CODIGOS_LEGIVEIS}`, linhas.length === CODIGOS_LEGIVEIS, linhas.length);
  const conflitoComSaldo = conflitos.filter((c) => {
    const l = linhas.find((x) => x.codigo === c.codigo);
    return l && l.saldo !== 0;
  });
  check('nenhum conflito de valor entre vias em produto COM saldo',
    conflitoComSaldo.length === 0, conflitos.length ? `${conflitos.length} conflito(s), nenhum com saldo` : 'nenhum conflito');
  console.log(`      ${CODIGOS_LEGIVEIS} códigos + 3 linhas sem código + 3 com código repetido = ${LINHAS_DO_RELATORIO} linhas`);

  if (falhas) {
    console.error('\n  XX  a leitura não passou nas provas. NADA foi gravado.');
    process.exit(1);
  }

  console.log('\n--- 2. o que o relatório diz de saldo ---');
  const comSaldo = linhas.filter((l) => l.saldo !== 0);
  const negativos = comSaldo.filter((l) => l.saldo < 0);
  const positivos = comSaldo.filter((l) => l.saldo > 0);
  console.log(`      produtos com saldo .....: ${comSaldo.length}`);
  console.log(`      dos quais NEGATIVOS ....: ${negativos.length} (não entram — ver (b) no cabeçalho)`);
  console.log(`      a carregar .............: ${positivos.length} produtos, ${centavos(positivos.reduce((s, l) => s + l.saldo, 0))} unidades, ${brl(positivos.reduce((s, l) => s + l.custoTotal, 0))}`);
  for (const l of negativos) {
    console.log(`         FORA  ${l.codigo.padEnd(8)} ${String(l.saldo).padStart(5)} un  ${l.nomeCompleto.slice(0, 46)}`);
  }

  console.log('\n--- 3. conferindo com o cadastro ---');
  const login = await req('POST', '/api/login', { username: USUARIO, password: SENHA });
  if (login.status !== 200) {
    console.error(`  XX  login respondeu ${login.status} — o servidor está de pé na porta ${PORTA}?`);
    process.exit(1);
  }
  const token = JSON.parse(login.body).token;
  const meta = JSON.parse((await req('GET', '/api/sales/meta', null, token)).body);
  const produtos = meta.products || [];
  const porSku = new Map(produtos.map((p) => [String(p.sku || '').trim(), p]));
  console.log(`      produtos no cadastro: ${produtos.length}`);

  const aCadastrar = positivos.filter((l) => !porSku.has(l.codigo));
  const noCadastro = linhas.filter((l) => porSku.has(l.codigo));
  const ausentesSemSaldo = linhas.filter((l) => !porSku.has(l.codigo) && l.saldo === 0);
  console.log(`      códigos do relatório que existem aqui: ${noCadastro.length}`);
  console.log(`      não existem e têm saldo ..: ${aCadastrar.length}  -> serão cadastrados`);
  console.log(`      não existem e estão em zero: ${ausentesSemSaldo.length}  -> ficam de fora (ver (a))`);
  for (const l of aCadastrar) {
    console.log(`         NOVO  ${l.codigo.padEnd(8)} ${String(l.saldo).padStart(6)} un  ${brl(l.custo).padStart(12)}  ${l.nomeCompleto.slice(0, 44)}`);
  }

  console.log('\n--- 4. preço: o que muda e o que fica ---');
  const custoMuda = [];
  const vendaMuda = [];
  const espelhaOCusto = [];
  for (const l of noCadastro) {
    const p = porSku.get(l.codigo);
    if (!iguais(p.costPrice, l.custo)) custoMuda.push({ l, p });
    // (c) A COLUNA "VALOR VENDA" DO VIPER NÃO É PREÇO EM DOIS TERÇOS DO
    // CATÁLOGO. Em 3.741 das 5.647 linhas ela é IDÊNTICA ao Custo, centavo por
    // centavo — é campo não preenchido espelhando o custo, não decisão de
    // preço. Nas outras 1.906 ela difere (1.897 acima do custo e 9 abaixo), e
    // aí é preço de verdade.
    //
    // Gravar o espelho como preço poria metade do catálogo à venda com margem
    // zero, e com a aparência de estar tudo certo. Produto a R$ 0,00 é um
    // defeito que alguém vê; produto vendido pelo custo é um prejuízo que
    // ninguém vê. Então o espelho não entra — nem sobre um preço que existe
    // aqui, nem sobre o zero.
    if (iguais(l.venda, l.custo)) { espelhaOCusto.push({ l, p }); continue; }
    if (iguais(p.salePrice, l.venda)) continue;
    vendaMuda.push({ l, p });
  }
  const maisBarato = custoMuda.filter(({ l, p }) => l.custo > Number(p.costPrice));
  const deZero = vendaMuda.filter(({ p }) => Number(p.salePrice) === 0);
  const abaixoDoCusto = vendaMuda.filter(({ l }) => l.venda < l.custo - 0.005);
  const espelhoSobreZero = espelhaOCusto.filter(({ p }) => Number(p.salePrice) === 0);
  console.log(`      CUSTO muda em ...........: ${custoMuda.length} de ${noCadastro.length}`);
  console.log(`         o cadastro estava mais BARATO em ${maisBarato.length}, mais caro em ${custoMuda.length - maisBarato.length}`);
  console.log(`      VENDA muda em ...........: ${vendaMuda.length}  (só onde o Viper tem preço de verdade)`);
  console.log(`         saindo de R$ 0,00 (podiam ser vendidos de graça): ${deZero.length}`);
  console.log(`         com preço ABAIXO do custo, que entram como estão: ${abaixoDoCusto.length}`);
  console.log(`      VENDA não escrita .......: ${espelhaOCusto.length}  (o Viper espelha o custo — ver (c))`);
  console.log(`         destes, ${espelhoSobreZero.length} continuam em R$ 0,00 AQUI: não há preço em lugar nenhum.`);
  console.log('         PENDÊNCIA: esses produtos entram num pedido por R$ 0,00 e nada reclama.');
  for (const { l } of abaixoDoCusto) {
    console.log(`         abaixo do custo  ${l.codigo.padEnd(8)} custo ${brl(l.custo).padStart(12)}  venda ${brl(l.venda).padStart(12)}  ${l.nomeCompleto.slice(0, 34)}`);
  }

  const custoAntes = centavos(positivos.reduce((s, l) => {
    const p = porSku.get(l.codigo);
    return s + l.saldo * Number(p ? p.costPrice : 0);
  }, 0));
  const custoDepois = centavos(positivos.reduce((s, l) => s + l.saldo * l.custo, 0));
  console.log('');
  console.log(`      a carga avaliada pelo custo de HOJE ....: ${brl(custoAntes)}`);
  console.log(`      a carga avaliada pelo custo do Viper ...: ${brl(custoDepois)}`);
  console.log(`      diferença que a ordem preço→saldo salva : ${brl(custoDepois - custoAntes)}`);

  console.log('\n--- 5. saldo que existe aqui e o relatório não explica ---');
  // Produto com saldo neste sistema que o relatório não menciona, ou menciona
  // em zero. Ele entra na contagem COM ZERO: sem isso o número fica de pé sem
  // nada atrás, e o Painel de Estoque (que lê o razão) e a lista de produtos
  // (que lê a coluna) seguem discordando para sempre.
  const porCodigo = new Map(linhas.map((l) => [l.codigo, l]));
  const aZerar = produtos.filter((p) => {
    if (Number(p.stockQuantity || 0) === 0) return false;
    const l = porCodigo.get(String(p.sku || '').trim());
    return !l || l.saldo <= 0;
  });
  console.log(`      produtos a zerar: ${aZerar.length}`);
  for (const p of aZerar) {
    const l = porCodigo.get(String(p.sku || '').trim());
    console.log(`         ZERA  ${String(p.sku).padEnd(10)} ${String(Number(p.stockQuantity)).padStart(6)} un  ${String(p.name).slice(0, 34)}  (${l ? 'relatório diz ' + l.saldo : 'fora do relatório'})`);
  }

  console.log('\n--- 6. a contagem que será lançada ---');
  const itensDaContagem = positivos.map((l) => ({ codigo: l.codigo, contado: l.saldo, nome: l.nomeCompleto }))
    .concat(aZerar.map((p) => ({ codigo: String(p.sku || '').trim(), contado: 0, nome: p.name })));
  const novosSemPreco = aCadastrar.filter((l) => iguais(l.venda, l.custo));
  if (novosSemPreco.length) {
    console.log(`      dos ${aCadastrar.length} novos, ${novosSemPreco.length} nascem SEM preço de venda`);
    console.log('      (o Viper espelha o custo neles, e espelho não é preço — ver (c)):');
    for (const l of novosSemPreco) console.log(`         ${l.codigo.padEnd(8)} custo ${brl(l.custo).padStart(12)}  ${l.nomeCompleto.slice(0, 40)}`);
  }
  console.log(`      itens: ${itensDaContagem.length} (${positivos.length} com saldo + ${aZerar.length} zerados)`);

  if (!confirmo) {
    console.log('\n======================================================================');
    console.log('  CONFERÊNCIA — nada foi gravado.');
    console.log('  Para gravar:');
    console.log('    node scripts/importar-estoque-viper.js --deposito="Depósito Matriz" --confirmo');
    console.log('======================================================================');
    fs.rmSync(temporario, { recursive: true, force: true });
    process.exit(0);
  }

  if (!nomeDeposito) {
    console.error('\n  XX  --confirmo sem --deposito="<nome>". Não adivinho depósito:');
    console.error('      o filtro do relatório diz "LOJA CENTRO", que não é nome de');
    console.error('      depósito deste sistema, e saldo no depósito errado é pior que');
    console.error('      saldo nenhum.');
    process.exit(1);
  }
  const depositos = JSON.parse((await req('GET', '/api/stock/deposits', null, token)).body).deposits || [];
  const deposito = depositos.find((d) => String(d.name).trim().toLowerCase() === nomeDeposito.trim().toLowerCase());
  if (!deposito) {
    console.error(`\n  XX  não achei o depósito "${nomeDeposito}". Existem:`);
    for (const d of depositos) console.error(`      - ${d.name}`);
    process.exit(1);
  }

  console.log(`\n--- 7. GRAVANDO em ${deposito.name} ---`);

  // PASSO 1 — cadastrar. `stockQuantity: 0` de propósito: saldo entra pela
  // contagem, que passa por `commitStockMovements`. Mandar a quantidade aqui
  // gravaria a coluna sem uma linha no razão — exatamente o órfão que o passo 5
  // está consertando.
  console.log(`  cadastrando ${aCadastrar.length} produto(s)...`);
  const criados = new Map();
  for (const l of aCadastrar) {
    const r = await req('POST', '/api/stock', {
      // `nomeCompleto` cola o fragmento que o PDF deixou na linha seguinte.
      // Sem ele o 101060 entraria como "ABRACADEIRA PLASTICA COR PRETA,
      // TAMANHO" -- e o cadastro JÁ TEM a de 5MM x 400MM e a de 3,6MM x 300MM.
      // O que distingue os três é exatamente o pedaço que ficou na outra linha.
      name: l.nomeCompleto, sku: l.codigo, stockQuantity: 0,
      // Preço só quando o Viper tem preço: se "Valor Venda" espelha o custo,
      // o produto nasce sem preço — que é a verdade sobre ele — e sai listado.
      costPrice: l.custo, salePrice: iguais(l.venda, l.custo) ? 0 : l.venda,
    }, token);
    if (r.status !== 200) {
      console.error(`    XX  ${l.codigo}: ${r.status} ${r.body.slice(0, 160)}`);
      falhas += 1;
      continue;
    }
    criados.set(l.codigo, JSON.parse(r.body).product);
  }
  console.log(`    ${criados.size} de ${aCadastrar.length} cadastrados`);
  if (falhas) {
    console.error('  XX  cadastro incompleto. Não sigo para o saldo.');
    process.exit(1);
  }

  // PASSO 2 — preço, ANTES do saldo. Em lotes: a rota recarrega o contexto de
  // estoque inteiro a cada chamada.
  //
  // UM PRODUTO, UMA ATUALIZAÇÃO. A rota grava a linha inteira do produto, então
  // mandar o mesmo produto duas vezes (uma pelo custo, outra pelo preço) faria a
  // segunda sobrescrever a primeira com o valor que estava ANTES. Custo e venda
  // entram juntos, e quem não muda vai com o valor atual.
  const porProduto = new Map();
  for (const { l, p } of custoMuda) porProduto.set(p.id, { productId: p.id, costPrice: l.custo, salePrice: Number(p.salePrice) });
  for (const { l, p } of vendaMuda) {
    const antes = porProduto.get(p.id);
    if (antes) antes.salePrice = l.venda;
    else porProduto.set(p.id, { productId: p.id, costPrice: Number(p.costPrice), salePrice: l.venda });
  }
  const lote = [...porProduto.values()];
  console.log(`  gravando preço de ${lote.length} produto(s) ANTES do saldo...`);
  const TAMANHO = 200;
  let gravados = 0;
  for (let i = 0; i < lote.length; i += TAMANHO) {
    const pedaco = lote.slice(i, i + TAMANHO);
    const r = await req('POST', '/api/stock/price-manager', { updates: pedaco }, token);
    if (r.status !== 200) {
      console.error(`    XX  lote ${i}: ${r.status} ${r.body.slice(0, 200)}`);
      falhas += 1;
      break;
    }
    gravados += pedaco.length;
    if (i % (TAMANHO * 5) === 0) console.log(`    ${gravados}/${lote.length}`);
  }
  console.log(`    ${gravados} de ${lote.length} com preço gravado`);
  if (falhas) {
    console.error('  XX  preço incompleto. NÃO lanço saldo: o razão gravaria o custo errado.');
    process.exit(1);
  }
  console.log(`    (${custoMuda.length} com custo a mudar e ${vendaMuda.length} com venda; ${lote.length} produtos distintos)`);

  // PASSO 3 — a contagem.
  const metaDepois = JSON.parse((await req('GET', '/api/sales/meta', null, token)).body);
  const skuParaId = new Map((metaDepois.products || []).map((p) => [String(p.sku || '').trim(), p.id]));

  const criada = await req('POST', '/api/stock/counts', {
    depositId: deposito.id,
    note: `Carga do estoque a partir do relatório do ViperERP de 30/09/2026 16:48 `
      + `(filtro "LOJA CENTRO", 6 vias, ${LINHAS_DO_RELATORIO} linhas lidas). `
      + `${positivos.length} produtos com saldo e ${aZerar.length} zerados. `
      + `Fora: ${negativos.length} de saldo negativo, que a contagem não aceita.`,
  }, token);
  if (criada.status !== 200) {
    console.error(`  XX  não abriu a contagem (${criada.status}): ${criada.body.slice(0, 300)}`);
    process.exit(1);
  }
  const contagem = JSON.parse(criada.body).count;
  console.log(`  contagem ${contagem.code} aberta`);

  const recusados = [];
  let lancados = 0;
  for (const item of itensDaContagem) {
    const productId = skuParaId.get(item.codigo);
    if (!productId) { recusados.push(`${item.codigo}: não achei o produto depois de cadastrar`); continue; }
    const r = await req('POST', `/api/stock/counts/${encodeURIComponent(contagem.id)}/items`, {
      productId, countedQuantity: item.contado, note: `Relatório Viper 30/09/2026`,
    }, token);
    if (r.status !== 200) { recusados.push(`${item.codigo}: ${r.status} ${r.body.slice(0, 120)}`); continue; }
    lancados += 1;
  }
  console.log(`  ${lancados} de ${itensDaContagem.length} itens lançados`);
  if (recusados.length) {
    console.log('    RECUSADOS (a contagem fica ABERTA, sem aplicar nada):');
    for (const r of recusados) console.log(`      ${r}`);
    console.error('\n  XX  não fecho folha incompleta. Corrija e feche pela tela.');
    process.exit(1);
  }

  const fechada = await req('POST', `/api/stock/counts/${encodeURIComponent(contagem.id)}/close`, {}, token);
  if (fechada.status !== 200) {
    console.error(`  XX  não fechou (${fechada.status}): ${fechada.body.slice(0, 300)}`);
    process.exit(1);
  }
  console.log(`  contagem ${contagem.code} FECHADA — cada item virou movimento no razão`);

  // PASSO 4 — conferir o que ficou gravado, pela rota que a tela de venda usa.
  console.log('\n--- 8. conferindo o que ficou ---');
  const metaFinal = JSON.parse((await req('GET', '/api/sales/meta', null, token)).body);
  const saldos = metaFinal.saldosPorDeposito || {};
  let conferem = 0;
  const divergem = [];
  for (const l of positivos) {
    const id = skuParaId.get(l.codigo);
    // A CHAVE TEM PIPE NO FIM: `${productId}|${depositId}|` (server.js:8851).
    // O terceiro pedaço é a cor. Sem o pipe final toda leitura devolve undefined.
    const lido = Number(saldos[`${id}|${deposito.id}|`] || 0);
    if (Math.abs(lido - l.saldo) < 0.005) conferem += 1;
    else divergem.push(`${l.codigo}: esperado ${l.saldo}, está ${lido}`);
  }
  check(`o saldo de cada produto bate com o relatório`, divergem.length === 0, `${conferem} de ${positivos.length}`);
  for (const d of divergem.slice(0, 20)) console.log(`      ${d}`);

  let custoErrado = 0;
  for (const l of noCadastro.concat(aCadastrar)) {
    const p = (metaFinal.products || []).find((x) => String(x.sku || '').trim() === l.codigo);
    if (p && !iguais(p.costPrice, l.custo)) custoErrado += 1;
  }
  check('o custo do cadastro é o do relatório', custoErrado === 0, `${custoErrado} ainda diferente(s)`);

  // PASSO 5 — A COLUNA QUE DISCORDA DO RAZÃO.
  //
  // `products.stock_quantity` é o total do produto em todos os depósitos, e o
  // razão é quem o explica. Quando os dois discordam, existe um número sem
  // evento atrás dele — e a CONTAGEM NÃO ALCANÇA ESSE CASO: ela compara o
  // contado com o saldo DO DEPÓSITO, que vem do razão. Contar zero contra zero
  // dá delta zero, não gera movimento, e a coluna fica de pé.
  //
  // Foi o que aconteceu com o SKU-001 "Produto Exemplo", que veio no dump de
  // produção com 20 na coluna e nada no razão: o Painel de Estoque somava 20 ao
  // "Valor em estoque" e o saldo por depósito dizia zero, para sempre.
  //
  // Zerar a coluna aqui NÃO é movimentar estoque -- é apagar um número que
  // nunca foi um evento. Por isso passa pela rota de salvar produto e não por
  // `commitStockMovements`: não há movimento a registrar. E só é feito quando o
  // razão não tem NADA para aquele produto; se ele tiver algo diferente, o
  // problema é outro e sai apenas relatado.
  console.log('\n--- 9. coluna de saldo sem razão atrás ---');
  const somaNosDepositos = (id) => Object.entries(saldos)
    .filter(([k]) => k.startsWith(`${id}|`))
    .reduce((s, [, v]) => s + Number(v || 0), 0);

  const fantasmas = [];
  const discordamComRazao = [];
  for (const p of metaFinal.products || []) {
    const coluna = Number(p.stockQuantity || 0);
    const noRazao = centavos(somaNosDepositos(p.id));
    if (Math.abs(coluna - noRazao) < 0.005) continue;
    if (noRazao === 0) fantasmas.push({ p, coluna });
    else discordamComRazao.push({ p, coluna, noRazao });
  }
  console.log(`      coluna com número e razão vazio (fantasma): ${fantasmas.length}`);
  console.log(`      coluna e razão com números DIFERENTES .....: ${discordamComRazao.length}`);
  for (const { p, coluna, noRazao } of discordamComRazao) {
    console.log(`         ${String(p.sku).padEnd(10)} coluna ${coluna}, razão ${noRazao} — NÃO mexo, é outro problema`);
  }
  for (const { p, coluna } of fantasmas) {
    const r = await req('POST', '/api/stock', {
      id: p.id, name: p.name, sku: p.sku, stockQuantity: 0,
      costPrice: Number(p.costPrice || 0), salePrice: Number(p.salePrice || 0),
    }, token);
    if (r.status !== 200) { console.log(`         XX ${p.sku}: ${r.status} ${r.body.slice(0, 120)}`); falhas += 1; continue; }
    console.log(`         ZERADO ${String(p.sku).padEnd(10)} tinha ${coluna} na coluna e nada no razão  (${String(p.name).slice(0, 30)})`);
  }
  if (fantasmas.length) {
    const conf = JSON.parse((await req('GET', '/api/sales/meta', null, token)).body);
    const restantes = (conf.products || []).filter((p) => {
      const era = fantasmas.find((f) => f.p.id === p.id);
      return era && Number(p.stockQuantity || 0) !== 0;
    });
    check('os fantasmas ficaram em zero', restantes.length === 0, `${fantasmas.length - restantes.length} de ${fantasmas.length}`);
  }

  fs.rmSync(temporario, { recursive: true, force: true });
  console.log('');
  console.log(falhas === 0 ? 'CARGA CONCLUÍDA' : `${falhas} PROBLEMA(S) — leia acima`);
  process.exit(falhas === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
