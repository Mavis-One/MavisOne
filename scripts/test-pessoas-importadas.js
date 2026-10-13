#!/usr/bin/env node
/**
 * PESSOAS DO VIPER COMO CLIENTE (13/10/2026).
 *
 * A planilha "Pessoas" do Viper (61 pessoas) não diz papel; o usuário decidiu
 * que todas são Cliente. Sem banco: a leitura e o plano são puros, e a rota e
 * a gravação são conferidas pelo fonte. A gravação de verdade foi provada no
 * banco local: 4 novas, 19 ganharam o papel, e a segunda rodada não mudou nada.
 */
const fs = require('fs');
const path = require('path');
const { lerPlanilha, planejar, CABECALHO } = require('../lib/importacao-pessoas-viper');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas += 1;
};
const ler = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

const planilha = (linhas) => [{ nome: 'Pessoas', linhas: [
  ['PESSOAS', '', '', '', '', '', '', ''],
  ['SAL INFINITY PLUS COMERCIO LTDA (MATRIZ)', '', '', '', '', '', '', ''],
  ['Gerado em: 13/10/2026', '', '', '', '', '', '', ''],
  CABECALHO,
  ...linhas
] }];

console.log('--- 1. a leitura ---');
const { empresa, itens, ignorados } = lerPlanilha(planilha([
  ['006894', 'Wesley  Caetano', 'WESLEY CAETANO', 'Física', '-', '134.362.089-90', 'Ativo', '01/10/2026'],
  ['006897', '28.807.155 SAMUEL ELOI', 'SAMUEL', 'Jurídica', '-', '28.807.155/0001-53', 'Inativo', '10/10/2026'],
  ['006898', 'REPETIDO', '', 'Física', '-', '13436208990', 'Ativo', ''],
  ['006899', 'SEM DOC', '', 'Física', '-', '123', 'Ativo', ''],
  ['', '', '', '', '', '', '', '']
]));
check('a empresa do cabeçalho', empresa === 'SAL INFINITY PLUS COMERCIO LTDA (MATRIZ)', empresa);
check('duas pessoas válidas', itens.length === 2, itens.length);
check('nome em maiúscula, sem espaço sobrando', itens[0].nome === 'WESLEY CAETANO');
check('  fantasia igual ao nome não vira dado', itens[0].fantasia === '');
check('  fantasia diferente fica', itens[1].fantasia === 'SAMUEL');
check('o tipo sai do tamanho do documento', itens[0].tipo === 'pessoa-fisica' && itens[1].tipo === 'pessoa-juridica');
check('o documento só com dígitos', itens[1].documento === '28807155000153');
check('"Inativo" chega como inativo', itens[1].ativo === false && itens[0].ativo === true);
check('documento repetido e incompleto ficam de fora, com o motivo', ignorados.length === 2 && /repetido/.test(ignorados[0].motivo) && /incompleto/.test(ignorados[1].motivo),
  ignorados.map((i) => i.motivo).join(' | '));
let recusou = false;
try { lerPlanilha([{ linhas: [['Código', 'Nome', 'CPF/CNPJ']] }]); } catch (e) { recusou = true; }
check('planilha sem o cabeçalho esperado é recusada', recusou);
recusou = false;
try { lerPlanilha([{ linhas: [['Código', 'Nome', 'Fantasia', 'Tipo', 'Grupo', 'CPF/CNPJ', 'Status', 'Data']] }]); } catch (e) { recusou = /fora do lugar/.test(e.message); }
check('  e com coluna trocada também', recusou);

console.log('\n--- 2. o plano ---');
const existentes = [
  { id: 'p1', tabela: 'people', name: 'WESLEY', document: '134.362.089-90', roles: ['Colaborador'] },
  { id: 'p2', tabela: 'people', name: 'JA CLIENTE', document: '11144477735', roles: ['Cliente', 'Vendedor'] },
  { id: 'c1', tabela: 'cnpjs', name: 'EMPRESA', document: '11222333000181', roles: [] }
];
const plano = planejar([
  { codigo: '1', documento: '13436208990' },
  { codigo: '2', documento: '11144477735' },
  { codigo: '3', documento: '11222333000181' },
  { codigo: '4', documento: '52998224725', nome: 'NOVA' }
], existentes, 'Cliente');
check('quem existe ganha o papel, sem perder os outros', JSON.stringify(plano.ganhamPapel[0].papeis) === '["Colaborador","Cliente"]');
check('  achado pelo documento, com ou sem máscara', plano.ganhamPapel[0].id === 'p1');
check('  inclusive na tabela de CNPJs', plano.ganhamPapel.some((g) => g.id === 'c1' && g.tabela === 'cnpjs'));
check('quem já é Cliente não é tocado', plano.jaTinham === 1 && !plano.ganhamPapel.some((g) => g.id === 'p2'));
check('quem não existe é novo', plano.novos.length === 1 && plano.novos[0].codigo === '4');
const segunda = planejar([{ codigo: '1', documento: '13436208990' }], [{ ...existentes[0], roles: ['Colaborador', 'Cliente'] }], 'Cliente');
check('rodar de novo não faz nada', segunda.jaTinham === 1 && !segunda.novos.length && !segunda.ganhamPapel.length);

console.log('\n--- 3. a gravação e a rota ---');
const gravacao = ler('lib/db/pessoas-importadas.js');
check('grava pelas funções do cadastro (o cache fica em dia)', /cadastros\.createPerson\(/.test(gravacao) && /cadastros\.updatePerson\(g\.id, \{ roles: g\.papeis \}\)/.test(gravacao));
check('  e só o papel muda em quem já existe', !/updatePerson\(g\.id, \{[^}]*name/.test(gravacao));
check('documento com dígito errado não vira cadastro', /documentoValido\(i\.documento\)/.test(gravacao));
check('simular não grava', /if \(simular\) return \{ simulado: true/.test(gravacao));
const servidor = ler('server.js');
const rota = (servidor.match(/pathname === '\/api\/cadastros\/importacao\/viper-pessoas'[\s\S]*?\n  \}\n/) || [''])[0];
check('a rota existe', rota.length > 0);
check('  só administrador', /ehAdmin\(user\)/.test(rota));
check('  o papel é Cliente (decisão do usuário)', /papel: 'Cliente'/.test(rota));
check('  confere o CPF/CNPJ com a mesma regra da tela', /documentoValido: isValidDocument/.test(rota));
check('  e registra na auditoria', /registrarAuditoria\(/.test(rota));

console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TODOS OS CHECKS PASSARAM =====');
process.exit(falhas ? 1 : 0);
