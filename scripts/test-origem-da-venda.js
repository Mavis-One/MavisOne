#!/usr/bin/env node
/**
 * ORIGEM DA VENDA VIRA CADASTRO (fase AZ).
 *
 * Duas partes: função pura + leitura de fonte no `npm test`, e um trecho contra
 * o banco quando ele está de pé (`node scripts/test-origem-da-venda.js --banco`).
 *
 * O QUE ESTE TESTE PROTEGE
 * ------------------------
 * 1. A LISTA SAIU DO CÓDIGO. Eram seis nomes numa constante do public/app.js,
 *    sem tela. Quem vende por WhatsApp escolhia "Venda Direta" para tudo, e a
 *    pergunta que a origem existe para responder — de onde vêm minhas vendas —
 *    passava a ter uma resposta só.
 *
 * 2. AS SEIS CONTINUAM EXISTINDO. A migração as semeia. Se um dia o cadastro
 *    vier vazio (banco sem a migração, ou todas inativadas), o campo cai na
 *    lista antiga em vez de mostrar um <select> sem opção nenhuma — venda
 *    impossível de registrar por causa de um cadastro de apoio.
 *
 * 3. O QUE ESTÁ GRAVADO NUNCA SOME. `sale_origin` guarda o NOME: um pedido com
 *    origem inativada depois abriria com o campo em branco, e a próxima escolha
 *    apagaria o histórico de verdade.
 *
 * 4. ORIGEM E CATEGORIA CONTINUAM SENDO DUAS COISAS. Categoria diz O QUE a
 *    venda é; origem diz POR ONDE chegou. A mesma venda tem as duas.
 *
 * 5. EXCLUIR CONTA PEDIDOS **E** ORÇAMENTOS. As duas tabelas têm sale_origin, e
 *    contar só uma diria "ninguém usa" sobre uma origem viva em vinte
 *    orçamentos — que a exclusão apagaria em silêncio.
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

const appSrc = ler('public/app.js');

console.log('--- 1. as opções vêm do cadastro ---');
const fonte = (appSrc.match(/function opcoesDeOrigemDeVenda[\s\S]*?\n\}/) || [''])[0];
check('a função existe', fonte.length > 0);
const fontePadrao = (appSrc.match(/const ORIGENS_VENDA_PADRAO = \[[^\]]*\];/) || [''])[0];
check('  e a lista antiga virou só a rede de segurança', fontePadrao.length > 0);
// eslint-disable-next-line no-new-func
const opcoesDeOrigemDeVenda = new Function(`${fontePadrao}; ${fonte}; return opcoesDeOrigemDeVenda;`)();

const meta = { salesOrigins: ['Balcão', 'Indicação', 'WhatsApp'] };
const doCadastro = opcoesDeOrigemDeVenda(meta, '').map((o) => o.value);
check('usa o cadastro quando ele existe',
  doCadastro.join(',') === 'Balcão,Indicação,WhatsApp', doCadastro.join(', '));
check('  e não a lista antiga', !doCadastro.includes('Televendas'));

console.log('\n--- 2. a rede de segurança ---');
// Um <select> sem opcao nenhuma tornaria a venda impossivel de registrar por
// causa de um cadastro de apoio. O pior caso e' voltar ao que era.
const semCadastro = opcoesDeOrigemDeVenda({}, '').map((o) => o.value);
check('cadastro ausente cai nas seis antigas', semCadastro.length === 6, semCadastro.join(', '));
check('cadastro vazio também', opcoesDeOrigemDeVenda({ salesOrigins: [] }, '').length === 6);
check('  e "Venda Direta" está entre elas', semCadastro.includes('Venda Direta'));

console.log('\n--- 3. o que está gravado não some ---');
const comInativa = opcoesDeOrigemDeVenda(meta, 'Feira de Negócios');
check('origem fora do cadastro continua na lista',
  comInativa.some((o) => o.value === 'Feira de Negócios'),
  comInativa.map((o) => o.label).join(' | '));
check('  e vem marcada como fora do cadastro',
  comInativa.some((o) => /fora do cadastro/.test(o.label)));
check('  sem duplicar quando ela já está no cadastro',
  opcoesDeOrigemDeVenda(meta, 'Balcão').filter((o) => o.value === 'Balcão').length === 1);
check('  e entra em primeiro, onde se vê', comInativa[0].value === 'Feira de Negócios');

console.log('\n--- 4. a tela toda lê o cadastro ---');
check('o campo do formulário',
  /opcoesDeOrigemDeVenda\(meta, formState\.saleOrigin\)/.test(appSrc));
check('o filtro da busca avançada',
  /opcoesDeOrigemDeVenda\(meta, filters\.saleOrigin\)/.test(appSrc));
// O padrao da venda nova saia de ORIGENS_VENDA[0]: renomear "Venda Direta" no
// cadastro nao pode continuar entregando o nome antigo em toda venda nova.
check('e o padrão da venda nova',
  /saleOrigin: origem\?\.saleOrigin \|\| \(opcoesDeOrigemDeVenda\(meta, ''\)\[0\] \|\| \{\}\)\.value/.test(appSrc));
check('nenhum uso da constante antiga sobrou',
  !/\bORIGENS_VENDA\b(?!_PADRAO)/.test(appSrc));

console.log('\n--- 5. origem e categoria continuam separadas ---');
// Sao duas perguntas: O QUE a venda e' (categoria) e POR ONDE chegou (origem).
// A mesma venda tem as duas — um atacado que entrou por televendas.
check('o pedido tem os dois campos',
  /saleOrigin: texto\(body\.saleOrigin\)/.test(ler('server.js'))
  && /name="category"/.test(appSrc));
check('e são dois cadastros diferentes',
  /salesOrigins:/.test(ler('server.js')) && /salesCategories:/.test(ler('server.js')));
check('  em duas tabelas', fs.existsSync(path.join(RAIZ, 'lib/db/origens-venda.js'))
  && fs.existsSync(path.join(RAIZ, 'lib/db/categorias-venda.js')));

console.log('\n--- 6. o servidor ---');
const servidor = ler('server.js');
check('só as ATIVAS vão para o formulário',
  /origensVendaDb\.listar\(\{ apenasAtivas: true \}\)/.test(servidor));
check('as quatro rotas existem',
  /pathname === '\/api\/sales\/origins' && req\.method === 'GET'/.test(servidor)
  && /pathname === '\/api\/sales\/origins' && req\.method === 'POST'/.test(servidor)
  && /pathname\.startsWith\('\/api\/sales\/origins\/'\) && req\.method === 'PUT'/.test(servidor)
  && /pathname\.startsWith\('\/api\/sales\/origins\/'\) && req\.method === 'DELETE'/.test(servidor));
check('e todas exigem o módulo Vendas',
  (servidor.match(/allowedModules\.includes\('sales'\)/g) || []).length >= 8);
// Renomear nao reescreve o historico, e quem renomeou precisa saber na hora.
check('renomear avisa quem ficou para trás',
  /registros continuam'\} com o nome antigo/.test(servidor));

console.log('\n--- 7. o cadastro ---');
const dados = ler('lib/db/origens-venda.js');
// Contar so pedidos diria "ninguem usa" sobre uma origem viva em orcamentos.
check('o uso conta pedidos E orçamentos',
  /from orders where lower\(trim\(sale_origin\)\)/.test(dados)
  && /from quotes where lower\(trim\(sale_origin\)\)/.test(dados));
check('excluir em uso é recusado com o caminho certo',
  /Marque como inativa em vez de excluir/.test(dados));
// O indice unico e' quem garante; duas requisicoes simultaneas atravessariam
// uma checagem feita antes com select.
check('nome duplicado é decidido pelo índice, não por select antes',
  /23505/.test(dados) && !/select .* where lower\(name\) =/.test(dados));

console.log('\n--- 8. a migração ---');
const mig = ler('banco/migrations/fase-az-origem-da-venda-vira-cadastro.sql');
check('cria a tabela', /create table if not exists sales_origins/.test(mig));
check('com índice único sobre lower(name)',
  /create unique index if not exists idx_sales_origins_nome[\s\S]*?lower\(name\)/.test(mig));
check('semeia as seis antigas', ['Venda Direta', 'Televendas', 'E-commerce',
  'Marketplace', 'Representante', 'Balcão'].every((n) => mig.includes(`'${n}'`)));
check('  e o que os registros usam, de pedidos E orçamentos',
  /select sale_origin from orders[\s\S]*?union all[\s\S]*?select sale_origin from quotes/.test(mig));
// O `;` no fim distingue o COMANDO da mesma frase citada no comentário de cima.
check('as duas semeaduras têm guarda contra repetição',
  (mig.match(/on conflict do nothing;/g) || []).length === 2);
check('liga RLS', /alter table if exists sales_origins enable row level security/.test(mig));

console.log('\n--- 9. as telas ---');
check('a lista existe', fs.existsSync(path.join(RAIZ, 'public/modules/sales/subs/sales_origins.js')));
check('o formulário existe', fs.existsSync(path.join(RAIZ, 'public/modules/sales/subs/new_sales_origin.js')));
const html = ler('public/index.html');
check('as duas são carregadas',
  /modules\/sales\/subs\/sales_origins\.js/.test(html)
  && /modules\/sales\/subs\/new_sales_origin\.js/.test(html));
check('e aparecem no menu de Vendas',
  /key: 'sales_origins'/.test(appSrc) && /key: 'new_sales_origin'/.test(appSrc));

// ---------------------------------------------------------------------------
// Contra o banco. Fora do `npm test` porque exige o container de pé.
// ---------------------------------------------------------------------------
async function contraOBanco() {
  // Só aqui: o resto deste teste é fonte e função pura, e carregar o .env no
  // topo faria o `npm test` depender de um arquivo que pode não existir.
  require('dotenv').config();
  const origens = require('../lib/db/origens-venda');
  const { consultar } = require('../lib/db/conexao');
  console.log('\n--- 10. contra o banco ---');

  const semeadas = await origens.listar();
  check('as seis foram semeadas', semeadas.length >= 6, `${semeadas.length} origem(ns)`);
  check('  e "Venda Direta" está lá', semeadas.some((o) => o.name === 'Venda Direta'));

  const criada = await origens.criar({ name: 'zz Origem de Teste', code: 'ZZ1' });
  check('cria', Boolean(criada && criada.id), criada && criada.name);
  try {
    await origens.criar({ name: 'ZZ ORIGEM DE TESTE' });
    check('nome duplicado (só o caixa muda) é recusado', false);
  } catch (erro) {
    check('nome duplicado (só o caixa muda) é recusado', erro.status === 409, erro.message.slice(0, 60));
  }

  const uso = await origens.registrosQueUsam('Venda Direta');
  check('conta o uso de uma origem viva', uso.total > 0,
    `${uso.pedidos} pedido(s) + ${uso.orcamentos} orçamento(s)`);
  try {
    const emUso = semeadas.find((o) => o.name === 'Venda Direta');
    await origens.excluir(emUso.id);
    check('excluir uma origem em uso é recusado', false);
  } catch (erro) {
    check('excluir uma origem em uso é recusado', erro.status === 409, erro.message.slice(0, 70));
  }

  check('excluir a que ninguém usa funciona', await origens.excluir(criada.id) === true);
  await consultar("delete from sales_origins where name ilike 'zz %'");
  console.log('  (limpeza feita)');
}

(async () => {
  if (process.argv.includes('--banco')) {
    try {
      await contraOBanco();
    } catch (erro) {
      check('o trecho contra o banco rodou', false, erro.message);
    }
  }
  console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TODOS OS CHECKS PASSARAM =====');
  process.exit(falhas ? 1 : 0);
})();
