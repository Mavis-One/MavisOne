#!/usr/bin/env node
/**
 * A CONTA BANCÁRIA DO CADASTRO GRAVA DE VERDADE (fase BA).
 *
 * O BUG QUE ISTO IMPEDE DE VOLTAR
 * --------------------------------
 * `POST /api/cadastros/bank-accounts` respondia `success: true` com o registro
 * completo, e a conta não existia em lugar nenhum. Provado contra a API:
 *
 *   POST  -> 200 {"success":true,"bankAccount":{"id":"bank-1788...", ...}}
 *   GET   -> {"bankAccounts":[]}
 *   banco -> select count(*) -> 0
 *
 * A rota genérica de cadastros grava em `data[coleção]` e chama `saveData`;
 * `bankAccounts` entrou em NAO_PERSISTIR quando o db.json parou de guardar
 * cópia do que é do Postgres. A LEITURA passou para o banco, a ESCRITA não —
 * saveData removia a coleção e ninguém a gravava.
 *
 * A CLASSE DO ERRO, que é o que este teste realmente guarda: uma coleção pode
 * estar em NAO_PERSISTIR *e* na rota que grava por `saveData`. As duas listas
 * moram em arquivos diferentes e nada as obrigava a concordar. A seção 1 abaixo
 * compara as duas — qualquer coleção nova que caia nas duas quebra aqui, e não
 * na tela de alguém.
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

const servidor = ler('server.js');

console.log('--- 1. nenhuma coleção grava por saveData E está em NAO_PERSISTIR ---');
// O CHECK QUE PEGA A CLASSE INTEIRA DO ERRO, e nao so a conta bancaria.
const naoPersistir = (servidor.match(/const NAO_PERSISTIR = new Set\(\[([\s\S]*?)\]\)/) || ['', ''])[1];
const semComentarios = naoPersistir.replace(/\/\/[^\n]*/g, '');
const naoPersistidas = [...semComentarios.matchAll(/'([^']+)'/g)].map((m) => m[1]);
check('achei a lista NAO_PERSISTIR', naoPersistidas.length > 5, naoPersistidas.join(', '));

const rotaGenerica = (servidor.match(/const cadastroCollectionMatch = pathname\.match\(\/\^\\\/api\\\/cadastros\\\/\(([^)]+)\)/) || ['', ''])[1];
const naRotaGenerica = rotaGenerica.split('|').filter(Boolean);
check('achei as coleções da rota genérica', naRotaGenerica.length > 5, naRotaGenerica.join(', '));

// A rota usa o nome do endpoint ('bank-accounts'); NAO_PERSISTIR usa a chave da
// coleção ('bankAccounts'). O mapa está no cadastros-core.
const core = ler('lib/cadastros-core.js');
const chaveDoEndpoint = (endpoint) => {
  const bloco = core.match(new RegExp(`'?${endpoint.replace(/[-]/g, '\\-')}'?: \\{\\s*\\n\\s*key: '([^']+)'`));
  return bloco ? bloco[1] : null;
};
const conflitos = naRotaGenerica
  .map((endpoint) => ({ endpoint, chave: chaveDoEndpoint(endpoint) }))
  .filter(({ chave }) => chave && naoPersistidas.includes(chave));
conflitos.forEach(({ endpoint, chave }) => console.log(`        ${endpoint} -> data.${chave}`));
check('nenhuma coleção da rota genérica está em NAO_PERSISTIR', conflitos.length === 0,
  conflitos.length ? `${conflitos.length} conflito(s)` : `${naRotaGenerica.length} conferidas`);

console.log('\n--- 2. bank-accounts saiu da rota genérica ---');
check('não está mais na lista', !naRotaGenerica.includes('bank-accounts'), naRotaGenerica.join('|'));
check('e tem rotas próprias',
  /const contaBancariaMatch = pathname\.match\(\/\^\\\/api\\\/cadastros\\\/bank-accounts/.test(servidor));
// A tela e' a mesma (makeListScreen); mudar o nome da chave quebraria a lista
// sem erro nenhum aparecer.
check('com a MESMA forma de resposta que a tela espera',
  /sendJson\(res, \{ bankAccounts: await db\.getBankAccounts\(\) \}\)/.test(servidor)
  && /sendJson\(res, \{ success: true, bankAccount \}\)/.test(servidor));
const tela = ler('public/modules/cadastros/subs/contas_bancarias.js');
check('  e a tela continua apontando para o mesmo endpoint',
  /endpoint: '\/api\/cadastros\/bank-accounts'/.test(tela)
  && /listKey: 'bankAccounts'/.test(tela));

console.log('\n--- 3. a validação não foi copiada ---');
// Duplicar as regras aqui deixaria as duas metades divergirem na primeira
// mudanca do formulario.
check('a rota reusa o build do cadastros-core',
  /const config = cadastrosCore\.CADASTRO_COLLECTIONS\['bank-accounts'\];[\s\S]{0,300}config\.build\(body, atual, loadData\(\), helpers\)/.test(servidor));
check('e reusa a checagem de "em uso"',
  /CADASTRO_COLLECTIONS\['bank-accounts'\]\.inUse\(id, dados\)/.test(servidor));
// Sem o sync, data.finance chega vazio e a checagem diria "ninguem usa" sobre
// uma conta cheia de lancamentos.
check('  com o financeiro carregado antes de perguntar',
  /await syncFinanceData\(dados\);\s*\n\s*const bloqueio = cadastrosCore/.test(servidor));
// Contra `data.bankAccounts` a checagem leria vazio — era parte do mesmo bug.
check('a duplicata é conferida contra o BANCO',
  /const todas = await db\.getBankAccounts\(\);/.test(servidor));

console.log('\n--- 4. as duas palavras "ativo" não se misturam ---');
const dados = ler('lib/db/financeiro.js');
// status  = 'ativa'|'erro'|'desconectada'  -> a CONEXAO Open Finance
// ativo   = true|false                     -> o CADASTRO esta em uso
check('o cadastro usa a coluna `ativo`', /ativo: row\.ativo !== false/.test(dados));
check('  e a conexão continua com `status`', /status: row\.status \|\| ''/.test(dados));
check('a rota converte ativo/inativo em booleano',
  /const payload = \{ \.\.\.built, ativo: built\.status !== 'inativo' \};[\s\S]{0,120}delete payload\.status;/.test(servidor));

console.log('\n--- 5. o tipo da conta é um campo só ---');
// Duas colunas de tipo seriam duas respostas para a mesma pergunta.
check('formulário e Open Finance caem na mesma coluna',
  /const tipo = payload\.accountType \|\| payload\.type;/.test(dados));
const mig = ler('banco/migrations/fase-ba-conta-bancaria-do-cadastro.sql');
check('e o CHECK aceita os cinco do formulário',
  /'corrente', 'poupanca', 'credito', 'pagamento', 'caixa', 'investimento'/.test(mig));

console.log('\n--- 6. a migração ---');
['bank_code', 'agency_digit', 'number_digit', 'holder', 'holder_document',
  'pix_key', 'initial_balance', 'notes', 'ativo'].forEach((coluna) => {
  check(`  cria ${coluna}`, new RegExp(`add column if not exists ${coluna}\\s`).test(mig));
});
// `ativo` nascer false esconderia toda conta existente do formulario de
// lancamento de um dia para o outro.
check('e `ativo` nasce true', /add column if not exists ativo\s+boolean not null default true/.test(mig));

console.log('\n--- 7. a sincronização não pisa no que a pessoa digitou ---');
// updateBankAccount agora e' usado pelos DOIS caminhos. A garantia antiga vinha
// de a funcao nao conhecer os campos; agora vem de `!== undefined`.
const fonteUpdate = (dados.match(/async function updateBankAccount[\s\S]*?\n\}/) || [''])[0];
check('cada campo só é tocado quando vem definido',
  fonteUpdate.length > 0
  && !/row\.name = payload\.name;\s*\n(?!.*undefined)/.test(fonteUpdate)
  && (fonteUpdate.match(/!== undefined/g) || []).length >= 14,
  `${(fonteUpdate.match(/!== undefined/g) || []).length} campos guardados`);
check('e existe como apagar', /async function deleteBankAccount/.test(dados));

console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TODOS OS CHECKS PASSARAM =====');
process.exit(falhas ? 1 : 0);
