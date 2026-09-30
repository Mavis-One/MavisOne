#!/usr/bin/env node
// O PRE-CHECK DO SPED, pelo HTTP, contra o servidor de verdade.
//
// NAO entra em `npm test`: sobe o server.js e consulta o banco. Roda a mao:
//
//   node scripts/prova-sped-pre-check.js
//
// O QUE ELA EXISTE PARA RESPONDER
// -------------------------------
// Esta tela tem uma regra que a faz nao mentir, e ela nao se confere lendo o
// codigo: CONFERENCIA SEM BASE NAO E VERDE. Com 0 documentos fiscais, "0 itens
// sem CFOP" e verdade e e inutil -- e uma tela que pintasse isso de verde diria
// que esta tudo pronto para gerar um arquivo vazio.
//
// Entao a prova cobra os tres estados de uma vez, contra o banco como ele esta:
//
//   os checks do Bloco C tem de vir `semBase`, e NAO `ok`
//   os registros sem fonte tem de vir `semFonte`, e nao `semBase`
//   os checks de cadastro tem de vir com numero de verdade
//
// E cobra que o resumo SOME o que as linhas dizem: um resumo que conte diferente
// das linhas e' pior que nao ter resumo, porque ele e' o que a pessoa le.
require('dotenv').config();
const path = require('path');
const { spawn } = require('child_process');

const RAIZ = path.join(__dirname, '..');
const PORTA = 3198;
const BASE = 'http://127.0.0.1:' + PORTA;

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

async function subirServidor() {
  const proc = spawn('node', [path.join(RAIZ, 'server.js')], {
    cwd: RAIZ,
    env: { ...process.env, PORT: String(PORTA) },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let log = '';
  proc.stdout.on('data', (d) => { log += d; });
  proc.stderr.on('data', (d) => { log += d; });
  for (let i = 0; i < 60; i++) {
    await esperar(250);
    try {
      const r = await fetch(BASE + '/login.html');
      if (r.status < 500) return { proc, log: () => log };
    } catch (_) { /* ainda subindo */ }
  }
  throw new Error('servidor nao subiu. log:\n' + log);
}

let token = '';
async function chamar(caminho, opcoes = {}) {
  const r = await fetch(BASE + caminho, {
    ...opcoes,
    headers: {
      'content-type': 'application/json',
      ...(token ? { 'x-auth-token': token } : {}),
      ...(opcoes.headers || {})
    }
  });
  const texto = await r.text();
  let corpo = null;
  try { corpo = JSON.parse(texto); } catch (_) { corpo = texto.slice(0, 200); }
  return { status: r.status, corpo };
}

(async () => {
  const servidor = await subirServidor();
  try {
    let r = await chamar('/api/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'admin', password: 'admin123' })
    });
    if (r.status !== 200) throw new Error('sem sessao: ' + JSON.stringify(r.corpo));
    token = r.corpo.token || r.corpo.authToken || '';

    console.log('--- a rota responde, e a competencia padrao e o MES PASSADO ---');
    r = await chamar('/api/fiscal/sped/pre-check');
    check('200', r.status === 200, `${r.status}`);
    const d = r.corpo;
    const agora = new Date();
    const esperado = new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
    check('competencia = mes passado', d.competencia === esperado, `${d.competencia} (esperado ${esperado})`);
    check('  com a janela do mes inteiro', d.de === d.competencia + '-01' && /-(28|29|30|31)$/.test(d.ate), `${d.de} a ${d.ate}`);

    console.log('\n--- competencia escolhida a mao ---');
    r = await chamar('/api/fiscal/sped/pre-check?competencia=2026-08');
    check('agosto/2026 responde', r.status === 200 && r.corpo.competencia === '2026-08', r.corpo.competencia);
    check('  ultimo dia de agosto e 31', r.corpo.ate === '2026-08-31', r.corpo.ate);
    r = await chamar('/api/fiscal/sped/pre-check?competencia=2024-02');
    check('fevereiro bissexto da 29', r.corpo.ate === '2024-02-29', r.corpo.ate);
    r = await chamar('/api/fiscal/sped/pre-check?competencia=2026-02');
    check('  e fevereiro comum da 28', r.corpo.ate === '2026-02-28', r.corpo.ate);

    console.log('\n--- competencia invalida e recusada, nao "corrigida" ---');
    for (const ruim of ['2026-13', 'agosto', '2026-00', '26-08']) {
      r = await chamar('/api/fiscal/sped/pre-check?competencia=' + encodeURIComponent(ruim));
      check(`"${ruim}" -> 400`, r.status === 400, `${r.status}`);
    }

    console.log('\n--- OS TRES ESTADOS, contra o banco como ele esta ---');
    r = await chamar('/api/fiscal/sped/pre-check?competencia=2026-09');
    const dados = r.corpo;
    const todas = dados.blocos.flatMap((b) => b.registros.flatMap((reg) => reg.conferencias));
    check('ha conferencias', todas.length >= 15, `${todas.length}`);

    // 1. Sem fonte: tem de vir marcado como tal, e NAO como "sem base".
    const semFonte = todas.filter((c) => c.gravidade === 'semFonte');
    check('os registros sem fonte estao marcados', semFonte.length >= 5, `${semFonte.length}`);
    check('  e o 0100 (contabilista) esta entre eles',
      semFonte.some((c) => c.reg === '0100'), semFonte.map((c) => c.reg).join(', '));
    // O C190 SAIU DESTA LISTA em 30/09/2026, e esta prova cobrava que ele
    // estivesse nela. A agregacao por CST x CFOP x aliquota passou a existir
    // em lib/sped-apuracao.js, provada em scripts/test-sped-apuracao.js: ele
    // deixou de ser "nao sai de lugar nenhum" e virou conferencia de DADO.
    // Hoje vem SEM BASE, porque ha 0 documentos -- nao "ok", que diria que
    // esta' resolvido, nem "semFonte", que diria que falta codigo.
    const analitico = todas.find((c) => c.id === 'analitico');
    check('  e o C190 NAO esta mais entre eles', !semFonte.some((c) => c.reg === 'C190'),
      semFonte.map((c) => c.reg).join(', '));
    check('  o C190 virou conferencia de dado', !!analitico && analitico.gravidade !== 'semFonte',
      analitico && analitico.gravidade);
    check('    e vem SEM BASE, nao ok', !!analitico && analitico.semBase === true && analitico.ok === false,
      analitico && `semBase=${analitico.semBase} ok=${analitico.ok} avaliados=${analitico.avaliados}`);

    // 2. Sem base: o Bloco C hoje, porque ha 0 documentos.
    const itemCfop = todas.find((c) => c.id === 'item_cfop_ncm');
    check('"CFOP e NCM de cada item" existe', !!itemCfop);
    check('  e vem SEM BASE (0 itens), nao ok',
      itemCfop && itemCfop.semBase === true && itemCfop.ok === false,
      itemCfop ? `semBase=${itemCfop.semBase} ok=${itemCfop.ok} avaliados=${itemCfop.avaliados}` : '-');

    // 3. Com base: o cadastro de produtos tem 5.475 linhas de verdade.
    const ncm = todas.find((c) => c.id === 'ncm');
    check('"NCM dos produtos" olhou o cadastro', ncm && ncm.avaliados > 1000, ncm ? `${ncm.avaliados} avaliados` : '-');
    check('  e NAO esta sem base', ncm && ncm.semBase === false);

    const unidades = todas.find((c) => c.id === 'unidades');
    check('"unidades sem descricao" conta as em uso',
      unidades && unidades.avaliados > 0 && unidades.pendentes > 0,
      unidades ? `${unidades.pendentes} de ${unidades.avaliados}` : '-');
    check('  e traz exemplos, para a lista ser acionavel',
      unidades && unidades.exemplos.length > 0, unidades ? unidades.exemplos.slice(0, 3).join(' · ') : '-');

    console.log('\n--- o RESUMO soma o que as linhas dizem ---');
    const contar = (f) => todas.filter(f).length;
    check('impedem', dados.resumo.impedem === contar((c) => c.gravidade === 'impede' && c.pendentes > 0),
      `${dados.resumo.impedem} vs ${contar((c) => c.gravidade === 'impede' && c.pendentes > 0)}`);
    check('atencoes', dados.resumo.atencoes === contar((c) => c.gravidade === 'atencao' && c.pendentes > 0),
      `${dados.resumo.atencoes} vs ${contar((c) => c.gravidade === 'atencao' && c.pendentes > 0)}`);
    check('semFonte', dados.resumo.semFonte === contar((c) => c.gravidade === 'semFonte'),
      `${dados.resumo.semFonte} vs ${contar((c) => c.gravidade === 'semFonte')}`);
    check('semBase (sem contar os sem fonte)',
      dados.resumo.semBase === contar((c) => c.semBase && c.gravidade !== 'semFonte'),
      `${dados.resumo.semBase} vs ${contar((c) => c.semBase && c.gravidade !== 'semFonte')}`);
    check('total', dados.resumo.total === todas.length, `${dados.resumo.total} vs ${todas.length}`);

    console.log('\n--- nenhuma conferencia pode estar nos dois estados ---');
    const contraditorias = todas.filter((c) => c.ok && (c.semBase || c.pendentes > 0));
    check('ok e semBase/pendentes nunca juntos', contraditorias.length === 0,
      contraditorias.map((c) => c.id).join(', ') || 'nenhuma');

    console.log('\n--- a referencia diz de onde os numeros de comparacao vieram ---');
    check('cita o arquivo do sistema atual', /sped01082026/.test(dados.referencia.arquivo), dados.referencia.arquivo);
    check('  e o COD_VER que ele declara', dados.referencia.codVer === '020', dados.referencia.codVer);
    check('  e quantos registros sem fonte ha', Array.isArray(dados.referencia.semFonteNoSistema)
      && dados.referencia.semFonteNoSistema.length >= 5, (dados.referencia.semFonteNoSistema || []).join(', '));

    console.log('\n--- e a rota NAO gera arquivo nem grava nada ---');
    check('a resposta nao tem campo de arquivo/conteudo',
      !('arquivo' in dados) && !('conteudo' in dados) && !('txt' in dados),
      Object.keys(dados).join(', '));

    console.log('\n--- o log do servidor esta limpo ---');
    const erros = (servidor.log().match(/^.*(Error|Erro ao|ERRO).*$/gm) || []);
    check('nenhum erro no log', erros.length === 0, erros.slice(0, 2).join(' | ') || 'limpo');
  } catch (e) {
    console.error('\nERRO NA PROVA:', e.message);
    falhas++;
  } finally {
    servidor.proc.kill();
  }

  console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== O PRE-CHECK NAO PINTA DE VERDE O QUE NAO CONFERIU =====');
  process.exit(falhas ? 1 : 0);
})();
