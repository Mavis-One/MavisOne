// Arquivos Anexados ao pedido/orçamento.
//
// Passo 7 do módulo Vendas. O que este teste guarda:
//
//   1. os bytes saem pelo servidor e NÃO existe URL para o arquivo. URL de
//      arquivo vaza fácil — e-mail, print, log de proxy — e anexo de pedido tem
//      contrato e dado de cliente dentro;
//   2. o binário mora numa tabela SEPARADA (fase AM), não dentro do pedido:
//      é o que faz listar pedidos não arrastar megabyte de PDF junto;
//   3. as rotas de anexo vêm ANTES das genéricas de /api/sales/records/:id,
//      senão o GET genérico engole ".../anexos/<id>";
//   4. o corpo da requisição tem teto. Sem teto, um upload grande enche a
//      memória do processo antes de qualquer validação.
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const ler = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');
const semComentarios = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};

require('dotenv').config();
const anexos = require('../lib/db/anexos');

console.log('--- não existe caminho, então não existe travessia (fase AM) ---');
const anexosSrc = semComentarios(ler('lib/db/anexos.js'));
// Enquanto o arquivo morava num bucket, o nome dele virava CAMINHO, e "../" na
// chave escaparia da pasta do pedido — havia um nomeTecnico() só para isso.
// Agora o binário é uma linha de tabela endereçada pelo id: o nome do arquivo
// não endereça mais nada. O check mudou de "sanea o nome" para "não há nome
// nenhum sendo usado como endereço", que é a versão forte da mesma garantia.
check('nenhum caminho é montado a partir do nome', !/pedidos\/|caminho/.test(anexosSrc));
check('o binário é achado pelo id da ficha', /\.eq\('id', ficha\.id\)/.test(anexosSrc));
check('e o nome original é preservado inteiro', /nome,\s*$/m.test(anexosSrc) || /nome\b/.test(anexosSrc));

console.log('\n--- o arquivo é privado, e os bytes saem pelo servidor ---');
// Se algum dia alguém devolver uma URL daqui, o arquivo passa a ser legível por
// quem tiver o link, sem sessão. Não pode existir nem a possibilidade.
check('não devolve URL de espécie alguma', !/getPublicUrl|createSignedUrl|https?:\/\//.test(anexosSrc));
check('o Storage do Supabase não é mais tocado', !/supabase\.storage|createBucket|\.upload\(/.test(anexosSrc));
check('baixa os bytes e devolve buffer', /return \{ bytes: hexParaBytes/.test(anexosSrc));
// INSERT, não upsert: o id já é único, e sobrescrever transformaria uma colisão
// improvável em perda silenciosa de arquivo. Com insert, colisão vira erro
// 23505 e alguém fica sabendo.
check('gravar não sobrescreve (insert, não upsert)', /from\('pedido_anexo'\)\.insert\(/.test(anexosSrc) && !/pedido_anexo'\)\.upsert/.test(anexosSrc));
check('há limite por arquivo', /LIMITE_BYTES = 10 \* 1024 \* 1024/.test(anexosSrc));
// Ficha órfã (arquivo que não veio do Storage antigo) tem de poder ser removida
// da tela: um DELETE que não acha nada não é erro em SQL, e o código não
// inventa um.
check('remover arquivo ausente não trava', /delete\(\)\.eq\('id', ficha\.id\)/.test(anexosSrc));
check('e baixar ficha órfã explica o que houve', /não está neste banco/.test(ler('lib/db/anexos.js')));

console.log('\n--- o Content-Type volta para um cabeçalho, então passa por peneira ---');
check('tipo comum passa', anexos.tipoSeguro('application/pdf') === 'application/pdf');
check('tipo com quebra de linha vira o genérico', anexos.tipoSeguro('text/html\r\nX-Oi: 1') === 'application/octet-stream',
  anexos.tipoSeguro('text/html\r\nX-Oi: 1'));
check('tipo vazio vira o genérico', anexos.tipoSeguro('') === 'application/octet-stream');

console.log('\n--- a tabela do binário existe e é separada do pedido ---');
const faseAm = ler('supabase/migrations/fase-am-anexos-no-banco.sql');
check('fase-am cria pedido_anexo', /create table if not exists pedido_anexo/.test(faseAm));
check('o conteúdo é bytea', /conteudo bytea not null/.test(faseAm));
// O ponto todo: a ficha continua em orders.attachments, então listar pedido não
// arrasta megabyte de PDF junto. Se a coluna do binário aparecesse em orders, a
// objeção da fase AI voltaria a valer.
check('e o binário NÃO foi parar em orders', !/orders add column[^\n]*conteudo|orders[^\n]*bytea/.test(faseAm));
check('há índice por registro_id (excluir pedido não varre a tabela)', /create index if not exists idx_pedido_anexo_registro/.test(faseAm));

console.log('\n--- o servidor ---');
const serverSrc = semComentarios(ler('server.js'));
check('as rotas de anexo existem', /rotaAnexo = pathname\.match/.test(serverSrc));
// O GET genérico casa com qualquer coisa depois da barra: viesse antes,
// engoliria ".../anexos/<id>" achando que é um código de pedido.
const posAnexo = serverSrc.indexOf('const rotaAnexo = pathname.match');
const posGenerico = serverSrc.indexOf("if (pathname.startsWith('/api/sales/records/') && req.method === 'GET')");
check('e vêm ANTES da rota genérica de registro', posAnexo > -1 && posAnexo < posGenerico,
  `anexo ${posAnexo}, genérico ${posGenerico}`);
check('exigem sessão e permissão do módulo', /rotaAnexo[\s\S]{0,900}allowedModules\.includes\('sales'\)/.test(serverSrc));
check('o download não expõe URL, entrega bytes', /Content-Disposition[\s\S]{0,80}filename\*=UTF-8/.test(serverSrc));
// Anexo é documento comercial: cache de disco compartilhado não serve.
check('e não deixa o arquivo em cache', /'Cache-Control': 'private, no-store'/.test(serverSrc));
check('enviar e excluir gravam auditoria',
  /action: 'anexarArquivoPedido'/.test(serverSrc) && /action: 'excluirAnexoPedido'/.test(serverSrc));
// A função de auditoria certa: `addAuditLog` não existe neste servidor.
check('usam registrarAuditoria, que existe', (serverSrc.match(/registrarAuditoria\(\{\s*$/gm) || []).length > 0
  || /await registrarAuditoria\(\{/.test(serverSrc));
// Um arquivo grande demais no meio da seleção não pode derrubar os outros.
check('um arquivo ruim não derruba a leva', /erros\.push\(erro\.message\)/.test(serverSrc));
check('o serializer devolve as fichas', /attachments: Array\.isArray\(record\.attachments\)/.test(serverSrc));
// Excluir o pedido tem de levar os arquivos junto. Sem isto o registro some do
// banco e os arquivos ficam para sempre no Storage, sem nada apontando para
// eles: ninguém os vê pela tela, ninguém os apaga, e a conta cresce sozinha.
check('excluir o pedido apaga os anexos do Storage',
  /record\.attachments : \[\]\)\) \{[\s\S]{0,200}anexosDb\.removerAnexo/.test(serverSrc));
// E ANTES de excluir o registro: depois, as fichas já não existem para dizer
// QUAIS arquivos apagar.
check('  e antes de apagar o registro',
  serverSrc.indexOf('anexosDb.removerAnexo(ficha)') < serverSrc.indexOf('db.deleteOrder(id) : db.deleteQuote(id)'));
// Um arquivo que falha ao apagar não pode manter o pedido vivo.
check('  e falha de um arquivo não trava a exclusão', /try \{[\s\S]{0,80}removerAnexo\(ficha\)[\s\S]{0,120}console\.error\('\[anexos\] arquivo orfao/.test(serverSrc));

console.log('\n--- o corpo da requisição tem teto ---');
// Sem teto, o corpo era acumulado em memória até o cliente parar de mandar.
check('readBody aceita limite', /function readBody\(req, limiteBytes = LIMITE_CORPO_PADRAO\)/.test(serverSrc));
check('e corta quando estoura', /recebidos > limiteBytes/.test(serverSrc));
// Continuar lendo o que já passou do teto é o que o teto existe para impedir.
check('destruindo a conexão', /req\.destroy\(\)/.test(serverSrc));
check('devolvendo 413', /err\.status = 413/.test(serverSrc));
// base64 é ~33% maior que o binário: o teto do upload tem de ser maior.
check('o upload tem teto próprio e maior', /readBody\(req, 16 \* 1024 \* 1024\)/.test(serverSrc));

console.log('\n--- a migração é aditiva ---');
const sql = ler('supabase/migrations/fase-ai-anexos-do-pedido.sql');
check('cria attachments em orders', /alter table if exists orders add column if not exists attachments jsonb/.test(sql));
check('e em quotes também', /alter table if exists quotes add column if not exists attachments jsonb/.test(sql));
check('com padrão de lista vazia', /default '\[\]'::jsonb/.test(sql));
check('não apaga nem altera nada', !/\b(drop|delete|truncate|alter column)\b/i.test(sql));
// O binário no banco faria cada leitura da LISTA de pedidos arrastar megabytes
// de PDF que ninguém pediu.
// Sem tirar os comentários, o próprio comentário que EXPLICA por que não usar
// bytea fazia este check reprovar.
const sqlLimpo = sql.replace(/^\s*--.*$/gm, '');
check('a coluna guarda ficha, não binário', /jsonb/.test(sqlLimpo) && !/bytea/.test(sqlLimpo));

console.log('\n--- degrada se a fase-AI não rodou ---');
const dbSrc = semComentarios(ler('lib/db/vendas-compras.js'));
check('a fase AI entra no fallback', /nome: 'Fase AI', colunas: COLUNAS_FASE_AI/.test(dbSrc));
check('a perda é explicada', /o pedido esquece que ele existe/.test(ler('lib/db/vendas-compras.js')));
check('a leitura devolve attachments', /attachments: Array\.isArray\(row\.attachments\)/.test(dbSrc));

console.log('\n--- a tela ---');
const appSrc = ler('public/app.js');
check('a aba existe', /\{ id: 'arquivos', label: 'Arquivos Anexados' \}/.test(appSrc));
check('aceita vários arquivos', /id="salesAnexoInput" multiple/.test(appSrc));
check('mostra nome, tamanho, data e quem enviou', /salesFormatTamanho\(a\.tamanho\)/.test(appSrc) && /a\.enviadoPor/.test(appSrc));
// Registro novo não tem id, e o arquivo é guardado numa pasta com esse id.
check('registro não salvo explica em vez de aceitar arquivo', /Salve o \$\{title\.toLowerCase\(\)\} primeiro/.test(appSrc));
// Depois do await o navegador já não considera a abertura como gesto do
// usuário e bloqueia a janela — mesmo caminho da DANFE.
// Sem comentários e com janela maior: há uma explicação escrita entre as duas
// linhas, e a primeira versão deste check media só 200 caracteres de fonte cru.
check('a aba é aberta ANTES do fetch',
  /const aba = window\.open\('', '_blank'\);[\s\S]{0,400}await fetch/.test(semComentarios(appSrc)));
check('e o token vai no cabeçalho', /'x-auth-token': getSessionToken\(\)/.test(appSrc));
// Excluir apaga o arquivo do Storage — não há lixeira.
check('excluir pede confirmação dizendo que não volta', /não dá para recuperar/.test(appSrc));
check('o formatador de tamanho existe', /const salesFormatTamanho/.test(appSrc));

console.log(`\n===== ${falhas === 0 ? 'TODOS OS CHECKS PASSARAM' : falhas + ' FALHA(S)'} =====`);
process.exit(falhas ? 1 : 0);
