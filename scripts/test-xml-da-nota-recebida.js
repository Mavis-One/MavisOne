#!/usr/bin/env node
/**
 * O XML DA NOTA RECEBIDA NA HORA DO "DAR ENTRADA" (15/10/2026). Pedido do
 * usuário: "já manifestei, simplesmente o XML ainda não carrega para mim dar
 * entrada, verifique!" (a 3111, Matriz -> Pomerode, confirmada).
 *
 * Conferido na Focus (só leitura): a confirmação estava registrada, mas a SEFAZ
 * ainda não tinha entregue o XML completo a Pomerode (nfe_completa false, só o
 * resNFe de 435 bytes). O XML só era buscado ao manifestar.
 *
 * Provado no servidor local:
 *   A) nota recebida com a chave da 3111 + a mesma chave em NF-e Emitidas com
 *      o XML guardado -> o "Dar entrada" recebeu o XML da nota emitida, e ele
 *      ficou guardado na recebida ("completo");
 *   B) nota real com ciência e sem XML aqui -> buscou na Focus (9.391 bytes);
 *   C) sem a emitida e a Focus sem o XML -> 404 dizendo que está manifestada e
 *      a SEFAZ ainda não entregou (e não mais "manifeste ciência").
 * Os dados falsos de A e C foram apagados.
 */
const fs = require('fs');
const path = require('path');

let falhas = 0;
const check = (nome, cond) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}`);
  if (!cond) falhas += 1;
};
const servidor = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const funcao = servidor.slice(servidor.indexOf('async function xmlDaNotaRecebida'), servidor.indexOf('// DE QUAL EMPRESA É O TÍTULO'));
const ini = servidor.indexOf("pathname.startsWith('/api/fiscal/dfe/') && pathname.endsWith('/xml') && req.method === 'GET'");
const rota = servidor.slice(ini, ini + 1800);

check('primeiro a NOTA EMITIDA POR NÓS (o XML autorizado de NF-e Emitidas)',
  /from nfe n\s*join nfe_arquivos a on a\.nfe_id = n\.id and a\.tipo = 'xml'\s*where n\.chave_acesso = \$1 and upper\(n\.status\) = 'AUTORIZADO'/.test(funcao));
check('  o bytea vem em texto "\\x..." e é decodificado', funcao.includes("Buffer.from(String(conteudo).replace(/^\\\\x/, ''), 'hex')"));
check('depois a Focus de novo (pode ter chegado depois da manifestação)',
  funcao.indexOf('distribuicaoDfe({ cnpj, modo: \'chave\', chave })') > funcao.indexOf('from nfe n'));
check('a rota busca na hora quando falta, e guarda o que achar',
  /xml = await xmlDaNotaRecebida\(documento\);\s*if \(xml\) await dfeDb\.guardarXml\(id, xml\);/.test(rota));
check('  e, sem XML, diz que já está manifestada e a SEFAZ ainda não entregou',
  rota.includes('Esta nota já está manifestada, mas a SEFAZ ainda não entregou o XML completo dela'));

console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TUDO OK =====');
process.exit(falhas ? 1 : 0);
