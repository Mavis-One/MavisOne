#!/usr/bin/env node
// TEMPO DE PRODUÇÃO POR MODELO E PROGRAMAÇÃO DO DIA (fase EB, 12/10/2026).
//
// Pedido do usuário: cada modelo tem o seu tempo de montagem (uns 40 min,
// outros 1h30), e o dia (8h, ajustável no dia) é preenchido misturando
// modelos até fechar. Decisões: UM tempo por modelo; jornada padrão por setor,
// ajustável por dia. Provado no navegador, no banco local, com o exemplo
// dele: 6 × 40 min + 2 × 1h30 = 7h de 8h, sobra 1h, cabe mais 1 do de 40 min;
// jornada do dia em 6h = "passou 1h".
'use strict';
const fs = require('fs');
const path = require('path');
const { semComentarios } = require('./sem-comentarios');
const T = require('../public/modules/shared/pcp_tempo');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};
const RAIZ = path.join(__dirname, '..');
const ler = (a) => fs.readFileSync(path.join(RAIZ, a), 'utf8');

console.log('\n--- 1. formato do tempo ---');
check('40 -> 40 min', T.formatarMinutos(40) === '40 min');
check('90 -> 1h30', T.formatarMinutos(90) === '1h30');
check('480 -> 8h', T.formatarMinutos(480) === '8h');
check('65 -> 1h05', T.formatarMinutos(65) === '1h05');

console.log('\n--- 2. o exemplo do usuário ---');
const tempos = [{ productId: 'a', minutos: 40 }, { productId: 'b', minutos: 90 }];
const dia = T.resumoDoDia({ itens: [{ productId: 'a', quantidade: 6 }, { productId: 'b', quantidade: 2 }], tempos, jornadaHoras: 8 });
check('6 × 40 min + 2 × 1h30 = 7h', dia.ocupado === 420, T.formatarMinutos(dia.ocupado));
check('de 8h, sobra 1h', dia.disponivel === 480 && dia.sobra === 60 && !dia.excedeu);
check('cabe mais 1 do de 40 min', T.cabemNoDia('a', dia.sobra, tempos) === 1);
check('e nenhum do de 1h30', T.cabemNoDia('b', dia.sobra, tempos) === 0);
const curto = T.resumoDoDia({ itens: [{ productId: 'a', quantidade: 6 }, { productId: 'b', quantidade: 2 }], tempos, jornadaHoras: 6 });
check('jornada do dia em 6h: passou 1h', curto.excedeu && curto.sobra === -60);
const semTempo = T.resumoDoDia({ itens: [{ productId: 'a', quantidade: 1 }, { productId: 'x', quantidade: 3 }], tempos, jornadaHoras: 8 });
check('produto sem tempo fica FORA da soma e listado', semTempo.ocupado === 40 && semTempo.semTempo.length === 1 && semTempo.semTempo[0].productId === 'x');
check('produto sem tempo: "cabem" não inventa número', T.cabemNoDia('x', 480, tempos) === null);
check('ordem de 6 do de 40 min = 4h', T.minutosDe('a', 6, T.mapaDeTempos(tempos)) === 240);

console.log('\n--- 3. jornada do dia ---');
check('ajuste do dia vence o padrão do setor', T.jornadaDoDia({ ajuste: { horas: 4 }, setor: { jornadaHoras: 8 } }) === 4);
check('ajuste de 0h (dia parado) é respeitado', T.jornadaDoDia({ ajuste: { horas: 0 }, setor: { jornadaHoras: 8 } }) === 0);
check('sem ajuste: padrão do setor', T.jornadaDoDia({ setor: { jornadaHoras: 9.5 } }) === 9.5);
check('sem setor nem ajuste: 8h', T.jornadaDoDia({}) === 8);

console.log('\n--- 4. banco ---');
const mig = ler('banco/migrations/fase-eb-pcp-tempos-e-programacao.sql');
check('um tempo por produto (UNIQUE) e maior que zero', /product_id text not null unique references products\(id\) on delete cascade,\s*minutos numeric\(10,2\) not null check \(minutos > 0\)/.test(mig));
check('um ajuste de jornada por dia e setor (inclusive o "geral")', /create unique index if not exists idx_pcp_jornada_dia on pcp_jornadas \(coalesce\(sector_id, ''\), date\)/.test(mig));
check('programação com quantidade > 0', /quantidade numeric\(14,4\) not null check \(quantidade > 0\)/.test(mig));
check('setor ganha jornada_horas (0 a 24)', /add column if not exists jornada_horas numeric\(5,2\)/.test(mig));
check('RLS nas três tabelas novas', ['pcp_tempos_produto', 'pcp_jornadas', 'pcp_programacao'].every((t) => new RegExp(`alter table ${t} enable row level security`).test(mig)));
check('RECRIAR-DO-ZERO inclui a fase EB', ler('banco/RECRIAR-DO-ZERO.sql').includes('fase-eb-pcp-tempos-e-programacao.sql'));
const modulos = require('../lib/db/modulos');
check('os três recursos no motor do PCP', ['pcp/tempos', 'pcp/jornadas', 'pcp/programacao'].every((r) => modulos.RECURSOS[r]));
check('  e o setor lê/grava jornadaHoras', Boolean(modulos.RECURSOS['pcp/sectors'].campos.jornadaHoras));

console.log('\n--- 5. servidor ---');
const server = semComentarios(ler('server.js'));
check('mensagem em português antes do UNIQUE/CHECK (criar e editar)', (server.match(/await recusaDoPlanejamentoPcp\(recurso, corpo, (null|id)\)/g) || []).length === 2);
check('  segundo tempo para o mesmo produto é recusado', /Este produto já tem tempo de produção cadastrado/.test(server));
check('meta do PCP leva SKU, tempos e a jornada do setor', /getProductsResumidos\('id, name, sku'\)/.test(server) && /apoio\.tempos = tempos\.map/.test(server) && /jornadaHoras: s\.jornadaHoras/.test(server));

console.log('\n--- 6. telas ---');
const app = ler('public/app.js');
const pcp = semComentarios(ler('public/modules/pcp/subs/pcp.js'));
const prog = semComentarios(ler('public/modules/pcp/subs/programacao.js'));
check('menu: Programação do Dia e Tempos de Produção', /key: 'programacao', label: 'Programação do Dia'/.test(app) && /key: 'tempos', label: 'Tempos de Produção'/.test(app));
check('Tempos de Produção: produto + minutos', /R\.tempos = C\.makeInlineRegisterScreen/.test(pcp) && /name: 'minutos', label: 'Tempo por unidade \(minutos\)'/.test(pcp));
check('OP mostra o tempo (quantidade × tempo do modelo)', /label: 'Tempo', render: \(i, meta\) => tempoDaOrdem\(i, meta\)/.test(pcp));
check('Setor: jornada padrão no lugar da capacidade por hora', /name: 'jornadaHoras', label: 'Jornada padrão \(horas por dia\)'/.test(pcp) && !/name: 'capacidadeHora'/.test(pcp));
check('Programação: contas pelo módulo compartilhado', /T\.resumoDoDia\(\{ itens, tempos: meta\.tempos, jornadaHoras \}\)/.test(prog) && /T\.cabemNoDia\(productId, resumo\.sobra, meta\.tempos\)/.test(prog));
check('  quantidade aceita qualquer número (passo "any")', !/min="0\.0001" step="1"/.test(prog) && (prog.match(/step="any"/g) || []).length === 2);
const html = ler('public/index.html');
check('scripts carregados, as contas antes das telas', html.indexOf('/modules/shared/pcp_tempo.js') > 0 && html.indexOf('/modules/shared/pcp_tempo.js') < html.indexOf('/modules/pcp/subs/pcp.js') && html.includes('/modules/pcp/subs/programacao.js'));

console.log(`\n===== ${falhas === 0 ? 'TODOS OS CHECKS PASSARAM' : falhas + ' FALHA(S)'} =====`);
process.exit(falhas ? 1 : 0);
