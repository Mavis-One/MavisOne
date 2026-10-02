#!/usr/bin/env node
/**
 * PROVA DO CATÁLOGO DE RELATÓRIOS CONTRA O BANCO DE VERDADE.
 *
 * Roda TODOS os relatórios do catálogo (lib/relatorios), duas vezes cada: com
 * os filtros padrão e com um período largo (2020 até hoje). Confere que a
 * consulta não quebra, que toda linha traz todas as colunas declaradas, que
 * coluna numérica vem como número e que o CSV sai.
 *
 *   node scripts/prova-relatorios-catalogo.js            todos
 *   node scripts/prova-relatorios-catalogo.js estoque    só um grupo
 *
 * Só lê: nenhuma consulta grava nada. Fica fora do `npm test` porque precisa
 * do banco de pé.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const catalogo = require('../lib/relatorios');
const motor = require('../lib/relatorios/motor');
const { consultar, fecharPool } = require('../lib/db/conexao');

const grupoPedido = process.argv[2] || '';
let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas += 1;
};

function lerEstado() {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'db.json'), 'utf8'));
  } catch (_) {
    return {};
  }
}

(async () => {
  const data = lerEstado();
  const sql = async (texto, parametros) => (await consultar(texto, parametros)).rows;
  const hoje = motor.hojeNoBrasil();
  const lista = catalogo.RELATORIOS.filter((r) => !r.especial && (!grupoPedido || r.grupo === grupoPedido));
  console.log(`${lista.length} relatório(s)${grupoPedido ? ` do grupo ${grupoPedido}` : ''}\n`);

  for (const def of lista) {
    // "só de": período com uma ponta só. Era erro de SQL nos relatórios que
    // usavam `between` (o "até" chegava vazio).
    const recortes = [['padrão', {}], ['largo', { de: '2020-01-01', ate: hoje, dias: 365 }], ['só de', { de: '2026-01-01' }]];
    // Cada opção de cada escolha, no recorte largo: a opção que nunca roda é
    // o SQL que só quebra no dia em que alguém a escolhe.
    for (const e of def.escolhas || []) {
      for (const [valor] of e.itens.slice(1)) recortes.push([`${e.campo}=${valor}`, { de: '2020-01-01', ate: hoje, dias: 365, [e.campo]: valor }]);
    }
    for (const [rotulo, bruto] of recortes) {
      const nome = `${def.grupo}/${def.key} (${rotulo})`;
      try {
        const filtros = motor.normalizarFiltros(def, bruto);
        const inicio = Date.now();
        const r = await motor.executar(def, filtros, { sql, data, vendedores: null });
        const ms = Date.now() - inicio;
        const faltando = [];
        const naoNumero = [];
        for (const linha of r.linhas) {
          for (const c of r.colunas) {
            if (!(c.campo in linha)) faltando.push(c.campo);
            else if (motor.TIPOS_NUMERICOS.has(c.tipo) && linha[c.campo] !== null && typeof linha[c.campo] !== 'number') naoNumero.push(`${c.campo}=${JSON.stringify(linha[c.campo])}`);
          }
        }
        const csv = motor.paraCsv(r);
        const ok = !faltando.length && !naoNumero.length && csv.length > 0;
        check(nome, ok, ok
          ? `${r.linhas.length} linha(s), ${ms} ms${Object.keys(r.totais).length ? ', ' + Object.entries(r.totais).slice(0, 3).map(([k, v]) => `${k}=${v}`).join(' ') : ''}`
          : `faltando: ${[...new Set(faltando)].join(',')} | não numérico: ${[...new Set(naoNumero)].slice(0, 3).join(', ')}`);
      } catch (erro) {
        check(nome, false, erro.message);
      }
    }
  }
  await fecharPool();
  console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TODOS OS RELATÓRIOS RODARAM =====');
  process.exit(falhas ? 1 : 0);
})().catch(async (e) => { console.error(e); await fecharPool(); process.exit(1); });
