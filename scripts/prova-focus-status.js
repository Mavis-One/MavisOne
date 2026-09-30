#!/usr/bin/env node
// A CAIXA DE STATUS DA FOCUS NFe, RODADA DE VERDADE.
//
// FORA DO `npm test` de propósito: precisa do servidor de pé na porta 3000 e
// faz login. A guarda estática de sempre mora em test-chave-mestra-focus.js
// (seções 8 a 10); esta prova existe porque texto de tela é o único código que
// regex confere mal — ela lê o TEXTO QUE O USUÁRIO VÊ.
//
// COMO ELA RODA O CÓDIGO REAL. A tela é um IIFE de navegador: não dá para
// `require`. Em vez de copiar a função para cá — cópia que passaria a mentir
// no dia em que a tela mudasse —, o arquivo é lido e os dois pedaços que
// importam são recortados dele e executados com `new Function`, recebendo
// `document`, `api` e `escapeHtml` de mentira. Se a função sair do arquivo ou
// mudar de nome, o recorte falha e a prova para, que é o certo.
//
// OS QUATRO ESTADOS. O primeiro vem da rota de verdade; os outros três não dão
// para produzir localmente sem estragar a configuração (apagar a chave mestra,
// ligar a trava, revogar o token), então entram como payload — o que se está
// provando é a TELA, e a rota que monta esses payloads é a que o teste
// estático confere.
const fs = require('fs');
const path = require('path');
const http = require('http');

const RAIZ = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(RAIZ, 'public/modules/settings/subs/fiscal.js'), 'utf8').replace(/\r\n/g, '\n');

const mapa = (SRC.match(/const ORIGEM_DO_TOKEN = \{[\s\S]*?\};/) || [])[0];
const fn = (SRC.match(/async function carregarStatusFocusPadrao\(\) \{[\s\S]*?\n  \}\n/) || [])[0];
if (!mapa || !fn) {
  console.error('  XX  não achei ORIGEM_DO_TOKEN ou carregarStatusFocusPadrao no arquivo da tela');
  process.exit(1);
}

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};

const escapeHtml = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

async function renderizar(status) {
  const caixa = { textContent: '', innerHTML: '' };
  const documentoFalso = { getElementById: () => caixa };
  const apiFalsa = async () => status;
  const rodar = new Function('document', 'api', 'escapeHtml',
    `${mapa}\n${fn}\nreturn carregarStatusFocusPadrao();`);
  await rodar(documentoFalso, apiFalsa, escapeHtml);
  return caixa.innerHTML || caixa.textContent;
}

const semTags = (html) => String(html).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

function req(method, caminho, body, token) {
  return new Promise((ok, bad) => {
    const d = body ? JSON.stringify(body) : null;
    const r = http.request({
      host: '127.0.0.1', port: 3000, path: caminho, method,
      headers: Object.assign({ 'content-type': 'application/json' },
        d ? { 'content-length': Buffer.byteLength(d) } : {},
        token ? { 'x-auth-token': token } : {})
    }, (res) => { let s = ''; res.on('data', (c) => { s += c; }); res.on('end', () => ok({ status: res.statusCode, body: s })); });
    r.on('error', bad);
    if (d) r.write(d);
    r.end();
  });
}

(async () => {
  console.log('--- 1. contra a rota de verdade ---');
  const login = await req('POST', '/api/login', { username: 'admin', password: 'admin123' });
  if (login.status !== 200) {
    console.error(`  XX  login respondeu ${login.status} — o servidor está de pé na porta 3000?`);
    process.exit(1);
  }
  const token = JSON.parse(login.body).token;
  const resposta = await req('GET', '/api/focusnfe/status', null, token);
  const real = JSON.parse(resposta.body);
  console.log(`    a rota: configured=${real.configured} connected=${real.connected} ambiente=${real.ambiente} origem=${real.origem}`);
  const saidaReal = await renderizar(real);
  console.log('    a tela: ' + semTags(saidaReal));
  check('a tela nomeia a origem que a rota devolveu',
    real.origem === 'nenhuma' || /Token usado:/.test(saidaReal), real.origem);
  if (real.origem === 'chave-mestra') {
    // O defeito que motivou isto: a tela afirmava testar o .env, e o que
    // respondeu foi a chave mestra.
    check('e diz que foi a chave mestra, não o .env',
      /chave mestra/.test(saidaReal) && !/FOCUS_NFE_TOKEN/.test(saidaReal));
  }

  console.log('\n--- 2. sem token nenhum ---');
  const semToken = await renderizar({
    ambiente: 'homologacao', ambienteSolicitado: 'homologacao', travadoEmHomologacao: false,
    configured: false, connected: false, message: 'Token não configurado.', origem: 'nenhuma'
  });
  console.log('    ' + semTags(semToken));
  check('manda para a chave mestra, que é um formulário desta mesma página',
    /chave mestra da conta/.test(semToken));
  check('não manda mais reiniciar o servidor', !/reinicie/.test(semToken));
  check('e ainda diz que o .env serve', /FOCUS_NFE_TOKEN/.test(semToken));

  console.log('\n--- 3. conectado com a trava de homologação ligada ---');
  const travado = await renderizar({
    ambiente: 'homologacao', ambienteSolicitado: 'producao', travadoEmHomologacao: true,
    configured: true, connected: true,
    message: 'Conectado em homologação — notas emitidas aqui NÃO têm valor fiscal.', origem: 'env'
  });
  console.log('    ' + semTags(travado));
  check('o aviso de que a nota não vale chega à tela', /NÃO têm valor fiscal/.test(travado));
  check('e vem em negrito, porque é o oposto do verde do badge',
    /<strong>[^<]*NÃO têm valor fiscal/.test(travado));
  check('a origem aparece aqui também', /FOCUS_NFE_TOKEN no \.env/.test(travado));

  console.log('\n--- 4. falha de conexão diz QUAL token foi recusado ---');
  const falhou = await renderizar({
    ambiente: 'producao', ambienteSolicitado: 'producao', travadoEmHomologacao: false,
    configured: true, connected: false, message: 'Token recusado pela Focus NFe.', origem: 'chave-mestra'
  });
  console.log('    ' + semTags(falhou));
  check('o ramo de falha nomeia a origem', /Token usado: a chave mestra/.test(falhou));
  check('e mantém a mensagem da Focus', /Token recusado pela Focus NFe\./.test(falhou));

  console.log(`\n===== ${falhas === 0 ? 'A TELA DIZ QUAL TOKEN RESPONDEU' : falhas + ' FALHA(S)'} =====`);
  process.exit(falhas ? 1 : 0);
})();
