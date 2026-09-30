#!/usr/bin/env node
/**
 * CONFERE O CADASTRO CONTRA O RELATÓRIO DE ESTOQUE DO VIPER.
 *
 * scripts/importar-saldo-viper.js carregou o SALDO. Este aqui confere o resto
 * do que o relatório traz de cada linha e o MavisONE também tem: nome, custo,
 * preço de venda e o gênero do item.
 *
 * O ESCOPO É HONESTO E ESTÁ ESCRITO: as 35 linhas COM SALDO do arquivo 1. As
 * outras ~965 linhas do arquivo (as de saldo zero) não estão conferidas aqui,
 * e o motivo é que os PDFs não ficam em disco — o que existe é a transcrição
 * das 35, e ela se prova pelo total impresso no relatório (2.164 unidades e
 * R$ 1.729.646,02, conferidos no centavo).
 *
 * Transcrever os ~965 códigos restantes à mão não tem checksum nenhum atrás:
 * um dígito errado meu viraria um "este produto não existe no cadastro" falso,
 * e alguém iria procurar um problema que não existe. Com o mesmo relatório em
 * CSV ou Excel, as 5.653 linhas se conferem de uma vez.
 *
 * Roda sem gravar nada.
 */
require('dotenv').config();
const { consultar, fecharPool } = require('../lib/db/conexao');

// Código, nome, saldo, CUSTO e VALOR VENDA como o PDF imprime.
// (as três linhas sem produto no cadastro entram marcadas, para a conferência
//  dizer o que aconteceu com elas em vez de omiti-las)
const DO_VIPER = [
  { sku: '100624', nome: 'CHAPA - CHAPEADO', qtd: 1, custo: 1000.00, venda: 1000.00, genero: '10' },
  { sku: '101024', nome: 'CERA CLEANER WAX PASTA 300G C/ APLIC - CADILLAC', qtd: 3, custo: 50.29, venda: 50.29, genero: '07' },
  { sku: '367', nome: 'CAPACETE C2', qtd: 485, custo: 28.38, venda: 149.00, genero: '00' },
  { sku: '100768', nome: 'CA. 40186 OCULOS SEG. PROTECTOR INCOLOR', qtd: 7, custo: 6.89, venda: 6.89, genero: '07' },
  { sku: '101023', nome: 'Bota Botina Seguranca Trabalho Couro Resistente Epi Bico Pvc', qtd: 2, custo: 54.91, venda: 54.91, genero: '07' },
  { sku: '525', nome: 'AUTOPROPELIDO ZILLA USADO', qtd: 1, custo: 3200.00, venda: 5790.00, genero: '00' },
  { sku: '100643', nome: 'Alicate Bomba D,agua 10 st 70412 Bico Papagaio', qtd: 2, custo: 59.99, venda: 59.99, genero: '07' },
  { sku: '11922', nome: 'AUTOPROPELIDO X13 PRO 1000W', qtd: 2, custo: 8987.55, venda: 10990.00, genero: '00' },
  { sku: '535', nome: 'AUTOPROPELIDO PATINETE XIAOMI', qtd: 1, custo: 1690.00, venda: 3990.00, genero: '00' },
  { sku: '100932', nome: 'AUTOPROPELIDO MAVIS VELLARYS 1000W | 2027', qtd: 101, custo: 3438.47, venda: 8790.00, genero: '00' },
  { sku: '10128', nome: 'AUTOPROPELIDO MAVIS RUNNER 1000W | 2026', qtd: 135, custo: 2754.96, venda: 6990.00, genero: '00' },
  { sku: '10006', nome: 'AUTOPROPELIDO MAVIS PROTOTIPO CS-04 | 2026', qtd: 1, custo: 4028.26, venda: 4028.26, genero: '00' },
  { sku: '10005', nome: 'AUTOPROPELIDO MAVIS PROTOTIPO CS-03 | 2026', qtd: 1, custo: 3612.42, venda: 3612.42, genero: '00' },
  { sku: '10004', nome: 'AUTOPROPELIDO MAVIS PROTOTIPO CS-02 | 2026', qtd: 1, custo: 2805.18, venda: 2805.18, genero: '00' },
  { sku: '9588', nome: 'AUTOPROPELIDO MAVIS NICKY 1000W | 2026', qtd: 1, custo: 3062.85, venda: 6990.00, genero: '00' },
  { sku: '9739', nome: 'AUTOPROPELIDO MAVIS NEXUS 1000W | 2026', qtd: 165, custo: 2310.09, venda: 5990.00, genero: '00' },
  { sku: '9590', nome: 'AUTOPROPELIDO MAVIS MINI MOTO | 2026 | PROTOTIPO', qtd: 1, custo: 2277.35, venda: 9990.00, genero: '00' },
  { sku: '8758', nome: 'AUTOPROPELIDO MAVIS JIMMY 1000W | 2027', qtd: 55, custo: 3359.38, venda: 8390.00, genero: '00' },
  { sku: '8756', nome: 'AUTOPROPELIDO MAVIS FLOW 800W | 2026', qtd: 1, custo: 2615.68, venda: 4990.00, genero: '00' },
  { sku: '9587', nome: 'AUTOPROPELIDO MAVIS FLIC 650W | 2026 | 02', qtd: 58, custo: 1693.34, venda: 4390.00, genero: '00' },
  { sku: '10072', nome: 'AUTOPROPELIDO MAVIS FLAME 500 15 | 2026', qtd: 2, custo: 1585.50, venda: 3390.00, genero: '00' },
  { sku: '9738', nome: 'AUTOPROPELIDO MAVIS CROSS 1000W | 2026', qtd: 9, custo: 4010.41, venda: 9990.00, genero: '00' },
  { sku: '8757', nome: 'AUTOPROPELIDO MAVIS CONNECT 900W | 2026', qtd: 6, custo: 2342.22, venda: 5590.00, genero: '00' },
  { sku: '8759', nome: 'AUTOPROPELIDO MAVIS AYLA+ 800W | 2026', qtd: 2, custo: 1947.48, venda: 4800.00, genero: '00' },
  { sku: '9589', nome: 'AUTOPROPELIDO MAVIS AYLA 500W | 2026 | 02', qtd: 58, custo: 1435.13, venda: 3890.00, genero: '00' },
  { sku: '7779', nome: 'AUTOPROPELIDO MAVIS AYLA 400 2025', qtd: 43, custo: 1570.28, venda: 4990.00, genero: '00' },
  { sku: '9204', nome: 'AUTOPROPELIDO MAVIS ABACOOK 1000W | 2026', qtd: 10, custo: 3666.10, venda: 9990.00, genero: '00' },
  { sku: '8376', nome: 'AUTOPROPELIDO KACCAU W2 800W', qtd: 1, custo: 5483.57, venda: 7990.00, genero: '00' },
  { sku: '238', nome: 'AUTOPROPELIDO KACCAU W2 1000W', qtd: 3, custo: 3929.26, venda: 6990.00, genero: '00' },
  { sku: '236', nome: 'AUTOPROPELIDO KACCAU V8', qtd: 1, custo: 7323.08, venda: 9790.00, genero: '00' },
  { sku: '324', nome: 'AUTOPROPELIDO KACCAU V40', qtd: 1, custo: 6000.00, venda: 9790.00, genero: '00' },
  { sku: '7929', nome: 'AUTOPROPELIDO KACCAU IRUN', qtd: 2, custo: 6753.27, venda: 7990.00, genero: '00' },
  { sku: '101060', nome: 'ABRACADEIRA PLASTICA COR PRETA, TAMANHO 5MM x 300MM', qtd: 1000, custo: 0.10, venda: 0.10, genero: '07' },
  { sku: '100659', nome: '84587 FURADEIRA DE BANCADA 220V 500W FBF-16 5/8" FERRARI', qtd: 1, custo: 955.12, venda: 955.12, genero: '07' },
  { sku: '100627', nome: '1 Kg de Cola quente Martelinho Preta', qtd: 1, custo: 46.80, venda: 46.80, genero: '07' }
];

const DEPOSITO = 'Depósito Matriz';

const brl = (v) => `R$ ${Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const cent = (v) => Math.round(Number(v || 0) * 100) / 100;
// Nome comparável: o Viper escreve "CHAPA - CHAPEADO" e o MavisONE
// "CHAPA | CHAPEADO"; o importador do cadastro trocou a pontuação, e isso não
// é divergência de produto.
const chave = (s) => String(s || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Z0-9]/g, '');

(async () => {
  const skus = DO_VIPER.map((l) => l.sku);
  const { rows } = await consultar(
    `select p.sku, p.name, p.cost_price, p.sale_price, p.ncm, p.unidade_comercial,
            p.tipo_produto_fiscal, p.stock_quantity,
            (select coalesce(sum(m.quantity), 0) from stock_movements m
              where m.product_id = p.id and m.deposit_id = d.id) saldo_matriz
       from products p
       cross join (select id from deposits where name = $2) d
      where p.sku = any($1)`, [skus, DEPOSITO]);
  const porSku = new Map(rows.map((r) => [String(r.sku), r]));

  console.log(`--- 1. os ${DO_VIPER.length} produtos com saldo no relatório ---`);
  const semProduto = [];
  const nomeDiverge = [];
  const custoDiverge = [];
  const vendaDiverge = [];
  const saldoDiverge = [];
  const semNcm = [];

  for (const l of DO_VIPER) {
    const p = porSku.get(l.sku);
    if (!p) { semProduto.push(l); continue; }
    if (chave(l.nome) !== chave(p.name)) nomeDiverge.push({ l, p });
    if (cent(p.cost_price) !== cent(l.custo)) custoDiverge.push({ l, p });
    if (cent(p.sale_price) !== cent(l.venda)) vendaDiverge.push({ l, p });
    if (Number(p.saldo_matriz) !== l.qtd) saldoDiverge.push({ l, p });
    if (!p.ncm || !String(p.ncm).trim()) semNcm.push(l.sku);
  }
  const achados = DO_VIPER.length - semProduto.length;

  const linha = (rotulo, lista, det) => {
    console.log(`${lista.length === 0 ? '  OK ' : '  XX '} ${rotulo} -> ${lista.length === 0 ? 'todos conferem (' + achados + ')' : lista.length + ' divergem'}`);
    if (lista.length && det) lista.forEach(det);
  };

  console.log(`  -- existem no cadastro -> ${achados} de ${DO_VIPER.length}`);
  semProduto.forEach((l) => console.log(`        FALTA  ${l.sku.padEnd(8)} ${String(l.qtd).padStart(5)} un  ${l.nome.slice(0, 48)}`));

  linha('o SALDO carregado bate com o relatório', saldoDiverge,
    ({ l, p }) => console.log(`        ${l.sku.padEnd(8)} relatório ${l.qtd}, no razão ${p.saldo_matriz}`));
  linha('o NOME é o mesmo produto', nomeDiverge,
    ({ l, p }) => console.log(`        ${l.sku.padEnd(8)} Viper "${l.nome.slice(0, 40)}" / Mavis "${String(p.name).slice(0, 40)}"`));
  linha('o CUSTO do cadastro é o do relatório', custoDiverge,
    ({ l, p }) => console.log(`        ${l.sku.padEnd(8)} Viper ${brl(l.custo).padStart(14)}  Mavis ${brl(p.cost_price).padStart(14)}  dif ${brl(cent(p.cost_price) - cent(l.custo))}`));
  linha('o PREÇO DE VENDA do cadastro é o do relatório', vendaDiverge,
    ({ l, p }) => console.log(`        ${l.sku.padEnd(8)} Viper ${brl(l.venda).padStart(14)}  Mavis ${brl(p.sale_price).padStart(14)}  dif ${brl(cent(p.sale_price) - cent(l.venda))}`));

  console.log('\n--- 2. o que o relatório tem e o cadastro não guarda ---');
  // A coluna "Gênero" do Viper é o TIPO_ITEM do registro 0200 do SPED (00
  // Mercadoria para Revenda, 01 Matéria-Prima, 07 Material de Uso e Consumo,
  // 08 Ativo Imobilizado, 10 Outros insumos, 99 Outras) — e lib/sped-registros
  // registra exatamente esses cinco valores no arquivo de agosto.
  const tipos = [...new Set(rows.map((r) => String(r.tipo_produto_fiscal || '(vazio)')))];
  const generos = [...new Set(DO_VIPER.map((l) => l.genero))].sort();
  console.log(`      Gênero no relatório .............: ${generos.join(', ')}  (é o TIPO_ITEM do registro 0200 do SPED)`);
  console.log(`      products.tipo_produto_fiscal ....: ${tipos.join(', ')}`);
  console.log('      Os dois não são a mesma coisa: `tipo_produto_fiscal` diz se o item é');
  console.log('      normal/kit/combustível para a NF-e; o Gênero diz o que ele é para a EFD.');
  console.log('      O 0200 pede o TIPO_ITEM, e o relatório do Viper o traz de graça.');
  if (semNcm.length) {
    console.log(`\n      sem NCM no cadastro: ${semNcm.length} de ${achados} -> ${semNcm.slice(0, 8).join(', ')}`);
  }

  console.log('\n--- 3. saldo sem razão atrás dele ---');
  // O razão é quem manda (lib/db/estoque-razao.js). Saldo em
  // `products.stock_quantity` sem movimento nenhum é número que o Painel de
  // Estoque não vê e que ninguém consegue explicar de onde veio.
  const orfaos = await consultar(
    `select p.sku, p.name, p.stock_quantity
       from products p
      where p.stock_quantity <> 0
        and not exists (select 1 from stock_movements m where m.product_id = p.id)
      order by p.stock_quantity desc`);
  if (!orfaos.rowCount) console.log('  OK  nenhum produto tem saldo sem movimento');
  else {
    console.log(`  XX  ${orfaos.rowCount} produto(s) com saldo e ZERO movimento no razão:`);
    orfaos.rows.forEach((r) => console.log(`        ${String(r.sku).padEnd(10)} ${String(r.stock_quantity).padStart(6)} un  ${String(r.name).slice(0, 44)}`));
  }

  console.log('\n--- 4. o que NÃO foi conferido ---');
  console.log(`      as ~965 linhas de saldo ZERO do arquivo 1 e as 4.000 linhas que`);
  console.log('      faltam (da 1 à 4.000, de D a Z) não estão conferidas: os PDFs não');
  console.log('      ficam em disco, e transcrever mil códigos à mão não tem checksum —');
  console.log('      um dígito errado viraria um "não existe no cadastro" falso.');
  console.log('      Com o mesmo relatório em CSV, as 5.653 linhas se conferem de uma vez.');

  await fecharPool();
})();
