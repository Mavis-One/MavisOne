#!/usr/bin/env node
/**
 * O DEPÓSITO PERTENCE A UMA LOJA (fase AW).
 *
 * Roda no `npm test`: o que se mede aqui é função pura e leitura de fonte, e o
 * vínculo em si tem e2e próprio quando há servidor no ar.
 *
 * O QUE ESTE TESTE PROTEGE
 * ------------------------
 * Nada ligava depósito a empresa: o pedido escolhia os dois campos um do lado
 * do outro, e dava para faturar pela Filial 02 tirando mercadoria do depósito
 * da Filial 07 sem que nada estranhasse. A auditoria do ERP anterior mostrou
 * onde isso chega — lá o depósito "FILIAL 004" pertence à empresa "FILIAL 05".
 *
 * 1. DEPÓSITO SEM LOJA CONTINUA APARECENDO. Nenhum dos que existem hoje foi
 *    cadastrado com empresa; esconder todos deixaria o campo vazio para quem só
 *    quer vender. Sem loja é "serve para qualquer uma".
 *
 * 2. O QUE ESTÁ GRAVADO NUNCA SOME DA LISTA. Um pedido antigo cujo depósito é
 *    de outra loja abriria com o campo em branco, e a próxima escolha apagaria
 *    o histórico de verdade.
 *
 * 3. SÓ SUGERE QUANDO NÃO HÁ DÚVIDA. Com dois depósitos na loja, escolher um é
 *    o sistema decidindo por quem vende — palpite que ninguém confere e que
 *    aparece no inventário.
 *
 * 4. AS DUAS METADES DO CAMPO CONCORDAM. `renderSearchableSelect` desenha e
 *    `attachSearchableSelect` alimenta a busca: se as duas receberem listas
 *    diferentes, o campo mostra uma coisa e oferece outra. Foi o que aconteceu
 *    com a Categoria — ver o check da seção 4.
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

// As duas funções são puras: dá para exercitá-las sem navegador.
const fonteFiltro = (appSrc.match(/function depositosDaLoja[\s\S]*?\n\}/) || [''])[0];
const fonteSugestao = (appSrc.match(/function depositoSugeridoDaLoja[\s\S]*?\n\}/) || [''])[0];
check('as duas funções existem', fonteFiltro.length > 0 && fonteSugestao.length > 0);
// eslint-disable-next-line no-new-func
const depositosDaLoja = new Function(`${fonteFiltro}; return depositosDaLoja;`)();
// eslint-disable-next-line no-new-func
const depositoSugeridoDaLoja = new Function(`${fonteSugestao}; return depositoSugeridoDaLoja;`)();

const meta = {
  deposits: [
    { id: 'd1', name: 'Loja Centro', companyId: 'c1' },
    { id: 'd2', name: 'Galpão Centro', companyId: 'c1' },
    { id: 'd3', name: 'Loja Norte', companyId: 'c2' },
    { id: 'd4', name: 'Trânsito', companyId: '' }
  ]
};

console.log('--- 1. o filtro pela loja ---');
const daC1 = depositosDaLoja(meta, 'c1', '').map((d) => d.id);
check('a loja c1 vê os seus dois', daC1.includes('d1') && daC1.includes('d2'), daC1.join(', '));
check('  e NÃO vê o da outra loja', !daC1.includes('d3'));
// Sem loja e' "serve para qualquer uma", nao "nao serve para nenhuma".
check('  o depósito sem loja aparece sempre', daC1.includes('d4'));
check('sem empresa escolhida, todos aparecem', depositosDaLoja(meta, '', '').length === 4);

console.log('\n--- 2. o que está gravado não some ---');
const comOutra = depositosDaLoja(meta, 'c1', 'd3');
check('depósito de outra loja continua na lista', comOutra.some((d) => d.id === 'd3'),
  comOutra.map((d) => d.name).join(' | '));
check('  e vem marcado como de outra loja',
  comOutra.some((d) => /de outra loja/.test(d.name)));
check('  sem duplicar quando ele já é da loja', depositosDaLoja(meta, 'c1', 'd1').filter((d) => d.id === 'd1').length === 1);

console.log('\n--- 3. a sugestão só quando não há dúvida ---');
check('loja com DOIS depósitos não sugere nada', depositoSugeridoDaLoja(meta, 'c1') === '',
  `"${depositoSugeridoDaLoja(meta, 'c1')}"`);
check('loja com UM depósito sugere o dela', depositoSugeridoDaLoja(meta, 'c2') === 'd3',
  depositoSugeridoDaLoja(meta, 'c2'));
check('sem loja, não sugere', depositoSugeridoDaLoja(meta, '') === '');

console.log('\n--- 4. as duas metades do campo recebem a MESMA lista ---');
// O CHECK QUE ENCONTROU UM ERRO REAL.
//
// `renderSearchableSelect` desenha o campo e `attachSearchableSelect` alimenta a
// busca. Depois da fase AS, o campo Categoria RENDERIZAVA do cadastro novo e a
// busca continuava oferecendo as categorias de PRODUTO — as duas metades do
// mesmo campo discordando, e a que o usuário usa é a da busca.
check('a busca de Categoria usa o cadastro de venda',
  /attachSearchableSelect\(\{ id: 'salesCategory', options: opcoesDeCategoriaDeVenda/.test(appSrc));
check('  e não mais productCategories',
  !/id: 'salesCategory', options: \(meta\.productCategories/.test(appSrc));
// O alvo deste check mudou de forma na fase CK, nao de intencao: a chamada
// passou de uma linha para varias porque ganhou um `onSelect` — trocar o
// deposito precisa redesenhar o formulario, ja que o saldo mostrado passou a
// ser o DAQUELE deposito. A lista oferecida continua vindo de depositosDaLoja,
// que e o que este check existe para garantir. `[\s\S]` em vez de exigir a
// mesma linha.
check('a busca de Depósito filtra pela loja',
  /id: 'salesDeposit',[\s\S]{0,60}options: depositosDaLoja\(/.test(appSrc));
// E trocar o deposito tem de redesenhar: sem isso os numeros de saldo
// continuariam os do deposito anterior, com o campo dizendo outro nome.
check('  e trocar o depósito redesenha o formulário',
  /id: 'salesDeposit',[\s\S]{0,900}renderForm\(\)/.test(appSrc));
check('  e o campo desenhado também',
  /id: 'salesDeposit', name: 'depositId', options: depositosDaLoja\(/.test(appSrc));

console.log('\n--- 5. trocar a loja mexe no depósito ---');
const onSelect = (appSrc.match(/id: 'salesCompany',[\s\S]*?onSelect: \(valor\) => \{[\s\S]*?\n          \}/) || [''])[0];
check('a troca de empresa tem tratamento', onSelect.length > 0);
check('  religa o campo de depósito', /attachSearchableSelect\(\{\s*id: 'salesDeposit'/.test(onSelect));
// Trocar um deposito que JA serve a loja nova seria desfazer escolha do usuario.
check('  e só troca se o atual não serve à loja nova', /precisaTrocar/.test(onSelect));

console.log('\n--- 6. o vínculo trafega banco -> tela ---');
const dados = ler('lib/db/cadastros.js');
check('o mapper lê company_id', /companyId: row\.company_id/.test(dados));
check('criar grava a loja', /company_id: payload\.companyId \|\| null/.test(dados));
const servidor = ler('server.js');
// Id de empresa que nao existe deixaria o deposito orfao de um jeito que
// nenhuma tela explica.
check('a rota confere a empresa contra o cadastro',
  /Empresa não encontrada/.test(servidor) && /companies \|\| \[\]\)\.some\(\(c\) => c\.id === companyId\)/.test(servidor));
const migracao = ler('banco/migrations/fase-aw-deposito-pertence-a-loja.sql');
check('a migração deixa a coluna nula', /add column if not exists company_id text;/.test(migracao));
check('  e explica por que não há FK', /companies` NÃO É UMA TABELA/.test(migracao));

console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TODOS OS CHECKS PASSARAM =====');
process.exit(falhas ? 1 : 0);
