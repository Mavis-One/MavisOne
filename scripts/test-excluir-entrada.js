#!/usr/bin/env node
/**
 * EXCLUIR E REFAZER A ENTRADA DE UMA NF-e RECEBIDA (16/10/2026). Pedido do
 * usuário: "adicione dois comandos para excluir a nf de entrada, e a permissão
 * para refazê-la"; e "ajuste o tamanho para fazer caber tudo na tela" nas
 * Notas contra CNPJ.
 *
 * Provado no servidor local com a NF-e 291733 de HERALDO CESAR CORREA (2
 * unidades, 1 conta a pagar): Excluir estornou o estoque (MOV de saída,
 * "estorno-entrada-nfe"), cancelou a conta a pagar com o motivo, apagou a
 * entrada e devolveu a nota a "pendente" com "Dar entrada"; com o estoque já
 * saído, recusou dizendo produto e depósito e não mexeu em nada; Refazer
 * excluiu e abriu o Dar entrada da mesma nota. Na largura de 1850 px a tabela
 * coube (1668 de 1668). Tudo apagado depois.
 */
const fs = require('fs');
const path = require('path');
const { semComentarios } = require('./sem-comentarios');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas += 1;
};
const ler = (p) => semComentarios(fs.readFileSync(path.join(__dirname, '..', p), 'utf8'));
const servidor = ler('server.js');
const ini = servidor.indexOf('async function excluirEntradaDeNfe(');
const funcao = servidor.slice(ini, servidor.indexOf('\nasync function resumoDaEntrada(', ini));

console.log('--- 1. o servidor desfaz tudo ou nada ---');
check('a rota DELETE existe (e o portão cobra Compras › excluir)',
  /const rotaExcluirEntrada = pathname\.match\(\/\^\\\/api\\\/purchases\\\/entrada-nfe\\\/\(\[\^\/\]\+\)\$\/\);\s*if \(rotaExcluirEntrada && req\.method === 'DELETE'\)/.test(servidor)
  && /DELETE: 'excluir'/.test(fs.readFileSync(path.join(__dirname, '..', 'lib/permissoes.js'), 'utf8')));
// 17/10/2026: a lançada por upload também sai (Notas de Entrada); para o
// Refazer, a resposta traz a nota recebida da chave e, ao administrador, o XML.
check('a nota recebida fica; o Refazer recebe a nota recebida e o XML (só administrador)',
  !/delete from nfe_distribuicao/.test(funcao)
  && /select id from nfe_distribuicao where chave = \$1 limit 1/.test(funcao)
  && /const xml = devolverXml\s*\?/.test(funcao)
  && /return \{ nota, chave: entrada\.chave, dfeId, xml,/.test(funcao)
  && /excluirEntradaDeNfe\(decodeURIComponent\(rotaExcluirEntrada\[1\]\), user, \{ devolverXml: await ehAdmin\(user\) \}\)/.test(servidor));
check('recusa entrada escriturada no SPED', /select 1 from fiscal_documentos where nfe_entrada_id = \$1/.test(funcao) && /já está escriturada nos documentos fiscais \(SPED\)/.test(funcao));
check('recusa conta a pagar com baixa', /estorne a baixa antes de excluir a entrada/.test(funcao));
check('acha as movimentações novas e as antigas (como o resumo)',
  /reference_id = \$1\s*or \(reference_id = '' and origin = 'entrada-nfe' and document = \$2/.test(funcao));
check('o estoque volta por estorno (saída), não apagando o histórico',
  /type: 'saida',/.test(funcao) && /origin: 'estorno-entrada-nfe',/.test(funcao) && !/delete from stock_movements/.test(funcao));
check('numa transação só: títulos, ordem, nota recebida e a entrada',
  /const desfazerTudo = \(\) => commitStockMovements\(data, estornos, productsById, \{\s*tambemNaTransacao: async \(cliente\) => \{/.test(funcao)
  && /update financial_entries set status = 'cancelado'/.test(funcao)
  && /comprasDb\.atualizarStatus\(ordem\.id, \{ status: 'ordem', type: 'order', stockApplied: false, entradaNfeId: '' \}, cliente\)/.test(funcao)
  && /update nfe_distribuicao set entrada_id = null/.test(funcao)
  && /delete from nfe_entrada where id = \$1/.test(funcao));
check('estoque já saído: recusa clara, com o nome do produto',
  /productName: nomes\.get\(m\.product_id\) \|\| ''/.test(funcao) && /o estoque que ela lançou já saiu\. /.test(funcao));
check('e fica registrado na auditoria', /action: 'entrada-nfe-excluida',/.test(funcao));

console.log('\n--- 2. a tela ---');
const tela = ler('public/modules/fiscal/subs/notas_contra_cnpj.js');
check('nota lançada ganha Refazer e Excluir', /data-refazer-entrada="\$\{escapeHtml\(doc\.id\)\}">Refazer<\/button>/.test(tela)
  && /data-excluir-entrada="\$\{escapeHtml\(doc\.id\)\}">Excluir<\/button>/.test(tela));
check('  excluir chama a rota e recarrega; refazer abre o Dar entrada',
  /await api\(`\/api\/purchases\/entrada-nfe\/\$\{encodeURIComponent\(doc\.entradaId\)\}`, \{ method: 'DELETE' \}\);/.test(tela)
  && /if \(refazer\) \{\s*darEntrada\(documentoId\);\s*return;\s*\}\s*await carregar\(\);/.test(tela));
check('a tabela cabe na tela (colunas que quebram linha)', /<table class="table table-actions dfe-tabela">/.test(tela)
  && /<td class="dfe-chave">/.test(tela) && /<td class="dfe-tipo">/.test(tela) && /<td class="dfe-acoes"><div class="finance-extrato-actions">/.test(tela));
const css = fs.readFileSync(path.join(__dirname, '..', 'public/app.css'), 'utf8');
check('  com o CSS de cada uma', /\.dfe-tabela td\.dfe-chave code \{[^}]*word-break: break-all;/.test(css) && /\.dfe-tabela td\.dfe-parte \{ white-space: normal;/.test(css));

console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TUDO OK =====');
process.exit(falhas ? 1 : 0);
