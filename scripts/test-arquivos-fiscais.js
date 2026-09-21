#!/usr/bin/env node
// O ACERVO FISCAL DO PERÍODO (fase CN): o zip e as três rotas.
//
// A QUEM ISTO SERVE: o contador gera a EFD ICMS/IPI a partir dos XML, e este
// sistema já guardava todos — o que não existia era tirá-los de uma vez, nem
// saber se falta algum.
//
// A TELA NÃO GERA SPED, e isso é decisão registrada em teste porque é o tipo de
// coisa que alguém "melhora" depois: gerar a EFD hoje produziria arquivo que a
// SEFAZ rejeita. Medido em 17/09/2026 neste banco: os 6.492 participantes estão
// sem o código IBGE do município (o registro 0150 exige), o `TIPO_ITEM` do 0200
// não existe como conceito (os 5.475 produtos estão todos como `NORMAL`, que é
// outra classificação), não há cadastro de contabilista para o 0100 e não há
// apuração para o Bloco E. Botão que produz arquivo inválido é pior do que
// botão ausente, porque alguém entrega.
//
// O zip é testado DE VERDADE aqui: monta e desmonta, lendo o índice central e
// inflando cada entrada. Formato escrito à mão sem teste de volta é a definição
// de arquivo corrompido que só aparece na mão de quem precisa dele.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const RAIZ = path.join(__dirname, '..');
const ler = (p) => fs.readFileSync(path.join(RAIZ, p), 'utf8').replace(/\r\n/g, '\n');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};

const { criarZip, crc32, nomeSeguro } = require('../lib/zip');

// ---------------------------------------------------------------------------
// Um leitor de zip mínimo, só para este teste: acha o fim do índice central,
// percorre as entradas e devolve {nome -> conteúdo}. É o inverso do que
// lib/zip.js escreve, e escrito à parte de propósito — se os dois
// compartilhassem código, um erro de deslocamento casaria consigo mesmo.
// ---------------------------------------------------------------------------
function lerZip(buf) {
  const fim = buf.length - 22;
  if (buf.readUInt32LE(fim) !== 0x06054b50) throw new Error('não achei o fim do índice central');
  const quantas = buf.readUInt16LE(fim + 10);
  let p = buf.readUInt32LE(fim + 16);
  const saida = {};
  for (let i = 0; i < quantas; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error(`entrada ${i} sem assinatura de índice`);
    const metodo = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const tamComp = buf.readUInt32LE(p + 20);
    const tamCru = buf.readUInt32LE(p + 24);
    const tamNome = buf.readUInt16LE(p + 28);
    const offset = buf.readUInt32LE(p + 42);
    const nome = buf.slice(p + 46, p + 46 + tamNome).toString('utf8');
    // Pula o cabeçalho local (30 bytes + nome + extra) para achar os dados.
    const tamNomeLocal = buf.readUInt16LE(offset + 26);
    const tamExtraLocal = buf.readUInt16LE(offset + 28);
    const inicio = offset + 30 + tamNomeLocal + tamExtraLocal;
    const dados = buf.slice(inicio, inicio + tamComp);
    const cru = metodo === 8 ? zlib.inflateRawSync(dados) : dados;
    if (cru.length !== tamCru) throw new Error(`${nome}: tamanho declarado ${tamCru}, inflado ${cru.length}`);
    if (crc32(cru) !== crc) throw new Error(`${nome}: CRC não bate`);
    saida[nome] = cru;
    p += 46 + tamNome + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
  }
  return saida;
}

console.log('--- 1. o zip: monta e desmonta ---');
const XML = '<?xml version="1.0"?><nfeProc><chNFe>352608</chNFe></nfeProc>';
const BINARIO = Buffer.from([0, 1, 2, 253, 254, 255]);
const entrada = [
  { nome: 'saidas/35260812345678901234550010000000011234567890.xml', conteudo: XML },
  { nome: 'entradas/NOTA SÃO BENTO.xml', conteudo: '<x>ãéçõ</x>' },  // acento no nome E no conteúdo
  { nome: 'vazio.txt', conteudo: '' },
  { nome: 'grande.xml', conteudo: '<item>repetido</item>'.repeat(5000) },
  { nome: 'bin.dat', conteudo: BINARIO }
];
const zip = criarZip(entrada);
check('assinatura de zip no começo', zip.slice(0, 4).toString('hex') === '504b0304', zip.slice(0, 4).toString('hex'));
const volta = lerZip(zip);
check('as 5 entradas voltaram', Object.keys(volta).length === 5, Object.keys(volta).length + ' entradas');
check('o XML volta idêntico', volta['saidas/35260812345678901234550010000000011234567890.xml'].toString('utf8') === XML);
// Sem o bit 11 do cabeçalho, acento em nome de arquivo vira ruído no Windows.
check('nome com acento sobrevive', Object.keys(volta).includes('entradas/NOTA SÃO BENTO.xml'), Object.keys(volta).join(' | ').slice(0, 80));
check('  e o conteúdo acentuado também', volta['entradas/NOTA SÃO BENTO.xml'].toString('utf8') === '<x>ãéçõ</x>');
// Arquivo vazio tem CRC 0 e tamanho 0 — um `if (length)` mal posto o descarta.
check('arquivo vazio continua no zip', volta['vazio.txt'].length === 0);
check('binário volta byte a byte', Buffer.compare(volta['bin.dat'], BINARIO) === 0);
// Deflate de verdade: 105 KB de texto repetido não podem sair com 105 KB.
const cruTotal = entrada.reduce((s, a) => s + Buffer.byteLength(a.conteudo), 0);
check('comprime de verdade', zip.length < cruTotal / 5, `${cruTotal} -> ${zip.length} bytes`);
// O CRC é o que o extrator confere; errado, ele recusa o arquivo inteiro.
check('o CRC de cada entrada bate', true, 'conferido no lerZip');
check('pastas saem por prefixo no nome', Object.keys(volta).some((n) => n.startsWith('saidas/')) && Object.keys(volta).some((n) => n.startsWith('entradas/')));

console.log('\n--- 2. nome de arquivo que sobrevive ao Windows ---');
check('barra vira traço', !nomeSeguro('NF 123/2026').includes('/'), nomeSeguro('NF 123/2026'));
check('dois-pontos também', !nomeSeguro('a:b').includes(':'), nomeSeguro('a:b'));
check('vazio cai na reserva', nomeSeguro('', 'reserva') === 'reserva');
check('nome só de pontuação também', nomeSeguro('///', 'reserva') === 'reserva', nomeSeguro('///', 'reserva'));

console.log('\n--- 3. sem ZIP64, mas dizendo isso em voz alta ---');
// Um zip de 5 GB montado em silêncio sai corrompido: os campos de tamanho têm
// 32 bits. Melhor estourar com a frase que explica o que fazer.
const zipSrc = ler('lib/zip.js');
check('há guarda de 4 GB', /assertCabe/.test(zipSrc));
check('  e a mensagem diz o caminho', /ZIP64|em pedaços|por mês/.test(zipSrc));

console.log('\n--- 4. as três rotas, e as duas permissões ---');
const servidor = ler('server.js');
check('resumo do acervo', /pathname === '\/api\/fiscal\/acervo' && req\.method === 'GET'/.test(servidor));
check('busca dos faltantes', /pathname === '\/api\/fiscal\/acervo\/buscar-faltantes' && req\.method === 'POST'/.test(servidor));
check('download do zip', /pathname === '\/api\/fiscal\/acervo\/zip' && req\.method === 'GET'/.test(servidor));
// A DIVISÃO DE PERMISSÃO É O PONTO: conferir se o acervo está completo é
// leitura; levar os documentos embora é a MESMA permissão de baixar o XML de
// uma nota. Download em lote não pode ser caminho mais fácil que o individual.
check("o resumo pede 'visualizar'", /'\/api\/fiscal\/acervo'\) return 'visualizar'/.test(servidor));
check("o zip pede 'xml'", /'\/api\/fiscal\/acervo\/zip'\) return 'xml'/.test(servidor));
check("  e buscar faltantes também", /'\/api\/fiscal\/acervo\/buscar-faltantes'\) return 'xml'/.test(servidor));

console.log('\n--- 5. o período é conferido antes de consultar ---');
check('há uma função só para isso', /function lerPeriodoDoAcervo\(params\)/.test(servidor));
const guarda = (/function lerPeriodoDoAcervo\(params\) \{[\s\S]*?\n\}/.exec(servidor) || [''])[0];
check('  exige estabelecimento', /Escolha o estabelecimento/.test(guarda));
check('  recusa data invertida', /de > ate/.test(guarda));
// O zip é montado na memória: "de 2024 até hoje" num CNPJ que emite todo dia é
// o lote que ninguém quer descobrir no meio do fechamento.
check('  e tem teto de período', /366/.test(guarda));

console.log('\n--- 6. a retentativa que não existia ---');
// O download do XML roda UMA vez, quando a nota passa a AUTORIZADO, e é melhor
// esforço: a Focus gera o arquivo de forma assíncrona, então a primeira
// tentativa pode chegar antes de ele existir. Sem isto, aquele XML nunca mais
// era buscado — acervo com buraco, e ninguém sabia.
// Ancora no MÉTODO, e não só no caminho: o caminho aparece antes, no
// resolveFiscalPermission, e um recorte entre as duas linhas de permissão vem
// quase vazio — e recorte vazio faz todo check do tipo "contém X" falhar (ou,
// pior, os do tipo "NÃO contém" passarem sozinhos).
const rotaBusca = servidor.slice(
  servidor.indexOf("pathname === '/api/fiscal/acervo/buscar-faltantes' && req.method === 'POST'"),
  servidor.indexOf("pathname === '/api/fiscal/acervo/zip' && req.method === 'GET'")
);
check('o corpo da rota de busca foi encontrado', rotaBusca.length > 400, `${rotaBusca.length} caracteres`);
check('busca só as que têm link na Focus', /faltantes\.filter\(\(f\) => f\.urlXml\)/.test(rotaBusca));
// Um mês inteiro disparado de uma vez toma limite de requisição justamente
// quando se está tentando fechar o mês.
check('  uma por vez, não em paralelo', /for \(const nota of comUrl\)/.test(rotaBusca));
check('  e uma falha não aborta as outras', /catch \(erro\) \{[\s\S]{0,120}falhas\.push/.test(rotaBusca));
check('devolve quantas recuperou', /recuperadas/.test(rotaBusca));

console.log('\n--- 7. a tela ---');
const tela = ler('public/modules/fiscal/subs/arquivos.js');
check('está registrada', /MavisSubscreenRegistry\.fiscal\.arquivos = desenhar/.test(tela));
// O `api()` do app.js faz response.json(): um zip parseado como JSON é erro de
// sintaxe. Binário pede fetch cru — é o que as outras telas de download fazem.
check('o zip NÃO passa pelo api() (que faz .json())', !/await api\([^)]*acervo\/zip/.test(tela));
check('  vai por fetch com o token no cabeçalho', /fetch\(`\/api\/fiscal\/acervo\/zip/.test(tela) && /getSessionToken/.test(tela));
check('  e libera o blob depois', /revokeObjectURL/.test(tela));
// Oferecer "buscar de novo" para nota sem link prometeria o que não cumpre.
check('só oferece buscar quando há link', /recuperaveis/.test(tela));
check('e o botão não dispara duas vezes', /botao\.disabled = true/.test(tela));
// O NOME diz o que é. "Gerar SPED" aqui seria promessa falsa.
check('a tela não se chama SPED', !/gerar sped|Gerar SPED/i.test(tela));
check('  e diz que não é o arquivo do SPED', /não é o arquivo do SPED|Não é o arquivo do SPED/i.test(tela));

console.log('\n--- 8. cancelada entra no acervo ---');
// Nota cancelada existiu para a SEFAZ e é escriturada. Fora do acervo, a
// numeração não fecha — e este sistema não apaga documento fiscal, só cancela.
const dbFiscal = ler('lib/db/fiscal.js');
check("os status escrituráveis são os dois", /STATUS_ESCRITURAVEIS = \['AUTORIZADO', 'CANCELADO'\]/.test(dbFiscal));
check('  e o porquê está escrito', /cancelada existiu para a SEFAZ|Cancelada entra|CANCELADA ENTRA/i.test(dbFiscal));
// Entrada não tem estabelecimento_id: casa pelo CNPJ do destinatário, e o
// documento pode estar gravado com pontuação.
check('entrada casa pelo CNPJ sem pontuação', /replace\(replace\(replace\(destinatario_documento/.test(dbFiscal));

console.log(`\n===== ${falhas === 0 ? 'TODOS OS CHECKS PASSARAM' : falhas + ' FALHA(S)'} =====`);
process.exit(falhas ? 1 : 0);
