#!/usr/bin/env node
// VÁRIAS ABAS NO MESMO NAVEGADOR (12/10/2026).
//
// O token mora no sessionStorage (por aba) e o servidor tem sessão única por
// usuário. Juntas, as regras faziam: aba nova = login; entrar nela = a primeira
// caía com "sua conta entrou em outro dispositivo". As abas passaram a dividir
// a sessão por um BroadcastChannel. Provado com duas abas reais no mesmo
// Chrome em 12/10/2026 (aba nova entra sozinha; novo login não derruba a
// outra; sair sai de todas; entrar numa entra na que estava no login).
//
// Este teste guarda o desenho no fonte — e o que NÃO pode mudar junto: a
// sessão continua no sessionStorage (fechar todas as abas encerra) e o
// servidor continua com sessão única (outro computador continua derrubando).
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
const app = semComentarios(fs.readFileSync(path.join(RAIZ, 'public/app.js'), 'utf8'));
const sessoes = fs.readFileSync(path.join(RAIZ, 'lib/db/sessoes.js'), 'utf8');

console.log('\n--- 1. o canal entre as abas ---');
check('um BroadcastChannel próprio, só se o navegador tiver', /typeof BroadcastChannel !== 'undefined' \? new BroadcastChannel\('mavisone:sessao'\) : null/.test(app));
check('aba nova sem sessão PEDE às abertas antes de mostrar o login',
  /let token = getSessionToken\(\);\s*if \(!token\) \{\s*token = await pedirSessaoAsOutrasAbas\(\);\s*if \(token\) setSessionToken\(token\);\s*\}\s*if \(!token\) \{\s*renderAuth\(\);/.test(app));
check('  e só quem está DENTRO responde', /if \(m\.tipo === 'pedir'\) \{[\s\S]{0,200}if \(token && state\.user\) avisarAbas\(\{ tipo: 'sessao', para: m\.id, token \}\)/.test(app));
check('  com tempo limite (não trava a tela de login)', /setTimeout\(\(\) => \{ canalDeSessao\.removeEventListener\('message', ouvir\); resolver\(null\); \}, esperaMs\)/.test(app));

console.log('\n--- 2. entrar, sair, outro usuário ---');
check('entrar avisa as outras abas com o token novo', /setSessionToken\(response\.token\);\s*avisarAbas\(\{ tipo: 'entrou', token: response\.token/.test(app));
check('  e elas o adotam (a aba no login entra junto)', /m\.tipo === 'entrou' && m\.token\) \{[\s\S]{0,400}setSessionToken\(m\.token\);[\s\S]{0,300}if \(!state\.user\) abrirSessaoExistente\(\)/.test(app));
check('  outro usuário entrou na máquina: recarrega (não mistura dados)', /if \(outroUsuario\) \{ window\.location\.reload\(\); return; \}/.test(app));
check('sair sai de todas as abas', /clearSessionToken\(\);\s*avisarAbas\(\{ tipo: 'saiu' \}\);/.test(app) && /m\.tipo === 'saiu'\) \{[\s\S]{0,300}renderAuth\(/.test(app));
// 15/10/2026: a ida ao servidor virou apiDireto (api é a guarda de duplicidade).
check('resposta "sessão encerrada" com token novo já adotado: repete uma vez', /if \(!jaRepetiu && getSessionToken\(\) && getSessionToken\(\) !== token\) \{\s*return apiDireto\(path, options, true\);/.test(app));

console.log('\n--- 3. o que NÃO mudou ---');
check('a sessão continua no sessionStorage (fechar todas encerra)', /sessionStorage\.setItem\(SESSION_TOKEN_KEY, token\)/.test(app) && !/localStorage\.setItem\(SESSION_TOKEN_KEY/.test(app));
check('o servidor continua com sessão única (outro computador derruba)', /async function abrirUnicaSemTraduzir[\s\S]{0,300}update sessoes\s+set encerrada_em = now\(\)/.test(sessoes));

console.log(`\n===== ${falhas === 0 ? 'TODOS OS CHECKS PASSARAM' : falhas + ' FALHA(S)'} =====`);
process.exit(falhas ? 1 : 0);
