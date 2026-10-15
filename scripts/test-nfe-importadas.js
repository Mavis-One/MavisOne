#!/usr/bin/env node
// AS NF-e DO SISTEMA ANTERIOR (VIPER) DENTRO DO MAVISONE (fase DX, 11/10/2026).
//
// O que pode dar errado, e cada item aqui é um desses:
//
//   1. o leitor de .xlsx ler a célula errada (texto compartilhado, coluna
//      pulada, número serial de data) — e a nota entrar com outro número;
//   2. uma importada ir para o SPED — o usuário decidiu (fase DY) que todas
//      são histórico: os SPEDs daqueles meses saíram do Viper;
//   3. a importação virar cobrança: origem MANUAL gera contas a receber;
//   4. a filial cair no CNPJ errado (a listagem do Viper não traz CNPJ);
//   5. duas filiais com o mesmo número se bloquearem (a trava antiga era por
//      empresa, e matriz e filiais são a mesma empresa — 9 notas reais
//      ficaram de fora na primeira carga);
//   6. a tela oferecer cancelar/CC-e para uma nota que não está na SEFAZ por
//      aqui.
//
// SEM BANCO: o leitor e o montador rodam de verdade sobre uma planilha
// montada em memória; o resto é lido do fonte.
'use strict';
const fs = require('fs');
const path = require('path');
const { criarZip } = require('../lib/zip');
const { lerXlsx, dataDoExcel } = require('../lib/xlsx-leitor');
const imp = require('../lib/importacao-nfe-viper');
const { motivoDaRecusa } = require('../lib/db/nfe-importadas');
const { semComentarios } = require('./sem-comentarios');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};
const RAIZ = path.join(__dirname, '..');
const ler = (p) => fs.readFileSync(path.join(RAIZ, p), 'utf8').replace(/\r\n/g, '\n');

// --- uma planilha .xlsx de verdade, montada em memória ----------------------
function xlsx(abas) {
  const compartilhados = [];
  const idx = (t) => { let i = compartilhados.indexOf(t); if (i < 0) { compartilhados.push(t); i = compartilhados.length - 1; } return i; };
  const col = (i) => { let s = ''; i += 1; while (i) { const r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = Math.floor((i - 1) / 26); } return s; };
  const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const folhas = abas.map((aba) => '<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>'
    + aba.linhas.map((l, r) => `<row r="${r + 1}">` + l.map((v, c) => (v === '' ? '' : typeof v === 'number'
      ? `<c r="${col(c)}${r + 1}"><v>${v}</v></c>`
      : `<c r="${col(c)}${r + 1}" t="s"><v>${idx(String(v))}</v></c>`)).join('') + '</row>').join('')
    + '</sheetData></worksheet>');
  const arquivos = [
    { nome: 'xl/workbook.xml', conteudo: '<workbook xmlns:r="r"><sheets>' + abas.map((a, i) => `<sheet name="${esc(a.nome)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') + '</sheets></workbook>' },
    { nome: 'xl/_rels/workbook.xml.rels', conteudo: '<Relationships>' + abas.map((a, i) => `<Relationship Id="rId${i + 1}" Type="ws" Target="worksheets/sheet${i + 1}.xml"/>`).join('') + '</Relationships>' },
    ...folhas.map((f, i) => ({ nome: `xl/worksheets/sheet${i + 1}.xml`, conteudo: f })),
    { nome: 'xl/sharedStrings.xml', conteudo: '<sst>' + compartilhados.map((t) => `<si><t>${esc(t)}</t></si>`).join('') + '</sst>' }
  ];
  return criarZip(arquivos);
}

const CAB_NOTAS = ['Chave', 'Número', 'Série', 'Emissão', 'Tipo', 'Natureza da operação', 'CFOP', 'Emitente CNPJ/CPF', 'Emitente nome',
  'Destinatário CPF/CNPJ', 'Destinatário nome', 'UF', 'vProd', 'vDesc', 'vFrete', 'vICMS', 'vST', 'vIPI', 'vPIS', 'vCOFINS', 'vNF',
  'Status', 'Protocolo', 'XML disponível', 'ID ERP', 'Origem (ERP)', 'Observação'];
const CAB_ITENS = ['Número da nota', 'nItem', 'cProd', 'xProd', 'NCM', 'CFOP', 'CST/CSOSN', 'Quantidade', 'Unidade', 'vUnit', 'vProd',
  'ICMS', 'IPI', 'PIS', 'COFINS', 'Série', 'Chave', 'Emitente nome', 'Tipo', 'Status', 'Origem mercadoria', 'ICMS ST', 'Desconto', 'ID ERP'];
const CHAVE = '42261043792899000135550010000031061517290001';
const detalhada = xlsx([
  { nome: 'Notas', linhas: [CAB_NOTAS,
    [CHAVE, '3106', '1', 46304.71041666667, 'Saída', '5102 VENDA', '5102', '43792899000135', 'MATRIZ', '42148928953', 'AMARILIO BONA', 'SC',
      2990, 0, 0, 0, 0, 0, 16.13, 74.45, 2990, 'Aprovada', '242260482777219', 'Sim', '77510', 'Vendas', ''],
    ['', '1633', '2', 46301.5, 'Entrada', 'VENDAS', '', '', 'GE MATERIAIS LTDA.', '43792899000135', 'MATRIZ', '', '', '', '', '', '', '', '', '', 314.55,
      'Aprovada', '', 'Não', '77373', 'Compras', 'XML não disponível'],
    ['', '1068', '1', 46000, 'Entrada', 'X', '', '', 'FORN', '', 'JOAO VITOR', '', '', '', '', '', '', '', '', '', 10, 'Aprovada', '', 'Não', '1', 'Compras', '']] },
  { nome: 'Itens', linhas: [CAB_ITENS,
    ['3106', '1', '9589', 'AUTOPROPELIDO MAVIS AYLA 500W', '87116000', '5102', '60', 1, 'UN', 2990, 2990, '', '', 16.13, 74.45, '1', CHAVE, 'MATRIZ', 'Saída', 'Aprovada', '1', '', '', '77510']] }
]);
const listagem = xlsx([{ nome: 'Documentos Fiscais', linhas: [
  ['DOCUMENTOS FISCAIS'], ['SAL INFINITY PLUS COMERCIO LTDA (MATRIZ)'], ['Gerado em: 10/10/2026'],
  ['Número', 'Modelo', 'Origem', 'Empresa', 'Destinatário / Emitente', 'Status', 'Emissão', 'Valor', 'Natureza', 'E-mail'],
  ['225', 'NFE', 'Vendas', 'SAL INFINITY PLUS COMERCIO LTDA FILIAL 06 (GUARAMIRIM)', 'GILSON', 'Aprovada', '09/10/2026 18:26', 2990, '5405 VENDA', '-'],
  ['2', 'NFE', 'Vendas', 'SAL INFINITY PLUS COMERCIO LTDA FILIAL 02 (MARCOLLA)', 'SAL INFINITY ELECTRIC LTDA', 'Aprovada', '09/12/2025 10:00', 34032.24, '5102', '-'],
  ['2', 'NFE', 'Vendas', 'SAL INFINITY PLUS COMERCIO LTDA FILIAL 04 (SAO BENTO DO SUL)', 'SAL INFINITY ELECTRIC LTDA', 'Cancelada', '04/02/2026 10:00', 7990, '5102', '-'],
  ['260', 'NFE', '', 'SAL INFINITY PLUS COMERCIO LTDA FILIAL 02 (MARCOLLA)', 'MARCOS', 'Aprovada', '01/09/2026 10:00', 100, '1411 - DEVOLUCAO', '-'],
  ['77', 'NFE', 'Compras', 'SAL INFINITY ELECTRIC LTDA', 'FORNECEDOR X', 'Aprovada', '01/09/2026 10:00', 50, 'Venda', '-'],
  ['3106', 'NFE', 'Vendas', 'SAL INFINITY PLUS COMERCIO LTDA (MATRIZ)', 'AMARILIO BONA', 'Aprovada', '09/10/2026 17:02', 2990, '5102', '-'],
  ['149', 'NFE', 'Vendas', 'KACCAU ELETRIC COMERCIAL LTDA', 'Y', 'Aprovada', '01/09/2026 10:00', 1, '5102', '-']
] }]);

console.log('\n--- 1. o leitor de .xlsx ---');
const abas = lerXlsx(detalhada);
check('lê as abas pelo nome', abas.map((a) => a.nome).join(',') === 'Notas,Itens');
check('texto compartilhado e número', abas[0].linhas[1][1] === '3106' && abas[0].linhas[1][12] === '2990');
check('célula vazia fica vazia e não desloca a coluna', abas[0].linhas[2][0] === '' && abas[0].linhas[2][1] === '1633');
check('data serial do Excel, sem fuso', dataDoExcel(46304.71041666667).data === '2026-10-09' && dataDoExcel(46304.71041666667).hora === '17:03');
let recusou = false; try { lerXlsx(Buffer.from('não é zip')); } catch (e) { recusou = /xlsx/.test(e.message); }
check('arquivo que não é planilha é recusado com mensagem', recusou);

console.log('\n--- 2. o montador ---');
const r = imp.montarImportacao({ detalhada: lerXlsx(detalhada), listagem: lerXlsx(listagem) });
const porRef = (prefixo) => r.documentos.filter((d) => d.ref.startsWith(prefixo));
const nota = r.documentos.find((d) => d.chaveAcesso === CHAVE);
check('nota com chave: própria, da matriz, completa, com o item — e mesmo assim histórico (fase DY)',
  nota && nota.emissaoPropria && nota.estabelecimentoCnpj === '43792899000135' && nota.completa && nota.escriturar === false && nota.itens.length === 1);
check('  com protocolo, série e PIS/COFINS do item', nota.protocolo === '242260482777219' && nota.serie === '1'
  && nota.itens[0].tributos.some((t) => t.tributo === 'PIS' && t.valor === 16.13) && nota.itens[0].tributos.some((t) => t.tributo === 'ICMS' && t.cst === '60'));
const semChave = r.documentos.find((d) => d.numero === '1633');
check('entrada sem chave: de terceiro, no estabelecimento destinatário, só histórico', semChave && !semChave.emissaoPropria && semChave.sentido === 'ENTRADA'
  && semChave.estabelecimentoCnpj === '43792899000135' && semChave.escriturar === false && semChave.participante.nome === 'GE MATERIAIS LTDA.');
check('entrada cujo destinatário não é do grupo fica de fora, com motivo', !r.documentos.some((d) => d.numero === '1068')
  && r.ignorados.some((x) => x.numero === '1068' && /nenhum estabelecimento do grupo/.test(x.motivo)));
check('a matriz da listagem é pulada quando a detalhada veio', !porRef('viper-lista:43792899000135').length);
check('empresa fora do MavisONE (KACCAU) fica de fora', r.ignorados.some((x) => /KACCAU/.test(x.motivo)));
const guaramirim = r.documentos.find((d) => d.numero === '225');
check('filial pelo nome -> CNPJ conferido (Guaramirim = 0006-40)', guaramirim && guaramirim.estabelecimentoCnpj === '43792899000640');
check('  listagem é sempre histórico, com data convertida', guaramirim.escriturar === false && guaramirim.dataEmissao === '2026-10-09');
const devolucao = r.documentos.find((d) => d.numero === '260');
check('origem vazia + CFOP 1xxx = entrada emitida por nós', devolucao && devolucao.sentido === 'ENTRADA' && devolucao.emissaoPropria);
const compra = r.documentos.find((d) => d.numero === '77');
check('Compras = entrada de terceiro (Electric)', compra && compra.sentido === 'ENTRADA' && !compra.emissaoPropria && compra.estabelecimentoCnpj === '46877837000114');
const doisNumero2 = r.documentos.filter((d) => d.numero === '2');
check('mesmo número em duas filiais = dois documentos', doisNumero2.length === 2 && new Set(doisNumero2.map((d) => d.estabelecimentoCnpj)).size === 2);
check('cancelada vira CANCELADO', doisNumero2.some((d) => d.situacao === 'CANCELADO'));
check('o mapa de filiais tem as 11 do MavisONE', Object.keys(imp.EMPRESAS_DA_LISTAGEM).length === 11);

console.log('\n--- 3. a rota confere tudo de novo ---');
const bom = { ...nota };
check('documento montado passa', motivoDaRecusa(bom) === null);
check('chave torta', motivoDaRecusa({ ...bom, chaveAcesso: '123' }) === 'chave de acesso inválida');
check('situação fora do vocabulário', motivoDaRecusa({ ...bom, situacao: 'EMITIDA' }) === 'situação inválida');
check('tributo que não existe', /tributo não aceito/.test(motivoDaRecusa({ ...bom, itens: [{ ...bom.itens[0], tributos: [{ tributo: 'XPTO' }] }] }) || ''));
check('número não numérico', motivoDaRecusa({ ...bom, numero: 'NF 1' }) !== null);

console.log('\n--- 4. banco, rota, SPED, financeiro e tela ---');
const mig = ler('banco/migrations/fase-dx-nfe-importadas.sql');
check('origem IMPORTACAO no check e no ponteiro', /'DFE', 'IMPORTACAO'\)\);/.test(mig) && /origem in \('MANUAL', 'DFE', 'IMPORTACAO'\) and nfe_id is null/.test(mig));
check('escriturar com default true (o que existia continua no SPED)', /add column if not exists escriturar boolean not null default true/.test(mig));
check('a trava de numeração sem chave passa a incluir o estabelecimento',
  /create unique index if not exists idx_fiscal_documentos_numeracao\s+on fiscal_documentos \(coalesce\(empresa_id::text, ''\), coalesce\(estabelecimento_id::text, ''\)/.test(mig));
const sped = semComentarios(ler('lib/db/sped-escrituracao.js'));
check('o SPED só lê documento escriturável', /where d\.estabelecimento_id = \$1(?:\s*--[^\n]*\n)*\s+and d\.escriturar\n/.test(sped));
const dbImp = ler('lib/db/nfe-importadas.js');
check('grava com origem IMPORTACAO (nunca MANUAL, que gera parcelas)', /origem: 'IMPORTACAO'/.test(dbImp) && !/origem: 'MANUAL'/.test(dbImp));
check('a importada é gravada SEMPRE fora do SPED, ignorando a bandeira que veio (fase DY)', /\[id, false, texto\(d\.protocolo, 20\)/.test(dbImp));
const migDy = ler('banco/migrations/fase-dy-importadas-so-historico.sql');
check('a fase DY tira do SPED o que já tinha sido importado',
  /update fiscal_documentos\s+set escriturar = false[\s\S]*?where origem = 'IMPORTACAO' and escriturar;/.test(migDy));
check('  e o banco trava importada escriturável', /check \(origem <> 'IMPORTACAO' or not escriturar\)/.test(migDy));
// A trava é conferida NA INSERÇÃO: a importada tem de nascer fora do SPED. Com
// o escriturar só no update depois do insert, o banco recusava toda importação
// nova (descoberto ao importar as NFC-e, 12/10/2026: 288 de 288 recusadas).
check('  por isso a importada NASCE fora do SPED (escriturar no insert)',
  /origem: 'IMPORTACAO',\s*escriturar: false,/.test(dbImp)
  && /modalidade_frete,\s*escriturar\s*\) values/.test(ler('lib/db/fiscal-documentos.js'))
  && /payload\.escriturar === undefined \? true : Boolean\(payload\.escriturar\)/.test(ler('lib/db/fiscal-documentos.js')));
check('reimportar não duplica (chave, ou referência)', /select 1 from fiscal_documentos where chave_acesso = \$1/.test(dbImp) && /importacao_ref = \$1/.test(dbImp));
check('participante do cadastro vem com a ficha inteira (endereço do 0150)', /\.\.\.\(pessoa\.extra \|\| \{\}\)/.test(dbImp));
const server = semComentarios(ler('server.js'));
check('a rota de importação é só de administrador',
  /pathname === '\/api\/fiscal\/importacao\/nfe' && req\.method === 'POST'\) \{\s*if \(!\(await ehAdmin\(user\)\)\) return sendJson/.test(server));
check('  e pede configurar no mapa de permissões', /if \(pathname\.startsWith\('\/api\/fiscal\/importacao\/'\)\) return 'configurar';/.test(server));
check('a lista NF-e Emitidas inclui as importadas, sem derrubar se faltar', /importadas = await nfeImportadasDb\.listarEmitidasParaLista\(\);[\s\S]{0,120}catch/.test(server)
  && /fiscais\.concat\(manuais, importadas\)/.test(server));
const tela = ler('public/modules/finance/subs/nfe_emitidas.js');
const acoes = ler('public/modules/finance/nfe_actions.js');
// 15/10/2026: a linha não tem mais botão Cancelar (a coluna Ações saiu).
check('a tela não oferece Cancelar para importada (ficha; a linha não tem mais o botão)',
  !/data-quick-cancel/.test(tela)
  && /nfe\.status === 'autorizada' && nfe\.origem !== 'importada' \? `<button type="button" class="btn-danger" id="nfeModalCancel"/.test(tela));
check('  e cancelNfe recusa importada mesmo se chamado', /if \(nota && nota\.origem === 'importada'\) \{/.test(tela));
check('o painel de ações trava tudo para importada', /ctx\.selecionadas\.some\(\(nota\) => nota\.origem === 'importada'\)\) return 'NF-e importada/.test(acoes));
check('a ficha da importada vem da rota própria', /\/api\/finance\/nfe\/importada\//.test(tela) && /pathname\.startsWith\('\/api\/finance\/nfe\/importada\/'\)/.test(server));
check('o script só grava com --enviar', /if \(!tem\('enviar'\)\) \{/.test(ler('scripts/importar-nfe-viper.js')));

console.log('\n--- 5. completar a chave pelos DANFEs (12/10/2026) ---');
// A SEFAZ não lista as notas que nós emitimos e a chave tem 8 dígitos
// aleatórios: ela só sai de um documento da nota. As notas que o Viper listou
// sem chave ganham a do DANFE — e só se a nota importada já existir.
const CH = '42260743792899000569550010000001241719101868';
check('a chave verdadeira passa no dígito verificador', imp.chaveValida(CH));
check('  e um dígito trocado não passa', !imp.chaveValida(CH.slice(0, 43) + ((Number(CH[43]) + 1) % 10)));
check('o DANFE (blocos de 4) é lido', imp.chavesDoTexto('CHAVE 4226 0743 7928 9900 0569 5500 1000 0001 2417 1910 1868 x').join() === CH);
check('a carta de correção (ID do evento + chave + sequência) é lida',
  imp.chavesDoTexto('ID1101104226074379289900080155001000000058156656148601').join() === '42260743792899000801550010000000581566561486');
check('número qualquer de 44 dígitos que não é chave é ignorado', imp.chavesDoTexto('1'.repeat(44)).length === 0);
const partes = imp.partesDaChave(CH);
check('a chave diz CNPJ, modelo, série, número e mês', partes.cnpj === '43792899000569' && partes.modelo === '55' && partes.serie === '1' && partes.numero === '124' && partes.anoMes === '2026-07');
const completar = dbImp.slice(dbImp.indexOf('async function completarChaves'), dbImp.indexOf('async function listarEmitidasParaLista'));
check('completar NUNCA cria nota (só update de nota sem chave)', !/insert into|criarDocumento/.test(completar) && /update fiscal_documentos\s+set chave_acesso = \$2/.test(completar) && /where id = \$1 and chave_acesso is null/.test(completar));
check('  casa empresa, número, modelo, série e MÊS', /estabelecimento_id = \$1 and numero = \$2 and modelo = \$3/.test(completar) && /to_char\(data_emissao, 'YYYY-MM'\) = \$5/.test(completar));
check('  duas candidatas = ambígua, não escolhe', /if \(candidatas\.length > 1\) \{ r\.ambiguas\.push/.test(completar));
check('a rota de completar é só de administrador',
  /pathname === '\/api\/fiscal\/importacao\/completar-chaves' && req\.method === 'POST'\) \{\s*if \(!\(await ehAdmin\(user\)\)\) return sendJson/.test(server));
check('o script de chaves só envia com --enviar', /if \(!tem\('enviar'\)\) \{/.test(ler('scripts/completar-chaves-nfe.js')));
check('  e lê PDF, planilha, XML e texto (SPED)', /const LIDOS = \/\\\.\(pdf\|xlsx\|csv\|xml\|txt\)\$\/i;/.test(ler('scripts/completar-chaves-nfe.js')));

console.log('\n--- 6. entradas de fornecedor pela nota recebida (12/10/2026) ---');
// A entrada do Viper não tem o CNPJ do fornecedor; número repete entre
// fornecedores. Casa empresa + número + mês + VALOR, 1 para 1 nos dois
// sentidos (na matriz: 455 de 455 desde maio/2026).
const recebidas = dbImp.slice(dbImp.indexOf('async function completarChavesDasRecebidas'), dbImp.indexOf('async function listarEmitidasParaLista'));
check('casa CNPJ destinatário, número, mês e valor', /r\.cnpj_destinatario = i\.cnpj and r\.numero = i\.numero and r\.mes = i\.mes and r\.valor = i\.valor/.test(recebidas));
check('  só entrada de terceiro importada e ainda sem chave', /d\.origem = 'IMPORTACAO' and d\.chave_acesso is null and not d\.emissao_propria/.test(recebidas));
check('  uma entrada com uma nota (having count = 1)', /having count\(\*\) = 1/.test(recebidas));
check('  e a nota com uma entrada só', /\(select count\(\*\) from pares p where p\.chave = u\.chave\) = 1/.test(recebidas));
check('  nunca repete chave que já está em outro documento', /not exists \(select 1 from fiscal_documentos x where x\.chave_acesso = u\.chave\)/.test(recebidas));
check('  e não cria nada (só update)', !/insert into/.test(recebidas));
check('a busca na SEFAZ completa sozinha ao terminar, sem derrubar a busca',
  /try \{ chavesCompletadas = \(await nfeImportadasDb\.completarChavesDasRecebidas\(\)\)\.completadas; \} catch/.test(server));
check('a rota manual é só de administrador',
  /pathname === '\/api\/fiscal\/importacao\/completar-chaves-recebidas' && req\.method === 'POST'\) \{\s*if \(!\(await ehAdmin\(user\)\)\) return sendJson/.test(server));

console.log(`\n===== ${falhas === 0 ? 'TODOS OS CHECKS PASSARAM' : falhas + ' FALHA(S)'} =====`);
process.exit(falhas ? 1 : 0);
