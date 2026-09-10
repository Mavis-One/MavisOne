#!/usr/bin/env node
/**
 * QUEM PROCESSA O CARTÃO (fase BV).
 *
 * O QUE ISTO PREPARA
 * ------------------
 * O grupo `pag/detPag/card` da NF-e exige o CNPJ da CREDENCIADORA quando o
 * pagamento é em cartão integrado. O MAVIS ONE não tinha esse dado em lugar
 * nenhum — `adquirente`, `credenciadora`, `bandeira` e `NSU` só apareciam em
 * comentário.
 *
 * Enquanto o grupo `card` não é montado, a SEFAZ não cobra os campos dele. É
 * montá-lo PELA METADE que derruba a nota: na observação do ViperERP de
 * 08/09/2026, duas notas caíram na mesma rejeição
 *
 *   Rejeicao: Falha no Schema XML da NFe
 *   (Elemento: enviNFe/NFe[1]/infNFe/pag/detPag/card/CNPJ/) (Cod: 225)
 *
 * porque o `card` saía sem CNPJ. O operador corrigiu a nota à mão e minutos
 * depois a seguinte caiu no mesmo erro — o defeito era do cadastro, não da nota.
 * Por isso o cadastro vem ANTES do grupo `card`, e não junto.
 *
 * O CNPJ É CONFERIDO DE VERDADE, com dígito verificador. Conferir só o tamanho
 * deixaria passar um número de 14 dígitos inventado — que volta como rejeição
 * depois de a nota ter sido transmitida, que é o custo caro.
 *
 * Provado contra a API, num banco de prova:
 *   CNPJ inválido            -> recusa explicando o que acontece se passar
 *   CNPJ com máscara         -> gravado só com dígitos
 *   bandeira fora da tabela  -> descartada, sem recusar o cadastro
 *   nome/CNPJ repetidos      -> 409 com a razão de cada um
 *   forma com credenciadora inexistente -> 404
 *   excluir credenciadora em uso -> 409 nomeando a forma que a usa
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

const adquirentes = require('../lib/db/adquirentes');

console.log('--- 1. o CNPJ é conferido de verdade ---');
check('CNPJ válido passa', adquirentes.cnpjValido('11.222.333/0001-81'));
check('  e com máscara também', adquirentes.cnpjValido('01.425.787/0001-04'));
// 14 dígitos inventados passam em qualquer checagem de comprimento.
check('CNPJ de 14 dígitos inventado é recusado', !adquirentes.cnpjValido('12345678000199'));
check('todos os dígitos iguais é recusado', !adquirentes.cnpjValido('00000000000000'));
check('curto demais é recusado', !adquirentes.cnpjValido('1234'));
check('vazio é recusado', !adquirentes.cnpjValido(''));

console.log('--- 2. as bandeiras usam o código da SEFAZ ---');
// Guardar o código oficial, e não um nome interno, evita tradução no meio do
// caminho: o que está no cadastro é o que vai no XML.
check('a tabela tBand está declarada', adquirentes.BANDEIRAS.length === 10, `${adquirentes.BANDEIRAS.length} bandeiras`);
check('  com código de dois dígitos', adquirentes.BANDEIRAS.every((b) => /^\d{2}$/.test(b.codigo)));
check('  Visa é 01', adquirentes.BANDEIRAS.find((b) => b.nome === 'Visa').codigo === '01');
check('  Elo é 06', adquirentes.BANDEIRAS.find((b) => b.nome === 'Elo').codigo === '06');

console.log('--- 3. a tabela e a guarda de exclusão ---');
const migracao = ler('banco/migrations/fase-bv-adquirentes-de-cartao.sql');
check('a migração cria a tabela', /create table if not exists card_acquirers/.test(migracao));
// Duas credenciadoras com o mesmo CNPJ são a mesma cadastrada duas vezes, e a
// segunda é a que vai estar desatualizada quando alguém corrigir a primeira.
check('  com nome único', /create unique index if not exists idx_card_acquirers_nome/.test(migracao));
check('  e CNPJ único', /create unique index if not exists idx_card_acquirers_cnpj/.test(migracao));
// RLS em toda tabela nova — cobrado também por scripts/test-rls.js.
check('  com RLS ligada', /alter table if exists card_acquirers enable row level security/.test(migracao));
check('e está no arquivo do zero', /create table if not exists card_acquirers/.test(ler('banco/RECRIAR-DO-ZERO.sql')));

const src = ler('server.js');
// A guarda lê o db.json, que é onde as formas de pagamento moram. É a lição da
// fase BB dita ao contrário: lá as guardas perguntavam ao db.json o que tinha
// ido para o Postgres; aqui perguntar ao Postgres responderia vazio.
const guarda = (/function formasQueUsamAdquirente\([\s\S]*?\n\}/.exec(src) || [''])[0];
check('a guarda de uso existe', guarda.length > 0);
check('  e lê o db.json, que é onde as formas moram',
  /const data = loadData\(\);\s*\n\s*return \(data\.paymentMethods \|\| \[\]\)\.filter/.test(guarda));
const rotaDelete = src.slice(src.indexOf("if (pathname.startsWith('/api/cadastros/card-acquirers/') && req.method === 'DELETE')"));
const trechoDelete = rotaDelete.slice(0, rotaDelete.indexOf('// ====='));
check('o DELETE consulta a guarda antes de apagar',
  trechoDelete.indexOf('formasQueUsamAdquirente(id)') < trechoDelete.indexOf('adquirentesDb.excluir(id)'));
// A mensagem é montada por template, então "usa a credenciadora" só existe em
// tempo de execução: o que está na fonte é o trecho literal ao redor dele.
check('  recusando com 409 e nomeando a forma',
  /a credenciadora "\$\{adquirente\.name\}"[\s\S]{0,300}?\}, 409\);/.test(trechoDelete)
  && /\$\{nomes\}/.test(trechoDelete));

console.log('--- 4. o vínculo com a forma de pagamento ---');
const core = ler('lib/cadastros-core.js');
check('a forma de pagamento guarda a credenciadora', /cardAcquirerId,\n/.test(core));
check('  e valida contra a lista carregada pela rota',
  /if \(cardAcquirerId && Array\.isArray\(data\.cardAcquirers\)/.test(core));
// Sem a lista a validação sai de cena em vez de recusar tudo — mesmo princípio
// de degradar sem quebrar das outras fases.
check('  degradando quando a lista não veio', /&& !data\.cardAcquirers\.some/.test(core));
check('a rota genérica carrega a lista para este cadastro',
  /if \(cadastroCollectionMatch\[1\] === 'payment-methods'\) \{\s*\n\s*data\.cardAcquirers = await adquirentesDb\.listar\(\);/.test(src));
check('e o meta alimenta o select', /cardAcquirers: await adquirentesDb\.listar\(\{ apenasAtivas: true \}\)/.test(src));

console.log('--- 5. as telas ---');
const html = ler('public/index.html');
check('a lista está registrada', /MavisSubscreenRegistry\.cadastros\.credenciadoras = /.test(ler('public/modules/cadastros/subs/credenciadoras.js')));
check('o formulário também', /MavisSubscreenRegistry\.cadastros\.nova_credenciadora = /.test(ler('public/modules/cadastros/subs/nova_credenciadora.js')));
check('as duas entram no index.html',
  html.includes('modules/cadastros/subs/credenciadoras.js')
  && html.includes('modules/cadastros/subs/nova_credenciadora.js'));
// A fábrica de formulários não tem multi-seleção: dez caixas resolvem sem mexer
// nela, e o servidor remonta o array.
check('as bandeiras viram caixas no formulário',
  /type: 'checkbox' \}\)\);/.test(ler('public/modules/cadastros/subs/nova_credenciadora.js')));
check('  e o servidor as remonta em `brands`',
  /\/\^bandeira\\d\{2\}\$\/\.test\(chave\) && body\[chave\]/.test(src));
// Sem o caminho de volta, abrir para editar mostraria tudo desmarcado e salvar
// apagaria o que estava lá.
check('  com o caminho de volta para a edição', /function bandeirasParaATela\(adquirente\)/.test(src));
// Quem chamar a API direto com brands: ['01'] continua funcionando.
check('  e o array explícito continua vencendo', /if \(Array\.isArray\(body\.brands\)\) return body;/.test(src));
check('o menu de Cadastros oferece as duas telas',
  /key: 'credenciadoras'/.test(ler('public/app.js')) && /key: 'nova_credenciadora'/.test(ler('public/app.js')));

console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TODOS OS CHECKS PASSARAM =====');
process.exit(falhas ? 1 : 0);
