/**
 * NOTAS ANTIGAS CONTRA O CNPJ PELO XML (19/11/2026).
 *
 * Pedido do usuário: "preciso puxar notas mais antigas, faça um botão que
 * somente o ADMIN vê pra puxar notas mais antigas". A SEFAZ só distribui os
 * últimos 90 dias e a Focus só tem desde 12/05/2026; o anterior entra pelos
 * XMLs (Viper, contador, fornecedor), soltos ou num .zip.
 *
 *   - lib/dfe-importacao.js lê a nota (e o cancelamento 110111) e recusa,
 *     dizendo o porquê, o resumo, a NFC-e, a homologação, a denegada;
 *   - public/modules/shared/zip_leitor.js abre o .zip no navegador
 *     (armazenado e deflate, com pasta e nome UTF-8);
 *   - a rota é só de administrador, e a nota importada entra com NSU 0, sem
 *     mexer no ponteiro da SEFAZ;
 *   - a tela mostra o botão só para o admin, e a importada dá entrada direto.
 *
 * Dados fictícios (CNPJs e chaves inventados). A prova contra o banco foi de
 * ponta a ponta na porta 3999, com usuário temporário.
 *
 *   node scripts/test-importar-xml-antigas.js
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { lerArquivoRecebido } = require('../lib/dfe-importacao');
const { lerZip } = require('../public/modules/shared/zip_leitor');

let falhas = 0;
const check = (nome, cond, extra = '') => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${extra ? `  (${extra})` : ''}`);
  if (!cond) falhas++;
};
const ler = (arquivo) => fs.readFileSync(path.join(__dirname, '..', arquivo), 'utf8');
const recusa = (xml) => { try { lerArquivoRecebido(xml); return ''; } catch (e) { return e.message; } };

const CHAVE = '42250511222333000181550010000012341000012345';
function nfe({ chave = CHAVE, mod = '55', tpAmb = '1', dest = '99888777000166', cStat = '100', comProtocolo = true, prefixo = '' } = {}) {
  const p = prefixo ? `${prefixo}:` : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<${p}nfeProc xmlns${prefixo ? `:${prefixo}` : ''}="http://www.portalfiscal.inf.br/nfe" versao="4.00">
  <${p}NFe><${p}infNFe Id="NFe${chave}" versao="4.00">
    <${p}ide><${p}mod>${mod}</${p}mod><${p}serie>1</${p}serie><${p}nNF>1234</${p}nNF><${p}dhEmi>2025-05-20T14:30:00-03:00</${p}dhEmi><${p}tpAmb>${tpAmb}</${p}tpAmb></${p}ide>
    <${p}emit><${p}CNPJ>11222333000181</${p}CNPJ><${p}xNome>FORNECEDOR &amp; CIA LTDA</${p}xNome></${p}emit>
    <${p}dest><${p}CNPJ>${dest}</${p}CNPJ><${p}xNome>NOSSA FILIAL</${p}xNome></${p}dest>
    <${p}total><${p}ICMSTot><${p}vProd>1500.00</${p}vProd><${p}vNF>1530.75</${p}vNF></${p}ICMSTot></${p}total>
  </${p}infNFe></${p}NFe>
  ${comProtocolo ? `<${p}protNFe versao="4.00"><${p}infProt><${p}chNFe>${chave}</${p}chNFe><${p}dhRecbto>2025-05-20T14:31:00-03:00</${p}dhRecbto><${p}nProt>142250000012345</${p}nProt><${p}cStat>${cStat}</${p}cStat><${p}xMotivo>Autorizado o uso da NF-e</${p}xMotivo></${p}infProt></${p}protNFe>` : ''}
</${p}nfeProc>`;
}
function cancelamento({ chave = CHAVE, tpEvento = '110111', cStat = '135', comRetorno = true } = {}) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<procEventoNFe versao="1.00" xmlns="http://www.portalfiscal.inf.br/nfe">
  <evento versao="1.00"><infEvento Id="ID${tpEvento}${chave}01"><cOrgao>42</cOrgao><tpAmb>1</tpAmb><CNPJ>11222333000181</CNPJ><chNFe>${chave}</chNFe><tpEvento>${tpEvento}</tpEvento><nSeqEvento>1</nSeqEvento><detEvento versao="1.00"><descEvento>Cancelamento</descEvento><nProt>142250000012345</nProt><xJust>erro de digitacao no pedido</xJust></detEvento></infEvento></evento>
  ${comRetorno ? `<retEvento versao="1.00"><infEvento><tpAmb>1</tpAmb><cStat>${cStat}</cStat><xMotivo>Evento registrado</xMotivo><chNFe>${chave}</chNFe><tpEvento>${tpEvento}</tpEvento><nProt>142250000099999</nProt></infEvento></retEvento>` : ''}
</procEventoNFe>`;
}

// Um .zip mínimo, montado aqui: [{ nome, conteudo, metodo (0|8), utf8 }].
function montarZip(entradas) {
  const locais = [];
  const centrais = [];
  let deslocamento = 0;
  for (const e of entradas) {
    const nome = Buffer.from(e.nome, e.utf8 ? 'utf8' : 'latin1');
    const original = Buffer.from(e.conteudo || '', 'utf8');
    const dados = e.metodo === 8 ? zlib.deflateRawSync(original) : original;
    const flags = e.utf8 ? 0x800 : 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(flags, 6); local.writeUInt16LE(e.metodo || 0, 8);
    local.writeUInt32LE(dados.length, 18); local.writeUInt32LE(original.length, 22); local.writeUInt16LE(nome.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(flags, 8); central.writeUInt16LE(e.metodo || 0, 10);
    central.writeUInt32LE(dados.length, 20); central.writeUInt32LE(original.length, 24); central.writeUInt16LE(nome.length, 28); central.writeUInt32LE(deslocamento, 42);
    locais.push(local, nome, dados);
    centrais.push(central, nome);
    deslocamento += local.length + nome.length + dados.length;
  }
  const diretorio = Buffer.concat(centrais);
  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0); fim.writeUInt16LE(entradas.length, 8); fim.writeUInt16LE(entradas.length, 10);
  fim.writeUInt32LE(diretorio.length, 12); fim.writeUInt32LE(deslocamento, 16);
  return Buffer.concat([...locais, diretorio, fim]);
}

(async () => {
  console.log('--- a nota ---');
  const lida = lerArquivoRecebido(nfe());
  check('lê chave, emitente, destinatário, data com hora, valor e protocolo',
    lida.tipo === 'nota' && lida.nota.chave === CHAVE && lida.nota.emitenteDocumento === '11222333000181'
    && lida.nota.emitenteNome === 'FORNECEDOR & CIA LTDA' && lida.nota.destinatarioDocumento === '99888777000166'
    && lida.nota.dataEmissao === '2025-05-20T14:30:00-03:00' && lida.nota.valorTotal === 1530.75
    && lida.nota.numero === '1234' && lida.nota.protocolo && lida.nota.protocolo.status === '100');
  check('com prefixo de namespace (ns2:) também', lerArquivoRecebido(nfe({ prefixo: 'ns2' })).nota.chave === CHAVE);
  check('sem o protocolo entra, sem protocolo', lerArquivoRecebido(nfe({ comProtocolo: false })).nota.protocolo === null);
  check('autorizada fora de prazo (150) entra', lerArquivoRecebido(nfe({ cStat: '150' })).tipo === 'nota');

  console.log('\n--- o que se recusa, dizendo o porquê ---');
  check('NFC-e', /NFC-e \(modelo 65\)/.test(recusa(nfe({ mod: '65' }))));
  check('homologação', /HOMOLOGA/.test(recusa(nfe({ tpAmb: '2' }))));
  check('denegada', /não autorizada pela SEFAZ \(status 302/.test(recusa(nfe({ cStat: '302' }))));
  check('o resumo (resNFe)', /RESUMO/.test(recusa(`<resNFe><chNFe>${CHAVE}</chNFe><vNF>10.00</vNF></resNFe>`)));
  check('arquivo que não é NF-e', /infNFe/.test(recusa('<html><body>DANFE</body></html>')));
  check('arquivo vazio', /vazio/.test(recusa('   ')));
  check('DOCTYPE (segurança)', /DOCTYPE/.test(recusa('<!DOCTYPE x [<!ENTITY a SYSTEM "file:///etc/passwd">]><NFe/>')));

  console.log('\n--- o cancelamento ---');
  const canc = lerArquivoRecebido(cancelamento());
  check('evento 110111 homologado vira cancelamento da chave', canc.tipo === 'cancelamento' && canc.chave === CHAVE && canc.protocolo === '142250000099999');
  check('outro evento (carta de correção) é recusado', /110110/.test(recusa(cancelamento({ tpEvento: '110110' }))));
  check('cancelamento sem o retorno da SEFAZ não prova nada', /sem o retorno/.test(recusa(cancelamento({ comRetorno: false }))));
  check('cancelamento rejeitado não vale', /não homologado/.test(recusa(cancelamento({ cStat: '573' }))));

  console.log('\n--- o .zip ---');
  const zip = montarZip([
    { nome: 'notas/', conteudo: '' },
    { nome: 'notas/nota-1.xml', conteudo: nfe(), metodo: 8 },
    { nome: 'notas/não-comprimida.xml', conteudo: cancelamento(), metodo: 0, utf8: true },
    { nome: 'notas/danfe.pdf', conteudo: '%PDF-1.4 fake', metodo: 8 }
  ]);
  const dentro = await lerZip(new Uint8Array(zip));
  const texto = (item) => new TextDecoder('utf-8').decode(item.bytes);
  check('abre deflate e armazenado, sem a pasta', dentro.length === 3 && texto(dentro[0]) === nfe() && texto(dentro[1]) === cancelamento(),
    dentro.map((d) => d.nome).join(', '));
  check('nome com acento (UTF-8)', dentro[1].nome === 'notas/não-comprimida.xml');
  check('o XML de dentro do zip é lido como nota', lerArquivoRecebido(texto(dentro[0])).nota.chave === CHAVE);
  let erroZip = '';
  try { await lerZip(new Uint8Array(Buffer.from('isto não é zip, só texto qualquer'))); } catch (e) { erroZip = e.message; }
  check('arquivo que não é zip: erro claro', /não é um \.zip válido/i.test(erroZip), erroZip);
  const comSenha = montarZip([{ nome: 'a.xml', conteudo: nfe(), metodo: 0 }]);
  comSenha.writeUInt16LE(0x1, comSenha.length - 22 - 46 - 5 + 8); // liga o bit de senha na entrada central
  const lidosComSenha = await lerZip(new Uint8Array(comSenha));
  check('protegido por senha: avisa, não quebra', lidosComSenha.length === 1 && /senha/.test(lidosComSenha[0].erro || ''));

  console.log('\n--- servidor ---');
  const servidor = ler('server.js');
  const rota = servidor.slice(servidor.indexOf("pathname === '/api/fiscal/dfe/importar-xml'"), servidor.indexOf("pathname.endsWith('/manifestar') && req.method === 'POST'"));
  check('rota só de administrador (ehAdmin, 403)', /if \(!await ehAdmin\(user\)\)/.test(rota) && /403/.test(rota));
  check('a empresa é a do CNPJ destinatário do XML', /porCnpj\.get\(nota\.destinatarioDocumento\)/.test(rota));
  check('não mexe no ponteiro de NSU', !/avancarNsu/.test(rota));
  check('lote limitado', /MAXIMO_DE_XMLS_POR_LOTE = 100/.test(servidor) && /arquivos\.length > MAXIMO_DE_XMLS_POR_LOTE/.test(rota));
  check('erro do arquivo vira "recusado"; erro do servidor não é engolido', /if \(!erroDoArquivo \|\| !erroDoArquivo\.status \|\| erroDoArquivo\.status >= 500\) throw erroDoArquivo;/.test(rota));
  const dfe = ler('lib/db/dfe.js');
  const importar = dfe.slice(dfe.indexOf('async function importarDoXml'), dfe.indexOf('async function marcarCanceladaPeloXml'));
  check('a importada entra com NSU 0, completa, marcada no resumo, sem manifestação',
    /nsu: 0,/.test(importar) && /tipo_documento: 'completo'/.test(importar) && /origem: ORIGEM_IMPORTACAO/.test(importar) && !/manifestacao_codigo/.test(importar));
  check('a que já existe não é tocada; a que só tinha resumo ganha o XML',
    /if \(existente\.tipoDocumento === 'completo'\) return \{ id: existente\.id, situacao: 'ja-existia' \}/.test(importar) && /await guardarXml\(existente\.id, xml\)/.test(importar));

  console.log('\n--- tela ---');
  const tela = ler('public/modules/fiscal/subs/notas_contra_cnpj.js');
  check('o botão só existe para o admin', /\$\{ehAdmin \? `\s*<button type="button" class="secondary" id="dfeImportarXml"/.test(tela)
    && /const ehAdmin = typeof usuarioEhAdmin === 'function' && usuarioEhAdmin\(\);/.test(tela));
  check('aceita vários .xml e .zip', /id="dfeArquivosXml" accept="\.xml,\.zip[^"]*" multiple hidden/.test(tela) && /window\.MavisZip\.lerZip/.test(tela));
  check('os cancelamentos vão por último', /xmls\.sort\(\(a, b\) => Number\(ehEvento\(a\)\) - Number\(ehEvento\(b\)\)\)/.test(tela));
  check('importada: dá entrada direto (salvo cancelada) e não oferece Manifestar',
    /doc\.importadaDoXml\s*\? doc\.situacao !== 'cancelada'/.test(tela) && /const podeManifestar = \(doc\) => !doc\.importadaDoXml &&/.test(tela));
  check('o leitor de .zip está na página', /<script src="\/modules\/shared\/zip_leitor\.js"><\/script>/.test(ler('public/index.html')));

  console.log(`\n===== ${falhas === 0 ? 'TODOS OS CHECKS PASSARAM' : falhas + ' FALHA(S)'} =====`);
  process.exit(falhas ? 1 : 0);
})();
