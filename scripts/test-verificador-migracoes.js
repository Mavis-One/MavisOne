#!/usr/bin/env node
// O verificador de migrações precisa estar certo sobre o que ele NÃO sabe.
//
// O defeito que este teste existe para pegar já aconteceu: o regex que lê as
// migrações exigia "alter table IF EXISTS <t> add column", e a fase-v escreve
// "alter table regra_fiscal add column". Resultado em cadeia:
//
//   1. a fase-v não declarava coluna nenhuma aos olhos do script;
//   2. sem estrutura declarada, ela caía em "sem estrutura a conferir";
//   3. esse estado não entrava na lista de pendentes;
//   4. o script imprimia "BANCO EM DIA" — com as duas colunas do DIFAL
//      faltando, a tela Regras Fiscais dando erro em toda gravação e a emissão
//      de NF-e bloqueada por baixo.
//
// Um verificador que erra para MAIS é pior do que não ter verificador: ele é
// consultado justamente antes de subir versão, e devolve uma garantia que não
// tem. Por isso os dois lados viram teste — o que ele lê e o que ele afirma.
//
// Não precisa de banco: lê o próprio fonte do script.
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const ler = (p) => fs.readFileSync(path.join(RAIZ, p), 'utf8').replace(/\r\n/g, '\n');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};

const src = ler('scripts/verificar-migracoes.js');

console.log('--- o regex enxerga as duas formas de alterar tabela ---');
// Extrai o regex do próprio fonte e roda contra SQL de verdade: assim o teste
// verifica o COMPORTAMENTO da leitura, não a presença de um texto.
const linhaColunas = src.match(/const colunas = \[\.\.\.sql\.matchAll\((\/.+\/gi)\)\]/);
check('o script declara o regex de colunas', Boolean(linhaColunas), linhaColunas ? 'achado' : 'NÃO ACHADO');

if (linhaColunas) {
  const corpo = linhaColunas[1].replace(/^\//, '').replace(/\/gi$/, '');
  const regex = new RegExp(corpo, 'gi');
  const casar = (sql) => [...sql.matchAll(new RegExp(regex.source, 'gi'))].map((m) => `${m[1]}.${m[2]}`);

  check('pega a forma COM "if exists"',
    casar('alter table if exists pedidos add column if not exists frete numeric;')[0] === 'pedidos.frete');
  check('pega a forma SEM "if exists" (a que escondia a fase-v)',
    casar('alter table regra_fiscal add column if not exists aliquota_fcp_uf_destino numeric(5,2);')[0] === 'regra_fiscal.aliquota_fcp_uf_destino');
  check('pega também sem "if not exists"',
    casar('alter table produtos add column ncm text;')[0] === 'produtos.ncm');

  // A prova final: o arquivo real da fase-v tem que render as duas colunas.
  const faseV = ler('supabase/migrations/fase-v-difal-e-pagamento.sql');
  const achadas = casar(faseV);
  check('a fase-v real declara as 2 colunas do DIFAL', achadas.length === 2, achadas.join(', '));
  check('inclusive a que quebrava as Regras Fiscais',
    achadas.includes('regra_fiscal.aliquota_fcp_uf_destino'));
}

console.log('\n--- "não sei conferir" não pode se parecer com "está certo" ---');
check('existe o estado NÃO CONFERIDA', /'NÃO CONFERIDA'/.test(src));
check('e ele não é mais chamado de "sem estrutura a conferir"', !/sem estrutura a conferir/.test(src));
check('as não conferidas são acumuladas à parte', /const naoConferidas = \[\]/.test(src));
check('e listadas com nome no fim', /naoConferidas\.forEach/.test(src));
// O ponto todo: quando sobra algo por conferir, o veredito precisa dizer que
// foi parcial — e o "BANCO EM DIA" limpo tem que ficar no outro ramo.
check('existe um veredito parcial', /EM DIA no que dá para conferir/.test(src));
check('e o "BANCO EM DIA" limpo é o outro ramo do mesmo ternário',
  /:\s*'===== BANCO EM DIA =====/.test(src));

console.log('\n--- a trava de deploy continua de pé ---');
// Migração que só insere dado ou cria índice não tem coluna a conferir e isso
// não é erro: a ressalva aparece, mas a saída segue 0. Só pendente derruba.
check('pendente ainda sai com código 1', /pendentes\.length[\s\S]{0,600}process\.exit\(1\)/.test(src));
check('e a ressalva sozinha sai com 0', /naoConferidas\.length[\s\S]{0,200}process\.exit\(0\)/.test(src));

console.log('\n--- o pacote para colar no SQL Editor está atualizado ---');
const pacote = ler('supabase/migrations/PENDENTES-rodar-agora.sql');
check('o pacote traz a fase-v', /aliquota_fcp_uf_destino/.test(pacote) && /aliquota_interna_uf_destino/.test(pacote));
// Um pacote que lista migração já aplicada faz quem for rodar duvidar do resto.
check('e não lista mais as fases já aplicadas', !/Fase H —|Fase I —|Fase J —|Fase K —/.test(pacote));
check('o verificador continua ignorando o pacote', /^--\s*CONSOLIDADO/im.test(pacote));

console.log(`\n===== ${falhas === 0 ? 'TODOS OS CHECKS PASSARAM' : falhas + ' FALHA(S)'} =====`);
process.exit(falhas ? 1 : 0);
