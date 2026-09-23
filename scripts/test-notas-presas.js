// NOTAS COM PROBLEMA (fase CR) — sem banco e sem servidor.
//
// A TELA EXISTE PORQUE O DADO EXISTIA E NÃO TINHA ONDE APARECER.
// `nfe.mensagem_sefaz` guarda a recusa desde o início. Ela era visível em dois
// lugares, e nenhum deles é onde alguém olha por rotina:
//
//   Logs NF-e ......... ordem cronológica de TUDO. Para achar a recusa de ontem
//                       é preciso rolar por cima de todas as autorizações;
//   tela de emissão ... mostra a mensagem da nota que falhou, mas só se você já
//                       souber qual nota procurar.
//
// E o Painel Fiscal mostra a contagem por status numa rosca: dá para ver que
// existem três notas com erro, e não dá para saber quais nem por quê.
//
// O QUE ESTE TESTE PROTEGE:
//
//   1. o RECORTE. Só os quatro status inacabados entram. Deixar AUTORIZADO ou
//      CANCELADO entrar transformaria a tela numa segunda lista de notas, que já
//      existe, e enterraria as quatro que importam;
//   2. a ORDEM por GRAVIDADE, e não por data. DENEGADO primeiro porque é o
//      único irreversível: consumiu numeração, não pode ser cancelado, e ainda
//      precisa ser escriturado. Ordenar por data poria um rascunho de hoje na
//      frente de uma denegada da semana passada;
//   3. o CÓDIGO do pedido, por junção. A lista de vendas filtra por TEXTO, e o
//      `order_id` é um uuid que a busca não acha. Sem o código, o botão "ver
//      pedido" entrega os 14.864 pedidos sem filtro — que é exatamente o que
//      `irParaVenda` (public/modules/finance/subs/nfe_emitidas.js) faz hoje;
//   4. que a tela NÃO oferece excluir. Documento fiscal não se apaga, e nota
//      denegada é justamente a que alguém quer apagar.
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const ler = (p) => fs.readFileSync(path.join(RAIZ, p), 'utf8').replace(/\r\n/g, '\n');

let falhas = 0;
const check = (n, c, d) => { console.log(`${c ? '  OK ' : '  XX '} ${n}${d ? ' -> ' + d : ''}`); if (!c) falhas++; };

const fiscalDb = ler('lib/db/fiscal.js');
const serverSrc = ler('server.js');
const tela = ler('public/modules/fiscal/subs/notas_presas.js');
const appJs = ler('public/app.js');
const indexHtml = ler('public/index.html');

console.log('\n--- 1. o recorte de status ---');
check('os quatro status inacabados',
  /const STATUS_COM_PROBLEMA = \['DENEGADO', 'ERRO', 'PROCESSANDO', 'RASCUNHO'\];/.test(fiscalDb));
// A ausência é o teste: com um destes na lista, a tela deixa de ser sobre o que
// ficou pelo caminho.
check('AUTORIZADO e CANCELADO ficam FORA',
  !/STATUS_COM_PROBLEMA = \[[^\]]*AUTORIZADO/.test(fiscalDb)
  && !/STATUS_COM_PROBLEMA = \[[^\]]*CANCELADO/.test(fiscalDb),
  'essas duas já têm lista própria');
// O catálogo do banco tem sete status; os dois que sobram (AUTORIZADO,
// CANCELADO) são exatamente os que STATUS_ESCRITURAVEIS cobre.
check('e os dois conjuntos juntos cobrem os sete do banco',
  /STATUS_ESCRITURAVEIS = \['AUTORIZADO', 'CANCELADO'\]/.test(fiscalDb),
  'DENEGADO fica fora dos dois — é o achado registrado na auditoria do SPED');

console.log('\n--- 2. a ordem é por gravidade ---');
check('a consulta ordena por CASE de status, não por data',
  /order by case n\.status\s*\n\s*when 'DENEGADO' then 1\s*\n\s*when 'ERRO' then 2/.test(fiscalDb));
check('e, dentro da gravidade, a mais antiga primeiro',
  /coalesce\(n\.criado_em, n\.data_emissao\) asc/.test(fiscalDb),
  'nota parada há mais tempo é a que já pode ser problema de prazo');
check('a gravidade é exportada para a tela usar a MESMA ordem',
  /GRAVIDADE_DO_STATUS/.test(fiscalDb) && /GRAVIDADE_DO_STATUS,/.test(fiscalDb));

console.log('\n--- 3. o código do pedido vem por junção ---');
check('a consulta faz left join em orders',
  /left join orders o on o\.id = n\.order_id/.test(fiscalDb));
check('e é LEFT, para nota avulsa não desaparecer',
  /`left join` porque nota avulsa/.test(fiscalDb));
// `|| ''` em número é defeito: código 0 viraria vazio e o botão desapareceria.
check('orderCode é string por comparação com null, não por `|| \'\'`',
  /orderCode: r\.order_code === null \|\| r\.order_code === undefined \? '' : String\(r\.order_code\)/.test(fiscalDb));
check('a tela navega pelo CÓDIGO, não pelo uuid',
  /data-codigo=/.test(tela) && !/data-pedido=/.test(tela));
check('e põe o código na busca da lista de vendas',
  /draft\.ordersFilters = \{ search: botao\.dataset\.codigo \}/.test(tela));
check('marcando a URL como já lida, senão o filtro é descartado no 1º desenho',
  /draft\.ordersUrlLida = true;/.test(tela));
check('e vai para a sub-tela que EXISTE',
  /state\.activeSub = 'orders_quotes';/.test(tela),
  "'sales_records', usada por nfe_emitidas.js, não existe em moduleSubItems");

console.log('\n--- 4. a mensagem da SEFAZ chega inteira ---');
check('a coluna é lida',
  /mensagemSefaz: r\.mensagem_sefaz \|\| '',/.test(fiscalDb));
check('e não é recortada para extrair só o código',
  /recortar o código faria a tela perder a parte/.test(fiscalDb),
  'o número da rejeição vem dentro do texto, junto do campo culpado');
check('a tela mostra o texto, e diz quando não há nenhum',
  /a nota não chegou a ser transmitida/.test(tela));

console.log('\n--- 5. o que cada status significa para a NUMERAÇÃO ---');
// É a razão de ser da tela: sem isto ela é a rosca do painel em forma de tabela.
check('DENEGADO avisa que a numeração foi consumida',
  /DENEGADO: \{ consumiu: true/.test(tela));
check('e que a nota ainda precisa ser escriturada',
  /precisa ser escriturada/.test(tela));
check('ERRO avisa que a numeração NÃO foi consumida',
  /ERRO: \{ consumiu: false/.test(tela));
check('PROCESSANDO usa a IDADE como dado',
  /function idade\(/.test(tela) && /Parada há/.test(tela));
check('e a idade compara em UTC, sem converter para local',
  /Date\.parse\(iso\)/.test(tela));

console.log('\n--- 6. a rota ---');
check('existe e é GET',
  /pathname === '\/api\/fiscal\/nfe\/problemas' && req\.method === 'GET'/.test(serverSrc));
check('exige o estabelecimento',
  /if \(!estabelecimentoId\) return sendJson\(res, \{ error: 'Escolha o estabelecimento\.' \}, 400\);/.test(serverSrc));
check("a permissão é 'visualizar', como o pré-check",
  /if \(pathname === '\/api\/fiscal\/nfe\/problemas'\) return 'visualizar';/.test(serverSrc));
check('e é EXPLÍCITA, não herdada do catch-all de /api/fiscal/nfe/',
  /Explicito AQUI, e nao deixado para o/.test(serverSrc));
// A rota /api/fiscal/nfe traz TODA nota com as 28 colunas, inclusive dois jsonb
// gordos. Reaproveitá-la aqui era o caminho fácil e o errado.
check('a consulta é própria, e o porquê está escrito',
  /Consulta própria, e não um filtro sobre \/api\/fiscal\/nfe/.test(serverSrc));

console.log('\n--- 7. a tela está registrada ---');
check('no registry', /window\.MavisSubscreenRegistry\.fiscal\.notas_presas = \{ render: desenhar \}/.test(tela));
check('no menu', /key: 'notas_presas'/.test(appJs));
check('com script tag', /subs\/notas_presas\.js/.test(indexHtml));
check('depois do Painel Fiscal, e o porquê está escrito',
  /o painel mostra QUANTAS notas/.test(appJs));

console.log('\n--- 8. o que a tela NÃO faz ---');
// A AÇÃO, e não a palavra: a primeira versão deste check procurava "excluir" no
// fonte e acusava o próprio texto que EXPLICA que não há exclusão. Teste que
// reclama de palavra ensina a esconder a palavra — é a mesma lição que
// `sem-comentarios.js` existe para aplicar.
check('não faz nenhuma chamada de exclusão',
  !/method: 'DELETE'/.test(tela) && !/\bDELETE\b/.test(tela));
check('e não tem botão de excluir',
  !/<button[^>]*>\s*(Excluir|Apagar)/i.test(tela) && !/data-(excluir|apagar)=/.test(tela));
check('e diz por que não', /fiscal não se exclui/.test(tela));
check('não promete corrigir a nota aqui',
  /Ela não corrige a nota/.test(tela),
  'o VM-FIS-04 pedia "botão que leva ao campo culpado"; esse caminho não existe');

console.log(falhas === 0 ? '\n===== TODOS OS CHECKS PASSARAM =====' : `\n===== ${falhas} FALHA(S) =====`);
process.exit(falhas === 0 ? 0 : 1);
