#!/usr/bin/env node
/**
 * O PDF DO PEDIDO — o botão "Baixar" (13/10/2026, pedido do usuário).
 *
 * O botão baixava um JSON; agora baixa o PDF, gerado no navegador por
 * public/modules/shared/pdf_pedido.js (sem biblioteca). Conferido à mão: o
 * pdftotext lê o texto com acento e o Chromium abre a página igual à
 * impressão A4.
 */
const fs = require('fs');
const path = require('path');
const P = require('../public/modules/shared/pdf_pedido');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas += 1;
};

const dados = (extra = {}) => ({
  titulo: 'Pedido', numero: '16329', emissao: '10/10/2026',
  emitente: { nome: 'SAL INFINITY PLUS COMERCIO LTDA, CNPJ: 43.792.899/0002-16', linhas: ['Rua (A), Jaraguá do Sul-SC'] },
  cliente: [['Cliente:', 'KAIO LEAL', 'Telefone:', '(47) 9999-0000']],
  itens: [['10128', '87116000', 'AUTOPROPELIDO MAVIS RUNNER — 352222655002126', '1,0000', 'UN', 'R$ 6.990,00', 'R$ 6.990,00']],
  totalItens: 'R$ 6.990,00',
  totais: { cabecalho: ['Frete', 'Outros', 'Desconto', 'Total Sem Desconto', 'Total Final'], valores: ['R$ 0,00', 'R$ 0,00', 'R$ 0,00', 'R$ 6.990,00', 'R$ 6.990,00'] },
  termos: 'PAGAMENTO À VISTA', observacoes: 'GARANTIA: 90 DIAS', rodape: 'Documento interno, sem valor fiscal.',
  ...extra
});

console.log('--- 1. o arquivo é um PDF bem formado ---');
const bytes = P.montarPdfDoPedido(dados());
const texto = Buffer.from(bytes).toString('latin1');
check('começa com %PDF-1.4 e termina com %%EOF', texto.startsWith('%PDF-1.4') && texto.trimEnd().endsWith('%%EOF'));
// Os offsets do xref apontam exatamente para o começo de cada objeto.
// "\nxref\n", e não "xref": a última ocorrência de "xref" é a de "startxref".
const xref = texto.slice(texto.lastIndexOf('\nxref\n'));
const offsets = [...xref.matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
check('o xref aponta para cada objeto', offsets.length > 0 && offsets.every((o, i) => texto.startsWith(`${i + 1} 0 obj`, o)), offsets.length + ' objetos');
const inicioXref = Number(/startxref\n(\d+)/.exec(texto)[1]);
check('  e o startxref para o xref', texto.startsWith('xref', inicioXref));
const fluxos = [...texto.matchAll(/<< \/Length (\d+) >>\nstream\n([\s\S]*?)\nendstream/g)];
check('o /Length de cada página é o tamanho do conteúdo', fluxos.length > 0 && fluxos.every((m) => Number(m[1]) === m[2].length));
check('fontes padrão, sem fonte embutida', /\/BaseFont \/Helvetica /.test(texto) && /\/BaseFont \/Helvetica-Bold /.test(texto) && !/FontFile/.test(texto));

console.log('\n--- 2. o texto ---');
check('acento sai em WinAnsi (á = 0xE1)', texto.includes('Jaragu\xE1 do Sul'));
check('travessão e º também', P.codigoWinAnsi('—') === 0x97 && P.codigoWinAnsi('º') === 0xBA);
check('parêntese é escapado', texto.includes('Rua \\(A\\)'));
check('o número e as seções estão lá', texto.includes('PEDIDO N\xBA 16329') && texto.includes('DADOS DO CLIENTE') && texto.includes('PRODUTOS E SERVI\xC7OS') && texto.includes('TOTAIS'));
check('termos trazem as linhas de assinatura', texto.includes('(Assinatura:)'));
check('sem termos, sem assinatura', !Buffer.from(P.montarPdfDoPedido(dados({ termos: '' }))).toString('latin1').includes('(Assinatura:)'));

console.log('\n--- 3. quebra de linha e páginas ---');
const linhas = P.quebrar('AUTOPROPELIDO MAVIS RUNNER 1000W | 2026 — 352222655002126', 150, 8.5, false);
check('texto longo quebra na largura', linhas.length > 1 && linhas.every((l) => P.largura(l, 8.5, false) <= 150), linhas.join(' / '));
const chave = P.quebrar('42260343792899000135650130000018031294520987', 60, 8.5, false);
check('palavra maior que a coluna é cortada', chave.length > 1 && chave.join('') === '42260343792899000135650130000018031294520987');
const muitos = Buffer.from(P.montarPdfDoPedido(dados({ itens: Array.from({ length: 80 }, (_, i) => [String(i), '', `ITEM ${i}`, '1', 'UN', 'R$ 1,00', 'R$ 1,00']) }))).toString('latin1');
check('80 itens viram mais de uma página', /\/Count (\d+)/.exec(muitos)[1] > 1, /\/Count (\d+)/.exec(muitos)[1]);
check('máscara de CPF e CNPJ', P.mascaraDocumento('12935855990') === '129.358.559-90' && P.mascaraDocumento('43792899000216') === '43.792.899/0002-16');

console.log('\n--- 4. o botão ---');
const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
const baixar = (app.match(/baixar: async \(\) => \{[\s\S]*?\n {10}\},/) || [''])[0];
check('Baixar gera o PDF pelo gerador', /P\.montarPdfDoPedido\(/.test(baixar) && /type: 'application\/pdf'/.test(baixar));
check('  com o cabeçalho da empresa do pedido (o mesmo da impressão)', /const emitente = emitenteDaImpressao\(\);/.test(baixar));
check('  e não baixa mais JSON', !/application\/json/.test(baixar) && /\.pdf`/.test(baixar));
check('o gerador está na página', /\/modules\/shared\/pdf_pedido\.js/.test(fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8')));

console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TODOS OS CHECKS PASSARAM =====');
process.exit(falhas ? 1 : 0);
