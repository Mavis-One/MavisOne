// Arquivos Anexados ao pedido/orçamento.
//
// Passo 7 do módulo Vendas. O que este teste guarda:
//
//   1. o bucket é PRIVADO e os bytes saem pelo servidor, nunca por URL do
//      Storage. URL de arquivo vaza fácil — e-mail, print, log de proxy — e
//      anexo de pedido tem contrato e dado de cliente dentro;
//   2. o nome do arquivo é saneado antes de virar caminho. "../" na chave
//      escaparia da pasta do pedido;
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

console.log('--- o nome do arquivo não vira caminho perigoso ---');
// "../" na chave escaparia da pasta do pedido e escreveria em outra.
check('".." é neutralizado', !anexos.nomeTecnico('../../etc/passwd').includes('/'),
  anexos.nomeTecnico('../../etc/passwd'));
check('barra some', !anexos.nomeTecnico('a/b/c.pdf').includes('/'), anexos.nomeTecnico('a/b/c.pdf'));
// Acento e espaço quebram a chave em alguns clientes de Storage.
check('acento e espaço saem', anexos.nomeTecnico('Proposta Comercial — Ação.pdf') === 'Proposta-Comercial-Acao.pdf',
  anexos.nomeTecnico('Proposta Comercial — Ação.pdf'));
check('nome vazio ainda gera algo', anexos.nomeTecnico('') === 'arquivo');
// A extensão é o que faz o navegador saber abrir o arquivo.
check('a extensão sobrevive', anexos.nomeTecnico('contrato.final.pdf').endsWith('.pdf'));
// Nome absurdamente longo estoura o limite de chave do Storage.
check('nome gigante é aparado', anexos.nomeTecnico('x'.repeat(500)).length <= 80,
  String(anexos.nomeTecnico('x'.repeat(500)).length));

console.log('\n--- o bucket é privado, e os bytes saem pelo servidor ---');
const anexosSrc = semComentarios(ler('lib/db/anexos.js'));
check('createBucket declara public: false', /public: false/.test(anexosSrc));
// Se algum dia alguém trocar download por URL assinada, o arquivo passa a ser
// legível por quem tiver o link, sem sessão.
check('não devolve URL do Storage', !/getPublicUrl|createSignedUrl/.test(anexosSrc));
check('baixa os bytes e devolve buffer', /\.download\(ficha\.caminho\)/.test(anexosSrc) && /Buffer\.from\(await data\.arrayBuffer\(\)\)/.test(anexosSrc));
// Sem upsert: o caminho já é único pelo id, e sobrescrita transformaria uma
// colisão improvável em perda silenciosa de arquivo.
check('upload não sobrescreve', /upsert: false/.test(anexosSrc));
check('o bucket é criado sozinho na primeira vez', /createBucket\(BUCKET/.test(anexosSrc));
// Dois uploads na primeira vez chegam juntos: "already exists" é sucesso.
check('e criação concorrente não é tratada como falha', /already exists/.test(anexosSrc));
check('há limite por arquivo', /LIMITE_BYTES = 10 \* 1024 \* 1024/.test(anexosSrc));
// Ficha órfã (arquivo já sumiu do Storage) tem de poder ser removida da tela.
check('remover arquivo ausente não trava', /not found/i.test(anexosSrc));

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
