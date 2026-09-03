#!/usr/bin/env node
/**
 * NOTAS EMITIDAS CONTRA O NOSSO CNPJ — Distribuição de DF-e (fase AR).
 *
 * RODA NO `npm test`, sem servidor e sem SEFAZ, de propósito.
 *
 * A integração com a Focus não pode ser exercida aqui — nem em homologação a
 * conta foi validada ainda. Então este teste cobre tudo o que NÃO depende da
 * rede, que é onde mora a maior parte do que pode dar errado em silêncio:
 *
 *   1. QUAL MANIFESTAÇÃO DÁ ENTRADA NO ESTOQUE. Só a Confirmação. Se um dia
 *      alguém marcar `geraEntrada` no desconhecimento, o sistema passará a
 *      lançar mercadoria de nota que a empresa declarou não ser dela — e
 *      nenhuma tela vai reclamar.
 *
 *   2. A TRADUÇÃO DOS CAMPOS DA FOCUS. É o ponto mais provável de erro numa
 *      integração não verificada, e o mais silencioso: nome errado devolve
 *      `undefined`, que vira string vazia, que vira uma nota sem emitente na
 *      tela — sem exceção nenhuma.
 *
 *   3. AS DECISÕES ESCRITAS NO SERVIDOR. Que o ponteiro de NSU só avança nos
 *      modos que varrem, que a manifestação vai à SEFAZ antes do banco, e que
 *      a permissão de manifestar é separada da de consultar.
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

const manifestacao = require('../public/modules/shared/manifestacao');
const focus = require('../lib/focusnfe');

console.log('--- 1. só a Confirmação dá entrada no estoque ---');
// O check é sobre CADA um dos quatro, e não só sobre a confirmação: o perigo é
// alguém acrescentar `geraEntrada: true` no desconhecimento achando que
// "manifestar" é tudo a mesma coisa.
check('confirmação dá entrada', manifestacao.geraEntrada('confirmacao'));
check('ciência NÃO dá', !manifestacao.geraEntrada('ciencia'));
check('desconhecimento NÃO dá', !manifestacao.geraEntrada('desconhecimento'));
check('operação não realizada NÃO dá', !manifestacao.geraEntrada('nao-realizada'));
check('  e é exatamente UMA que dá',
  manifestacao.CATALOGO.filter((m) => m.geraEntrada).length === 1,
  manifestacao.CATALOGO.filter((m) => m.geraEntrada).map((m) => m.label).join(', '));

// Só ciência e confirmação liberam o XML na SEFAZ. Quem desconhece a nota não
// recebe o documento — e a tela não pode oferecer "lançar entrada" com base num
// XML que nunca vai chegar.
check('ciência e confirmação liberam o XML',
  manifestacao.liberaXml('ciencia') && manifestacao.liberaXml('confirmacao'));
check('  e as duas recusas, não',
  !manifestacao.liberaXml('desconhecimento') && !manifestacao.liberaXml('nao-realizada'));

check('os códigos são os da SEFAZ',
  manifestacao.codigoDe('confirmacao') === '210200'
  && manifestacao.codigoDe('ciencia') === '210210'
  && manifestacao.codigoDe('desconhecimento') === '210220'
  && manifestacao.codigoDe('nao-realizada') === '210240');

// Evento gravado por outro sistema pode trazer código que este catálogo não
// conhece. A lista não pode cair — e o inerte tem de ser o mais conservador.
check('evento desconhecido não derruba nem dá entrada',
  !manifestacao.geraEntrada('999999') && !manifestacao.liberaXml('999999')
  && manifestacao.rotulo('999999') === '999999');

console.log('\n--- 2. a tradução dos campos da Focus ---');
const doc = focus.normalizarDocumento({
  nsu: '4131',
  chave_nfe: '4226092425581900016855001000061604101399607 6'.replace(/ /g, ''),
  cnpj_emitente: '24.255.819/0001-68',
  nome_emitente: 'DUOS INDUSTRIA E COMERCIO DE BICICLETAS ELETRICAS LTDA',
  valor_total: '364.00'
});
check('a chave sai só com dígitos', doc.chave.length === 44, `${doc.chave.length} dígitos`);
check('o CNPJ do emitente perde a máscara', doc.emitenteDocumento === '24255819000168', doc.emitenteDocumento);
check('o valor vira número', doc.valorTotal === 364, String(doc.valorTotal));
// Sem XML é resumo, com XML é completo — e é o XML que decide, não o campo
// `tipo` que a Focus mandar: é o XML que diz o que dá para fazer com a nota.
check('sem XML o documento é "resumo"', doc.tipoDocumento === 'resumo');
check('com XML vira "completo"',
  focus.normalizarDocumento({ chave: '1'.repeat(44), xml: '<nfeProc/>', tipo: 'resumo' }).tipoDocumento === 'completo');
// A resposta crua viaja junto: enquanto a integração não for verificada, é a
// única prova do que a Focus mandou quando um campo vier vazio.
check('a resposta crua da Focus é preservada', doc.bruto && doc.bruto.nsu === '4131');
// Documento sem chave válida é descartado antes de virar linha no banco.
check('chave curta não vira documento', focus.normalizarDocumento({ chave: '123' }).chave.length !== 44);

console.log('\n--- 3. os nomes de campo moram num lugar só ---');
const focusSrc = ler('lib/focusnfe.js');
check('existe o mapa CAMPOS_DFE', /const CAMPOS_DFE = \{/.test(focusSrc));
check('  e ele aceita mais de um nome por campo', focus.CAMPOS_DFE.chave.length > 1,
  focus.CAMPOS_DFE.chave.join(', '));
// A razão de o mapa existir: corrigir um nome errado tem de ser UMA edição.
// Se alguém ler campo cru fora de normalizarDocumento, o mapa vira decoração.
const forasDoMapa = (focusSrc.match(/documento\.(chave_nfe|cnpj_emitente|nome_emitente)/g) || []);
check('ninguém lê campo cru fora do tradutor', forasDoMapa.length === 0, forasDoMapa.join(', ') || 'ok');

console.log('\n--- 4. as decisões escritas no servidor ---');
const servidor = ler('server.js');
// RECORTAR A ROTA INTEIRA, e não até a primeira chave fechada: o `}` de um
// `if` interno terminaria o trecho antes das decisões que interessam, e os
// checks passariam a procurar num pedaço onde elas nem estão — reprovando
// código correto. Vai do começo desta rota até o começo da seguinte.
const trechoDaRota = (marcador) => {
  const inicio = servidor.indexOf(marcador);
  if (inicio < 0) return '';
  const seguinte = servidor.indexOf('\n      if (pathname', inicio + marcador.length);
  return servidor.slice(inicio, seguinte < 0 ? servidor.length : seguinte);
};
// O marcador inclui o metodo: a mesma rota e citada antes, no portao de
// permissoes (resolveFiscalPermission), e um indexOf sem o metodo acharia
// AQUELA linha — recortando um trecho onde nenhuma destas decisoes esta.
const rotaBusca = trechoDaRota("pathname === '/api/fiscal/dfe/buscar' && req.method === 'POST'");
check('a rota de busca existe', rotaBusca.length > 0);
// O ponteiro é o que diz "já sincronizei até aqui". Avançá-lo numa busca por
// chave ou por NSU antigo pularia tudo o que existe entre um e outro.
check('  o ponteiro só avança nos modos que varrem',
  /modo === 'ultimo-nsu' \|\| modo === 'tres-meses'/.test(rotaBusca));
// A SEFAZ devolve os documentos SEGUINTES ao NSU pedido.
check('  buscar um NSU específico parte de nsu-1', /pedido - 1/.test(rotaBusca));
// A SEFAZ pagina por NSU e não filtra por data: o recorte é feito aqui.
check('  o recorte de 3 meses é feito sobre o que voltou', /setMonth\(limite\.getMonth\(\) - 3\)/.test(rotaBusca));
check('  e a tela é avisada quando ainda falta buscar', /faltaBuscar/.test(rotaBusca));

const rotaManifestar = trechoDaRota("pathname.endsWith('/manifestar') && req.method === 'POST'");
check('a rota de manifestação existe', rotaManifestar.length > 0);
// Gravar antes de a SEFAZ aceitar deixaria a tela dizendo "manifestada" sobre
// uma nota que a Receita continua esperando.
check('  a SEFAZ vem ANTES do banco',
  rotaManifestar.indexOf('focusNfe.manifestarNfe') < rotaManifestar.indexOf('dfeDb.registrarManifestacao'));
check('  nota já manifestada é recusada', /ja foi manifestada/.test(rotaManifestar));
// Manifestar com o certificado de outro CNPJ é erro que a SEFAZ devolve como
// código numérico — melhor recusar aqui, com o motivo escrito.
check('  as credenciais vêm do CNPJ do próprio documento',
  /=== documento\.cnpjDestinatario/.test(rotaManifestar));

console.log('\n--- 5. manifestar é permissão separada de consultar ---');
const fiscalPerm = require('../public/modules/shared/fiscal_permissoes');
check('as duas permissões existem',
  fiscalPerm.VALORES.includes('manifestar') && fiscalPerm.VALORES.includes('documentos_recebidos'));
check('  e saíram da lista de removidas',
  !fiscalPerm.REMOVIDAS.includes('manifestar') && !fiscalPerm.REMOVIDAS.includes('documentos_recebidos'));
// Consultar é leitura; manifestar é evento fiscal com efeito jurídico. Quem
// confere as notas que chegaram não deveria, pelo mesmo clique, poder declarar
// à Receita que a empresa desconhece uma operação.
check('  o portão exige `manifestar` na rota de manifestação',
  /endsWith\('\/manifestar'\)\) return 'manifestar'/.test(servidor));
check('  e `documentos_recebidos` na de consulta',
  /'\/api\/fiscal\/dfe'[\s\S]{0,120}return 'documentos_recebidos'/.test(servidor));

console.log('\n--- 6. a tela não inventa um segundo caminho para o estoque ---');
const tela = ler('public/modules/fiscal/subs/notas_contra_cnpj.js');
// O lançamento tem de usar a MESMA rota que a tela de Notas de Entrada usa.
// Um segundo caminho no servidor seria um segundo lugar para o estoque entrar
// diferente — e as duas telas concordariam entre si por acidente, não por
// construção.
check('lança pela rota de entrada que já existia', /'\/api\/purchases\/entrada-nfe'/.test(tela));
// Sem `itens`, o servidor vincula pela sugestão que ele mesmo calculou.
check('  e não manda itens, para o servidor reconhecê-los', !/itens:/.test(tela));
check('  pede financeiro junto', /gerarFinanceiro: true/.test(tela));
// Manifestação não se desfaz: se o lançamento falhar, o usuário precisa saber
// que a primeira metade valeu.
check('  falha no lançamento avisa que a manifestação valeu', /a manifestação valeu/.test(tela));

console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TODOS OS CHECKS PASSARAM =====');
process.exit(falhas ? 1 : 0);
