#!/usr/bin/env node
// O LEIAUTE OFICIAL DA EFD, CONFERIDO CONTRA UMA ESCRITURAÇÃO QUE A SEFAZ
// ACEITOU.
//
// lib/sped-leiaute.js foi extraído de um PDF de 362 páginas por script. Um PDF
// lido por regex é uma fonte que erra em silêncio: campo perdido, campo
// inventado, tipo deslocado de uma linha. Nada disso aparece na leitura — só
// aparece quando a SEFAZ rejeita o arquivo, ou pior, quando aceita com valor
// truncado.
//
// O GABARITO é a escrituração de agosto de 2026 desta empresa, que foi
// entregue e aceita. lib/sped-registros.js guarda, daquele arquivo real,
// quantos campos cada um dos 40 registros usados tinha. Se a contagem do Guia
// bate com a do arquivo em 40 de 40, a leitura do PDF não perdeu nem inventou
// campo nesses 40 — e são justamente os que este sistema precisa gerar.
//
// Quatro defeitos de extração foram achados exatamente assim, e o cabeçalho de
// lib/sped-leiaute.js os registra: nome de campo com cedilha, asterisco de
// nota dentro do nome, tipo colado no traço, e a célula de descrição que desce
// uma linha no PDF.
//
// Roda sem banco, sem rede e sem o PDF: tudo o que ele compara está
// versionado.
const leiaute = require('../lib/sped-leiaute');
const observado = require('../lib/sped-registros');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};

console.log('--- 1. o Guia é o do leiaute que o arquivo real declara ---');
// DERIVADO: o COD_VER do registro 0000 de agosto é '020'. Se um dia o leiaute
// subir e alguém trocar o Guia sem trocar o outro, isto acusa.
check('LEIAUTE_VERSAO é o COD_VER observado no 0000',
  leiaute.LEIAUTE_VERSAO === observado.OBSERVADO_0000.codVer,
  `${leiaute.LEIAUTE_VERSAO} vs ${observado.OBSERVADO_0000.codVer}`);
check('a versão do Guia está registrada', /^\d+\.\d+\.\d+$/.test(leiaute.GUIA_VERSAO), leiaute.GUIA_VERSAO);
check('e a data de atualização dele também',
  /^\d{4}-\d{2}-\d{2}$/.test(leiaute.GUIA_ATUALIZACAO), leiaute.GUIA_ATUALIZACAO);
check('a origem é o portal do SPED', /^https?:\/\/sped\.rfb\.gov\.br\//.test(leiaute.GUIA_URL));

console.log('\n--- 2. O GABARITO: 40 registros de uma escrituração aceita ---');
const divergentes = [];
const ausentes = [];
for (const r of observado.REGISTROS) {
  // `quantosCampos` ESTOURA num campo mal formado — é assim que um nome com
  // cedilha é barrado. Aqui isso é uma divergência como qualquer outra, com o
  // motivo escrito: sem o try, o teste morria com stack trace no primeiro
  // registro torto e não dizia qual era.
  let q;
  try { q = leiaute.quantosCampos(r.reg); } catch (erro) {
    divergentes.push(`${r.reg}: não decodifica (${erro.message})`);
    continue;
  }
  if (q === null) ausentes.push(r.reg);
  else if (q !== r.campos) divergentes.push(`${r.reg}: guia=${q} arquivo=${r.campos}`);
}
check('todo registro usado em agosto existe no Guia',
  ausentes.length === 0, ausentes.length ? ausentes.join(', ') : `${observado.REGISTROS.length} conferidos`);
check('e a contagem de campos bate nos 40',
  divergentes.length === 0, divergentes.length ? divergentes.join(' | ') : `${observado.REGISTROS.length} de ${observado.REGISTROS.length}`);

console.log('\n--- 3. todo registro do Guia decodifica, e a ordem é 1..N ---');
const todos = leiaute.registros();
check('o Guia rendeu registros', todos.length > 200, todos.length);
// DECODIFICA UMA VEZ, AQUI, E GUARDA. `decodificar` ESTOURA de propósito num
// campo mal formado — é o que impede um nome com cedilha de entrar no arquivo
// da EFD. Mas os checks seguintes não podem morrer com stack trace por causa
// disso: quem acusa registro quebrado é este bloco, com nome e motivo.
let sequenciaOk = 0;
const quebrados = [];
const decodificados = new Map();
for (const reg of todos) {
  let campos;
  try { campos = leiaute.camposDe(reg); } catch (erro) { quebrados.push(reg + ': ' + erro.message); continue; }
  if (!campos || !campos.length) { quebrados.push(reg + ': vazio'); continue; }
  decodificados.set(reg, campos);
  if (campos.every((c, i) => c.n === i + 1)) sequenciaOk += 1;
  else quebrados.push(reg + ': numeração fora de ordem');
}
check('nenhum registro quebrado', quebrados.length === 0, quebrados.slice(0, 4).join(' | ') || `${todos.length} lidos`);
check('a numeração é 1..N em todos', sequenciaOk === todos.length, `${sequenciaOk} de ${todos.length}`);

// O nome do campo entra no arquivo em ASCII. O Guia escreve nove deles com
// acento (VL_RETENÇAO_ST, DT_SAÍDA...), e a extração normaliza.
const comAcento = [];
for (const [reg, campos] of decodificados) {
  for (const c of campos) {
    if (!/^[A-Z][A-Z0-9_]*$/.test(c.nome)) comAcento.push(reg + '.' + c.nome);
  }
}
check('nenhum nome de campo ficou com acento ou minúscula',
  comAcento.length === 0, comAcento.slice(0, 5).join(', ') || 'todos ASCII');
check('e os que o Guia acentua estão anotados',
  Array.isArray(leiaute.NOMES_ACENTUADOS_NO_GUIA) && leiaute.NOMES_ACENTUADOS_NO_GUIA.length >= 9,
  (leiaute.NOMES_ACENTUADOS_NO_GUIA || []).length);
// A anotação tem de apontar para campo que EXISTE, com o nome em ASCII. A
// primeira versão deste check só conferia que o registro existia — e uma
// mutação que escrevia "VL_RETENÇAO_ST" dentro da própria anotação passava,
// porque ninguém comparava a anotação com o leiaute.
const anotacoesTortas = [];
for (const anotado of (leiaute.NOMES_ACENTUADOS_NO_GUIA || [])) {
  const m = String(anotado).match(/^([0-9A-Z]{4})\.([A-Z0-9_]+) \(o guia escreve (\S+)\)$/);
  if (!m) { anotacoesTortas.push(anotado + ' [formato]'); continue; }
  const campos = leiaute.camposDe(m[1]);
  if (!campos) { anotacoesTortas.push(anotado + ' [registro inexistente]'); continue; }
  if (!campos.some((c) => c.nome === m[2])) anotacoesTortas.push(anotado + ' [campo inexistente]');
  if (m[2] === m[3]) anotacoesTortas.push(anotado + ' [nada a normalizar]');
}
check('  e cada anotação aponta para um campo que existe, em ASCII',
  anotacoesTortas.length === 0, anotacoesTortas.slice(0, 3).join(' | ') || 'todas conferidas');

console.log('\n--- 3b. nome truncado: o defeito que a CONTAGEM não pega ---');
// No PDF o nome vem partido quando não cabe na coluna, e o resto cai na coluna
// 0 da linha seguinte: "VL_BC_ICMS_" + "ST" no C190, "VL_SLD_CREDOR_TRA" +
// "NSPORTAR" no E110. Com o nome truncado o NÚMERO de campos continua certo, e
// a conferência de 40 em 40 passa — foi o que aconteceu na primeira versão
// deste arquivo. Quem pega é o nome.
const truncados = [];
const repetidosIndevidos = [];
for (const [reg, campos] of decodificados) {
  const legitimos = (leiaute.DUPLICADOS_LEGITIMOS || {})[reg] || [];
  const vistos = new Set();
  for (const c of campos) {
    if (c.nome.endsWith('_')) truncados.push(reg + '.' + c.nome);
    if (vistos.has(c.nome) && !legitimos.includes(c.nome)) repetidosIndevidos.push(reg + '.' + c.nome);
    vistos.add(c.nome);
  }
}
// Os dois campos que a apuração usa, e que vinham truncados.
const c190_8 = leiaute.camposDe('C190')[7];
const e110_14 = leiaute.camposDe('E110')[13];
check('C190 campo 08 é VL_BC_ICMS_ST, e não VL_BC_ICMS_',
  c190_8.nome === 'VL_BC_ICMS_ST', c190_8.nome);
check('E110 campo 14 é VL_SLD_CREDOR_TRANSPORTAR',
  e110_14.nome === 'VL_SLD_CREDOR_TRANSPORTAR', e110_14.nome);

// Os suspeitos que sobraram têm de estar DECLARADOS, e nenhum pode ser dos 40.
const usados = new Set(observado.REGISTROS.map((r) => r.reg));
const suspeitos = new Set(leiaute.NOMES_SUSPEITOS || []);
const suspeitosNaoDeclarados = [...new Set([...truncados, ...repetidosIndevidos]
  .map((x) => x.split('.')[0]))].filter((reg) => !suspeitos.has(reg));
check('todo registro com nome duvidoso está em NOMES_SUSPEITOS',
  suspeitosNaoDeclarados.length === 0,
  suspeitosNaoDeclarados.join(', ') || `${suspeitos.size} declarados`);
check('e NENHUM dos 40 usados em agosto é suspeito',
  [...suspeitos].every((reg) => !usados.has(reg)),
  [...suspeitos].filter((reg) => usados.has(reg)).join(', ') || 'nenhum');
// Nome repetido só passa se estiver na lista de duplicados conferidos no Guia.
check('nome repetido no mesmo registro só com justificativa conferida',
  Object.keys(leiaute.DUPLICADOS_LEGITIMOS || {}).length > 0
  && (leiaute.DUPLICADOS_LEGITIMOS.C170 || []).includes('ALIQ_PIS'),
  'C170: ' + ((leiaute.DUPLICADOS_LEGITIMOS || {}).C170 || []).join(', '));
// E o C170 de fato os tem duas vezes — o Guia é que é assim (campo 27 em
// percentual, 29 em reais; 33 e 35 idem para a COFINS).
const nomesC170 = leiaute.camposDe('C170').map((c) => c.nome);
check('  e o C170 realmente tem ALIQ_PIS duas vezes',
  nomesC170.filter((n) => n === 'ALIQ_PIS').length === 2
  && nomesC170.filter((n) => n === 'ALIQ_COFINS').length === 2);
check('  e o campo 34 dele não ficou em QUANT_BC_COF',
  nomesC170[33] === 'QUANT_BC_COFINS', nomesC170[33]);

console.log('\n--- 4. tipo chutado é pior que tipo ausente ---');
// A célula de descrição desce uma linha no PDF, então tipo/tamanho são casados
// por ORDEM e só quando as contagens batem. Quando não batem, o registro fica
// sem tipo — e isso tem de ser declarado, não descoberto em produção.
const semTipo = new Set(leiaute.SEM_TIPO);
const mentindo = [];
for (const [reg, campos] of decodificados) {
  const temTipo = campos.every((c) => c.tipo);
  const nenhumTipo = campos.every((c) => !c.tipo);
  if (semTipo.has(reg) && !nenhumTipo) mentindo.push(reg + ': em SEM_TIPO mas tem tipo');
  if (!semTipo.has(reg) && !temTipo) mentindo.push(reg + ': fora de SEM_TIPO mas falta tipo');
}
check('SEM_TIPO diz a verdade nos dois sentidos',
  mentindo.length === 0, mentindo.slice(0, 4).join(' | ') || `${todos.length - semTipo.size} com tipo, ${semTipo.size} sem`);

// O DESLOCAMENTO QUE A CONTAGEM NÃO PEGA. Em 01/10/2026 o K200 (estoque do
// Bloco K, que aparece no SPED de setembro) estava com todos os tipos um campo
// para trás: REG:C8, DT_EST:N-.3, QTD:N5, IND_EST:C0. A contagem de campos
// batia; o tipo, não. O primeiro campo de TODO registro é REG, texto de 4
// posições — se o tipo dele não for C4, o casamento escorregou, e escorregou
// para todos os campos do registro. B020, C177, C420 e C490 estavam assim
// também e foram para SEM_TIPO; K200 e B990 (que o gerador escreve) foram
// corrigidos à mão contra o Guia.
const regTorto = [...decodificados]
  .filter(([, campos]) => campos[0].tipo && !(campos[0].tipo === 'C' && campos[0].tam === 4))
  .map(([reg, campos]) => `${reg}: REG:${campos[0].tipo}${campos[0].tam ?? '-'}`);
check('todo registro com tipo começa em REG:C4',
  regTorto.length === 0, regTorto.slice(0, 4).join(' | ') || 'nenhum escorregado');
check('  e o K200 tem DT_EST data, QTD com 3 decimais e IND_EST de 1 posição',
  (() => {
    const k = Object.fromEntries(leiaute.camposDe('K200').map((c) => [c.nome, c]));
    return k.DT_EST.tam === 8 && k.QTD.dec === 3 && k.IND_EST.tam === 1;
  })());

// DOS 40 QUE IMPORTAM, quantos estão sem tipo — e o que isso impede.
const dos40SemTipo = observado.REGISTROS.filter((r) => semTipo.has(r.reg));
check('dos 40 usados em agosto, no máximo um está sem tipo',
  dos40SemTipo.length <= 1, dos40SemTipo.map((r) => r.reg).join(', ') || 'nenhum');
check('  e esse já não tinha origem no sistema de qualquer forma',
  dos40SemTipo.every((r) => r.fonte === null),
  dos40SemTipo.map((r) => `${r.reg}: fonte=${r.fonte}`).join(', ') || 'n/a');

console.log('\n--- 5. fatos que não dependem da minha leitura do PDF ---');
// A chave de acesso da NF-e tem 44 dígitos. Isso é lei, não extração — e vale
// em TODO registro que carregue a chave, não só no C100. A primeira versão
// olhava apenas o C100, e uma mutação que encurtava a chave no registro 1105
// passava: o CHV_NFE aparece em quatro registros (1105, B020, C100, E531).
const comChave = [];
const chaveTorta = [];
for (const [reg, campos] of decodificados) {
  for (const c of campos) {
    if (c.nome !== 'CHV_NFE') continue;
    comChave.push(reg);
    // Registro em SEM_TIPO não tem tipo a conferir (o B020 foi para lá em
    // 01/10/2026): conta como portador da chave, mas não como chave torta.
    if (semTipo.has(reg)) continue;
    if (c.tipo !== 'N' || c.tam !== 44) chaveTorta.push(`${reg}: ${c.tipo}${c.tam}`);
  }
}
check('a chave da NF-e tem 44 posições em todo registro que a carrega',
  comChave.length >= 4 && chaveTorta.length === 0,
  chaveTorta.length ? chaveTorta.join(', ') : comChave.join(', '));
const c100 = leiaute.camposDe('C100');
check('C100 começa em REG e o 2º campo é IND_OPER',
  c100[0].nome === 'REG' && c100[1].nome === 'IND_OPER');

// Todo campo que o arquivo real de agosto preencheu no 0000 tem de existir no
// leiaute oficial do 0000. Derivado de OBSERVADO_0000, não de uma lista minha.
const nomesDo0000 = new Set(leiaute.camposDe('0000').map((c) => c.nome));
const MAPA_0000 = { codVer: 'COD_VER', codFin: 'COD_FIN', uf: 'UF', codMun: 'COD_MUN', indPerfil: 'IND_PERFIL', indAtiv: 'IND_ATIV' };
const faltando0000 = Object.entries(MAPA_0000)
  .filter(([chaveObs]) => observado.OBSERVADO_0000[chaveObs] !== undefined)
  .filter(([, campo]) => !nomesDo0000.has(campo))
  .map(([, campo]) => campo);
check('todo campo observado no 0000 real existe no leiaute',
  faltando0000.length === 0, faltando0000.join(', ') || Object.keys(MAPA_0000).length + ' conferidos');
check('e o 0000 começa em REG', leiaute.camposDe('0000')[0].nome === 'REG');

// Registro de encerramento: REG + quantidade de linhas, sempre 2 campos.
const encerramentos = todos.filter((r) => /^([0-9A-K])990$/.test(r) || r === '9990' || r === '9999');
const forasDePadrao = encerramentos.filter((r) => leiaute.quantosCampos(r) !== 2);
check('todo registro de encerramento tem 2 campos',
  forasDePadrao.length === 0, forasDePadrao.join(', ') || `${encerramentos.length} conferidos`);

console.log('\n--- 6. registro que o Guia não tem devolve null, não lista vazia ---');
// Lista vazia deixaria um gerador escrever "|XXXX|" e achar que cumpriu o
// leiaute. null obriga quem chama a decidir.
check('camposDe de registro inexistente é null', leiaute.camposDe('ZZZZ') === null);
check('quantosCampos de registro inexistente é null', leiaute.quantosCampos('ZZZZ') === null);
check('e o caixa alta não importa', leiaute.quantosCampos('c100') === leiaute.quantosCampos('C100'));

console.log('\n--- 7. ter o leiaute não é ter o gerador ---');
// A conta honesta: dos 40 registros de agosto, dez não têm de onde sair neste
// sistema — e entre eles está o bloco E inteiro, a apuração do imposto. Este
// check existe para que "temos o Guia" não seja lido como "podemos gerar".
const sem = observado.semFonte();
check('a lista de registros sem origem continua existindo', sem.length > 0, sem.length + ' registros');
const blocoE = sem.filter((r) => r.bloco === 'E').map((r) => r.reg);
check('  e a apuração (bloco E) está nela', blocoE.length > 0, blocoE.join(', '));
check('  todos eles têm leiaute conhecido',
  sem.every((r) => leiaute.quantosCampos(r.reg) !== null),
  'o que falta é o dado, não o leiaute');

console.log(`\n===== ${falhas === 0 ? 'TODOS OS CHECKS PASSARAM' : falhas + ' FALHA(S)'} =====`);
process.exit(falhas ? 1 : 0);
