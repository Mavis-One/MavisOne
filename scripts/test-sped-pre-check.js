#!/usr/bin/env node
// O PRE-CHECK DO SPED: o catalogo de registros e a logica dos quatro estados.
//
// O QUE ESTE TESTE EXISTE PARA PEGAR
// ----------------------------------
// Esta tela e' uma lista de conferencias, e a coisa mais facil de fazer errado
// numa lista de conferencias e' ela dizer "ok" para o que nao conferiu.
//
// Hoje o banco tem 0 documentos fiscais. Entao "0 itens sem CFOP" e' verdade, e
// e' inutil: nao ha item nenhum. Uma tela que pintasse isso de verde diria que
// esta tudo pronto para gerar um arquivo vazio -- e essa e' a forma de defeito
// mais caro possivel aqui, porque a pessoa confia na tela e descobre no dia 19.
//
// Por isso `conferencia()` tem TRES saidas e nao duas (`ok`, `semBase`,
// pendente), e este teste cobra a tabela de verdade inteira delas.
//
// O SEGUNDO ASSUNTO E O CATALOGO. `lib/sped-registros.js` foi levantado do
// arquivo que o SISTEMA ATUAL gerou para agosto de 2026, e a contagem de campos
// de cada registro esta lá como CONFERENCIA: quando o gerador existir, o numero
// de campos que ele produzir tem de bater com o do arquivo antigo. Se alguem
// mexer nessas contagens sem ter o arquivo na mao, a referencia deixa de valer
// -- e o teste cobra os numeros que foram medidos.
//
// O arquivo em si foi embora da pasta Downloads depois da leitura, entao estes
// numeros sao o que restou dela. Mexer neles exige medir de novo.
//
// O QUE ESTE TESTE NAO ALCANCA
// ----------------------------
// As consultas ao banco. Isso e' `scripts/prova-sped-pre-check.js`, que sobe o
// servidor e cobra os tres estados contra o banco de verdade.
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const ler = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');

// O modulo de pre-check carrega lib/db/conexao, que cria o pool na primeira
// CONSULTA e nao no require. Sem consulta, nenhuma conexao e' aberta. A URL de
// mentira e' o cinto de seguranca, no mesmo idioma de test-modulos-telas.js.
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://teste:teste@127.0.0.1:1/teste-offline';

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};

const sped = require('../lib/sped-registros.js');
const { janelaDaCompetencia } = require('../lib/db/sped-pre-check.js');
const fonteCheck = ler('lib/db/sped-pre-check.js');
const tela = ler('public/modules/fiscal/subs/sped_pre_check.js');
const servidor = ler('server.js');

// ---------------------------------------------------------------------------
console.log('--- o catalogo de registros, medido no arquivo de agosto/2026 ---');

check('os 40 registros do arquivo estao no catalogo', sped.REGISTROS.length === 40, `${sped.REGISTROS.length}`);
const semNome = sped.REGISTROS.filter((r) => !r.reg || !r.bloco || !r.nome || !r.campos);
check('todos com registro, bloco, nome e contagem de campos', semNome.length === 0,
  semNome.map((r) => r.reg).join(', ') || 'todos completos');
const repetidos = sped.REGISTROS.map((r) => r.reg).filter((r, i, a) => a.indexOf(r) !== i);
check('nenhum registro repetido', repetidos.length === 0, repetidos.join(', ') || 'nenhum');

// AS CONTAGENS MEDIDAS. Mexer aqui sem medir de novo torna a referencia falsa.
const MEDIDO = {
  '0000': 15, '0005': 10, '0100': 14, '0150': 13, '0190': 3, '0200': 13, '0450': 3,
  C100: 29, C110: 3, C170: 38, C190: 12,
  E100: 3, E110: 15, E116: 10, E200: 4, E210: 15, E250: 10,
  1010: 14, 9900: 3
};
for (const [reg, campos] of Object.entries(MEDIDO)) {
  const achado = sped.REGISTROS.find((r) => r.reg === reg);
  check(`  ${reg} tem ${campos} campos`, achado && achado.campos === campos, achado ? String(achado.campos) : 'AUSENTE');
}
// Abertura e encerramento de bloco tem 2 campos, sempre. Um com 3 seria erro de
// transcricao, e nao ha de onde o gerador tirar um terceiro.
const aberturas = sped.REGISTROS.filter((r) => /^([0-9]|[A-K])?(001|990)$/.test(r.reg) || r.reg === '9990' || r.reg === '9999');
const aberturaTorta = aberturas.filter((r) => r.campos !== 2);
check('toda abertura/encerramento tem 2 campos', aberturaTorta.length === 0,
  aberturaTorta.map((r) => `${r.reg}=${r.campos}`).join(', ') || `${aberturas.length} conferidos`);

console.log('\n--- e o que o arquivo declara no 0000 ---');
check('COD_VER 020 (a versao do layout)', sped.OBSERVADO_0000.codVer === '020', sped.OBSERVADO_0000.codVer);
check('IND_PERFIL B', sped.OBSERVADO_0000.indPerfil === 'B', sped.OBSERVADO_0000.indPerfil);
check('IND_ATIV 1 (outros, nao industrial)', sped.OBSERVADO_0000.indAtiv === '1', sped.OBSERVADO_0000.indAtiv);
check('modelos 55 e 65 (tem NFC-e na escrituracao)',
  sped.OBSERVADO.modelos.join(',') === '55,65', sped.OBSERVADO.modelos.join(','));

console.log('\n--- os registros SEM FONTE neste sistema ---');
const semFonte = sped.semFonte().map((r) => r.reg);
// Estes seis foram os achados de ler o arquivo, e nenhum estava previsto em
// fase nenhuma do plano.
for (const reg of ['0100', '0450', 'C110', 'C190', 'E110', 'E116', 'E200', 'E210', 'E250', '1010']) {
  check(`  ${reg} nao sai de lugar nenhum`, semFonte.includes(reg));
}
// E o contrario: registro COM fonte nao pode estar na lista, senao a tela pede
// desenvolvimento para algo que ja existe.
for (const reg of ['0000', '0150', '0190', '0200', 'C100', 'C170']) {
  const r = sped.REGISTROS.find((x) => x.reg === reg);
  check(`  ${reg} tem fonte (${r && r.fonte})`, r && r.fonte !== null);
}

// ---------------------------------------------------------------------------
console.log('\n--- a janela da competencia: o ultimo dia de cada mes ---');
check('agosto -> 31', janelaDaCompetencia('2026-08').ate === '2026-08-31');
check('setembro -> 30', janelaDaCompetencia('2026-09').ate === '2026-09-30');
check('fevereiro comum -> 28', janelaDaCompetencia('2026-02').ate === '2026-02-28');
check('fevereiro bissexto -> 29', janelaDaCompetencia('2024-02').ate === '2024-02-29');
check('  e 2000 (bissexto de seculo) -> 29', janelaDaCompetencia('2000-02').ate === '2000-02-29');
check('  e 1900 nao seria bissexto -> 28', janelaDaCompetencia('1900-02').ate === '1900-02-28');
check('dezembro -> 31', janelaDaCompetencia('2026-12').ate === '2026-12-31');
check('o primeiro dia e sempre dia 01', janelaDaCompetencia('2026-07').de === '2026-07-01');

// A competencia invalida e RECUSADA, e nao "corrigida". Corrigir faria
// "2026-13" virar janeiro de 2027 em silencio, e o arquivo sairia do mes errado.
for (const ruim of ['2026-13', '2026-00', 'agosto', '26-08', '', null, '2026-1']) {
  let recusou = false;
  try { janelaDaCompetencia(ruim); } catch (e) { recusou = e.status === 400; }
  check(`  ${JSON.stringify(ruim)} e recusado com 400`, recusou);
}

// ---------------------------------------------------------------------------
console.log('\n--- OS QUATRO ESTADOS, e a tabela de verdade deles ---');

// `conferencia()` nao e exportada de proposito (e detalhe interno), entao a
// logica e conferida pela FONTE. Sao tres afirmacoes, e cada uma sozinha
// deixaria a tela mentir de um jeito diferente.
check('`semBase` e avaliados === 0',
  /semBase:\s*Number\(avaliados \|\| 0\) === 0/.test(fonteCheck));
check('`ok` exige avaliados > 0 E pendentes === 0',
  /ok:\s*Number\(avaliados \|\| 0\) > 0 && Number\(pendentes \|\| 0\) === 0/.test(fonteCheck));
// Sem o `> 0`, toda conferencia sem base viria `ok: true` -- e o Bloco C
// inteiro, hoje, apareceria verde.
check('  e sem o `> 0` o Bloco C inteiro viria verde (o defeito que isto evita)',
  fonteCheck.includes('Number(avaliados || 0) > 0 &&'));

// Na tela, a ORDEM das saidas importa: `semFonte` tambem tem avaliados = 0, e
// sem a saida dele antes, todo registro sem fonte apareceria como "sem base" --
// que sugere "ainda nao ha dado", quando o certo e "nao ha onde guardar".
const ordemSemFonte = tela.indexOf("if (c.gravidade === 'semFonte')");
const ordemSemBase = tela.indexOf('if (c.semBase)');
check('na tela, `semFonte` e testado ANTES de `semBase`',
  ordemSemFonte > 0 && ordemSemBase > 0 && ordemSemFonte < ordemSemBase,
  `semFonte na posicao ${ordemSemFonte}, semBase na ${ordemSemBase}`);
check('os quatro estados tem rotulo proprio',
  ['impede', 'atencao', 'semFonte', 'semBase', 'ok'].every((e) => new RegExp(`${e}:\\s*\\{ rotulo`).test(tela)));
check('  e "sem base" nao usa o tom de sucesso',
  /semBase:\s*\{ rotulo: 'sem base para conferir', tom: 'muted' \}/.test(tela));
check('  e "ok" e o unico verde', (tela.match(/tom: 'success'/g) || []).length === 1);

console.log('\n--- a tela diz que NAO gera o arquivo ---');
// O nome da tela e "Pre-check do SPED" e nao "Gerar SPED", e a razao tem de
// estar escrita: o layout de serializacao de cada registro sai do Guia Pratico,
// e sem ele um botao "Gerar" produziria arquivo que o PVA recusa.
check('a tela afirma isso em texto visivel', /<strong>Esta tela não gera o arquivo<\/strong>/.test(tela));
check('  e explica que falta o layout de serializacao', /Guia Prático/.test(tela));
check('  e a rota nao devolve conteudo de arquivo',
  !/txt:|conteudo:|arquivo:\s*gerar/.test(fonteCheck));

console.log('\n--- a rota e a permissao ---');
check('a rota existe', /pathname === '\/api\/fiscal\/sped\/pre-check' && req\.method === 'GET'/.test(servidor));
check('  mapeada como `visualizar`', /pathname === '\/api\/fiscal\/sped\/pre-check'\) return 'visualizar'/.test(servidor));
// A permissao tem de vir ANTES do prefixo generico do fim da funcao, senao
// `startsWith('/api/fiscal/nfe/')` nunca a alcanca -- mas este caminho nao
// casa com aquele prefixo. O que importa e nao cair no `return 'configurar'`
// final, que exigiria permissao de configuracao para uma tela de leitura.
const posPermissao = servidor.indexOf("'/api/fiscal/sped/pre-check') return 'visualizar'");
const posFallback = servidor.indexOf("  return 'configurar';");
check('  e antes do fallback `configurar`', posPermissao > 0 && posPermissao < posFallback);
check('o padrao da competencia e o MES PASSADO, e nao este',
  /getUTCMonth\(\) - 1/.test(servidor) && /a EFD que se está preparando|A EFD que se está preparando|mês passado|MÊS PASSADO/i.test(servidor));

console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TODOS OS CHECKS PASSARAM =====');
process.exit(falhas ? 1 : 0);
