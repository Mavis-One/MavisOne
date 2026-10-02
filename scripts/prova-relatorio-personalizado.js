#!/usr/bin/env node
/**
 * PROVA DO RELATÓRIO PERSONALIZADO CONTRA O BANCO DE VERDADE.
 *
 * Para cada fonte: um relatório com TODOS os campos como coluna; depois cada
 * campo como filtro, em cada operador que o tipo dele aceita; e cada campo como
 * ordem. Cada expressão de cada fonte passa assim pelo SELECT, pelo WHERE e pelo
 * ORDER BY — a expressão que só quebra quando alguém a escolhe como filtro é o
 * defeito que esta prova existe para achar antes.
 *
 *   node scripts/prova-relatorio-personalizado.js            todas as fontes
 *   node scripts/prova-relatorio-personalizado.js vendas     só uma
 *
 * Só lê. Fica fora do `npm test` porque precisa do banco de pé.
 */
require('dotenv').config();
const p = require('../lib/relatorios/personalizado');
const motor = require('../lib/relatorios/motor');
const { consultar, fecharPool } = require('../lib/db/conexao');

const pedida = process.argv[2] || '';
let falhas = 0;
let consultas = 0;
const check = (nome, cond, det) => {
  if (!cond || det) console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas += 1;
};

const VALOR = { texto: 'a', data: '2026-01-01', codigo: '1', moeda: '0', numero: '0', quantidade: '0', inteiro: '0', percentual: '0' };
const VALOR2 = { data: motor.hojeNoBrasil(), codigo: '999999', moeda: '1000000', numero: '1000000', quantidade: '1000000', inteiro: '1000000', percentual: '100' };

(async () => {
  const sql = async (texto, parametros) => { consultas += 1; return (await consultar(texto, parametros)).rows; };
  for (const fonte of p.FONTES.filter((f) => !pedida || f.key === pedida)) {
    const todas = fonte.campos.map((c) => c.campo);
    const base = { nome: `Prova ${fonte.titulo}`, fonte: fonte.key, colunas: todas };
    const inicio = Date.now();
    try {
      const r = await p.executar(p.validarDefinicao(base), { sql, de: '2020-01-01', ate: motor.hojeNoBrasil() });
      const faltando = r.linhas.slice(0, 200).flatMap((l) => todas.filter((c) => !(c in l)));
      check(`${fonte.key}: todas as ${todas.length} colunas`, !faltando.length, `${r.linhas.length} linha(s), ${Date.now() - inicio} ms${r.limitado ? ' (cortado no teto)' : ''}`);
    } catch (e) {
      check(`${fonte.key}: todas as colunas`, false, e.message);
      continue;
    }
    for (const campo of fonte.campos) {
      const operadores = p.fontesVisiveis(() => true).find((f) => f.key === fonte.key).campos.find((c) => c.campo === campo.campo).operadores;
      for (const operador of operadores) {
        const filtro = { campo: campo.campo, operador, valor: VALOR[campo.tipo], valor2: VALOR2[campo.tipo] || 'z' };
        try {
          await p.executar(p.validarDefinicao({ ...base, colunas: [campo.campo], filtros: [filtro] }), { sql });
        } catch (e) {
          check(`${fonte.key}: filtro ${campo.campo} ${operador}`, false, e.message);
        }
      }
      try {
        await p.executar(p.validarDefinicao({ ...base, colunas: [todas[0]], ordem: [{ campo: campo.campo, direcao: 'desc' }] }), { sql });
      } catch (e) {
        check(`${fonte.key}: ordem por ${campo.campo}`, false, e.message);
      }
    }
    console.log(`  ok  ${fonte.key}: ${fonte.campos.length} campos como filtro e como ordem`);
  }
  await fecharPool();
  console.log(falhas ? `\n===== ${falhas} FALHA(S) em ${consultas} consultas =====` : `\n===== TODAS AS ${consultas} CONSULTAS RODARAM =====`);
  process.exit(falhas ? 1 : 0);
})().catch(async (e) => { console.error(e); await fecharPool(); process.exit(1); });
