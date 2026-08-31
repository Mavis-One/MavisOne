#!/usr/bin/env node
// ENTRADA DE NF-e — o XML do fornecedor, o fornecedor que falta e o que a nota
// não pode fazer sozinha.
//
// O QUE ESTE TESTE GUARDA
// -----------------------
// 1. O leitor de XML. É código próprio (o projeto não tem biblioteca de XML), e
//    a parte que mais assusta é a que ele RECUSA: XML com DOCTYPE pode declarar
//    entidade externa e mandar o servidor ler arquivo do disco. Se essa recusa
//    sumir num refactor, nada quebra na tela — só abre a porta.
//
// 2. O casamento do fornecedor É POR DOCUMENTO, nunca por nome. Casar por nome
//    é como nasce cadastro duplicado: "COMERCIAL X LTDA" e "Comercial X" viram
//    dois, e a partir dali metade das compras vai para cada um.
//
// 3. A hora da emissão. dhEmi vem com fuso (-03:00); passar por Date e chamar
//    toISOString joga a nota das 22h para o dia seguinte. É o mesmo erro que já
//    apareceu nos filtros de período de Vendas.
//
// 4. Que analisar NÃO grava. A rota de análise não pode criar fornecedor,
//    produto nem movimento — arrastar um XML para a tela é "deixa eu ver o que
//    tem aqui".
//
// 5. Que não existe caminho para EXCLUIR uma entrada. Nota fiscal recebida não
//    se apaga, do mesmo jeito que nota emitida não se apaga.
//
// Roda offline: nada aqui toca banco ou rede.
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const ler = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');

const nfeXml = require(path.join(RAIZ, 'lib', 'nfeXml'));
const entrada = require(path.join(RAIZ, 'lib', 'entradaNfe'));

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};
const explode = (fn) => {
  try { fn(); return null; } catch (erro) { return erro.message; }
};

const XML = ler('scripts/fixtures/nfe-entrada-exemplo.xml');

// ---------------------------------------------------------------------------
console.log('--- o leitor de XML recusa o que não devia ler ---');

const comDoctype = '<?xml version="1.0"?><!DOCTYPE nfe [<!ENTITY x SYSTEM "file:///etc/passwd">]><nfeProc><a>&x;</a></nfeProc>';
const erroDoctype = explode(() => nfeXml.parseXml(comDoctype));
check('XML com DOCTYPE é recusado', Boolean(erroDoctype), erroDoctype || 'PASSOU DIRETO — XXE aberto');
check('e o erro diz o motivo', /DOCTYPE/.test(erroDoctype || ''));

// A entidade externa nunca chega a ser expandida porque o arquivo é recusado
// antes. Sem DOCTYPE não há como declarar entidade, então só as cinco do
// padrão e as numéricas existem.
check('entidade desconhecida fica literal, não vira nada',
  nfeXml.decodificar('&naoexiste; &amp; &#65;') === '&naoexiste; & A',
  nfeXml.decodificar('&naoexiste; &amp; &#65;'));

const gigante = '<a>' + 'x'.repeat(nfeXml.LIMITE_XML_BYTES + 10) + '</a>';
check('arquivo acima do limite é recusado', Boolean(explode(() => nfeXml.parseXml(gigante))));

console.log('\n--- e lê direito o que é XML de verdade ---');
const arvore = nfeXml.parseXml(
  '<?xml version="1.0"?><ns2:raiz xmlns:ns2="http://x"><a attr="tem > dentro">1</a>' +
  '<b/><c><![CDATA[<nao interpretar>]]></c><d>a &amp; b</d></ns2:raiz>'
);
const raiz = arvore.filhos[0];
check('o prefixo do namespace é descartado', raiz.nome === 'raiz', raiz.nome);
check('atributo com ">" dentro das aspas não corta a tag',
  nfeXml.achar(raiz, 'a').atributos.attr === 'tem > dentro', nfeXml.achar(raiz, 'a').atributos.attr);
check('tag auto-fechada não engole o resto', raiz.filhos.length === 4, `${raiz.filhos.length} filhos`);
check('CDATA fica literal', nfeXml.txt(raiz, 'c') === '<nao interpretar>', nfeXml.txt(raiz, 'c'));
check('entidade do padrão é expandida', nfeXml.txt(raiz, 'd') === 'a & b', nfeXml.txt(raiz, 'd'));
check('campo ausente vira string vazia, não erro', nfeXml.txt(raiz, 'z/y/x') === '');
check('número ausente vira 0 (o layout omite campo zerado)', nfeXml.num(raiz, 'z') === 0);

// ---------------------------------------------------------------------------
console.log('\n--- a nota lida ---');
const nota = entrada.lerNotaDeEntrada(XML);
check('chave com 44 dígitos', nota.chave.length === 44, nota.chave);
check('número e série', nota.numero === '12345' && nota.serie === '1', `${nota.numero}/${nota.serie}`);
// dhEmi é 2026-08-20T22:15:00-03:00. Em UTC isso é dia 21 — passar por
// toISOString() jogaria a nota para o dia seguinte.
check('emissão às 22h continua no dia 20', nota.dataEmissao === '2026-08-20', nota.dataEmissao);
check('emitente lido inteiro',
  nota.emitente.documento === '11222333000181' && nota.emitente.inscricaoEstadual === '255123456',
  `${nota.emitente.documento} / IE ${nota.emitente.inscricaoEstadual}`);
check('e o & do nome foi decodificado', nota.emitente.nome.includes('&') && !nota.emitente.nome.includes('&amp;'), nota.emitente.nome);
check('endereço do emitente completo',
  nota.emitente.endereco.municipio === 'FLORIANOPOLIS' && nota.emitente.endereco.cep === '88010100');
check('dois itens', nota.itens.length === 2, String(nota.itens.length));
check('quantidade e valores do item 1',
  nota.itens[0].quantidade === 100 && nota.itens[0].valorUnitario === 2.5 && nota.itens[0].valorTotal === 250);
// "SEM GTIN" é o que o layout manda escrever quando não há código de barras.
// Tratar isso como código faria TODOS os produtos sem GTIN casarem entre si.
check('"SEM GTIN" não vira código de barras', nota.itens[1].ean === '', JSON.stringify(nota.itens[1].ean));
check('mas o GTIN de verdade é lido', nota.itens[0].ean === '7891234567895');
// O grupo do ICMS muda de nome conforme a tributação; o CSOSN do Simples ocupa
// o lugar do CST.
check('ICMS00 lido com CST e alíquota', nota.itens[0].icms.cst === '00' && nota.itens[0].icms.aliquota === 17);
check('ICMSSN102 lido com o CSOSN no lugar do CST', nota.itens[1].icms.cst === '102', nota.itens[1].icms.cst);
check('IPI do item', nota.itens[0].ipi.valor === 12.5);
check('totais da nota', nota.totais.nota === 612.5 && nota.totais.produtos === 600);
check('duas duplicatas com vencimento', nota.duplicatas.length === 2 && nota.duplicatas[1].vencimento === '2026-10-19');
check('forma de pagamento traduzida', nota.pagamentos[0].forma === 'Boleto bancário', nota.pagamentos[0].forma);
check('protocolo de autorização', nota.protocolo.status === '100');
check('informações complementares', /PEDIDO 8890/.test(nota.informacoesComplementares));

// Resumo (resNFe) não é a nota: tem chave e valor, mas nenhum item.
const resumo = '<?xml version="1.0"?><retDistDFeInt><docZip><resNFe><chNFe>4226</chNFe></resNFe></docZip></retDistDFeInt>';
const erroResumo = explode(() => entrada.lerNotaDeEntrada(resumo));
check('resumo da nota é recusado com explicação', /RESUMO/.test(erroResumo || ''), erroResumo);

// ---------------------------------------------------------------------------
console.log('\n--- o fornecedor ---');
const DIRETORIO = [
  { id: 'cnpj-1', kind: 'empresa', name: 'OUTRA EMPRESA', code: '000123', document: '52998224725000' },
  { id: 'pes-1', kind: 'pessoa', name: 'DISTRIBUIDORA MODELO & CIA LTDA', code: '000124', document: '52998224725' }
];

const semCadastro = entrada.montarConferencia({ nota, diretorio: DIRETORIO, produtos: [] });
// O diretório TEM um cadastro com exatamente o mesmo nome do emitente, e com
// outro documento. Casar por nome daria "cadastrado" para o fornecedor errado.
check('não casa por nome, só por documento', semCadastro.fornecedor.situacao === 'nao-cadastrado', semCadastro.fornecedor.situacao);

const sugestao = semCadastro.fornecedor.sugestao;
check('a sugestão vem com razão social e CNPJ', sugestao.name === nota.emitente.nome && sugestao.document === '11222333000181');
check('  com inscrição estadual', sugestao.stateRegistration === '255123456');
check('  com endereço completo',
  sugestao.address === 'RUA DAS INDUSTRIAS' && sugestao.addressNumber === '1500' &&
  sugestao.neighborhood === 'DISTRITO INDUSTRIAL' && sugestao.city === 'FLORIANOPOLIS' &&
  sugestao.state === 'SC' && sugestao.zipCode === '88010100');
check('  com o código IBGE do município', sugestao.ibgeCityCode === '4205407');
check('  marcado como Fornecedor', Array.isArray(sugestao.roles) && sugestao.roles.includes('Fornecedor'));
check('  e registrando de onde veio', /XML/.test(sugestao.notes || ''));
// Os nomes dos campos precisam ser os do formulário de Cadastros: a tela posta
// isto na rota que já existe. Um nome fora do combinado é ignorado na gravação
// em silêncio — o campo fica vazio e ninguém vê erro nenhum.
const campoDoFormulario = ler('public/app.js');
['tradeName', 'stateRegistration', 'ibgeCityCode', 'addressComplement', 'countryCode'].forEach((campo) => {
  check(`  o campo "${campo}" existe no formulário de Cadastros`, campoDoFormulario.includes(`'${campo}'`));
});
check('CPF de produtor rural vira cadastro de pessoa, não de CNPJ',
  entrada.sugerirCadastroDoEmitente({ documento: '52998224725', tipoDocumento: 'CPF', nome: 'JOSE', endereco: {} }).tipo === 'pessoa');

const comCadastro = entrada.montarConferencia({
  nota,
  // Documento com máscara no cadastro: a comparação tem de ser por dígitos.
  diretorio: [{ id: 'cnpj-9', kind: 'empresa', name: 'MODELO', code: '9', document: '11.222.333/0001-81' }],
  produtos: []
});
check('acha o cadastro mesmo com o documento mascarado', comCadastro.fornecedor.situacao === 'cadastrado');
check('e não sugere cadastro nenhum quando já existe', comCadastro.fornecedor.sugestao === null);

// ---------------------------------------------------------------------------
console.log('\n--- os itens contra o estoque ---');
const PRODUTOS = [
  { id: 'p-gtin', name: 'OUTRO NOME QUALQUER', sku: 'ABC', ean: '7891234567895' },
  { id: 'p-sku', name: 'CAIXA QUE NAO CASA POR NOME', sku: 'FORN-9902', ean: '' },
  { id: 'p-nome', name: 'Caixa Organizadora 20L', sku: 'XYZ', ean: '' }
];
const conf = entrada.montarConferencia({ nota, diretorio: [], produtos: PRODUTOS });
check('item 1 casa pelo código de barras', conf.itens[0].vinculo.produtoId === 'p-gtin' && conf.itens[0].vinculo.por === 'gtin');
check('  e o GTIN é vínculo de confiança alta', conf.itens[0].vinculo.confianca === 'alta');
// O item 2 casa por SKU E por descrição; o SKU tem de ganhar.
check('item 2 prefere o código à descrição', conf.itens[1].vinculo.produtoId === 'p-sku', conf.itens[1].vinculo.por);

const soPorNome = entrada.montarConferencia({ nota, diretorio: [], produtos: [PRODUTOS[2]] });
check('sem código, casa pela descrição', soPorNome.itens[1].vinculo.produtoId === 'p-nome');
// Casar por descrição é palpite: dois produtos diferentes podem se chamar
// igual. Se a tela não distinguir isso de um GTIN, o palpite entra no estoque
// com a mesma confiança do código de barras.
check('  mas marcado como confiança BAIXA', soPorNome.itens[1].vinculo.confianca === 'baixa', soPorNome.itens[1].vinculo.confianca);
check('  e vira aviso na conferência', soPorNome.avisos.some((a) => a.chave === 'vinculo-fraco'));

// O de-para aprendido ganha de tudo: veio de uma pessoa conferindo.
const comHistorico = entrada.montarConferencia({
  nota, diretorio: [], produtos: PRODUTOS,
  vinculosAnteriores: { 'FORN-4471': 'p-nome' }
});
check('o vínculo já feito antes ganha do GTIN', comHistorico.itens[0].vinculo.produtoId === 'p-nome' && comHistorico.itens[0].vinculo.por === 'historico');
// Vínculo apontando para produto que não existe mais não pode "vencer" e
// deixar o item sem casar com nada.
const historicoMorto = entrada.montarConferencia({
  nota, diretorio: [], produtos: PRODUTOS,
  vinculosAnteriores: { 'FORN-4471': 'p-apagado' }
});
check('vínculo antigo para produto apagado é ignorado', historicoMorto.itens[0].vinculo.produtoId === 'p-gtin');

const semProduto = entrada.montarConferencia({ nota, diretorio: [], produtos: [] });
check('item sem produto vira aviso, não erro', semProduto.avisos.some((a) => a.chave === 'itens-sem-produto') && semProduto.bloqueios.length === 0);
const sugestaoProduto = semProduto.itens[0].sugestaoProduto;
check('a sugestão de produto traz NCM, unidade e GTIN',
  sugestaoProduto.ncm === '73181500' && sugestaoProduto.unidadeComercial === 'PC' && sugestaoProduto.ean === '7891234567895');
check('  e o custo da nota', sugestaoProduto.costPrice === 2.5);
// O XML só diz quanto EU paguei. Chutar preço de venda a partir do custo seria
// inventar margem que ninguém definiu.
check('  mas NÃO inventa preço de venda', sugestaoProduto.salePrice === 0);

// ---------------------------------------------------------------------------
console.log('\n--- o que impede o lançamento ---');
const duplicada = entrada.montarConferencia({
  nota, diretorio: [], produtos: [],
  entradaExistente: { id: 'ent-1', criadoEm: '2026-08-21T10:00:00Z' }
});
check('nota já lançada é BLOQUEIO', duplicada.bloqueios.some((b) => b.chave === 'duplicidade'));

const minhaPropria = entrada.montarConferencia({
  nota, diretorio: [], produtos: [],
  documentosProprios: ['11222333000181']
});
check('nota emitida por mim mesmo é BLOQUEIO', minhaPropria.bloqueios.some((b) => b.chave === 'emitente-proprio'));

const outroDestinatario = entrada.montarConferencia({
  nota, diretorio: [], produtos: [],
  documentosProprios: ['99999999000191']
});
check('nota endereçada a outro CNPJ é AVISO, não bloqueio',
  outroDestinatario.avisos.some((a) => a.chave === 'destinatario') &&
  !outroDestinatario.bloqueios.some((b) => b.chave === 'destinatario'));
// Sem estabelecimento cadastrado não há com o que comparar; acusar toda nota
// treinaria a ignorar o aviso.
check('sem estabelecimento cadastrado, nada é acusado',
  !entrada.montarConferencia({ nota, diretorio: [], produtos: [] }).avisos.some((a) => a.chave === 'destinatario'));

const homologacao = entrada.lerNotaDeEntrada(XML.replace('<tpAmb>1</tpAmb>', '<tpAmb>2</tpAmb>'));
check('nota de homologação é avisada',
  entrada.montarConferencia({ nota: homologacao, diretorio: [], produtos: [] }).avisos.some((a) => a.chave === 'homologacao'));

const totalErrado = entrada.lerNotaDeEntrada(XML.replace('<vProd>600.00</vProd>', '<vProd>900.00</vProd>'));
check('soma dos itens diferente do total da nota é avisada',
  entrada.montarConferencia({ nota: totalErrado, diretorio: [], produtos: [] }).avisos.some((a) => a.chave === 'total-divergente'));

// ---------------------------------------------------------------------------
console.log('\n--- as rotas ---');
const servidor = ler('server.js');
const rotaAnalisar = (servidor.match(/pathname === '\/api\/purchases\/entrada-nfe\/analisar'[\s\S]*?\n  \}\n/) || [''])[0];
check('a rota de análise existe', rotaAnalisar.length > 0);
// Analisar é leitura. Se um dia ela gravar, o XML solto na tela vira cadastro.
check('  e NÃO grava nada', !/criarEntrada|createFinancialEntry|upsertProduct|saveData/.test(rotaAnalisar));
check('  exige o módulo Compras', /allowedModules\.includes\('purchases'\)/.test(rotaAnalisar));

const rotaLancar = (servidor.match(/pathname === '\/api\/purchases\/entrada-nfe' && req\.method === 'POST'[\s\S]*?\n  \}\n/) || [''])[0];
check('a rota de lançamento existe', rotaLancar.length > 0);
// O corpo manda DECISÕES; os fatos da nota saem da releitura do XML. Sem isto,
// o navegador poderia mandar uma nota de 600 com total de 60.000.
check('  relê o XML em vez de confiar na tela', /conferirEntradaDeNfe\(body\.xml\)/.test(rotaLancar));
check('  recusa quando há bloqueio', /conferencia\.bloqueios\.length/.test(rotaLancar));
check('  valida todos os itens ANTES de gravar',
  rotaLancar.indexOf('assertMovementIsPossible') < rotaLancar.indexOf('criarEntrada'));
check('  grava auditoria', /entrada-nfe-lancada/.test(rotaLancar));

// Documento fiscal recebido não se apaga — mesma regra da nota emitida.
check('não existe rota DELETE de entrada', !/entrada-nfe[\s\S]{0,200}req\.method === 'DELETE'/.test(servidor));
const dbEntrada = ler('lib/db/entrada-nfe.js');
check('nem função de exclusão na camada de dados', !/function excluir|function deletar|function remover/.test(dbEntrada));
// A coluna xml tem o documento inteiro; num `select *` a lista viraria
// megabytes de tráfego a cada abertura de tela.
const colunas = (dbEntrada.match(/const COLUNAS_LISTA = \[([\s\S]*?)\]/) || ['', ''])[1];
check('a listagem não traz a coluna xml', !/'xml'/.test(colunas));

// ---------------------------------------------------------------------------
console.log('\n--- a migração ---');
const migracao = ler('banco/migrations/fase-ak-entrada-de-nfe.sql');
check('cria as duas tabelas', /create table if not exists nfe_entrada\b/.test(migracao) && /create table if not exists nfe_entrada_item\b/.test(migracao));
// A chave é a identidade da nota no Brasil inteiro: é o UNIQUE que impede a
// mesma nota entrar duas vezes, mesmo que a tela esqueça de conferir.
check('a chave de acesso é UNIQUE', /chave char\(44\) not null unique/.test(migracao));
check('e as duas tabelas ligam RLS',
  /alter table if exists nfe_entrada enable row level security/.test(migracao) &&
  /alter table if exists nfe_entrada_item enable row level security/.test(migracao));
check('guarda o código do fornecedor para o de-para', /codigo_fornecedor/.test(migracao));

// ---------------------------------------------------------------------------
console.log('\n--- a tela ---');
const appSrc = ler('public/app.js');
check('a tela está no menu de Compras', /key: 'entrada_nfe'/.test(appSrc));
check('e é carregada pelo navegador', /purchases\/subs\/entrada_nfe\.js/.test(ler('public/index.html')));
const telaSrc = ler('public/modules/purchases/subs/entrada_nfe.js');
check('a tela pergunta antes de cadastrar o fornecedor', /entradaCadastrarFornecedor/.test(telaSrc) && /confirmModal/.test(telaSrc));
// Rota do módulo Cadastros, não uma rota paralela: validação de CNPJ,
// duplicidade e permissão são as que já existem.
check('  e cadastra pela rota de Cadastros', /\/api\/cadastros\/cnpjs/.test(telaSrc) && /\/api\/cadastros\/pessoas/.test(telaSrc));
check('  sem inventar rota própria de fornecedor', !/entrada-nfe\/fornecedor/.test(telaSrc) && !/entrada-nfe\/fornecedor/.test(servidor));
check('quem não tem Cadastros vê o motivo, não um botão que falha', /não tem acesso ao módulo Cadastros/.test(telaSrc));
// XML com acento em ISO-8859-1 lido como UTF-8 vira lixo — e esse lixo iria
// para o cadastro do fornecedor.
check('respeita a codificação declarada no XML', /iso-8859-1/.test(telaSrc));
// A sessão vive no cabeçalho x-auth-token: um <a href> chegaria sem sessão.
check('o download do XML passa pelo token', /x-auth-token/.test(telaSrc) && !/<a href="\/api\/purchases/.test(telaSrc));
check('e o lançamento avisa que nota não se apaga', /não pode ser apagada/.test(telaSrc));

// A movimentação gerada pela nota não pode aparecer como "Manual" na tela de
// Estoque: rótulo errado manda procurar a pessoa que "digitou" um movimento
// que o sistema gerou sozinho.
const movimentacoes = ler('public/modules/stock/subs/movements.js');
check('a movimentação da entrada não se passa por manual', /'entrada-nfe': \['Entrada de NF-e'/.test(movimentacoes));
check('  e o rótulo vale na lista e no detalhe',
  /<td>\$\{seloDeOrigem\(movement\)\}<\/td>/.test(movimentacoes) &&
  /detailItem\('Origem', seloDeOrigem\(movement\)\)/.test(movimentacoes));

console.log(`\n===== ${falhas === 0 ? 'TODOS OS CHECKS PASSARAM' : falhas + ' FALHA(S)'} =====`);
process.exit(falhas ? 1 : 0);
