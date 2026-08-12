#!/usr/bin/env node
// CPF e CNPJ — modules/shared/documento.js.
//
// O QUE ISTO GUARDA
// -----------------
// A máscara e a validação existiam SÓ na tela de Cadastro de Pessoas, dentro
// do app.js. Todo o resto — colaborador no RH, destinatário da NF-e, titular
// da conta bancária, estabelecimento no Fiscal, atalho de Novo Cliente — era
// um <input> cru: aceitava letras, aceitava CPF de 9 dígitos, e gravava
// "12345678901" ao lado de "123.456.789-01" como se fossem documentos
// diferentes. Ninguém percebe até dois cadastros do mesmo cliente coexistirem.
//
// A armadilha da correção: copiar a função para cada tela. Resolveria hoje e
// divergiria na primeira correção feita só de um lado — por isso o app.js
// delega para este módulo em vez de manter a sua própria cópia.
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const ler = (p) => fs.readFileSync(path.join(RAIZ, p), 'utf8').replace(/\r\n/g, '\n');

const docSrc = ler('public/modules/shared/documento.js');
const appSrc = ler('public/app.js');
const indexSrc = ler('public/index.html');

global.window = {};
(0, eval)(docSrc);
const D = global.window.MavisDocumento;

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};

console.log('--- máscara conforme se digita ---');
check('CPF parcial', D.mascarar('1234567') === '123.456.7', D.mascarar('1234567'));
check('CPF completo', D.mascarar('12345678901') === '123.456.789-01', D.mascarar('12345678901'));
check('vira CNPJ ao passar de 11', D.mascarar('123456789012') === '12.345.678/9012', D.mascarar('123456789012'));
check('CNPJ completo', D.mascarar('12345678000199') === '12.345.678/0001-99', D.mascarar('12345678000199'));
check('descarta letras', D.mascarar('12a34b567c8901') === '123.456.789-01', D.mascarar('12a34b567c8901'));
check('não passa de 14 dígitos', D.soDigitos(D.mascarar('123456789012345678')).length === 14);

console.log('\n--- o tipo limita o tamanho ---');
// Campo de colaborador é CPF: aceitar 14 dígitos ali deixaria um CNPJ entrar
// no lugar do CPF e a folha não teria como saber.
check('cpf corta em 11', D.soDigitos(D.mascarar('12345678901234', 'cpf')).length === 11);
check('cnpj aceita 14', D.soDigitos(D.mascarar('12345678000199', 'cnpj')).length === 14);
check('pessoa-fisica corta em 11', D.soDigitos(D.mascarar('12345678901234', 'pessoa-fisica')).length === 11);
check('pessoa-juridica aceita 14', D.soDigitos(D.mascarar('12345678000199', 'pessoa-juridica')).length === 14);

console.log('\n--- validação de dígitos verificadores ---');
check('CPF válido', D.validoCpf('529.982.247-25'));
check('CPF com dígito errado', !D.validoCpf('529.982.247-26'));
check('CNPJ válido', D.validoCnpj('11.222.333/0001-81'));
check('CNPJ com dígito errado', !D.validoCnpj('11.222.333/0001-82'));
// Sequência repetida passa no cálculo mas não é documento: é o erro de
// digitação mais comum, e a SEFAZ recusa.
check('111.111.111-11 é recusado', !D.validoCpf('11111111111'));
check('00.000.000/0000-00 é recusado', !D.validoCnpj('00000000000000'));
check('tamanho errado é inválido', !D.valido('123456789'));
check('vazio é inválido', !D.valido(''));
check('valido() aceita os dois', D.valido('52998224725') && D.valido('11222333000181'));

console.log('\n--- tipo pelo tamanho ---');
check('11 dígitos = cpf', D.tipoDe('52998224725') === 'cpf');
check('14 dígitos = cnpj', D.tipoDe('11222333000181') === 'cnpj');
check('incompleto = sem tipo', D.tipoDe('123') === '');

console.log('\n--- uma implementação só ---');
// Se o app.js voltar a ter a sua, as duas divergem na primeira correção.
check('app.js não redefine a validação de CPF', !/function isValidCpf\(/.test(appSrc));
check('app.js não redefine a validação de CNPJ', !/function isValidCnpj\(/.test(appSrc));
check('app.js não redefine a máscara', !/function maskDocumentValue\(value/.test(appSrc));
check('isValidCpf delega', /const isValidCpf = .*MavisDocumento\.validoCpf/.test(appSrc));
check('isValidCnpj delega', /const isValidCnpj = .*MavisDocumento\.validoCnpj/.test(appSrc));
check('isValidDocument delega', /const isValidDocument = .*MavisDocumento\.valido/.test(appSrc));
check('maskDocumentValue delega', /const maskDocumentValue = .*MavisDocumento\.mascarar/.test(appSrc));
check('formatCpfCnpj delega', /return window\.MavisDocumento\.formatar\(value\)/.test(appSrc));
check('getDocumentType delega', /const getDocumentType = .*MavisDocumento\.tipoDe/.test(appSrc));
// A tela de Cadastro de Pessoas troca o tipo por um select, então precisa ler
// o tipo na hora — não fixado na ligação.
check('a máscara da tela principal usa o módulo', /window\.MavisDocumento\.ligar\(input, \{ tipoGetter: typeGetter \}\)/.test(appSrc));
check('o módulo suporta tipo dinâmico', /const tipoAtual = \(\) => \(tipoGetter \? tipoGetter\(\) : tipo\)/.test(docSrc));

console.log('\n--- carregado antes do app.js ---');
// O app.js delega para ele já na definição dos apelidos.
check('index.html carrega documento.js', indexSrc.includes('/modules/shared/documento.js'));
check('e antes do app.js', indexSrc.indexOf('/modules/shared/documento.js') < indexSrc.indexOf('/app.js'));

console.log('\n--- todo campo de CPF/CNPJ do sistema está ligado ---');
const CAMPOS = [
  ['public/modules/hr/subs/rh.js', 'RH · Colaborador (CPF)', /name: 'document', label: 'CPF', attrs: 'data-documento="cpf"'/],
  ['public/modules/cadastros/subs/nova_conta_bancaria.js', 'Conta bancária · titular', /name: 'document'[^}]*data-documento/],
  ['public/modules/cadastros/subs/nova_empresa.js', 'Empresa · CNPJ', /data-documento="cnpj"/],
  ['public/modules/finance/subs/emitir_nfe_focus.js', 'NF-e · destinatário', /name="destDocumento" required data-documento/],
  ['public/modules/settings/subs/fiscal.js', 'Fiscal · estabelecimento', /name="cnpj" required data-documento="cnpj"/],
  ['public/modules/shared/atalhos.js', 'Atalho · Novo Cliente/Fornecedor', /name: 'document', label: 'CPF \/ CNPJ', required: true, linha: 1, documento: true/]
];
CAMPOS.forEach(([arquivo, rotulo, padrao]) => {
  check(rotulo, padrao.test(ler(arquivo)));
});

console.log('\n--- e alguém chama ligarTodos em cada tela ---');
// Marcar o campo sem ligar não faz nada — é a metade que some sem avisar.
[
  ['public/modules/cadastros/shared.js', 'fábricas de lista/formulário'],
  ['public/modules/finance/subs/emitir_nfe_focus.js', 'emissão de NF-e'],
  ['public/modules/settings/subs/fiscal.js', 'configurações fiscais'],
  ['public/modules/shared/atalhos.js', 'janelas de atalho']
].forEach(([arquivo, rotulo]) => {
  check(`${rotulo} chama ligarTodos`, /MavisDocumento\?\.ligarTodos\(/.test(ler(arquivo)));
});
// As três fábricas de tela (lista, inline, formulário) desenham em pontos
// diferentes; ligar em só uma deixaria as outras duas cruas.
const nasFabricas = (ler('public/modules/cadastros/shared.js').match(/ligarTodos\(content\)/g) || []).length;
check('as 3 fábricas de tela ligam', nasFabricas === 3, `${nasFabricas} ponto(s)`);

console.log('\n--- re-render não empilha listener ---');
// ligarTodos roda a cada desenho da tela; sem a trava, cada render somaria
// mais um handler no mesmo campo.
check('ligar ignora input já ligado', /if \(!input \|\| input\.dataset\.documentoLigado === '1'\) return;/.test(docSrc));
check('e marca o input', /input\.dataset\.documentoLigado = '1';/.test(docSrc));

console.log('\n--- o erro aparece no blur, não a cada tecla ---');
// Acusar "CPF inválido" no terceiro dígito é ruído: ainda vai ficar inválido
// por mais oito.
check('valida no blur', /input\.addEventListener\('blur'/.test(docSrc));
check('não valida no input', !/addEventListener\('input'[\s\S]{0,200}documento-invalido'\)/.test(docSrc.replace(/classList\.remove\('documento-invalido'\)/g, '')));
check('digitar limpa o erro anterior', /classList\.remove\('documento-invalido'\)/.test(docSrc));
// Documento opcional em branco não é erro — marcar em vermelho um campo que
// ninguém precisa preencher treina o usuário a ignorar o vermelho.
check('vazio só é erro se obrigatório', /const ok = vazio \? !obrigatorio : valido\(digitos\)/.test(docSrc));
check('obrigatoriedade vem do required do campo', /obrigatorio: input\.hasAttribute\('required'\)/.test(docSrc));

console.log('\n--- a mensagem diz o que está errado ---');
check('conta os dígitos informados', /\$\{digitos\.length\} dígito\(s\)/.test(docSrc));
check('e diz quantos deveriam ser', /CPF tem 11 e CNPJ tem 14/.test(docSrc));
check('distingue dígito verificador errado', /os dígitos verificadores não conferem/.test(docSrc));
check('o CSS do erro existe', /\.documento-erro/.test(ler('public/app.css')));
check('e o da borda inválida', /\.documento-invalido/.test(ler('public/app.css')));

console.log('\n--- consulta de CNPJ na Receita ---');
// Digitar o CNPJ e nada acontecer não avisa que existe uma consulta. Antes só
// a tela de Cadastro de Pessoas puxava os dados; no atalho de Novo Cliente a
// pessoa colava o CNPJ e digitava o resto à mão.
const atalhosSrc = ler('public/modules/shared/atalhos.js');
check('o módulo expõe a consulta', typeof D.consultarCnpj === 'function');
check('e o ligador do campo', typeof D.ligarConsultaCnpj === 'function');
check('atalho de Cliente consulta', /titulo: 'Cliente'[\s\S]{0,140}consultaCnpj: true/.test(atalhosSrc));
check('atalho de Fornecedor consulta', /titulo: 'Fornecedor'[\s\S]{0,140}consultaCnpj: true/.test(atalhosSrc));
// Produto e Lançamento não têm CNPJ: ligar ali seria botão que nunca serve.
check('atalho de Produto NÃO consulta', !/titulo: 'Produto'[\s\S]{0,300}consultaCnpj/.test(atalhosSrc));
check('atalho de Lançamento NÃO consulta', !/titulo: 'Lançamento'[\s\S]{0,400}consultaCnpj/.test(atalhosSrc));

let rotaChamada = '';
const apiFalsa = async (rota) => {
  rotaChamada = rota;
  return {
    officialData: {
      razaoSocial: 'MAVIS COMERCIO LTDA',
      nomeFantasia: 'Mavis',
      endereco: { logradouro: 'Rua das Palmeiras', numero: '120', complemento: 'Sala 3', bairro: 'Centro', cep: '89201000', cidade: 'Joinville', estado: 'SC' },
      enderecoCompleto: 'Rua das Palmeiras, 120, Sala 3',
      contatos: [{ type: 'email', value: 'contato@mavis.com' }, { type: 'telefone', value: '4733334444' }],
      raw: {}
    }
  };
};

(async () => {
  const dados = await D.consultarCnpj(apiFalsa, '43.792.899/0001-35');
  // A rota recebe só dígitos: mandar com máscara devolveria 400.
  check('a rota recebe só dígitos', rotaChamada === '/api/cnpj/43792899000135', rotaChamada);
  check('razão social', dados.razaoSocial === 'MAVIS COMERCIO LTDA');
  // Logradouro separado, e não o "enderecoCompleto": as telas têm campo de
  // número e complemento próprios, e juntar tudo obrigaria a desmembrar depois.
  check('logradouro separado do número', dados.logradouro === 'Rua das Palmeiras' && dados.numero === '120');
  check('complemento', dados.complemento === 'Sala 3');
  check('bairro, cidade e UF', dados.bairro === 'Centro' && dados.municipio === 'Joinville' && dados.uf === 'SC');
  check('CEP só com dígitos', dados.cep === '89201000');
  // Receita devolve contato em dois formatos conforme o provedor.
  check('e-mail da lista de contatos', dados.email === 'contato@mavis.com');
  check('telefone da lista de contatos', dados.telefone === '4733334444');

  const doCru = await D.consultarCnpj(async () => ({
    officialData: { contatos: [], raw: { email: 'x@y.com', ddd_telefone_1: '4799998888' } }
  }), '43792899000135');
  check('e-mail do payload cru, quando não há lista', doCru.email === 'x@y.com');
  check('telefone do payload cru', doCru.telefone === '4799998888');

  // Valida ANTES da rede: CNPJ com dígito errado não gasta chamada nem devolve
  // erro genérico de servidor.
  let recusou = '';
  try { await D.consultarCnpj(apiFalsa, '11111111111111'); } catch (e) { recusou = e.message; }
  check('CNPJ inválido é recusado antes da rede', /dígitos verificadores/.test(recusou), recusou.slice(0, 40));
  let curto = '';
  try { await D.consultarCnpj(apiFalsa, '123'); } catch (e) { curto = e.message; }
  check('CNPJ incompleto também', /14 dígitos/.test(curto), curto.slice(0, 40));

  console.log('\n--- a busca automática não atropela o que foi digitado ---');
  const src = ler('public/modules/shared/documento.js');
  // Colar o CNPJ e passar para o próximo campo é o gesto natural; exigir um
  // clique na lupa faria a consulta passar despercebida.
  check('busca ao sair do campo', /input\.addEventListener\('blur', \(\) => \{[\s\S]{0,120}consultar\(\{ automatica: true \}\)/.test(src));
  check('a lupa força a consulta', /botao\.addEventListener\('click', \(\) => consultar\(\{ automatica: false \}\)\)/.test(src));
  check('automática respeita o guarda', /if \(automatica && devePreencherSozinho && !devePreencherSozinho\(\)\) return;/.test(src));
  check('o atalho só busca sozinho com o nome vazio', /devePreencherSozinho: \(\) => !String\(overlay\.querySelector\('\[name="name"\]'\)\?\.value \|\| ''\)\.trim\(\)/.test(atalhosSrc));
  // Sobrescrever o que a pessoa digitou é pior do que não preencher: o
  // cadastro da Receita costuma estar desatualizado.
  check('só preenche campo vazio', /if \(campo && !String\(campo\.value \|\| ''\)\.trim\(\) && valor\) campo\.value = valor/.test(atalhosSrc));
  // UF é <select>: atribuir uma sigla fora da lista deixaria o campo em branco.
  check('UF só muda se a sigla existir no select', /\[\.\.\.uf\.options\]\.some\(\(o\) => o\.value === dados\.uf\)/.test(atalhosSrc));
  check('duas consultas simultâneas não se atropelam', /if \(consultando\) return;/.test(src));
  // Receita fora do ar não torna o CNPJ digitado inválido.
  check('falha de rede não invalida o documento', /Falha de consulta não invalida o CNPJ digitado/.test(src));
  check('a lupa fica desabilitada sem 14 dígitos', /botao\.disabled = soDigitos\(input\.value\)\.length !== 14/.test(src));

  console.log('\n--- a lupa envolve só o campo ---');
  // Posicionar em relação ao <label> a deixaria torta: o label tem o texto do
  // rótulo acima e cresce quando o aviso de inválido aparece embaixo.
  check('cria um wrapper próprio', /caixa\.className = 'documento-com-lupa'/.test(src));
  check('e move o input para dentro dele', /caixa\.appendChild\(input\)/.test(src));
  check('o aviso vai para o label, não para o wrapper', /input\.closest\('label'\) \|\| input\.parentElement/.test(src));
  const css = ler('public/app.css');
  check('CSS do wrapper', /\.documento-com-lupa \{ position: relative/.test(css));
  check('espaço reservado no input', /\.documento-com-lupa input \{ padding-right/.test(css));
  check('estado de carregando', /\.documento-lupa\.is-carregando/.test(css));

  console.log('\n--- código do município: IBGE, nunca SIAFI ---');
  // A BrasilAPI devolve DOIS códigos de município. Para Brasília:
  //   codigo_municipio      = 9701     (SIAFI/TOM)
  //   codigo_municipio_ibge = 5300108  (é este que vai na NF-e)
  // Trocar os dois faz a SEFAZ rejeitar a nota por município inválido — e o
  // erro só aparece na transmissão, com a nota já montada.
  const comCodigos = await D.consultarCnpj(async () => ({
    officialData: { endereco: {}, contatos: [], raw: { codigo_municipio: 9701, codigo_municipio_ibge: 5300108 } }
  }), '43792899000135');
  check('usa o código IBGE', comCodigos.codigoMunicipioIbge === '5300108', comCodigos.codigoMunicipioIbge);
  check('e NUNCA o SIAFI', comCodigos.codigoMunicipioIbge !== '9701');
  const semIbge = await D.consultarCnpj(async () => ({
    officialData: { endereco: {}, contatos: [], raw: { codigo_municipio: 9701 } }
  }), '43792899000135');
  // Sem o IBGE, melhor vazio do que errado: o "Buscar CEP" preenche pelo ViaCEP.
  check('sem código IBGE, fica vazio', semIbge.codigoMunicipioIbge === '', semIbge.codigoMunicipioIbge);
  check('o módulo lê só codigo_municipio_ibge', /raw\?\.codigo_municipio_ibge/.test(docSrc));
  check('e explica o porquê no código', /código SIAFI\/TOM/.test(docSrc));

  console.log('\n--- consulta ligada na emissão de NF-e ---');
  const nfeSrc = ler('public/modules/finance/subs/emitir_nfe_focus.js');
  check('ligada ao campo do destinatário', /content\.querySelector\('\[name="destDocumento"\]'\)/.test(nfeSrc));
  ['destNome', 'destCep', 'destLogradouro', 'destNumero', 'destComplemento', 'destBairro', 'destMunicipio', 'destUf']
    .forEach((campo) => check(`  preenche ${campo}`, new RegExp(`preencher\\('${campo}'`).test(nfeSrc)));
  check('  usa o IBGE no código do município', /preencher\('destCodigoMunicipio', dados\.codigoMunicipioIbge\)/.test(nfeSrc));
  // Quem tem CNPJ é presumidamente contribuinte — e é isso que decide o
  // indicador de IE e, com ele, se a operação tem DIFAL.
  check('  marca contribuinte', /contribuinte\.checked = true/.test(nfeSrc));
  check('  só preenche campo vazio', /if \(campo && !String\(campo\.value \|\| ''\)\.trim\(\) && valor\)/.test(nfeSrc));

  console.log('\n--- consulta ligada no estabelecimento fiscal ---');
  const fiscalSrc = ler('public/modules/settings/subs/fiscal.js');
  check('ligada ao CNPJ do estabelecimento', /content\.querySelector\('#fiscalEstabForm \[name="cnpj"\]'\)/.test(fiscalSrc));
  ['razaoSocial', 'nomeFantasia', 'email', 'telefone', 'logradouro', 'numero', 'complemento', 'bairro', 'municipio', 'uf', 'cep']
    .forEach((campo) => check(`  preenche ${campo}`, new RegExp(`preencher\\('${campo}'`).test(fiscalSrc)));
  check('  usa o IBGE no código do município', /preencher\('codigoMunicipio', dados\.codigoMunicipioIbge\)/.test(fiscalSrc));
  // A Receita devolve o CNAE como descrição, não como código: preencher o
  // campo de código com texto deixaria o cadastro fiscal errado em silêncio.
  check('  NÃO preenche o CNAE', !/preencher\('cnaePrincipal'/.test(fiscalSrc));
  check('  e explica por quê', /não como código/.test(fiscalSrc));

  console.log('\n--- os campos de destino existem mesmo ---');
  // Um nome errado aqui não quebra nada: a consulta roda, não preenche, e
  // ninguém descobre por que o campo ficou vazio.
  const DESTINOS = [
    ['public/modules/finance/subs/emitir_nfe_focus.js', ['destNome', 'destCep', 'destLogradouro', 'destNumero', 'destComplemento', 'destBairro', 'destMunicipio', 'destUf', 'destCodigoMunicipio', 'destContribuinte']],
    ['public/modules/settings/subs/fiscal.js', ['razaoSocial', 'nomeFantasia', 'email', 'telefone', 'logradouro', 'numero', 'complemento', 'bairro', 'municipio', 'uf', 'cep', 'codigoMunicipio']],
    ['public/modules/shared/atalhos.js', []]
  ];
  DESTINOS.forEach(([arquivo, campos]) => {
    const src = ler(arquivo);
    const ausentes = campos.filter((c) => !new RegExp(`name="${c}"`).test(src));
    if (campos.length) check(`${arquivo.split('/').pop()}: ${campos.length} campos existem`, ausentes.length === 0, ausentes.join(', ') || 'ok');
  });
  // No atalho os campos vêm de CAMPOS_PESSOA, declarados como objeto.
  const atalhoCampos = ['name', 'email', 'phone', 'zipCode', 'address', 'number', 'complement', 'neighborhood', 'city', 'state'];
  const ausentesAtalho = atalhoCampos.filter((c) => !new RegExp(`name: '${c}'`).test(atalhosSrc));
  check(`atalhos.js: ${atalhoCampos.length} campos existem`, ausentesAtalho.length === 0, ausentesAtalho.join(', ') || 'ok');

  console.log(`\n===== ${falhas === 0 ? 'TODOS OS CHECKS PASSARAM' : falhas + ' FALHA(S)'} =====`);
  process.exit(falhas ? 1 : 0);
})();
