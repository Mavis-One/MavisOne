#!/usr/bin/env node
// Um telefone é um telefone em toda tela do sistema.
//
// O QUE ESTE TESTE EXISTE PARA PEGAR
// ----------------------------------
// A varredura de 14/08/2026 mediu a bagunça: 7 campos de telefone, TODOS
// <input type="text"> cru — aceitavam letras e aceitavam 3 dígitos. CEP tinha
// 3 tratamentos diferentes, UF tinha 5 (de campo livre a select), CPF/CNPJ
// tinha 7: a tela de Pessoas validava, a de Colaborador não, e o destinatário
// da NF-e avulsa — o campo cujo erro a SEFAZ recusa — era texto cru.
//
// Ninguém era contra validar. O que faltava era um lugar que garantisse a
// marcação e um teste que cobrasse. Sem este arquivo, a tela nova de amanhã
// nasce com <input type="text"> de novo e ninguém percebe.
//
// COMO FUNCIONA
// -------------
// Cada campo de DADO precisa declarar o que é: data-campo="telefone" no HTML
// literal, ou `mascara: 'telefone'` / `documento: 'cpf'` nas fábricas. O teste
// varre o front-end inteiro e cobra a marcação.
//
// As EXCEÇÕES são explícitas e justificadas, nunca silenciosas — uma exceção
// sem motivo escrito é como o campo ficaria sem o teste.
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const arquivos = [];
(function varrer(dir) {
  for (const nome of fs.readdirSync(dir)) {
    const p = path.join(dir, nome);
    if (fs.statSync(p).isDirectory()) varrer(p);
    else if (nome.endsWith('.js')) arquivos.push(p);
  }
})(path.join(RAIZ, 'public'));

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};

// Campos que TÊM o nome de uma família mas NÃO são daquela família. Cada um
// com o motivo — é o que impede a lista de virar um esconderijo.
const EXCECOES = [
  // "Documento" aqui é o NÚMERO da nota/boleto/romaneio que originou o
  // lançamento ou a movimentação. Não é CPF nem CNPJ: mascarar impediria
  // digitar "NF 12345".
  { arquivo: 'public/modules/finance/subs/novo_lancamento.js', campo: 'document' },
  { arquivo: 'public/modules/stock/subs/new_movement.js', campo: 'document' },
  { arquivo: 'public/modules/stock/subs/new_transfer.js', campo: 'document' },
  { arquivo: 'public/modules/shared/atalhos.js', campo: 'document', so: 'Documento' },
  // Campos de FILTRO de lista. Filtro aceita pedaço: quem procura todos os
  // clientes de Joinville digita "89" no CEP e espera que funcione. Validar
  // um filtro como se fosse cadastro tornaria a busca inútil.
  { arquivo: 'public/app.js', campo: 'state', filtro: true },
  { arquivo: 'public/app.js', campo: 'email', filtro: true },
  { arquivo: 'public/app.js', campo: 'zipCode', filtro: true },
  { arquivo: 'public/app.js', campo: 'uf', filtro: true },
  { arquivo: 'public/app.js', campo: 'document', so: 'listFilters.document' },
  // O documento do Cadastro de Pessoas é ligado por JS (ver peopleDocumentInput
  // no app.js) e NÃO por data-documento, porque o tipo vem de um select que o
  // usuário troca entre física e jurídica: precisa ser lido na hora, e é o que
  // o `tipoGetter` faz. Marcar com data-documento faria o observador ligá-lo
  // primeiro, com tipo fixo, e a troca do select deixaria de valer.
  { arquivo: 'public/app.js', campo: 'document', so: 'peopleDocumentInput' }
];

// name -> marcação esperada
const ESPERADO = {
  phone: 'telefone', telefone: 'telefone', mobilePhone: 'telefone', whatsapp: 'telefone',
  zipCode: 'cep', cep: 'cep', billingZipCode: 'cep', deliveryZipCode: 'cep',
  state: 'uf', uf: 'uf', ufDestino: 'uf', billingState: 'uf', deliveryState: 'uf',
  plate: 'placa', ncm: 'ncm', cest: 'cest', cnpjRaiz: 'cnpj-raiz'
};
const DOCUMENTOS = ['document', 'cnpj', 'cpf', 'titularCnpj', 'clientDocument'];

const rel = (p) => path.relative(RAIZ, p).split(path.sep).join('/');
const ehExcecao = (arquivo, campo, trecho) => EXCECOES.some((e) =>
  e.arquivo === arquivo && e.campo === campo && (!e.so || trecho.includes(e.so)));

console.log('--- todo campo de dado declara o que é ---');
const semMarca = [];
let marcados = 0;
for (const arq of arquivos) {
  const src = fs.readFileSync(arq, 'utf8');
  const nome = rel(arq);

  // 1) HTML literal
  for (const m of src.matchAll(/<(input|select)\b([^>]*)>/gi)) {
    const tag = m[0];
    const elemento = m[1].toLowerCase();
    const campo = (tag.match(/name="([^"$]*)"/) || [])[1];
    if (!campo) continue;
    const precisa = ESPERADO[campo] || (DOCUMENTOS.includes(campo) ? 'documento' : null);
    if (!precisa) continue;
    // <select> já limita a escolha à lista — é a validação mais forte que existe.
    if (elemento === 'select') { marcados++; continue; }
    const tem = precisa === 'documento' ? /data-documento/.test(tag) : tag.includes(`data-campo="${precisa}"`);
    if (tem) marcados++;
    else if (!ehExcecao(nome, campo, tag)) semMarca.push(`${nome}  <${elemento} name="${campo}"> — falta ${precisa === 'documento' ? 'data-documento' : `data-campo="${precisa}"`}`);
  }

  // 2) declaração de fábrica: { name: 'x', ... }
  for (const m of src.matchAll(/\{\s*name:\s*'([^']+)'([^}]{0,200})\}/g)) {
    const campo = m[1];
    const resto = m[2];
    const precisa = ESPERADO[campo] || (DOCUMENTOS.includes(campo) ? 'documento' : null);
    if (!precisa) continue;
    if (/type:\s*'select'/.test(resto)) { marcados++; continue; }
    const tem = precisa === 'documento'
      ? /documento:/.test(resto)
      : new RegExp(`mascara:\\s*'${precisa}'`).test(resto);
    if (tem) marcados++;
    else if (!ehExcecao(nome, campo, resto)) semMarca.push(`${nome}  { name: '${campo}' } — falta ${precisa === 'documento' ? 'documento:' : `mascara: '${precisa}'`}`);
  }
}
check(`${marcados} campos marcados, nenhum sem marcação`, semMarca.length === 0, semMarca.length ? `${semMarca.length} sem marca` : undefined);
semMarca.forEach((s) => console.log(`        ${s}`));

console.log('\n--- as três fábricas falam a mesma língua ---');
// Declarar um telefone tem que ser igual nas três; se uma só aceitar `attrs`,
// a próxima tela declara do jeito dela e a divergência volta por outro caminho.
const fabricas = [
  ['Estoque/RH/PCP/Frota', 'public/modules/stock/shared.js'],
  ['Cadastros', 'public/modules/cadastros/shared.js'],
  ['Atalhos', 'public/modules/shared/atalhos.js']
];
for (const [rotulo, arq] of fabricas) {
  const src = fs.readFileSync(path.join(RAIZ, arq), 'utf8');
  check(`${rotulo}: entende mascara`, /data-campo="\$\{(def|campo)\.mascara\}"/.test(src));
  check(`${rotulo}: entende documento`, /data-documento="\$\{(def|campo)\.documento/.test(src));
}

console.log('\n--- o comportamento é ligado sozinho, em qualquer tela ---');
const campos = fs.readFileSync(path.join(RAIZ, 'public/modules/shared/campos.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(RAIZ, 'public/index.html'), 'utf8');
check('campos.js é carregado', /shared\/campos\.js/.test(indexHtml));
check('e depois do documento.js, que ele usa', indexHtml.indexOf('shared/documento.js') < indexHtml.indexOf('shared/campos.js'));
// Quem liga é o PRÓPRIO arquivo, não quem o carrega. A primeira versão chamava
// observar() do router.js, que o index.html carrega ANTES deste — o `?.`
// engolia a chamada em silêncio e nada ficava ligado, com o teste de fonte
// passando porque os campos ESTAVAM marcados. Só o navegador acusou.
check('campos.js se liga sozinho, sem depender de ordem de carregamento',
  /if \(document\.readyState === 'loading'\) document\.addEventListener\('DOMContentLoaded', iniciar\)/.test(campos));
check('e ninguém mais tenta ligar de fora',
  !/MavisCampos\?\.observar/.test(fs.readFileSync(path.join(RAIZ, 'public/modules/router.js'), 'utf8')));
check('ligarTodos cobre também o documento', /MavisDocumento\?\.ligarTodos/.test(campos));
// Sem o observador, cada tela teria de lembrar de chamar ligarTodos — e as que
// re-renderizam sozinhas (trocar de aba, salvar item de lista) ficariam de fora.
check('o observador existe e é idempotente', /MutationObserver/.test(campos) && /camposObservados/.test(campos));

console.log('\n--- as regras de validação ---');
// campos.js é script de navegador; roda aqui num `window` de mentira, para o
// teste exercitar as funções DE VERDADE em vez de reimplementá-las.
global.window = global.window || {};
new Function('window', fs.readFileSync(path.join(RAIZ, 'public/modules/shared/campos.js'), 'utf8'))(global.window);
const C = global.window.MavisCampos;

const casos = [
  ['telefone', '(47) 99999-0000', true], ['telefone', '4733334444', true],
  ['telefone', '479999900', false, 'curto demais'],
  ['telefone', '(01) 99999-0000', false, 'DDD 01 não existe'],
  ['telefone', '(47) 89999-0000', false, 'celular tem que começar com 9'],
  ['telefone', '00000000000', false, 'tudo zero'],
  ['cep', '89201-000', true], ['cep', '89201000', true], ['cep', '8920100', false, '7 dígitos'],
  ['uf', 'SC', true], ['uf', 'sc', true], ['uf', 'XX', false, 'não existe'],
  ['placa', 'ABC1234', true, 'formato antigo'], ['placa', 'ABC1D23', true, 'Mercosul'],
  ['placa', 'AB1234', false, 'curta'], ['placa', '1234ABC', false, 'invertida'],
  ['ncm', '73181500', true], ['ncm', '7318150', false, '7 dígitos'],
  ['cest', '2106400', true], ['cest', '210640', false, '6 dígitos']
];
for (const [tipo, valor, esperado, nota] of casos) {
  const obtido = C.TIPOS[tipo].valido(valor);
  check(`${tipo}: "${valor}" ${esperado ? 'aceito' : 'recusado'}${nota ? ' (' + nota + ')' : ''}`, obtido === esperado);
}

console.log('\n--- a máscara só deixa passar o que deve ---');
check('telefone descarta letras', C.mascararTelefone('47a9b9999c0000') === '(47) 99999-0000', C.mascararTelefone('47a9b9999c0000'));
check('CEP descarta letras', C.mascararCep('89a201b000') === '89201-000', C.mascararCep('89a201b000'));
check('UF vira maiúscula e corta em 2', C.mascararUf('scx') === 'SC', C.mascararUf('scx'));
check('placa vira maiúscula sem hífen', C.mascararPlaca('abc-1d23') === 'ABC1D23', C.mascararPlaca('abc-1d23'));
check('NCM só dígitos', C.TIPOS.ncm.mascara('73a18b1500x') === '73181500', C.TIPOS.ncm.mascara('73a18b1500x'));

console.log('\n--- o erro tem a mesma cara em todo campo ---');
const css = fs.readFileSync(path.join(RAIZ, 'public/app.css'), 'utf8');
check('a borda vermelha é a mesma regra', /\.documento-invalido,\s*\n\.campo-invalido/.test(css));
check('o texto de erro é a mesma regra', /\.documento-erro,\s*\n\.campo-erro/.test(css));
check('a validação roda no blur, não a cada tecla', /addEventListener\('blur'/.test(campos) && !/addEventListener\('input'[\s\S]{0,200}campo-erro'\);\s*\n\s*caixa/.test(campos));

console.log(`\n===== ${falhas === 0 ? 'TODOS OS CHECKS PASSARAM' : falhas + ' FALHA(S)'} =====`);
process.exit(falhas ? 1 : 0);
