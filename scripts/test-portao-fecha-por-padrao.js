#!/usr/bin/env node
/**
 * O PORTÃO FECHA POR PADRÃO, E "LIVRE" DEIXOU DE QUERER DIZER DUAS COISAS
 * (fase CA — achados 04 e 05 da varredura de 11/09/2026).
 *
 * 1. SEM PERMISSÃO MAPEADA NÃO É MAIS SINÔNIMO DE LIBERADO
 *    -----------------------------------------------------
 *    `resolverPermissao()` devolve null para prefixo fora do mapa, e
 *    `verificarAcesso` traduzia isso em `permitido: true`. Só 16 prefixos estão
 *    mapeados — `/api/fiscal`, `/api/me` e `/api/audit` ficavam de fora.
 *
 *    Sondadas as 112 rotas sem token: 86×401, 24×403, 2×404, ZERO respostas
 *    2xx. Nenhuma estava aberta, porque cada uma conferia por conta própria.
 *    Mas isso é um acordo entre programadores, não uma garantia: a próxima
 *    rota escrita fora dos prefixos nasceria sem portão — que é exatamente o
 *    furo que o portão foi criado para não ter.
 *
 * 2. "ROTAS_LIVRES" MISTURAVA DUAS IDEIAS, E CUSTOU DOS DOIS LADOS
 *    -------------------------------------------------------------
 *    "Livre" queria dizer ao mesmo tempo "não precisa de sessão" e "o portão
 *    não decide, quem decide é a rota". Consequência medida, com o segredo
 *    CERTO no cabeçalho e sem sessão:
 *
 *      POST /api/fiscal/webhooks/focus        -> 200  (estava na lista)
 *      POST /api/open-finance/webhooks/pluggy -> 401  (não estava)
 *
 *    O webhook do Open Finance estava INALCANÇÁVEL pelo provedor desde que foi
 *    escrito — o portão exigia sessão de quem nunca teria uma, e a conferência
 *    do segredo compartilhado nem chegava a rodar.
 *
 * 3. A CAIXA "RELATÓRIOS" NÃO FECHAVA RELATÓRIO NENHUM
 *    -------------------------------------------------
 *    O portão decide por PAPEL (`reports.ler`), e o papel 'Usuário' já traz
 *    essa permissão. Um usuário com `dashboard, sales` e Relatórios desmarcado
 *    recebia 200 em `/api/reports/overview`: contasAPagar, contasAReceber,
 *    série de receitas e despesas, estoque — a posição financeira da empresa,
 *    e sem escopo nenhum por trás.
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

const P = require('../lib/permissoes');
const src = ler('server.js');

console.log('--- 1. público e "portão na própria rota" são listas diferentes ---');
check('existe a lista de rotas PÚBLICAS', Array.isArray(P.ROTAS_PUBLICAS));
check('  e ela é curta, de propósito', P.ROTAS_PUBLICAS.length === 3, `${P.ROTAS_PUBLICAS.length} entradas`);
// Quem entra sem sessão precisa ter OUTRA prova de identidade: o login tem a
// senha, os webhooks têm o segredo compartilhado no cabeçalho.
check('o login é público', P.rotaPublica('/api/login'));
check('o webhook fiscal é público', P.rotaPublica('/api/fiscal/webhooks/focus'));
check('o webhook do Open Finance também', P.rotaPublica('/api/open-finance/webhooks/pluggy'));

// Estas o portão não resolve — mas exigem sessão. Antes, estar nesta lista
// significava entrar sem nenhuma.
check('/api/me NÃO é público', !P.rotaPublica('/api/me'));
check('  mas o portão não decide por ele', P.rotaLivre('/api/me'));
check('/api/fiscal NÃO é público', !P.rotaPublica('/api/fiscal/nfe'));
check('  e o Fiscal decide por conta própria', P.rotaLivre('/api/fiscal/nfe'));

console.log('--- 2. o padrão virou: exige sessão ---');
check('rota /api/ fora do mapa exige sessão', P.exigeSessao('/api/rota-que-alguem-vai-escrever'));
check('/api/me exige sessão', P.exigeSessao('/api/me'));
check('/api/fiscal exige sessão', P.exigeSessao('/api/fiscal/nfe'));
check('/api/sales exige sessão', P.exigeSessao('/api/sales/records'));
// As três que não exigem — e nenhuma a mais.
check('o login NÃO exige', !P.exigeSessao('/api/login'));
check('os webhooks NÃO exigem',
  !P.exigeSessao('/api/fiscal/webhooks/focus') && !P.exigeSessao('/api/open-finance/webhooks/pluggy'));
// Página, CSS e JS não são /api/ — o portão não se aplica a eles.
check('fora de /api/ o portão não se mete', !P.exigeSessao('/modules/router.js') && !P.exigeSessao('/'));

console.log('--- 3. o portão usa isso ---');
const portao = (/async function verificarAcesso\(req, pathname\) \{[\s\S]*?\n\}/.exec(src) || [''])[0];
check('verificarAcesso consulta exigeSessao', /if \(!permissoes\.exigeSessao\(pathname\)\) return/.test(portao));
// O que NÃO pode voltar: o `return { permitido: true }` seco para permissão nula.
check('  e não libera mais por permissão nula',
  !/if \(!permissao\) return \{ permitido: true/.test(portao));
check('  buscando o usuário quando não há permissão mapeada',
  /const usuario = await getCurrentUser\(req\);\s*\n\s*return \{ permitido: Boolean\(usuario\)/.test(portao));

console.log('--- 4. relatórios respeitam a caixa de módulo ---');
check('a regra existe', /function podeVerRelatorios\(user, ehAdministrador\)/.test(src));
// O "ou administrador" não é folga: sem ele, um admin cuja linha não tem
// 'reports' em allowed_modules seria barrado na ferramenta que ele usa para
// conferir o sistema. O receio anotado no código antes era correto; o errado
// era a conclusão de não conferir nada.
check('  admin passa mesmo sem a caixa',
  /ehAdministrador \|\| user\.allowedModules\.includes\('reports'\)/.test(src));
const relatorio = src.slice(src.indexOf('async function montarRelatorioDeVendas'));
check('o relatório de vendas confere', /if \(!podeVerRelatorios\(user, ehAdministrador\)\)/.test(relatorio.slice(0, 3000)));
check('o overview confere', /if \(!podeVerRelatorios\(user, await ehAdmin\(user\)\)\)/.test(src));
// A exportação sai pelo mesmo montador, então herda a conferência — o que
// importa é que ela NÃO tenha um caminho próprio sem checagem.
check('  e a exportação passa pelo mesmo montador',
  /const contexto = await montarRelatorioDeVendas\(req, url\.searchParams\);/.test(src));

console.log('--- 5. o que foi medido contra a API ---');
// Registro do que a prova mostrou, para quem mexer nisto saber o que esperar.
const medido = [
  ['rota /api/ inexistente, sem token', '401 (antes caía direto em 404)'],
  ['a mesma, com token', '404'],
  ['webhook fiscal, segredo certo, sem sessão', '200'],
  ['webhook Open Finance, segredo certo, sem sessão', '200 (antes 401)'],
  ['qualquer webhook, segredo errado', '401'],
  ['usuário com dashboard+sales em /reports/*', '403 (antes 200)'],
  ['admin sem a caixa Relatórios', '200 (sem regressão)'],
  ['usuário COM a caixa Relatórios', '200'],
  ['as 112 rotas sem token', '0 respostas 2xx']
];
for (const [caso, esperado] of medido) console.log(`  ·  ${caso.padEnd(48)} ${esperado}`);

console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TODOS OS CHECKS PASSARAM =====');
process.exit(falhas ? 1 : 0);
