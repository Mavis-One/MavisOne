#!/usr/bin/env node
/**
 * NOTAS DE ENTRADA: O BOTÃO "BAIXAR PLANILHA" (16/10/2026). Pedido do usuário:
 * "em notas de entrada, preciso que você faça um botão para baixar uma
 * planilha já formatada".
 *
 * Um .xlsx de verdade (lib/xlsx.js, sem biblioteca), com duas abas — notas e
 * itens —, cabeçalho escuro em negrito, primeira linha congelada, filtro,
 * largura por coluna, R$, datas, total com SUBTOTAL e impressão deitada na
 * largura de uma folha. Valores só para administrador.
 *
 * Provado no Excel 16 (via COM, sem gravar nada): duas notas e três itens de
 * teste baixados pelo botão abriram sem reparo; "14/10/2026 22:30" (01:30 UTC),
 * "R$ 1.600,75", chave de 44 dígitos inteira, código "0007" com o zero,
 * filial pelo CNPJ que recebeu, produto vinculado, totais 3 / R$ 1.800,50 /
 * R$ 1.900,75, impressão em 2 folhas (uma por aba) com o cabeçalho repetido.
 *
 * De carona: o "é administrador?" da tela era avaliado quando o arquivo
 * carregava — antes do app.js, onde a função mora — e dava sempre "não". Nem o
 * administrador via Total, valores e "baixar XML" nas Notas de Entrada.
 */
const fs = require('fs');
const path = require('path');
const { semComentarios } = require('./sem-comentarios');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas += 1;
};
const RAIZ = path.join(__dirname, '..');
const xlsx = require(path.join(RAIZ, 'lib/xlsx'));
const { lerXlsx } = require(path.join(RAIZ, 'lib/xlsx-leitor'));
const { abasDasEntradas, planilhaDasEntradas } = require(path.join(RAIZ, 'lib/planilha-entradas'));

console.log('\n--- o gerador ---');
check('letras das colunas', ['A', 'Z', 'AA', 'ZZ', 'AAA'].join() === [0, 25, 26, 701, 702].map(xlsx.letraDaColuna).join());
check('dia sem hora vira o serial do Excel', xlsx.serialDaData('2026-10-14', false) === 46309);
check('data com hora no horário de Brasília', xlsx.serialDaData('2026-10-15T01:30:00Z', true) === 46309.9375);
check('  e só o dia, quando a coluna é de data', xlsx.serialDaData('2026-10-15T01:30:00Z', false) === 46309);

const partes = xlsx.partesDaPlanilha([{
  nome: 'Teste: [x]',
  colunas: [{ titulo: 'Nome', largura: 30 }, { titulo: 'Valor', tipo: 'moeda', somar: true }, { titulo: 'Nº', tipo: 'inteiro' }],
  linhas: [['A & B <c>\u0001', 10.5, 'X12'], ['  espaço', 2, 7]],
  total: 'Total'
}]);
const arquivo = (nome) => partes.find((p) => p.nome === nome).conteudo;
const aba = arquivo('xl/worksheets/sheet1.xml');
const estilos = arquivo('xl/styles.xml');
const workbook = arquivo('xl/workbook.xml');
check('arquivos do pacote', ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/worksheets/sheet1.xml']
  .every((n) => partes.some((p) => p.nome === n)));
check('nome da aba sem caractere proibido', /<sheet name="Teste   x"/.test(workbook), workbook.match(/<sheet name="[^"]*"/)[0]);
check('cabeçalho congelado', /<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"\/>/.test(aba));
check('filtro no cabeçalho, sem a linha de total', /<autoFilter ref="A1:C3"\/>/.test(aba)
  && /_xlnm\._FilterDatabase" localSheetId="0" hidden="1">'Teste   x'!\$A\$1:\$C\$3</.test(workbook));
check('largura da coluna', /<col min="1" max="1" width="30" customWidth="1"\/>/.test(aba));
check('cabeçalho escuro em negrito', /<fill><patternFill patternType="solid"><fgColor rgb="FF14202B"\//.test(estilos)
  && /<font><b\/><sz val="11"\/><color rgb="FFFFFFFF"\/>/.test(estilos));
check('formatos de R$ e data', estilos.includes('formatCode="&quot;R$&quot; #,##0.00"') && estilos.includes('formatCode="dd/mm/yyyy"'));
check('texto escapado e sem caractere de controle', aba.includes('A &amp; B &lt;c&gt;</t>'));
check('espaço no começo preservado', aba.includes('<t xml:space="preserve">  espaço</t>'));
check('número fora do tipo sai como texto, não some', aba.includes('<c r="C2" s="2" t="inlineStr"><is><t>X12</t></is></c>'));
check('total com SUBTOTAL(109), que respeita o filtro', aba.includes('<f>SUBTOTAL(109,B2:B3)</f>'));
check('impressão deitada, na largura de uma folha', /<pageSetUpPr fitToPage="1"\/>/.test(aba) && /orientation="landscape" fitToWidth="1" fitToHeight="0"/.test(aba));
check('cabeçalho repetido em cada folha', /_xlnm\.Print_Titles" localSheetId="0">'Teste   x'!\$1:\$1</.test(workbook));
check('o Excel calcula o total ao abrir', /<calcPr calcId="0" fullCalcOnLoad="1"\/>/.test(workbook));
let recusou = false;
try { xlsx.criarPlanilha([{ nome: 'x', colunas: [{ titulo: 'a', tipo: 'percentual' }], linhas: [] }]); } catch (_) { recusou = true; }
check('tipo de coluna desconhecido é recusado', recusou);

console.log('\n--- a planilha das entradas ---');
const dados = {
  entradas: [
    { id: 'e1', numero: '12345', serie: '1', data_emissao: '2026-10-14', criado_em: '2026-10-15T01:30:00Z', emitente_nome: 'FORNECEDOR', emitente_documento: '12345678000199',
      destinatario_documento: '43792899000135', valor_produtos: 1500.5, valor_total: 1600.75, status: 'LANCADA', movimentou_estoque: true, gerou_financeiro: false,
      chave: '42261012345678000199550010000123451000123456' },
    { id: 'e2', numero: '7', serie: '2', data_emissao: '2026-10-10', emitente_nome: 'OUTRO', emitente_documento: '98765432000155', status: 'REVISAR', valor_total: 300 }
  ],
  itens: [
    { entrada_id: 'e1', numero: 2, descricao: 'SEGUNDO', codigo_fornecedor: '0007', quantidade: 4, valor_unitario: 125, valor_total: 500, vinculo_origem: 'descricao' },
    { entrada_id: 'e1', numero: 1, descricao: 'PRIMEIRO', quantidade: 2, valor_unitario: 500.25, valor_total: 1000.5, produto_sku: '11768', produto_nome: 'PNEU', vinculo_origem: 'gtin' },
    { entrada_id: 'outra', numero: 1, descricao: 'DE ENTRADA QUE NÃO VEIO' }
  ],
  estabelecimentos: [{ cnpj: '43.792.899/0001-35', nomeFantasia: 'MATRIZ' }]
};
const comValores = abasDasEntradas({ ...dados, comValores: true });
const semValores = abasDasEntradas({ ...dados, comValores: false });
const titulos = (abaX) => abaX.colunas.map((c) => c.titulo);
check('duas abas: notas e itens', comValores.map((a) => a.nome).join() === 'Notas de entrada,Itens');
check('administrador: colunas de valor', titulos(comValores[0]).includes('Valor total') && titulos(comValores[1]).includes('Valor unitário'));
check('quem não é: nenhuma coluna de valor', !semValores.some((a) => titulos(a).some((t) => /^Valor/.test(t))),
  semValores.map((a) => titulos(a).filter((t) => /Valor/.test(t))).join('|'));
const linha = (abaX, i, titulo) => abaX.linhas[i][titulos(abaX).indexOf(titulo)];
check('filial pelo CNPJ que recebeu', linha(comValores[0], 0, 'Recebida por') === 'MATRIZ');
check('CNPJ do fornecedor com máscara', linha(comValores[0], 0, 'CNPJ/CPF do fornecedor') === '12.345.678/0001-99');
check('chave como texto, inteira', linha(comValores[0], 0, 'Chave de acesso') === '42261012345678000199550010000123451000123456'
  && !comValores[0].colunas.find((c) => c.titulo === 'Chave de acesso').tipo);
check('situação legível', linha(comValores[0], 0, 'Situação') === 'Lançada' && linha(comValores[0], 1, 'Situação') === 'A revisar');
check('itens contados por nota', linha(comValores[0], 0, 'Itens') === 2 && linha(comValores[0], 1, 'Itens') === 0);
check('itens na ordem da nota, e item de nota fora da lista não entra',
  comValores[1].linhas.length === 2 && linha(comValores[1], 0, 'Descrição na nota') === 'PRIMEIRO');
check('vínculo com o rótulo da tela', linha(comValores[1], 0, 'Vínculo') === 'código de barras' && linha(comValores[1], 1, 'Vínculo') === 'só pela descrição');
check('código do fornecedor guarda o zero à esquerda (texto)', linha(comValores[1], 1, 'Código no fornecedor') === '0007');
const lida = lerXlsx(planilhaDasEntradas({ ...dados, comValores: true }));
check('o arquivo abre e tem as duas abas', lida.length === 2 && lida[0].linhas[1][0] === '12345', JSON.stringify(lida[0].linhas[1]).slice(0, 80));

console.log('\n--- a rota e a tela ---');
const server = semComentarios(fs.readFileSync(path.join(RAIZ, 'server.js'), 'utf8'));
const posPlanilha = server.indexOf("pathname === '/api/purchases/entrada-nfe/planilha' && req.method === 'GET'");
check('rota da planilha antes da rota genérica /:id', posPlanilha > 0 && posPlanilha < server.indexOf("pathname.endsWith('/resumo') && req.method === 'GET'"));
const rota = server.slice(posPlanilha, posPlanilha + 2500);
check('  pede o módulo Compras', rota.includes("user.allowedModules.includes('purchases')"));
check('  valores só para administrador', rota.includes('comValores: await ehAdmin(user)'));
check('  responde .xlsx com o nome datado', rota.includes("'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'")
  && rota.includes('filename="notas-de-entrada-${hoje}.xlsx"'));
const tela = semComentarios(fs.readFileSync(path.join(RAIZ, 'public/modules/purchases/subs/entrada_nfe.js'), 'utf8'));
check('botão "Baixar planilha" nas últimas entradas', /<h4>Últimas entradas<\/h4>\s*<button type="button" class="secondary" id="entradaPlanilha">Baixar planilha<\/button>/.test(tela));
check('  baixa pela rota, com o token', /fetch\('\/api\/purchases\/entrada-nfe\/planilha', \{\s*headers: \{ 'x-auth-token': getSessionToken\(\) \|\| '' \}/.test(tela));
check('"é administrador?" decidido ao abrir a tela, não ao carregar o arquivo',
  /let veValores = false;/.test(tela) && /renderEntradaNfe\(ctx\) \{\s*const \{[^}]*\} = ctx;\s*veValores = typeof usuarioEhAdmin === 'function' && usuarioEhAdmin\(\);/.test(tela));

console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TUDO OK =====');
process.exit(falhas ? 1 : 0);
