// DUPLICIDADE DE CADASTRO — sem banco e sem servidor.
//
// O DEFEITO, medido neste banco em 24/09/2026 sobre as 6.492 pessoas
// importadas do ViperERP:
//
//      87 pessoas têm o nome de outra
//     737 pessoas têm o endereço completo de outra (282 endereços repetidos)
//
// A conferência RECUSAVA o cadastro nos três casos — documento, nome e
// endereço. As duas últimas travavam essas ~824 pessoas, e não só na criação:
// travavam a EDIÇÃO, porque a conferência ignora apenas o próprio id. Abrir um
// homônimo para corrigir o telefone dele encontrava o outro homônimo e
// recusava. Não havia caminho pela tela para consertar nenhum dos 824.
//
// E são cadastros legítimos: homônimo é comum, mãe e filho dividem endereço,
// condomínio e prédio comercial repetem endereço por natureza, e pessoa física
// mora no endereço da empresa dela.
//
// O QUE ESTE TESTE PROTEGE, E POR QUE CADA COISA
// ---------------------------------------------
// 1. O DOCUMENTO RECUSA. É o único que se sustenta: CPF e CNPJ existem para
//    dizer "esta é a mesma pessoa".
// 2. NOME E ENDEREÇO AVISAM. Voltar a recusar trava os 824 de novo.
// 3. A REGRA TEM UM DONO SÓ. Ela estava escrita DUAS VEZES, palavra por
//    palavra — server.js e public/app.js, cada uma com sua cópia de
//    `normalizeText` e da chave de endereço. Duas cópias de uma regra são duas
//    regras; a segunda só ainda não divergiu. Este é o check que impede a
//    terceira.
// 4. O AVISO CHEGA ANTES DE GRAVAR, na tela. Aviso depois do salvamento é
//    informação sem ação.
// 5. A CHAVE DE ENDEREÇO É DO ENDEREÇO COMPLETO. Só o logradouro faria toda
//    "Rua Brasil" do país colidir; e chave vazia não compara com nada, senão
//    os 6.492 cadastros sem endereço colidiriam todos entre si.
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const ler = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');
const { semComentarios } = require('./sem-comentarios');

const dup = require(path.join(RAIZ, 'public/modules/shared/duplicidade_cadastro'));

let falhas = 0;
function check(titulo, condicao, detalhe) {
  console.log(`  ${condicao ? 'OK  ' : 'XX  '} ${titulo}${detalhe ? ' -> ' + detalhe : ''}`);
  if (!condicao) falhas++;
}

const ENDERECO = {
  street: 'Rua das Palmeiras', streetNumber: '120', neighborhood: 'Centro',
  city: 'Joinville', state: 'SC', zipCode: '89200-000'
};

const BASE = [
  { id: 'p1', name: 'José Maria da Silva', document: '111.444.777-35', ...ENDERECO },
  { id: 'p2', name: 'Padaria do Bairro LTDA', document: '11.222.333/0001-81', street: 'Av. Brasil', streetNumber: '9', city: 'Blumenau', state: 'SC', zipCode: '89000-000' }
];

// ---------------------------------------------------------------------------
console.log('--- 1. o documento RECUSA ---');
check('mesmo CPF é bloqueio',
  Boolean(dup.bloqueio(BASE, { name: 'Outro Nome', document: '11144477735' })));
check('  e a mensagem nomeia quem já tem',
  /José Maria da Silva/.test(dup.bloqueio(BASE, { name: 'Outro', document: '11144477735' })));
check('mesmo CNPJ é bloqueio',
  Boolean(dup.bloqueio(BASE, { name: 'Outra Padaria', document: '11222333000181' })));
check('pontuação não importa',
  Boolean(dup.bloqueio(BASE, { name: 'X', document: '111-444-777.35' })),
  'a comparacao e por digitos');
check('documento novo passa',
  dup.bloqueio(BASE, { name: 'Alguém', document: '52998224725' }) === null);
check('sem documento não há bloqueio a dar',
  dup.bloqueio(BASE, { name: 'Alguém', document: '' }) === null,
  'a obrigatoriedade do campo e outra conferencia');

console.log('\n--- 2. na EDIÇÃO, o próprio registro não se acusa ---');
check('editar p1 mantendo o CPF dele passa',
  dup.bloqueio(BASE, { id: 'p1', name: 'José Maria da Silva', document: '11144477735' }, 'p1') === null,
  'sem excluirId, todo cadastro seria duplicata de si mesmo');
check('  mas assumir o CPF de p2 ainda é bloqueio',
  Boolean(dup.bloqueio(BASE, { id: 'p1', name: 'José', document: '11222333000181' }, 'p1')));

// ---------------------------------------------------------------------------
console.log('\n--- 3. nome e endereço AVISAM, não recusam ---');

const homonimo = { name: 'josé maria DA silva', document: '52998224725', street: 'Outra Rua', city: 'Curitiba', state: 'PR', zipCode: '80000-000' };
check('homônimo NÃO é bloqueio', dup.bloqueio(BASE, homonimo) === null,
  'e o caso dos 87');
const avisosHomonimo = dup.avisos(BASE, homonimo);
check('  é aviso', avisosHomonimo.length === 1 && avisosHomonimo[0].tipo === 'nome');
check('  e compara sem acento e sem caixa',
  avisosHomonimo.length === 1, '"josé maria DA silva" casou com "José Maria da Silva"');

const mesmoEndereco = { name: 'Maria da Silva', document: '52998224725', ...ENDERECO };
check('mesmo endereço NÃO é bloqueio', dup.bloqueio(BASE, mesmoEndereco) === null,
  'e o caso dos 737 -- mae e filho, condominio, matriz e filial');
const avisosEndereco = dup.avisos(BASE, mesmoEndereco);
check('  é aviso', avisosEndereco.length === 1 && avisosEndereco[0].tipo === 'endereco');
check('  e diz de quem é o endereço', /José Maria da Silva/.test(avisosEndereco[0].mensagem));

console.log('\n--- 4. as duas coincidências juntas dão DOIS avisos ---');
// Dizer só a primeira esconderia a outra: quem decide precisa das duas.
const ambos = dup.avisos(BASE, { name: 'José Maria da Silva', document: '52998224725', ...ENDERECO });
check('dois avisos', ambos.length === 2, ambos.map((a) => a.tipo).join(' + '));
check('e o texto da pergunta junta os dois e pergunta',
  /Cadastrar mesmo assim\?$/.test(dup.textoDoAviso(ambos)),
  dup.textoDoAviso(ambos).slice(0, 120));
check('sem coincidência, texto vazio',
  dup.textoDoAviso(dup.avisos(BASE, { name: 'Ninguém Igual', document: '52998224725', street: 'Rua Nova', city: 'Itajaí', state: 'SC', zipCode: '88300-000' })) === '');

console.log('\n--- 5. a chave de endereço é do endereço COMPLETO ---');
check('sem logradouro, chave vazia', dup.chaveDeEndereco({ city: 'Joinville' }) === '',
  'os 6.492 cadastros sem endereco colidiriam todos entre si');
check('  e chave vazia não gera aviso',
  dup.avisos([{ id: 'x', name: 'A', city: 'Joinville' }], { name: 'B', city: 'Joinville' })
    .every((a) => a.tipo !== 'endereco'));
check('mesma rua, número diferente: chaves diferentes',
  dup.chaveDeEndereco({ ...ENDERECO, streetNumber: '120' })
  !== dup.chaveDeEndereco({ ...ENDERECO, streetNumber: '121' }),
  '"Rua Brasil" sozinha casaria com toda Rua Brasil do pais');
check('mesma rua e número, cidade diferente: chaves diferentes',
  dup.chaveDeEndereco({ ...ENDERECO, city: 'Joinville' })
  !== dup.chaveDeEndereco({ ...ENDERECO, city: 'Blumenau' }));
check('CEP compara por dígitos',
  dup.chaveDeEndereco({ ...ENDERECO, zipCode: '89200-000' })
  === dup.chaveDeEndereco({ ...ENDERECO, zipCode: '89200000' }));
check('`address` e `street` são a mesma coisa',
  dup.chaveDeEndereco({ address: 'Rua X', city: 'A' }) === dup.chaveDeEndereco({ street: 'Rua X', city: 'A' }),
  'o formulario grava street; payload antigo usa address');

// ---------------------------------------------------------------------------
console.log('\n--- 6. a regra tem UM dono ---');
const servidor = semComentarios(ler('server.js'));
const app = semComentarios(ler('public/app.js'));

check('o servidor requer o módulo compartilhado',
  /require\('\.\/public\/modules\/shared\/duplicidade_cadastro'\)/.test(ler('server.js')));
check('e delega a conferência a ele',
  /return duplicidade\.bloqueio\(\[\.\.\.data\.people, \.\.\.data\.cnpjs\], record, excludeId\)/.test(servidor));

// O CHECK QUE IMPEDE A TERCEIRA CÓPIA. Se alguém reescrever a comparação por
// nome ou a chave de endereço em qualquer das duas pontas, aqui falha.
for (const [onde, fonte] of [['server.js', servidor], ['public/app.js', app]]) {
  check(`${onde} não reimplementa a comparação por nome`,
    !/normalizeText\(entry\.name/.test(fonte) && !/normalizeRegistrationText\(entry\.name/.test(fonte),
    'era o `if (name && ...)` das duas copias');
  check(`${onde} não tem mais a sua chave de endereço`,
    !/function buildAddressKey/.test(fonte) && !/function buildRegistrationAddressKey/.test(fonte));
}

// A TELA NÃO CONFERE MAIS: PERGUNTA (rodada de desempenho, out/2026).
//
// Ela conferia contra as 6.492 pessoas que baixava a cada clique (7,4 MB). A
// lista passou a vir paginada do servidor, então a tela pergunta a
// /api/cadastros/duplicidade — que aplica ESTE módulo sobre a mesma lista.
// Estes dois checks exigiam a casca do cliente sobre o módulo; agora exigem
// que a rota use o módulo e que a tela mande os campos que ele lê.
const rotaDup = servidor.slice(servidor.indexOf("pathname === '/api/cadastros/duplicidade'"));
check('a rota de duplicidade aplica o bloqueio do módulo',
  /bloqueio: findDuplicateRegistration\(dados, registro, excluirId\)/.test(rotaDup.slice(0, 1500)));
check('  e o aviso', /aviso: duplicidade\.textoDoAviso\(avisosDeDuplicidade\(dados, registro, excluirId\)\)/.test(rotaDup.slice(0, 1500)));
check('  sobre pessoas E CNPJs, a mesma lista de antes',
  /const dados = \{ people, cnpjs \};/.test(rotaDup.slice(0, 1500)));
check('a tela e a rota leem os campos da lista que mora no módulo',
  /duplicidadeCadastro\(\)\.CAMPOS_LIDOS\.forEach/.test(app) && /duplicidade\.CAMPOS_LIDOS\.forEach/.test(rotaDup.slice(0, 1500)));
// A lista cobre tudo o que a regra lê: um campo novo lido e não mandado faria
// a pergunta responder diferente da recusa do POST.
const lidosNoModulo = new Set([...ler('public/modules/shared/duplicidade_cadastro.js')
  .matchAll(/registro\.([a-zA-Z]+)/g)].map((m) => m[1]));
const declarados = require(path.join(RAIZ, 'public/modules/shared/duplicidade_cadastro.js')).CAMPOS_LIDOS;
const faltando = [...lidosNoModulo].filter((c) => !declarados.includes(c));
check('CAMPOS_LIDOS cobre todo campo que a regra lê do cadastro', faltando.length === 0,
  faltando.length ? `faltando: ${faltando.join(', ')}` : [...lidosNoModulo].join(', '));

// O módulo escreve os combinantes por CÓDIGO. A cópia do app.js os tinha
// LITERAIS dentro do regex — caractere invisível no fonte é o defeito que
// ninguém revisa (ver o byte NUL que o lib/zip.js carregava).
const modulo = ler('public/modules/shared/duplicidade_cadastro.js');
check('os acentos combinantes estão escapados no módulo',
  modulo.includes(String.fromCharCode(92) + 'u0300-' + String.fromCharCode(92) + 'u036f'));
// A FAIXA É MONTADA POR CÓDIGO, e não escrita como literal dentro do regex.
//
// Esta linha era `!/[<combinantes literais>]/.test(modulo)` — usava exatamente
// o caractere invisível que ela existe para proibir. Funcionava, e era a
// armadilha: quem abrisse o teste para entender a regra veria colchetes vazios.
//
// A varredura de TODOS os fontes mora em test-fontes-sem-byte-de-controle.js
// (a regra valia só para este arquivo, e o defeito voltou em
// lib/filial-da-venda.js). Aqui fica o caso do módulo, que é o que esta suíte
// cobre.
const COMBINANTES = new RegExp(`[${String.fromCharCode(0x300)}-${String.fromCharCode(0x36f)}]`);
check('e não há combinante literal no arquivo',
  !COMBINANTES.test(modulo),
  'fonte com caractere invisivel some num "salvar como" errado');

console.log('\n--- 7. o aviso chega ANTES de gravar, na tela ---');
check('a tela pergunta e desiste no "não"',
  /if \(avisoDup && !\(await confirmModal\(avisoDup\)\)\) return;/.test(app));
check('  nos DOIS formulários (pessoa e CNPJ), com a resposta do servidor',
  (app.match(/duplicidadeDoCadastro = await perguntarDuplicidadeDeCadastro\(payload, payload\.id\)/g) || []).length === 2
  && (app.match(/const avisoDup = duplicidadeDoCadastro\.aviso;/g) || []).length === 2);
check('  e o documento repetido continua recusando antes de enviar',
  (app.match(/const duplicateMessage = duplicidadeDoCadastro\.bloqueio;/g) || []).length === 2);
check('e não usa window.prompt', !/window\.prompt/.test(app));

console.log('\n--- 8. o servidor também devolve os avisos ---');
// Quem chega por API não vê o confirmModal. Sem isto, a importação e qualquer
// integração gravariam o homônimo sem nunca saber que havia um.
// `const avisos = ...` e não só `avisosDeDuplicidade(data`: este último conta
// também a DEFINIÇÃO da função, e o check pedia 4 achando 5. Contar a chamada
// pelo jeito como ela é usada é o que responde "quantas rotas calculam?".
check('as quatro rotas calculam os avisos',
  (servidor.match(/const avisos = avisosDeDuplicidade\(data/g) || []).length === 4,
  'pessoa e CNPJ, criar e atualizar');
check('e os devolvem na resposta',
  (servidor.match(/success: true, (person|company): (created|updated), avisos/g) || []).length === 4);
check('calculados ANTES de gravar',
  /const avisos = avisosDeDuplicidade\(data, person\);\s*\n\s*const created = await db\.createPerson/.test(servidor),
  'depois, o proprio cadastro novo se acusaria');

console.log(falhas === 0 ? '\n===== TODOS OS CHECKS PASSARAM =====' : `\n===== ${falhas} FALHA(S) =====`);
process.exit(falhas === 0 ? 0 : 1);
