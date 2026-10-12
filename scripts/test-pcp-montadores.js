#!/usr/bin/env node
// ORDENS PARA MONTADORES SEPARADOS (fase EC, 12/10/2026).
//
// Pedido do usuário: "uma tela para PCP, para colocar ordens para montadores
// separados". Decidido com ele: montador é PESSOA do Cadastros com o papel
// "Montador" (primeiro foi colaborador do RH; o usuário pediu o registro no
// Cadastros no mesmo dia); a tela mostra o dia de CADA montador (jornada,
// ocupado, sobra) e imprime a folha de cada um.
//
// Provado no navegador, no banco local: "+ Novo montador" abre o Cadastros
// com o papel marcado; dois montadores, 6 × 40 min para um (4h, sobra 4h),
// 2 × 1h30 + 3 × 40 min para a outra (5h; com a jornada do dia em 4h, "passou
// 1h"); a folha de um traz só ele; a pessoa sem o papel não aparece; a
// Programação do Dia (por setor) não conta o que foi entregue a montador.
'use strict';
const fs = require('fs');
const path = require('path');
const { semComentarios } = require('./sem-comentarios');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};
const RAIZ = path.join(__dirname, '..');
const ler = (a) => fs.readFileSync(path.join(RAIZ, a), 'utf8');

console.log('\n--- 1. banco ---');
const mig = ler('banco/migrations/fase-ec-pcp-montadores.sql');
const migSemComentario = mig.replace(/--.*$/gm, '');
check('item programado ganha o montador (id do Cadastros)', /alter table if exists pcp_programacao add column if not exists montador_id text;/.test(mig));
check('  sem chave estrangeira para o RH', !/hr_employees/.test(migSemComentario) && !/references/.test(migSemComentario));
check('jornada ajustada pode ser de um montador', /alter table if exists pcp_jornadas add column if not exists montador_id text;/.test(mig));
check('  um ajuste por dia, setor E montador', /drop index if exists idx_pcp_jornada_dia;/.test(mig)
  && /on pcp_jornadas \(coalesce\(sector_id, ''\), coalesce\(montador_id, ''\), date\)/.test(mig));
check('RECRIAR-DO-ZERO inclui a fase EC', ler('banco/RECRIAR-DO-ZERO.sql').includes('fase-ec-pcp-montadores.sql'));
const modulos = require('../lib/db/modulos');
check('motor: montador na programação e na jornada', Boolean(modulos.RECURSOS['pcp/programacao'].campos.montadorId && modulos.RECURSOS['pcp/jornadas'].campos.montadorId));
check('  e o colaborador do RH não tem marca de montador', !modulos.RECURSOS['hr/employees'].campos.montador);

console.log('\n--- 2. servidor ---');
const server = semComentarios(ler('server.js'));
check('montador = papel "Montador" no Cadastros, menos os inativos',
  /function getMontadoresDirectory\(data\)[\s\S]{0,200}entry\.roles\.includes\('Montador'\)[\s\S]{0,120}!== 'inativo'/.test(server));
check('  a meta só lê o cadastro quando pedem',
  /if \(url\.searchParams\.get\('montadores'\) === '1'\) \{[\s\S]{0,200}apoio\.montadores = getMontadoresDirectory\(dados\);/.test(server));
check('jornada repetida considera o montador', /String\(j\.montadorId \|\| ''\) === montador/.test(server));

console.log('\n--- 3. telas ---');
const app = ler('public/app.js');
const lista = ler('public/modules/shared/lista_de_cadastros.js');
const rh = semComentarios(ler('public/modules/hr/subs/rh.js'));
const mont = semComentarios(ler('public/modules/pcp/subs/montadores.js'));
const prog = semComentarios(ler('public/modules/pcp/subs/programacao.js'));
check('Cadastros: papel "Montador" na ficha', /'Colaborador', 'Montador', 'Representada'/.test(app));
check('  e filtro "Exibir Montadores" na lista', /name="showAssemblers"[\s\S]{0,80}Exibir Montadores/.test(app)
  && /\['showAssemblers', 'Montador'\]/.test(lista) && /showAssemblers: g\.showAssemblers \?\? true/.test(lista));
check('RH: sem marca de montador no colaborador', !/name: 'montador'/.test(rh));
check('menu: Montadores do Dia', /key: 'montadores', label: 'Montadores do Dia'/.test(app));
check('a tela pede os montadores do Cadastros', /api\('\/api\/pcp\/meta\?montadores=1'\)/.test(mont));
check('"+ Novo montador" abre o Cadastros com o papel marcado', /people: \{ roles: \['Montador'\], status: 'ativo' \}/.test(mont) && /state\.activeSub = 'register';/.test(mont));
check('um quadro por montador, com as contas compartilhadas', /const quadros = montadores\.map\(/.test(mont) && /T\.resumoDoDia\(\{ itens, tempos: meta\.tempos, jornadaHoras \}\)/.test(mont));
check('entregar grava o montador no item', /montadorId: form\.querySelector\('\[name="montadorId"\]'\)\.value/.test(mont));
check('"cabem para ele": sobra do montador escolhido', /T\.cabemNoDia\(produtoEscolhido, quadro\.resumo\.sobra, meta\.tempos\)/.test(mont));
check('jornada do dia por montador', /const corpo = \{ date: filtro\.date, montadorId: campo\.dataset\.jornada, horas: Number\(campo\.value\) \}/.test(mont));
check('imprime a folha de um e de todos', /data-imprimir/.test(mont) && /pcpMontImprimirTodos/.test(mont) && /page-break-after: always/.test(mont));
check('Programação do Dia não conta o que é de montador', /String\(x\.sectorId \|\| ''\) === String\(filtro\.sectorId \|\| ''\) && !x\.montadorId\)/.test(prog));
const html = ler('public/index.html');
check('script carregado depois das contas', html.indexOf('/modules/shared/pcp_tempo.js') < html.indexOf('/modules/pcp/subs/montadores.js'));

console.log(`\n===== ${falhas === 0 ? 'TODOS OS CHECKS PASSARAM' : falhas + ' FALHA(S)'} =====`);
process.exit(falhas ? 1 : 0);
