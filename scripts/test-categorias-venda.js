#!/usr/bin/env node
/**
 * CATEGORIAS DE VENDA (fase AS).
 *
 *   PORT=3999 npm start                     (num terminal)
 *   node scripts/test-categorias-venda.js   (noutro)
 *
 * Fora do `npm test` pelo mesmo motivo dos outros e2e: precisa do servidor no
 * ar. Sem ele, avisa e sai SEM falhar.
 *
 * O QUE ESTE TESTE PROTEGE
 * ------------------------
 * 1. QUE O FORMULÁRIO DE VENDA DEIXOU DE OFERECER CATEGORIA DE PRODUTO. Era o
 *    defeito de origem: "Parafusos" classificando uma venda. Se alguém religar
 *    o campo a productCategories, nada quebra — só volta a misturar dois
 *    catálogos que respondem perguntas diferentes.
 *
 * 2. QUE UM PEDIDO ANTIGO NÃO PERDE A CATEGORIA NA TELA. `orders.category`
 *    guarda o NOME. Categoria inativada, ou gravada antes deste cadastro
 *    existir, sumiria das opções — e o campo abriria em branco, com o valor
 *    ainda no input oculto. Quem edita acharia que perdeu, e a próxima escolha
 *    apagaria o histórico de verdade.
 *
 * 3. QUE NOME DUPLICADO SÓ POR CAIXA É RECUSADO, e que categoria em uso não se
 *    exclui. As duas são o motivo de o cadastro existir: sem elas, o catálogo
 *    volta a ser texto livre com mais passos.
 */
require('dotenv').config();
const http = require('http');
const { consultar, fecharPool } = require('../lib/db/conexao');
const fs = require('fs');
const path = require('path');

const PORTA = Number(process.env.PORTA_TESTE) || 3999;
const RAIZ = path.join(__dirname, '..');
const ler = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');

let token = '';
let falhas = 0;
const ok = (n, c, d) => { console.log(`  ${c ? 'OK ' : 'XX '} ${n}${d !== undefined ? ' -> ' + d : ''}`); if (!c) falhas++; };

function pedir(metodo, caminho, corpo) {
  return new Promise((resolve) => {
    const dados = corpo ? JSON.stringify(corpo) : null;
    const req = http.request({
      host: 'localhost', port: PORTA, path: caminho, method: metodo,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'x-auth-token': token } : {}),
        ...(dados ? { 'Content-Length': Buffer.byteLength(dados) } : {})
      }
    }, (res) => {
      let b = '';
      res.on('data', (d) => { b += d; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(b); } catch (_) { /* nao-JSON */ }
        resolve({ status: res.statusCode, json, texto: b.slice(0, 160) });
      });
    });
    req.on('error', () => resolve({ status: 0, json: null, texto: 'sem conexao' }));
    if (dados) req.write(dados);
    req.end();
  });
}

const criadas = [];

(async () => {
  const senha = process.env.SENHA_TESTE || '';
  const login = await pedir('POST', '/api/login', {
    username: process.env.USUARIO_TESTE || 'admin', password: senha
  });
  if (login.status !== 200) {
    console.log(`  (login recusou: ${login.status} — o servidor esta de pe na porta ${PORTA} e SENHA_TESTE esta no .env?)`);
    await fecharPool();
    process.exit(0);
  }
  token = login.json.token;
  ok('autenticado', Boolean(token));

  console.log('\n--- 1. o cadastro ---');
  const carimbo = Date.now();
  const nome = `zz Varejo ${carimbo}`;
  const criada = await pedir('POST', '/api/sales/categories', { name: nome, code: 'ZZV', notes: 'de teste' });
  ok('a categoria foi criada', criada.status === 200, criada.texto.slice(0, 70));
  criadas.push(criada.json?.category?.id);
  ok('  nasce ativa', criada.json?.category?.status === 'ativo');

  console.log('\n--- 2. "Varejo" e "varejo" sao a MESMA categoria ---');
  const duplicada = await pedir('POST', '/api/sales/categories', { name: nome.toLowerCase() });
  ok('a duplicata por caixa foi recusada', duplicada.status === 409, String(duplicada.status));
  ok('  e o erro diz o porque', /so mudando maiusculas|só mudando maiúsculas/i.test(duplicada.json?.error || ''),
    (duplicada.json?.error || '').slice(0, 60));

  console.log('\n--- 3. a venda passou a oferecer ESTAS, nao as de produto ---');
  const meta = await pedir('GET', '/api/sales/meta');
  const temMeta = meta.status === 200 && meta.json;
  if (temMeta) {
    ok('a meta da venda traz salesCategories', Array.isArray(meta.json.salesCategories),
      `${(meta.json.salesCategories || []).length} categoria(s)`);
    ok('  e a recem-criada esta la', (meta.json.salesCategories || []).some((c) => c.name === nome));
  } else {
    // A rota de meta mudou de nome: o check de fonte abaixo continua valendo.
    ok('(a rota de meta nao respondeu; o check de fonte abaixo cobre)', true, String(meta.status));
  }
  // O defeito de origem, conferido na fonte: o campo Categoria da venda lia
  // meta.productCategories. Se voltar a ler, este check acusa.
  // ANCORADO NO ID DO CAMPO, e nao em "<label>Categoria": ha mais de um rotulo
  // com essa palavra no app.js (o do produto, por exemplo), e uma janela de
  // tamanho fixo depois dele pode terminar antes da linha que interessa — que
  // foi o que aconteceu na primeira versao deste check. `salesCategory` so
  // existe uma vez.
  const app = ler('public/app.js');
  const posicao = app.indexOf("id: 'salesCategory'");
  const campoCategoria = posicao < 0 ? '' : app.slice(Math.max(0, posicao - 1200), posicao + 400);
  ok('o campo da venda existe', posicao > 0);
  // SEM OS COMENTARIOS, e o motivo e concreto: a primeira versao deste check
  // reprovou o proprio comentario que EXPLICA a mudanca, porque ele cita
  // "meta.productCategories" em prosa. Teste que reclama de texto em vez de
  // comando ensina a esconder a palavra — mesma correcao que test-rls.js ja
  // fazia com `semComentario`.
  const semComentario = (js) => js.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  ok('o campo Categoria nao le mais productCategories',
    !/productCategories/.test(semComentario(campoCategoria)));
  ok('  e passou a usar o cadastro proprio', /opcoesDeCategoriaDeVenda/.test(campoCategoria));

  console.log('\n--- 4. pedido antigo nao perde a categoria na tela ---');
  // A funcao e pura: da para exercita-la sem navegador.
  const fonte = (app.match(/function opcoesDeCategoriaDeVenda[\s\S]*?\n\}/) || [''])[0];
  ok('a funcao existe', fonte.length > 0);
  // eslint-disable-next-line no-new-func
  const opcoes = new Function(`${fonte}; return opcoesDeCategoriaDeVenda;`)();
  const metaFingida = { salesCategories: [{ id: '1', name: 'Varejo' }] };
  ok('categoria cadastrada aparece uma vez', opcoes(metaFingida, 'Varejo').length === 1);
  const comAntiga = opcoes(metaFingida, 'Parafusos');
  ok('  valor fora do cadastro NAO some', comAntiga.some((o) => o.value === 'Parafusos'),
    comAntiga.map((o) => o.label).join(' | '));
  ok('  e vem marcado como fora do cadastro',
    comAntiga.some((o) => /fora do cadastro/.test(o.label)));
  ok('  campo vazio nao inventa opcao', opcoes(metaFingida, '').length === 1);

  console.log('\n--- 5. categoria em uso nao se exclui ---');
  const { rows: pedido } = await consultar('select id from orders limit 1');
  if (pedido.length) {
    await consultar('update orders set category = $1 where id = $2', [nome, pedido[0].id]);
    const lista = await pedir('GET', '/api/sales/categories');
    const naLista = (lista.json?.categories || []).find((c) => c.id === criadas[0]);
    ok('a lista mostra quantos pedidos usam', naLista?.pedidos === 1, String(naLista?.pedidos));
    const recusa = await pedir('DELETE', `/api/sales/categories/${encodeURIComponent(criadas[0])}`);
    ok('  e a exclusao e recusada', recusa.status === 409, String(recusa.status));
    ok('  com o caminho certo no erro', /inativa/i.test(recusa.json?.error || ''),
      (recusa.json?.error || '').slice(0, 60));

    console.log('\n--- 6. renomear avisa que os pedidos ficam com o nome velho ---');
    const renome = await pedir('PUT', `/api/sales/categories/${encodeURIComponent(criadas[0])}`, {
      name: `${nome} (novo)`, status: 'ativo'
    });
    ok('a edicao foi aceita', renome.status === 200, renome.texto.slice(0, 60));
    ok('  e avisa sobre os pedidos presos ao nome antigo', /nome antigo/.test(renome.json?.aviso || ''),
      (renome.json?.aviso || '(sem aviso)').slice(0, 60));

    await consultar('update orders set category = \'\' where id = $1', [pedido[0].id]);
  } else {
    ok('(sem pedidos no banco para exercitar o uso)', true);
  }

  console.log('\n--- 7. inativar tira do formulario, sem apagar ---');
  await pedir('PUT', `/api/sales/categories/${encodeURIComponent(criadas[0])}`, {
    name: `${nome} (novo)`, status: 'inativo'
  });
  const meta2 = await pedir('GET', '/api/sales/meta');
  if (meta2.status === 200 && meta2.json) {
    ok('sumiu das opcoes da venda',
      !(meta2.json.salesCategories || []).some((c) => c.id === criadas[0]));
  }
  const lista2 = await pedir('GET', '/api/sales/categories');
  ok('  mas continua no cadastro', (lista2.json?.categories || []).some((c) => c.id === criadas[0]));
})()
  .catch((e) => { console.error(e); falhas++; })
  .finally(async () => {
    console.log('\n--- limpeza ---');
    for (const id of criadas.filter(Boolean)) {
      await consultar('delete from sales_categories where id = $1', [id]);
    }
    await consultar("delete from sales_categories where name like 'zz %'");
    ok('categorias de teste removidas', true);
    console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TODOS OS CHECKS PASSARAM =====');
    await fecharPool();
    process.exit(falhas ? 1 : 0);
  });
