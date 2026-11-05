#!/usr/bin/env node
/**
 * A VISÃO DOS RELATÓRIOS (04/11/2026): procurar, ordenar e separar, sobre o
 * resultado já executado (lib/relatorios/motor.js, aplicarVisao), com o
 * subtotal de cada grupo no CSV, na planilha e no PDF; e a barra de ações
 * comum (Excel, PDF, CSV e Imprimir) em todo relatório.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const motor = require('../lib/relatorios/motor');
const catalogo = require('../lib/relatorios');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas += 1;
};
const ler = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

const base = () => ({
  key: 'teste', titulo: 'Teste', filtros: { de: '2026-10-01', ate: '2026-10-31', hoje: '2026-11-04' },
  colunas: [
    { campo: 'cliente', rotulo: 'Cliente', tipo: 'texto' },
    { campo: 'dia', rotulo: 'Data', tipo: 'data' },
    { campo: 'qtd', rotulo: 'Qtd.', tipo: 'inteiro' },
    { campo: 'valor', rotulo: 'Valor', tipo: 'moeda' }
  ],
  linhas: [
    { cliente: 'Zé Ltda', dia: '2026-10-02', qtd: 1, valor: 10 },
    { cliente: 'Ana', dia: '2026-10-05', qtd: 2, valor: 5.5 },
    { cliente: 'zé ltda', dia: '2026-09-30', qtd: 1, valor: 2 },
    { cliente: '', dia: '2026-10-09', qtd: 3, valor: 1.25 },
    { cliente: 'Ânia', dia: '', qtd: 1, valor: 100 }
  ],
  totais: { qtd: 8, valor: 118.75 }
});

console.log('\n--- 1. procurar ---');
let r = motor.aplicarVisao(base(), { procurar: 'ze' });
check('sem acento nem caixa, e os totais só do que ficou', r.linhas.length === 2 && r.totais.valor === 12 && r.totais.qtd === 2, JSON.stringify(r.totais));
check('  data como a tela mostra (dd/mm/aaaa)', motor.aplicarVisao(base(), { procurar: '05/10/2026' }).linhas.length === 1);
check('  valor com vírgula', motor.aplicarVisao(base(), { procurar: '1,25' }).linhas.length === 1);
check('  nada achado: zero linhas e total zero', (() => { const x = motor.aplicarVisao(base(), { procurar: 'xyz' }); return !x.linhas.length && x.totais.valor === 0; })());
check('sem pedido nenhum, o resultado é o mesmo', motor.aplicarVisao(base(), {}).linhas.length === 5 && motor.aplicarVisao(base(), {}).grupos === null);

console.log('\n--- 2. ordenar ---');
r = motor.aplicarVisao(base(), { ordenarPor: 'valor', sentido: 'desc' });
check('número como número, do maior', r.linhas.map((l) => l.valor).join(',') === '100,10,5.5,2,1.25');
r = motor.aplicarVisao(base(), { ordenarPor: 'cliente' });
check('texto em português (Â junto de A), vazio no fim', r.linhas.map((l) => l.cliente).join('|') === 'Ana|Ânia|Zé Ltda|zé ltda|', r.linhas.map((l) => l.cliente).join('|'));
r = motor.aplicarVisao(base(), { ordenarPor: 'dia', sentido: 'desc' });
check('data como data, vazia no fim mesmo do maior para o menor', r.linhas.map((l) => l.dia).join(',') === '2026-10-09,2026-10-05,2026-10-02,2026-09-30,');
check('coluna que não existe é ignorada', motor.aplicarVisao(base(), { ordenarPor: 'senha' }).visao.ordenarPor === '');

console.log('\n--- 3. separar ---');
r = motor.aplicarVisao(base(), { separarPor: 'cliente', ordenarPor: 'valor', sentido: 'desc' });
check('grupos pelo valor (Zé Ltda e zé ltda são um), "(sem valor)" no fim',
  r.grupos.map((g) => `${g.rotulo}:${g.quantidade}`).join(' | ') === 'Ana:1 | Ânia:1 | Zé Ltda:2 | (sem valor):1', r.grupos.map((g) => `${g.rotulo}:${g.quantidade}`).join(' | '));
check('  cada um com o subtotal, e as linhas do grupo juntas na ordem pedida',
  r.grupos[2].totais.valor === 12 && r.linhas[2].valor === 10 && r.linhas[3].valor === 2);
r = motor.aplicarVisao(base(), { separarPor: 'dia:mes' });
check('data pelo mês', r.grupos.map((g) => g.rotulo).join(' | ') === 'setembro de 2026 | outubro de 2026 | (sem valor)', r.grupos.map((g) => g.rotulo).join(' | '));
check('não se separa por coluna numérica', motor.aplicarVisao(base(), { separarPor: 'valor' }).grupos === null);
check('as opções de separação: texto, e data pelo mês e pelo dia',
  motor.aplicarVisao(base(), {}).separacoes.map((s) => s.valor).join(',') === 'cliente,dia:mes,dia');

console.log('\n--- 4. os arquivos levam a visão ---');
const separado = motor.aplicarVisao(base(), { separarPor: 'cliente', ordenarPor: 'valor', sentido: 'desc' });
const csv = motor.paraCsv(separado).split('\n').filter(Boolean);
check('CSV: o subtotal depois de cada grupo, e o total no fim',
  csv.some((l) => l.startsWith('Subtotal — Zé Ltda (2 linhas);;2;12,00')) && csv[csv.length - 1].startsWith('Total;;8;118,75'), csv.join(' ¶ '));
const xlsx = motor.paraXlsx(separado, { emitidoEm: 'x' });
const folha = (() => {
  // O .xlsx é um zip: acha a folha e descomprime.
  const nome = Buffer.from('xl/worksheets/sheet1.xml');
  const i = xlsx.indexOf(nome);
  const tamanhoNome = xlsx.readUInt16LE(i - 4);
  const extra = xlsx.readUInt16LE(i - 2);
  const comprimido = xlsx.readUInt32LE(i - 12);
  const metodo = xlsx.readUInt16LE(i - 22);
  const dados = xlsx.slice(i + tamanhoNome + extra, i + tamanhoNome + extra + comprimido);
  return metodo === 8 ? zlib.inflateRawSync(dados).toString('utf8') : dados.toString('utf8');
})();
check('planilha: SUBTOTAL() por grupo e o total do pé por cima de tudo',
  (folha.match(/SUBTOTAL\(109,D\d+:D\d+\)/g) || []).length === 5 && /Subtotal — Zé Ltda \(2 linhas\)/.test(folha));
const pdf = motor.paraPdf(separado, { emitidoEm: 'x' });
check('PDF sai', pdf.slice(0, 5).toString() === '%PDF-');
check('o alto do arquivo diz a visão', motor.descricaoDaVisao(separado) === 'Separado por Cliente · ordenado por Valor (maior primeiro)', motor.descricaoDaVisao(separado));

console.log('\n--- 5. os nomes e as rotas ---');
check('procurar/ordenarPor/sentido/separarPor são reservados (nenhuma escolha usa)',
  ['procurar', 'ordenarPor', 'sentido', 'separarPor'].every((c) => motor.CAMPOS_RESERVADOS.has(c)) && catalogo.RELATORIOS.length > 80);
const servidor = ler('server.js');
check('catálogo e personalizado aplicam a visão DEPOIS de tirar o custo',
  (servidor.match(/motorDeRelatorios\.aplicarVisao\(\s*res\.__ocultarCusto \? custoOculto\.relatorioSemCusto\(/g) || []).length === 2);
check('Vendas, Síntese e Estoque também baixam Excel (e PDF), pelo mesmo caminho do catálogo',
  /return exportarRelatorio\(res, resultadoDaTela\(\{\s*key: 'vendas'/.test(servidor)
  && /key: 'sintese-financeira'/.test(servidor) && /key: 'estoque'/.test(servidor));

console.log('\n--- 6. a tela ---');
const tela = ler('public/modules/reports/subs/catalogo.js');
check('a barra: Aplicar, Limpar e Atualizar; depois Excel, PDF, CSV e Imprimir',
  /formatos = \['xlsx', 'pdf', 'csv'\]/.test(tela) && /data-rel-acao="aplicar"[\s\S]*data-rel-acao="limpar"[\s\S]*data-rel-acao="atualizar"[\s\S]*rel-baixar[\s\S]*data-rel-acao="imprimir"/.test(tela));
check('o título da coluna ordena (A a Z, Z a A, tira)', /data-rel-ordenar=/.test(tela) && /sentido: 'desc'/.test(tela) && /ordenarPor: '', sentido: ''/.test(tela));
check('procurar e separar acima da tabela', /data-rel-visao="procurar"/.test(tela) && /data-rel-visao="separarPor"/.test(tela));
check('a lista do grupo em ordem alfabética, com procurar', /localeCompare\(b\.titulo, 'pt-BR'/.test(tela) && /id="relListaProcurar"/.test(tela));
const especiais = ler('public/modules/reports/subs/relatorios.js');
check('as telas especiais usam a mesma barra', (especiais.match(/\$\{relAcoes\(/g) || []).length === 3
  && (especiais.match(/MavisRelatoriosCatalogo\.ligarBarra\(/g) || []).length === 2);
check('o Personalizado também', /catalogo\.barraDeAcoes\(ctx/.test(ler('public/modules/reports/subs/personalizado.js'))
  && /catalogo\.ligarVisao\(/.test(ler('public/modules/reports/subs/personalizado.js')));

console.log(`\n===== ${falhas === 0 ? 'TODOS OS CHECKS PASSARAM' : falhas + ' FALHA(S)'} =====`);
process.exit(falhas ? 1 : 0);
