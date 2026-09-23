// GRUPO TRIBUTÁRIO (fase CP) — sem banco e sem servidor.
//
// A PARAMETRIZAÇÃO QUE NÃO CABIA EM NINGUÉM, medida em 21/09/2026:
//
//   produtos cadastrados ............. 5.475
//   NCM distintos entre eles ..........  759
//   regras fiscais cadastradas ........    0
//
// `resolverRegraFiscal` casava a regra pelo NCM do item, e o NCM é
// classificação ADUANEIRA: diz o que a mercadoria é, não como a empresa a
// tributa. Deixar o catálogo apto a emitir exigia até 759 regras, vezes cada
// tipo de operação, vezes cada UF. O grupo é a etiqueta que faltava no produto.
//
// O QUE ESTE TESTE PROTEGE, e cada item é um defeito que existiu ou quase:
//
//   1. o PESO do grupo na especificidade. Contando-o como critério inteiro,
//      `{ncm}` e `{grupo}` EMPATAVAM, e o empate caía na prioridade — a exceção
//      por NCM perdia para o tratamento geral se alguém não mexesse na
//      prioridade também. A prova de ponta a ponta pegou: pediu 5405, recebeu
//      5102. Meio critério resolve, e mantém intacto todo empate que já existia;
//
//   2. regra COM grupo não pode casar com produto SEM grupo. Do contrário
//      classificar o catálogo pela metade faria o produto não classificado
//      herdar o tratamento do primeiro grupo cadastrado;
//
//   3. o grupo tem de ATRAVESSAR o caminho inteiro — coluna, mapProductRow,
//      serializeProduct, item da emissão, item da aba Impostos. Qualquer elo
//      faltando e o motor casa por um critério que nunca chega: nada quebra, a
//      regra só deixa de ser encontrada;
//
//   4. o grupo precisa estar em CHAVE_DA_COLUNA_REGRA e em CAMPOS_TEXTO, senão
//      o update parcial e o formulário o apagam em silêncio;
//
//   5. a lista de grupos do formulário de produto vem pelo meta do ESTOQUE, e
//      não pela rota fiscal: quem cadastra produto normalmente não tem
//      permissão fiscal.
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const ler = (p) => fs.readFileSync(path.join(RAIZ, p), 'utf8').replace(/\r\n/g, '\n');

let falhas = 0;
const check = (n, c, d) => { console.log(`${c ? '  OK ' : '  XX '} ${n}${d ? ' -> ' + d : ''}`); if (!c) falhas++; };

const fiscalDb = ler('lib/db/fiscal.js');
const estoqueDb = ler('lib/db/estoque.js');
const stockCore = ler('lib/stock-core.js');
const serverSrc = ler('server.js');
const tributos = ler('lib/calcularTributos.js');
const regrasTela = ler('public/modules/fiscal/subs/regras.js');
const produtoTela = ler('public/modules/stock/subs/new_product.js');
const gruposTela = ler('public/modules/fiscal/subs/grupos_tributarios.js');
const migracao = ler('banco/migrations/fase-cp-grupo-tributario.sql');

console.log('\n--- 1. a migração ---');
check('cria a tabela', /create table if not exists grupo_tributario/.test(migracao));
check('com RLS, como toda tabela nova',
  /alter table if exists grupo_tributario enable row level security/.test(migracao));
check('nome único por empresa, sem depender de caixa',
  /create unique index[\s\S]{0,120}grupo_tributario \(empresa_id, lower\(nome\)\)/.test(migracao));
check('a coluna do produto é set null, não cascade',
  /alter table products add column if not exists grupo_tributario_id uuid\s*\n\s*references grupo_tributario\(id\) on delete set null/.test(migracao),
  'apagar um grupo não pode apagar produto');
check('a coluna da regra existe',
  /alter table regra_fiscal add column if not exists grupo_tributario_id uuid/.test(migracao));
// O País ficou de fora, e o motivo tem de continuar escrito: sem ele alguém
// adiciona a coluna "para completar a matriz" e ela nasce sem quem a leia.
check('explica por que País ficou de fora', /POR QUE NÃO ENTRA "PAÍS" NA MATRIZ/.test(migracao));

console.log('\n--- 2. o peso do grupo na especificidade ---');
const corpoEspecificidade = (() => {
  const i = fiscalDb.indexOf('function especificidade(row)');
  return i < 0 ? '' : fiscalDb.slice(i, fiscalDb.indexOf('\n  }', i));
})();
check('o corpo foi encontrado', corpoEspecificidade.length > 40, `${corpoEspecificidade.length} caracteres`);
// O ponto do teste: o grupo NÃO pode ser somado junto com os critérios legais.
check('o grupo NÃO está na mesma contagem dos critérios legais',
  !/\[row\.ncm, row\.grupo_tributario_id/.test(corpoEspecificidade),
  'somá-lo junto faz {ncm} empatar com {grupo}');
check('ele entra com peso próprio',
  /PESO_DO_GRUPO/.test(corpoEspecificidade) && /row\.grupo_tributario_id \? PESO_DO_GRUPO : 0/.test(corpoEspecificidade));
check('e o peso é menor que um critério',
  /const PESO_DO_GRUPO = 0\.5;/.test(fiscalDb),
  'para {ncm} ganhar de {grupo} por especificidade, não por prioridade');
check('os cinco critérios legais continuam valendo um cada',
  /const legais = \[row\.ncm, row\.origem, row\.uf_destino,\s*\n\s*row\.dentro_do_estado, row\.destinatario_contribuinte\]/.test(corpoEspecificidade));

// A tabela-verdade que o comentário promete, conferida de verdade: reimplementa
// a função a partir do peso lido do fonte e compara os pares. Se alguém mudar o
// peso para 1 achando que "arruma", este check cai antes da emissão errar.
console.log('\n--- 3. a ordem que o peso produz ---');
const peso = Number((fiscalDb.match(/const PESO_DO_GRUPO = ([\d.]+);/) || [])[1]);
const esp = (r) => [r.ncm, r.origem, r.uf_destino, r.dentro_do_estado, r.destinatario_contribuinte]
  .filter((v) => v !== null && v !== undefined).length + (r.grupo_tributario_id ? peso : 0);
const vazio = { ncm: null, grupo_tributario_id: null, origem: null, uf_destino: null, dentro_do_estado: null, destinatario_contribuinte: null };
const comNcm = { ...vazio, ncm: '84713012' };
const comGrupo = { ...vazio, grupo_tributario_id: 'g1' };
const comUf = { ...vazio, uf_destino: 'SP' };
const grupoEUf = { ...vazio, grupo_tributario_id: 'g1', uf_destino: 'SP' };
check('{ncm} ganha de {grupo}', esp(comNcm) > esp(comGrupo), `${esp(comNcm)} > ${esp(comGrupo)}`);
check('{grupo} ganha do coringa', esp(comGrupo) > esp(vazio), `${esp(comGrupo)} > ${esp(vazio)}`);
check('{ncm} e {ufDestino} continuam empatando (nada regrediu)',
  esp(comNcm) === esp(comUf), `${esp(comNcm)} == ${esp(comUf)}`);
check('{grupo, uf} ganha de {ncm}', esp(grupoEUf) > esp(comNcm), `${esp(grupoEUf)} > ${esp(comNcm)}`);

console.log('\n--- 4. regra com grupo não pega produto sem grupo ---');
check('o filtro compara os dois como texto',
  /if \(row\.grupo_tributario_id && String\(row\.grupo_tributario_id\) !== String\(grupoTributarioId \|\| ''\)\) return false;/.test(fiscalDb));
// Tolerante à quebra de linha do comentário: o texto atravessa duas linhas, e
// entre elas há o "// " de continuação.
check('e o porquê está escrito',
  /não\s*(?:\/\/\s*)?classificado herdar o tratamento do primeiro grupo/.test(fiscalDb));
check('resolverRegraFiscal recebe o critério',
  /async function resolverRegraFiscal\(\{ empresaId, ncm, grupoTributarioId,/.test(fiscalDb));

console.log('\n--- 5. o caminho completo do grupo ---');
check('mapRegraFiscalRow devolve grupoTributarioId', /grupoTributarioId: row\.grupo_tributario_id,/.test(fiscalDb));
check('CHAVE_DA_COLUNA_REGRA tem a coluna', /grupo_tributario_id: 'grupoTributarioId',/.test(fiscalDb));
check('buildRegraFiscalFields grava a coluna',
  /grupo_tributario_id: textoOuNulo\(payload\.grupoTributarioId\),/.test(fiscalDb));
check('mapProductRow devolve grupoTributarioId', /grupoTributarioId: row\.grupo_tributario_id \|\| '',/.test(estoqueDb));
check('COLUNAS_FISCAIS grava a coluna do produto',
  /grupoTributarioId: 'grupo_tributario_id'/.test(estoqueDb));
check('serializeProduct expõe o grupo', /grupoTributarioId: product\.grupoTributarioId \|\| '',/.test(stockCore));
check('a emissão passa o grupo à regra',
  /grupoTributarioId: item\.grupoTributarioId \|\| '',/.test(serverSrc));
check('e o item da emissão o toma do CADASTRO, não do corpo',
  /grupoTributarioId: produto\.grupoTributarioId \|\| '',/.test(serverSrc),
  'aceitá-lo da tela deixaria quem monta a nota escolher a tributação');
check('a aba Impostos passa o mesmo critério',
  /grupoTributarioId: item\.grupoTributarioId \|\| '',/.test(tributos),
  'sem isso a prévia escolhe uma regra e a emissão outra');
check('e o contexto do pedido o carrega',
  /grupoTributarioId: \(produto && produto\.grupoTributarioId\) \|\| '',/.test(serverSrc));
check('o POST de produto grava o grupo',
  /grupoTributarioId: String\(body\.grupoTributarioId \?\? ''\)\.trim\(\)/.test(serverSrc));

console.log('\n--- 6. as rotas ---');
check('GET lista', /pathname === '\/api\/fiscal\/grupos-tributarios' && req\.method === 'GET'/.test(serverSrc));
check('POST cria', /pathname === '\/api\/fiscal\/grupos-tributarios' && req\.method === 'POST'/.test(serverSrc));
check('POST classificar em lote',
  /pathname === '\/api\/fiscal\/grupos-tributarios\/classificar' && req\.method === 'POST'/.test(serverSrc));
check('PUT atualiza', /pathname\.startsWith\('\/api\/fiscal\/grupos-tributarios\/'\) && req\.method === 'PUT'/.test(serverSrc));
// A ausência é o teste: DELETE apagaria a classificação dos produtos e levaria
// as regras do grupo embora pelo cascade.
check('NÃO existe rota de exclusão',
  !/grupos-tributarios[\s\S]{0,200}req\.method === 'DELETE'/.test(serverSrc),
  'desativar substitui, e o porquê está em getUsoDosGruposTributarios');
check('e o fonte diz que a ausência é decisão',
  /NÃO existe exclusão de grupo por rota/.test(fiscalDb));

console.log('\n--- 7. permissão: a mesma das regras ---');
const permissao = (() => {
  const i = serverSrc.indexOf("function resolveFiscalPermission");
  return serverSrc.slice(i, serverSrc.indexOf('\n}', i));
})();
check('ler pede visualizar, escrever pede regras',
  /if \(pathname === '\/api\/fiscal\/grupos-tributarios'\) return method === 'GET' \? 'visualizar' : 'regras';/.test(permissao));
check('classificar em lote pede regras',
  /if \(pathname === '\/api\/fiscal\/grupos-tributarios\/classificar'\) return 'regras';/.test(permissao));
check('e o porquê está escrito',
  /mudar a tributação de 5\.000 produtos do que para mudar uma regra/.test(permissao));

console.log('\n--- 8. a tela de regras ---');
check('oferece o grupo no formulário', /<select name="grupoTributarioId">/.test(regrasTela));
check('grupoTributarioId está em CAMPOS_TEXTO',
  /'tipoOperacao', 'ncm', 'grupoTributarioId', 'origem'/.test(regrasTela),
  'campo fora da lista chega ao servidor apagado');
check('o simulador manda o grupo',
  /\['tipoOperacao', 'ncm', 'grupoTributarioId', 'origem', 'ufDestino'/.test(regrasTela));
check('a lista mostra o grupo pelo NOME, não pelo id',
  /partes\.push\(`grupo \$\{nomeDoGrupo\(regra\.grupoTributarioId\) \|\| '\(desativado\)'\}`\)/.test(regrasTela));
check('carregar os grupos tem catch próprio',
  /grupos-tributarios\?empresaId=\$\{encodeURIComponent\(empresaId\)\}&ativos=1`\)\s*\n\s*\.then\(\(r\) => r\.grupos \|\| \[\]\)\.catch\(\(\) => \[\]\)/.test(regrasTela),
  'empresa sem grupo ainda escreve regra por NCM');

console.log('\n--- 9. o formulário de produto ---');
check('tem o campo', /<select name="grupoTributarioId">\$\{S\.options\(meta\.grupoTributarios/.test(produtoTela));
check('manda o campo no payload', /grupoTributarioId: formData\.get\('grupoTributarioId'\),/.test(produtoTela));
check('avisa quando não há grupo cadastrado',
  /Nenhum grupo cadastrado ainda — crie em Fiscal → Grupos Tributários/.test(produtoTela));
// O ponto: a lista NÃO pode vir da rota fiscal, senão o campo aparece vazio
// para quem cadastra produto.
check('a lista vem do meta do ESTOQUE, não da rota fiscal',
  !/api\('\/api\/fiscal\//.test(produtoTela) && /meta\.grupoTributarios/.test(produtoTela));
check('e o meta do estoque a serve',
  /grupoTributarios: await fiscalDb\.getGruposTributarios\(null, \{ somenteAtivos: true \}\)/.test(serverSrc));
check('com catch, para migração não rodada não derrubar o cadastro',
  /grupoTributarios: await fiscalDb[\s\S]{0,260}\.catch\(\(\) => \[\]\)/.test(serverSrc));

console.log('\n--- 10. a tela de grupos ---');
check('está registrada', /window\.MavisSubscreenRegistry\.fiscal\.grupos_tributarios = \{ render: desenhar \}/.test(gruposTela));
check('não oferece excluir', !/excluir|Excluir/.test(gruposTela));
check('classificar em lote tem PREVER antes de APLICAR',
  /id="gtPrever"/.test(gruposTela) && /id="gtAplicar" disabled/.test(gruposTela),
  'um clique muda a tributação de um conjunto inteiro');
check('e aplica os ids que a prévia mostrou',
  /produtoIds: escolhidos/.test(gruposTela),
  'reenviar o filtro poderia aplicar a um conjunto diferente do visto');
check('mostra quantos produtos e regras usam cada grupo',
  /comUso=1/.test(gruposTela) && /<th>Produtos<\/th><th>Regras<\/th>/.test(gruposTela));
check('diz que desativar preserva o vínculo',
  /Os produtos e as regras continuam apontando para ele/.test(gruposTela));

console.log('\n--- 11. a busca de produto passou a incluir NCM ---');
check('o filtro soma o ncm',
  /\$\{p\.name\} \$\{p\.sku\} \$\{p\.ean\} \$\{p\.ncm\}/.test(serverSrc),
  'a tela anuncia "Nome, SKU ou NCM"');
check('e o filtro por grupo existe',
  /if \(grupoTributario === 'sem'\) list = list\.filter\(\(p\) => !p\.grupoTributarioId\);/.test(serverSrc));
// A asserção prende `total: list.length` e NADA MAIS da resposta. Prender a
// chave-de-fechamento (`\}\);`) travava a FORMA da rota, não o comportamento:
// a fase CT acrescentou `pendencias` ao lado de `total` e este check quebrou
// sem que nada do grupo tributário tivesse mudado. Um teste que reclama de
// campo novo ensina a não acrescentar campo.
check('a rota devolve total', /sendJson\(res, \{ products: list, total: list\.length\b/.test(serverSrc));

console.log(falhas === 0 ? '\n===== TODOS OS CHECKS PASSARAM =====' : `\n===== ${falhas} FALHA(S) =====`);
process.exit(falhas === 0 ? 0 : 1);
