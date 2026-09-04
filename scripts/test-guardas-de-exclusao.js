#!/usr/bin/env node
/**
 * AS GUARDAS DE EXCLUSÃO PERGUNTAM À FONTE CERTA (fase BO).
 *
 * A fase BB descobriu que as guardas de "está em uso?" liam coleções que tinham
 * ido para o Postgres e respondiam SEMPRE vazio — deixando excluir exatamente o
 * que estava em uso. Duas foram corrigidas lá (contrapartida e depósito). Esta
 * fase pega as irmãs que ficaram, e mais duas de outra natureza.
 *
 * TUDO REPRODUZIDO num banco de prova, com `git stash` para medir o antes.
 * As três primeiras responderam {"success":true} e excluíram:
 *
 *   EMPRESA com 1 pedido e 1 depósito       -> excluída
 *   CATEGORIA DE MOVIMENTAÇÃO com 1 movimento -> excluída
 *   ESTORNO DE TRANSFERÊNCIA sem saldo da cor -> aceito, e o destino ficou
 *     com "Branco: -10" enquanto a origem recebeu de volta 10 Brancos que já
 *     tinham sido consumidos
 *
 * POR QUE CADA UMA FALHAVA
 * ------------------------
 * 1. EMPRESA: `companies.inUse` varre data.orders/data.quotes, coleções em
 *    NAO_PERSISTIR que a rota genérica de cadastros nunca sincroniza.
 * 2. CATEGORIA DE MOVIMENTAÇÃO: varre data.stockMovements, que saiu do db.json
 *    na fase AP.
 * 3. COR/VALOR DE CLASSE: a única proteção era a chave estrangeira das
 *    atribuições — e a própria tela apaga essa linha quando se desmarca a cor
 *    do produto. Movimento de estoque não tem FK para lá.
 * 4. TRANSFERÊNCIA: o estorno conferia `depositBalance`, que soma o depósito
 *    inteiro sem olhar a cor. Com 10 Brancos e 10 Azuis no destino, estornar os
 *    Brancos já consumidos passava porque os Azuis cobriam a conta.
 * 5. PESSOA/CNPJ: quatro referências sem FK (pedido, orçamento, compra,
 *    contrato) ficavam órfãs — o documento passa a apontar para um id que não
 *    existe, e a tela mostra o nome gravado nele, então o estrago é invisível.
 * 6. CATEGORIA DE VENDA: contava só `orders`, e `quotes.category` existe igual.
 *    A tela dizia "0 usos" numa categoria escolhida em dez orçamentos.
 *
 * O PADRÃO, e é ele que este teste protege: CONTAGEM NO BANCO, não varredura de
 * coleção em memória — o mesmo que a fase BB estabeleceu. E a saída oferecida é
 * sempre DESATIVAR, não excluir: assim o cadastro some do formulário e o
 * histórico continua explicável.
 */
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const ler = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};

const src = ler('server.js');
const corpoDe = (nome) => {
  const m = new RegExp(`(?:async )?function ${nome}\\([\\s\\S]*?\\n\\}`).exec(src);
  return m ? m[0] : '';
};

console.log('--- 1. empresa ---');
const empresa = corpoDe('empresaEmUso');
check('empresaEmUso existe', empresa.length > 0);
check('  conta pedidos, orçamentos e depósitos no banco',
  /from orders where company_id = \$1/.test(empresa)
  && /from quotes where company_id = \$1/.test(empresa)
  && /from deposits where company_id = \$1/.test(empresa));
// Quatro idas ao banco para responder "dá para excluir?" custariam quatro vezes
// a latência por um botão.
check('  numa consulta só', (empresa.match(/await consultarBanco\(/g) || []).length === 1);
check('a rota de cadastros a chama antes do inUse antigo',
  /if \(cadastroCollectionMatch\[1\] === 'companies'\) \{[\s\S]{0,120}?await empresaEmUso\(id\)/.test(src));

console.log('--- 2. categoria de movimentação ---');
check('a rota conta no razão',
  /if \(stockCollectionMatch\[1\] === 'movement-categories'\) \{[\s\S]{0,200}?razaoEstoque\.contarPorCategoria\(id\)/.test(src));
const razao = ler('lib/db/estoque-razao.js');
check('contarPorCategoria existe', /async function contarPorCategoria\(categoriaId\)/.test(razao));
// Contagem, e não varredura: o razão não entra em memória para responder
// "tem algum?". É o que a fase BB trocou.
check('  e é count, não listagem', /select count\(\*\)::int as n from stock_movements where category_id = \$1/.test(razao));

console.log('--- 3. cor / valor de classe ---');
const classes = ler('lib/db/classes.js');
check('excluirValor confere o razão antes de apagar',
  /async function excluirValor\(id\) \{\s*\n\s*const movimentos = await movimentosQueUsamValor\(id\);/.test(classes));
check('  e recusa com 409', /erro\.status = 409;/.test(classes));
// Desativar é o caminho que o próprio catálogo já implementa: valor inativo
// some da escolha e o movimento antigo continua legível.
check('  mandando DESATIVAR em vez de excluir', /Desative-o em vez de excluir/.test(classes));

console.log('--- 4. estorno de transferência ---');
const rotaEstorno = src.slice(src.indexOf("if (/^\\/api\\/stock\\/transfers\\/[^/]+$/.test(pathname) && req.method === 'DELETE')"));
const trecho = rotaEstorno.slice(0, rotaEstorno.indexOf('await emTransacao('));
check('achei o estorno de transferência', trecho.length > 100, `${trecho.length} caracteres`);
check('confere o saldo DA COR quando há cor',
  /const available = cor\s*\n\s*\? stockCore\.classValueBalance\(data, transfer\.productId, cor, transfer\.destinationDepositId\)/.test(trecho));
check('  e o do depósito quando não há',
  /: stockCore\.depositBalance\(data, transfer\.productId, transfer\.destinationDepositId\);/.test(trecho));
// "disponível 0" num depósito visivelmente cheio não explica nada.
check('  e a mensagem nomeia a cor', /await classesDb\.nomeDoValor\(cor\)/.test(trecho));

console.log('--- 5. pessoa e CNPJ ---');
const contrapartida = corpoDe('contarDocumentosDaContrapartida');
check('contarDocumentosDaContrapartida existe', contrapartida.length > 0);
check('  cobre as quatro referências sem FK',
  /from orders where client_supplier_id = \$1/.test(contrapartida)
  && /from quotes where client_supplier_id = \$1/.test(contrapartida)
  && /from purchases where supplier_id = \$1/.test(contrapartida)
  && /from contracts where party_id = \$1/.test(contrapartida));
check('e contrapartidaEmUso a usa', /contarDocumentosDaContrapartida\(id\)\.catch\(\(\) => null\)/.test(corpoDe('contrapartidaEmUso')));
// Falhar a contagem não pode travar a exclusão de um cadastro legítimo: o
// .catch devolve null e as outras metades da guarda continuam valendo.
check('  degradando se a consulta falhar', /\.catch\(\(\) => null\)/.test(corpoDe('contrapartidaEmUso')));

console.log('--- 6. categoria de venda ---');
const categorias = ler('lib/db/categorias-venda.js');
check('registrosQueUsam conta as DUAS tabelas',
  /from orders where lower\(trim\(category\)\)/.test(categorias)
  && /from quotes where lower\(trim\(category\)\)/.test(categorias));
check('  e a exclusão decide pelo total', /const uso = await registrosQueUsam\(categoria\.name\);\s*\n\s*if \(uso\.total > 0\)/.test(categorias));
// Quem só quer o número total continua chamando pedidosQueUsam: a rota de
// listagem e o aviso de renomear usam esse nome.
check('  sem quebrar quem chamava pedidosQueUsam',
  /async function pedidosQueUsam\(nome\) \{\s*\n\s*return \(await registrosQueUsam\(nome\)\)\.total;/.test(categorias));

console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TODOS OS CHECKS PASSARAM =====');
process.exit(falhas ? 1 : 0);
