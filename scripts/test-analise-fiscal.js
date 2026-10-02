#!/usr/bin/env node
/**
 * TABELAS OFICIAIS (NCM, CEST) E A ANÁLISE FISCAL DO CADASTRO (fase DO).
 *
 * Os trechos de HTML e JSON abaixo têm o formato exato das duas fontes
 * (Convênio ICMS 142/2018 no CONFAZ e nomenclatura do Siscomex), conferido nas
 * páginas baixadas em 02/10/2026 — inclusive a linha de redação ANTERIOR, que
 * vem com a classe "...verde" e não pode entrar.
 */
const { lerNcmSiscomex, lerCestConfaz, prefixosDoTexto, cestCobreNcm } = require('../lib/tabelas-fiscais');
const { analisarCadastro } = require('../lib/analise-fiscal');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas += 1;
};
const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

console.log('\n--- 1. o campo NCM/SH do convênio ---');
check('código completo', igual(prefixosDoTexto('3815.12.10 3815.12.90').prefixos, ['38151210', '38151290']));
check('posição e subposição viram prefixo', igual(prefixosDoTexto('3917 8714.9').prefixos, ['3917', '87149']));
check('"Capítulos 13 e 15 a 23"', igual(prefixosDoTexto('Capítulos 13 e 15 a 23').prefixos, ['13', '15', '16', '17', '18', '19', '20', '21', '22', '23']));
check('"Capítulo 33"', igual(prefixosDoTexto('Capítulo 33').prefixos, ['33']));
check('vírgula que sobra', igual(prefixosDoTexto('8704.31.30,').prefixos, ['87043130']));
check('zero a mais na frente ("008.13", "00909")', igual(prefixosDoTexto('008.13 00909').prefixos, ['0813', '0909']));
const torto = prefixosDoTexto('3924.90.00 926.90.90');
check('dígito que falta não é chutado: vai para descartados', igual(torto.prefixos, ['39249000']) && igual(torto.descartados, ['926.90.90']));
check('vazio não restringe', cestCobreNcm([], '87116000') && cestCobreNcm(['8714'], '87149990') && !cestCobreNcm(['8714'], '87116000'));

console.log('\n--- 2. a página do CONFAZ ---');
const html = `
<p class="A6-1Subtitulo">ANEXO II</p><p class="A6-1Subtitulo">AUTOPEÇAS</p>
<table><tbody>
<tr><td><p class="A7-1TabelaSubtitulo">ITEM</p></td><td><p>CEST</p></td><td><p>NCM/SH</p></td><td><p>DESCRIÇÃO</p></td></tr>
<tr><td><p class="A7-2Tabelajustificado">42.0</p></td><td><p class="A7-2Tabelajustificado">01.042.00</p></td><td><p class="A7-2Tabelajustificado">8421.32.00</p></td><td><p class="A7-2Tabelajustificado">Depuradores</p></td></tr>
<tr><td colspan="4"><p class="A8-2RemissaoAnt">Redação original, efeitos até 01.05.22.</p></td></tr>
<tr><td><p class="A9-2Tabelajustificadoverde">42.0</p></td><td><p class="A9-2Tabelajustificadoverde">01.042.00</p></td><td><p class="A9-2Tabelajustificadoverde">8421.39.20</p></td><td><p class="A9-2Tabelajustificadoverde">Depuradores</p></td></tr>
<tr><td><p class="A7-2Tabelajustificado">43.0</p></td><td><p class="A7-2Tabelajustificado">01.043.00</p></td><td><p class="A7-2Tabelajustificado">8714</p></td><td><p class="A7-2Tabelajustificado">Partes</p></td></tr>
<tr><td><p class="A7-2Tabelajustificado">43.1</p></td><td><p class="A7-2Tabelajustificado">01.043.00</p></td><td><p class="A7-2Tabelajustificado">4011.50.00</p></td><td><p class="A7-2Tabelajustificado">Partes</p></td></tr>
</tbody></table>
<p class="A6-1Subtitulo">ANEXO XVIII</p><p class="A6-1Subtitulo">PRODUTOS ALIMENTÍCIOS</p>
<p class="A6-1Subtitulo">(Cláusula vigésima segunda do Convênio ICMS 142/18)</p>
<table><tbody><tr><td><p class="A7-2Tabelajustificado">1.0</p></td><td><p class="A7-2Tabelajustificado">17.001.00</p></td><td><p class="A7-2Tabelajustificado">1905.90.90</p></td><td><p class="A7-2Tabelajustificado">Biscoitos</p></td></tr></tbody></table>`;
const cv = lerCestConfaz(html);
const c42 = cv.itens.find((i) => i.cest === '0104200');
check('a redação ANTERIOR ("verde") não entra', c42 && igual(c42.ncmPrefixos, ['84213200']), c42 && c42.ncmPrefixos.join(','));
check('CEST em duas linhas junta os NCMs', igual(cv.itens.find((i) => i.cest === '0104300').ncmPrefixos, ['8714', '40115000']));
check('o segmento vem do subtítulo do anexo', c42.segmentoNome === 'AUTOPEÇAS');
check('  e nota entre parênteses não vira nome de segmento', cv.itens.find((i) => i.cest === '1700100').segmentoNome === 'PRODUTOS ALIMENTÍCIOS');

console.log('\n--- 3. o JSON do Siscomex ---');
const ncm = lerNcmSiscomex(JSON.stringify({
  Data_Ultima_Atualizacao_NCM: 'Vigente em 02/10/2026', Ato: 'Resolução Gecex nº 926/2026',
  Nomenclaturas: [
    { Codigo: '87.11', Descricao: 'Motocicletas e ciclos com motor auxiliar.', Data_Inicio: '01/04/2022', Data_Fim: '31/12/9999' },
    { Codigo: '8711.60.00', Descricao: '- Com motor elétrico para propulsão', Data_Inicio: '01/04/2022', Data_Fim: '31/12/9999' },
    { Codigo: '1001.11.00', Descricao: '-- Para semeadura (<i>sementeira</i>)', Data_Inicio: '01/04/2022', Data_Fim: '31/12/2025' }
  ]
}));
check('só entram os códigos de 8 dígitos', ncm.itens.length === 2);
check('a descrição completa leva a dos pais', ncm.itens[0].descricaoCompleta === 'Motocicletas e ciclos com motor auxiliar › Com motor elétrico para propulsão', ncm.itens[0].descricaoCompleta);
check('sem marcação HTML', !/<i>/.test(ncm.itens[1].descricao));
check('31/12/9999 é "sem fim"; outra data é o fim', ncm.itens[0].dataFim === null && ncm.itens[1].dataFim === '2025-12-31');
check('a versão diz de quando é a tabela', /Gecex nº 926\/2026/.test(ncm.versao));

console.log('\n--- 4. a análise ---');
const tabNcm = new Map([
  ['87116000', { descricaoCompleta: 'Motocicletas › Com motor elétrico', dataFim: null }],
  ['87149990', { descricaoCompleta: 'Partes › Outros', dataFim: null }],
  ['10011100', { descricaoCompleta: 'Trigo › Para semeadura', dataFim: null }],
  ['65061000', { descricaoCompleta: 'Capacetes', dataFim: '2025-12-31' }]
]);
const tabCest = new Map([['0104300', { segmentoNome: 'AUTOPEÇAS', descricao: 'Partes', ncmPrefixos: ['8714'] }]]);
const p = (id, ncmP, cestP, extra = {}) => ({ id, sku: id, nome: id, ncm: ncmP, cest: cestP, emSt: false, ...extra });
const r = analisarCadastro({
  hoje: '2026-10-02', ncm: tabNcm, cest: tabCest,
  produtos: [
    p('ok', '87149990', '0104300', { emSt: true }),
    p('semNcm', '', ''),
    p('ncmFalso', '87119999', ''),
    p('ncmVelho', '65061000', ''),
    p('cestFalso', '87149990', '9999999', { emSt: true }),
    p('cestErrado', '87116000', '0104300', { emSt: true }),
    p('stSemCest', '87149990', '', { emSt: true }),
    p('cestSemSt', '87149990', '0104300'),
    p('trigo', '10011100', ''),
    p('zeros', '87149990', '00.000.00'),
    p('escritural', '', '', { escritural: true })
  ]
});
const de = (codigo) => (r.alertas.find((a) => a.codigo === codigo) || { produtos: [] }).produtos.map((x) => x.id);
check('produto escritural fica fora', r.analisados === 10);
check('o produto certo não aparece em alerta nenhum', !r.alertas.some((a) => a.produtos.some((x) => x.id === 'ok')));
check('sem NCM', igual(de('NCM_AUSENTE'), ['semNcm']));
check('NCM que não existe', igual(de('NCM_INEXISTENTE'), ['ncmFalso']));
check('NCM que deixou de valer', igual(de('NCM_ENCERRADO'), ['ncmVelho']));
check('CEST que não existe', igual(de('CEST_INEXISTENTE'), ['cestFalso']));
check('CEST que não cobre o NCM, dizendo o que ele cobre',
  igual(de('CEST_NCM_INCOMPATIVEL'), ['cestErrado']) && /cobre 8714/.test(r.alertas.find((a) => a.codigo === 'CEST_NCM_INCOMPATIVEL').produtos[0].detalhe));
check('produto em ST sem CEST', igual(de('ST_SEM_CEST'), ['stSemCest']));
check('CEST fora da ST', igual(de('CEST_SEM_ST'), ['cestSemSt']));
check('NCM de alimento (capítulos 01-24)', igual(de('NCM_ALIMENTO'), ['trigo']));
check('"00.000.00" é ausência de CEST, não CEST que não existe', !de('CEST_INEXISTENTE').includes('zeros') && !de('CEST_SEM_ST').includes('zeros'));
check('alta antes de média', r.alertas.findIndex((a) => a.gravidade === 'media') > r.alertas.findLastIndex((a) => a.gravidade === 'alta'));

console.log(falhas ? `\n===== ${falhas} CHECK(S) FALHARAM =====` : '\n===== TODOS OS CHECKS PASSARAM =====');
process.exit(falhas ? 1 : 0);
