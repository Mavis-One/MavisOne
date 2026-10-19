#!/usr/bin/env node
/**
 * PDF DOS RELATÓRIOS E O RELATÓRIO TÍTULOS PAGOS (17/10/2026). Pedido do
 * usuário: "criar um relatório no Financeiro de títulos pagos, com a opção de
 * salvar em PDF, com o mesmo formato que aparece atualmente, porém só salva em
 * Excel".
 *
 * Provado no servidor local: Relatórios › Financeiro › Títulos Pagos abre com
 * Exportar Excel e Salvar PDF; o clique baixou titulos-pagos-<data>.pdf; de
 * 01/09 a 17/10/2026 foram 120 títulos pagos, 9 páginas deitadas, colunas
 * sem palavra partida e a linha de total.
 */
const fs = require('fs');
const path = require('path');
const motor = require('../lib/relatorios/motor');
const { montarPdfDoRelatorio, formatar } = require('../public/modules/shared/pdf_relatorio');
const financeiro = require('../lib/relatorios/financeiro');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas += 1;
};
const ler = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const texto = (bytes) => Buffer.from(bytes).toString('latin1');
const montarLinhasDeTexto = (cols, ls) => ls.map((l) => cols.map((c) => formatar(c.tipo, l[c.campo])));

console.log('--- 1. o PDF ---');
const colunas = [
  { campo: 'vencimento', rotulo: 'Vencimento', tipo: 'data' }, { campo: 'codigo', rotulo: 'Código', tipo: 'codigo' },
  { campo: 'pessoa', rotulo: 'Fornecedor', tipo: 'texto' }, { campo: 'descricao', rotulo: 'Descrição', tipo: 'texto' },
  { campo: 'categoria', rotulo: 'Categoria', tipo: 'texto' }, { campo: 'conta', rotulo: 'Conta', tipo: 'texto' },
  { campo: 'banco', rotulo: 'Banco', tipo: 'texto' }, { campo: 'dataPagamento', rotulo: 'Data pagamento', tipo: 'data' },
  { campo: 'valor', rotulo: 'Valor', tipo: 'moeda' }, { campo: 'pago', rotulo: 'Pago', tipo: 'moeda' }
];
const linhas = Array.from({ length: 90 }, (_, i) => ({ vencimento: '2026-10-01', codigo: 30000 + i, pessoa: `FORNECEDOR ${i}`,
  descricao: 'Compra · NF-e 123 · descrição longa que precisa quebrar dentro da coluna', categoria: 'Mercadorias', conta: 'CAIXA', banco: 'Itaú',
  dataPagamento: '2026-10-15', valor: 1234.5, pago: 1234.5 }));
const pdf = texto(motor.paraPdf({ titulo: 'Títulos Pagos', key: 'titulos-pagos', filtros: { de: '2026-10-01', ate: '2026-10-17' }, colunas, linhas, totais: { valor: 111105, pago: 111105 } }, { emitidoEm: '17/10/2026 às 11:00' }));
check('é um PDF', pdf.startsWith('%PDF-1.4') && pdf.trimEnd().endsWith('%%EOF'));
check('com mais de 7 colunas, a página é deitada', /\/MediaBox \[0 0 841\.89 595\.28\]/.test(pdf));
const paginas = (pdf.match(/\/Type \/Page /g) || []).length;
check('várias páginas, cada uma com "Página X de Y"', paginas > 1 && pdf.includes(`(Página 1 de ${paginas})`) && pdf.includes(`(Página ${paginas} de ${paginas})`), paginas);
check('título, período e emissão no cabeçalho', pdf.includes('(Títulos Pagos)') && pdf.includes('Período: 01/10/2026 a 17/10/2026') && pdf.includes('Emitido em 17/10/2026'));
check('valores como a tela: R$ e dd/mm/aaaa', pdf.includes('(R$ 1.234,50)') && pdf.includes('(15/10/2026)') && pdf.includes('(Total)') && pdf.includes('(R$ 111.105,00)'));
check('formatar igual ao da tela', formatar('moeda', 1234.5) === 'R$ 1.234,50' && formatar('data', '2026-10-15') === '15/10/2026' && formatar('percentual', 12.5) === '12,50%');
const poucas = texto(montarPdfDoRelatorio({ titulo: 'X', colunas: colunas.slice(0, 3), linhas: linhas.slice(0, 2) }));
check('com poucas colunas, em pé', /\/MediaBox \[0 0 595\.28 841\.89\]/.test(poucas));
check('sem linhas, diz que não há registro', texto(montarPdfDoRelatorio({ titulo: 'X', colunas, linhas: [] })).includes('(Nenhum registro.)'));
check('o PDF do pedido continua em pé', /novoDocumento\(\{ paisagem = false \} = \{\}\)/.test(ler('public/modules/shared/pdf_pedido.js')));

console.log('\n--- 2. a exportação e as telas ---');
const servidor = ler('server.js');
check('a exportação aceita formato=pdf (catálogo e personalizado)',
  /if \(url\.searchParams\.get\('formato'\) === 'pdf'\) \{\s*const pdf = motorDeRelatorios\.paraPdf\(resultado, \{ emitidoEm \}\);/.test(servidor)
  && /'Content-Type': 'application\/pdf'/.test(servidor));
check('Salvar PDF no catálogo', /id="relCatPdf">Salvar PDF<\/button>/.test(ler('public/modules/reports/subs/catalogo.js'))
  && /exportar\(ctx, def, filtros, 'pdf'\)/.test(ler('public/modules/reports/subs/catalogo.js')));
check('  e no personalizado', /id="relPersPdf">Salvar PDF<\/button>/.test(ler('public/modules/reports/subs/personalizado.js')));

console.log('\n--- 3. o relatório Títulos Pagos ---');
const def = financeiro.find((r) => r.key === 'titulos-pagos');
check('existe no grupo Financeiro', def && def.grupo === 'financeiro' && def.titulo === 'Títulos Pagos');
check('  a pagar ou a receber', def && JSON.stringify(def.escolhas) === JSON.stringify([{ campo: 'tipo', rotulo: 'Títulos', itens: [['pagar', 'A pagar (pagos)'], ['receber', 'A receber (recebidos)']] }]));
(async () => {
  let pedido = null;
  const falso = { sql: async (sql, params) => { if (/from financial_entries/.test(sql)) pedido = params; return []; }, f: { de: '2026-10-01', ate: '2026-10-17', tipo: 'receber' } };
  const r = await def.executar(falso);
  check('  só pagas, pela data do pagamento, do tipo escolhido', pedido && pedido[2] === 'RECEITA' && pedido[3] === true && pedido[5] === 'pago', JSON.stringify(pedido));
  check('  sem Situação e Em aberto, com a data do pagamento', !r.colunas.some((c) => c.campo === 'situacao' || c.campo === 'emAberto') && r.colunas.some((c) => c.campo === 'dataPagamento'));

  // 19/10/2026, pedido do usuário: "todos os relatórios [do Financeiro] com uma
  // opção de baixar em PDF, de forma ordenada como o sistema". Provado com os
  // 17 do catálogo e a Síntese no banco local: Contas a Pagar de 75 para 44
  // páginas, a DRE Anual sem número partido (sem "R$" nas células, "(R$)" no
  // título), o cabeçalho das colunas em toda página.
  console.log('\n--- 4. ordenado como o sistema ---');
  const { planejarColunas } = require('../public/modules/shared/pdf_relatorio');
  const motorPdf = require('../public/modules/shared/pdf_pedido');
  const meses = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez', 'Total 2026', 'Total 2025', 'Diferença'];
  const colunasDre = [{ campo: 'categoria', rotulo: 'Categoria', tipo: 'texto' }, ...meses.map((m, i) => ({ campo: `m${i}`, rotulo: m, tipo: 'moeda' }))];
  const linhaDre = (cat) => Object.fromEntries([['categoria', cat], ...meses.map((_, i) => [`m${i}`, -1611453.39 * (i % 2 ? 1 : 8.33)])]);
  const dre = texto(montarPdfDoRelatorio({ titulo: 'DRE Anual', colunas: colunasDre, linhas: Array.from({ length: 80 }, (_, i) => linhaDre(`(−) CATEGORIA ${i}`)) }));
  check('tabela larga demais: o "R$" sai das células e vai para o título', dre.includes('(Jan \\(R$\\))') && !/\(R\$ 13/.test(dre) && /\(-13\.423\.406,74\)/.test(dre));
  check('  e o menos da DRE sai como hífen, não "?"', dre.includes('\\(-\\) CATEGORIA 0') && !dre.includes('\\(?\\)'));
  check('o cabeçalho das colunas se repete em toda página',
    (dre.match(/\(Categoria\) Tj/g) || []).length === (dre.match(/\/Type \/Page /g) || []).length && (dre.match(/\/Type \/Page /g) || []).length > 1);
  const plano = planejarColunas(colunas, montarLinhasDeTexto(colunas, linhas), 773.89);
  check('a fonte é a maior em que tudo cabe', plano.coube === true && plano.tamanho === 7.5);
  check('o texto longo para em duas linhas, com reticências', (() => {
    const longo = texto(montarPdfDoRelatorio({ titulo: 'X', colunas: colunas.slice(0, 4), linhas: [{ ...linhas[0], descricao: 'palavra '.repeat(200) }] }));
    return (longo.match(/\(palavra/g) || []).length === 2 && /…|\x85/.test(longo);
  })());
  check('o menos tipográfico vale um hífen no PDF', motorPdf.codigoWinAnsi('−') === 45);
  check('a Síntese Financeira também sai em PDF, com os números dos cartões',
    /if \(qual === 'financeiro' && url\.searchParams\.get\('formato'\) === 'pdf'\) \{/.test(servidor) && /`A receber \$\{brl\(receber\.total\)\}/.test(servidor)
    && /id="relPdf">Salvar PDF<\/button>/.test(ler('public/modules/reports/subs/relatorios.js'))
    && /relAcoes\('', \{ pdf: true \}\)/.test(ler('public/modules/reports/subs/relatorios.js')));

  console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TUDO OK =====');
  process.exit(falhas ? 1 : 0);
})();
