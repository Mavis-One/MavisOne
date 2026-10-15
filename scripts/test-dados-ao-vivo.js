#!/usr/bin/env node
/**
 * DADOS AO VIVO (15/10/2026). Pedido do usuário: "estou com uma tela aberta em
 * uma NF, preciso abrir uma nova para conseguir cadastrar um vendedor porém
 * depois de cadastrar um vendedor, o mesmo ainda não aparece até eu atualizar
 * a página, deixe uma verificação automática e deixe isso padronizado no
 * sistema inteiro".
 *
 * Provado no navegador com DUAS ABAS de verdade (window.open), servidor local:
 *   1. pedido de venda aberto na aba A com observação digitada; a aba B
 *      cadastra um vendedor; de volta à A, o vendedor aparece na busca e a
 *      observação continua lá;
 *   2. emissão de NF-e com observações digitadas e a aba Destinatário aberta;
 *      a B cadastra um cliente; ele aparece na busca, o texto e a aba ficam;
 *   3. Contas a Receber (nada digitado) se redesenha sozinha;
 *   4. salvar preferência de tela na B não avisa ninguém.
 * Os cadastros do teste foram apagados.
 *
 * Aqui: o módulo do navegador num documento simulado, e as pontas no servidor
 * e nas telas.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let falhas = 0;
const check = (nome, cond, extra) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${!cond && extra ? ` -> ${extra}` : ''}`);
  if (!cond) falhas += 1;
};
const ler = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- servidor
const servidor = ler('server.js');
const regex = eval(servidor.match(/^const GRAVACAO_SEM_MUDANCA = (.*);$/m)[1]); // eslint-disable-line no-eval
const conta = (p) => !regex.test(p);
check('gravação de cadastro, venda, estoque e emissão conta como mudança',
  ['/api/cadastros/pessoas', '/api/sales/records', '/api/stock/movements', '/api/fiscal/nfe/emitir', '/api/reports/personalizados'].every(conta));
check('  login, preferência, nota em edição, prévia, simulação e exportação não contam',
  ['/api/login', '/api/preferencias', '/api/fiscal/nfe/rascunho', '/api/fiscal/nfe/previa', '/api/fiscal/nfe/danfe-previa',
    '/api/fiscal/regras/simular', '/api/sales/tributos', '/api/finance/entries/exportar', '/api/fiscal/sped/conferir'].every((p) => !conta(p)));
check('a versão sobe só na resposta de sucesso e vai no cabeçalho',
  /if \(res\.__mudaDados && statusCode < 400 && !res\.headersSent\) \{\s*res\.__mudaDados = false;\s*versaoDosDados \+= 1;\s*res\.setHeader\('X-Versao-Dados'/.test(servidor));
check('  a gravação repetida (guarda) não conta de novo',
  /if \(await guardaDeGravacaoRepetida\(req, res, url\)\) return;\s*\/\/[^\n]*\n\s*res\.__mudaDados = gravacaoMudaDados\(pathname\);/.test(servidor));
check('  e a versão é lida em GET /api/dados/versao, com login', /pathname === '\/api\/dados\/versao' && req\.method === 'GET'[\s\S]{0,200}getCurrentUser/.test(servidor));

// ---------------------------------------------------------------- telas
const app = ler('public/app.js');
check('apiDireto avisa as outras abas depois de gravar', app.includes("window.MavisDados?.gravou(path, response.headers.get('X-Versao-Dados'));"));
check('loadModule marca a tela nova', /window\.MavisDados\?\.telaNova\(\);\s*state\.activeModule = moduleName;/.test(app));
check('pedido de venda: listas de novo e redesenho com o preenchido',
  /window\.MavisDados\?\.aoMudar\(async \(\) => \{\s*const novo = await api\('\/api\/sales\/meta'\);[\s\S]{0,120}syncFormState\(\);\s*Object\.assign\(meta, novo\);[\s\S]{0,160}renderForm\(\);/.test(app));
const nfe = ler('public/modules/finance/subs/emitir_nfe_focus.js');
check('emissão de NF-e: listas de novo, estado e campos de volta, mesma aba',
  /aoMudar\(async \(\) => \{\s*const novo = await api\('\/api\/finance\/meta\?diretorio=nfe&produtos=nfe'\);[\s\S]*?aplicarEstadoSalvo\(estadoDaTela\(\)\);\s*meta = novo;\s*montarOpcoes\(\);\s*renderForm\(\);\s*preencherCamposSalvos\(campos\);/.test(nfe));
check('atalhos (Novo Cliente/Produto) atualizam a tela de trás', ler('public/modules/shared/atalhos.js').includes('window.MavisDados?.mudouAqui();'));
check('index carrega o módulo antes do app.js', (() => {
  const html = ler('public/index.html');
  const i = html.indexOf('/modules/shared/dados_ao_vivo.js'); return i > 0 && i < html.indexOf('/app.js"');
})());

// ---------------------------------------------------------------- o módulo
function montar() {
  const ouvintes = {};
  const canais = [];
  class CanalFalso {
    constructor(nome) { this.nome = nome; this.ouvintes = []; canais.push(this); }
    postMessage(data) { canais.filter((c) => c !== this && c.nome === this.nome).forEach((c) => c.ouvintes.forEach((fn) => fn({ data }))); }
    addEventListener(_t, fn) { this.ouvintes.push(fn); }
  }
  const conteudo = { isConnected: true, contains: (el) => Boolean(el && el.dentro) };
  const documento = {
    hidden: false, activeElement: null,
    getElementById: (id) => (id === 'moduleContent' ? conteudo : null),
    addEventListener: (t, fn) => { (ouvintes[t] = ouvintes[t] || []).push(fn); }
  };
  const janela = { addEventListener: (t, fn) => { (ouvintes[`w:${t}`] = ouvintes[`w:${t}`] || []).push(fn); }, scrollY: 0, scrollTo() {} };
  const ctx = { window: janela, document: documento, BroadcastChannel: CanalFalso, setTimeout, clearTimeout, Date, Number, Boolean };
  vm.createContext(ctx);
  vm.runInContext(ler('public/modules/shared/dados_ao_vivo.js'), ctx);
  const outraAba = new CanalFalso('mavisone:dados');
  const enviados = [];
  outraAba.addEventListener('message', (e) => enviados.push(e.data));
  const log = { redesenhos: 0, esquecidas: 0 };
  janela.MavisDados.configurar({
    logado: () => true, rotaAtual: () => 'sales/new_sale',
    redesenhar: async () => { log.redesenhos += 1; janela.MavisDados.telaNova(); },
    esquecerListas: () => { log.esquecidas += 1; },
    buscarVersao: async () => ({ versao: 100 })
  });
  const disparar = (tipo, evento = {}) => (ouvintes[tipo] || []).forEach((fn) => fn(evento));
  return { M: janela.MavisDados, documento, outraAba, enviados, log, disparar };
}

(async () => {
  {
    const { M, enviados } = montar();
    M.gravou('/api/preferencias', null);
    check('gravação sem a versão do servidor não avisa as outras abas', enviados.length === 0);
    M.gravou('/api/cadastros/pessoas', '200');
    check('  com a versão, avisa', enviados.length === 1 && enviados[0].tipo === 'gravou' && enviados[0].versao === 200);
  }
  {
    const { M, outraAba, log } = montar();
    let atualizou = 0;
    M.telaNova();
    M.aoMudar(async () => { atualizou += 1; });
    outraAba.postMessage({ tipo: 'gravou', versao: 300 });
    await dormir(400);
    check('aviso de outra aba roda a atualização da tela aberta', atualizou === 1 && log.redesenhos === 0 && log.esquecidas === 1);
  }
  {
    const { M, outraAba, log, disparar } = montar();
    M.telaNova();
    disparar('input', { target: { tagName: 'INPUT', type: 'text', dentro: true } });
    outraAba.postMessage({ tipo: 'gravou', versao: 300 });
    await dormir(400);
    check('tela com algo digitado e sem atualização própria: não redesenha', log.redesenhos === 0 && log.esquecidas === 1);
  }
  {
    const { M, outraAba, log } = montar();
    M.telaNova();
    outraAba.postMessage({ tipo: 'gravou', versao: 300 });
    await dormir(400);
    check('tela sem nada digitado: abre de novo', log.redesenhos === 1);
  }
  {
    const { M, outraAba, log, documento, disparar } = montar();
    M.telaNova();
    documento.hidden = true;
    outraAba.postMessage({ tipo: 'gravou', versao: 300 });
    await dormir(400);
    const escondida = log.redesenhos;
    documento.hidden = false;
    disparar('visibilitychange');
    await dormir(400);
    check('aba escondida espera voltar a ficar visível', escondida === 0 && log.redesenhos === 1);
  }
  {
    const { M, outraAba, log, documento, disparar } = montar();
    M.telaNova();
    M.aoMudar(async () => { log.redesenhos += 10; });
    const campo = { tagName: 'INPUT', type: 'text', dentro: true };
    documento.activeElement = campo;
    outraAba.postMessage({ tipo: 'gravou', versao: 300 });
    await dormir(400);
    const digitando = log.redesenhos;
    documento.activeElement = null;
    disparar('focusout', { target: campo });
    await dormir(400);
    check('quem está digitando num campo: espera sair dele', digitando === 0 && log.redesenhos === 10);
  }
  {
    const { M, log, disparar } = montar();
    M.telaNova(); // marca a versão de partida (100)
    await dormir(50);
    check('a primeira tela marca a versão de partida sem atualizar', M._estado().versaoVista === 100 && log.redesenhos === 0);
  }

  console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TUDO OK =====');
  process.exit(falhas ? 1 : 0);
})();
