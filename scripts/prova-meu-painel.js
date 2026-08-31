#!/usr/bin/env node
// O MEU PAINEL, PROVADO CONTRA O BANCO E CONTRA O SERVIDOR DE VERDADE.
//
// NAO entra em `npm test`: escreve no Supabase e precisa de um servidor no ar.
//
//   npm start                       (num terminal)
//   node scripts/prova-meu-painel.js
//   BASE=http://localhost:3999 node scripts/prova-meu-painel.js
//
// POR QUE, SE JA EXISTE test-meu-painel.js
// ----------------------------------------
// Aquele teste prova a REGRA: dadas duas vendas e dois usuarios, a funcao pura
// separa direito. Ele nao consegue provar nada sobre o caminho que a regra
// percorre de verdade -- e o caminho e' onde mora o defeito que interessa:
//
//   - `users.seller_id` (fase AL) existe mesmo na tabela? Sem a coluna, TODO
//     usuario chega em escopoPessoal() com sellerId vazio e o painel do sistema
//     inteiro fica em branco, sem erro nenhum aparecer;
//   - a sessao carrega esse vinculo ate a rota, ou ele se perde no caminho?
//   - o portao central (sales.ler) deixa a rota passar para um usuario comum,
//     ou so' para administrador?
//   - mandar `vendedorId=<id do colega>` na URL, de fora, com um token de
//     verdade, muda alguma coisa?
//
// A ultima e' a unica que importa de verdade, e e' a unica que so' o servidor
// no ar responde: a prova aqui manda o id do colega na query string, com uma
// sessao legitima, e confere o que voltou.
//
// NAO CRIA NF-e. Documento fiscal so' e' cancelado, nunca apagado -- entao a
// prova nao emite nota nenhuma para depois limpar. Para a coluna NF-e, ela
// APROVEITA uma nota que ja exista no banco (so' leitura) e aponta o pedido de
// prova para ela. Se nao houver nenhuma nota, esse bloco e' PULADO, nao
// inventado, e a prova diz isso na tela.
//
// LIMPA O QUE ESCREVEU: dois vendedores, dois usuarios e dois pedidos, todos
// carimbados com a hora, apagados no `finally`.
require('dotenv').config();

const db = require('../db');
const { banco } = require('../lib/db/client');

const BASE = process.env.BASE || 'http://localhost:3000';
const CARIMBO = String(Date.now()).slice(-9);
const SENHA = `prova-${CARIMBO}-${Math.random().toString(36).slice(2, 10)}`;
// Dois codigos DIFERENTES, e vizinhos. A primeira versao derivava os dois do
// carimbo com prefixos diferentes e um slice(-6) -- que corta justamente o
// prefixo e devolvia o MESMO numero para os dois pedidos. A prova entao
// comparava um codigo consigo mesmo e acusava vazamento onde nao havia.
const CODIGO_A = Number(CARIMBO.slice(-6));
const CODIGO_B = CODIGO_A + 1;

let falhas = 0;
const check = (ok, titulo, detalhe) => {
  console.log(`  ${ok ? 'OK ' : 'XX '} ${titulo}${detalhe !== undefined ? ' -> ' + detalhe : ''}`);
  if (!ok) falhas++;
};

async function pedir(caminho, token) {
  const resposta = await fetch(`${BASE}${caminho}`, { headers: token ? { 'x-auth-token': token } : {} });
  const corpo = await resposta.json().catch(() => ({}));
  return { status: resposta.status, corpo };
}

async function entrar(username, password) {
  const resposta = await fetch(`${BASE}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  const corpo = await resposta.json().catch(() => ({}));
  return corpo.token || '';
}

const criados = { pessoas: [], usuarios: [], pedidos: [] };

(async () => {
  console.log(`\n--- 0. o servidor esta no ar? (${BASE}) ---`);
  try {
    const raiz = await fetch(`${BASE}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    check(raiz.status > 0, 'o servidor respondeu', `HTTP ${raiz.status}`);
  } catch (erro) {
    console.error(`\nXX  nao consegui falar com ${BASE}. Suba o servidor (npm start) ou passe BASE=...\n`);
    process.exit(1);
  }

  try {
    // ---------------------------------------------------------------- cenario
    console.log('\n--- 1. cenario: dois vendedores, dois logins, dois pedidos ---');
    const vendedorA = await db.createPerson({
      name: `Prova Vendedor A ${CARIMBO}`, type: 'pessoa-fisica',
      document: `000000000${CARIMBO}`.slice(-11), roles: ['Vendedor'], status: 'ativo'
    });
    const vendedorB = await db.createPerson({
      name: `Prova Vendedor B ${CARIMBO}`, type: 'pessoa-fisica',
      document: `111111111${CARIMBO}`.slice(-11), roles: ['Vendedor'], status: 'ativo'
    });
    criados.pessoas.push(vendedorA.id, vendedorB.id);
    check(Boolean(vendedorA.id && vendedorB.id), 'dois vendedores criados', `${vendedorA.id} / ${vendedorB.id}`);

    // O vinculo user -> seller e' a ponte da fase AL. Se a coluna nao existir,
    // createUser a ignora em silencio e o proximo check pega isso.
    const usuarioA = await db.createUser({
      username: `prova-a-${CARIMBO}`, password: SENHA, name: 'Prova A',
      role: 'user', allowedModules: ['dashboard', 'sales'], sellerId: vendedorA.id
    });
    const usuarioB = await db.createUser({
      username: `prova-b-${CARIMBO}`, password: SENHA, name: 'Prova B',
      role: 'user', allowedModules: ['dashboard', 'sales'], sellerId: vendedorB.id
    });
    criados.usuarios.push(usuarioA.id, usuarioB.id);

    // O PAPEL, e nao so' `allowedModules`. Este passo custou uma rodada inteira
    // desta prova e vale ficar escrito: com o RBAC ligado no banco (tabelas
    // user_roles / role_permissions), o portao central decide por
    // `usuarioPode(... 'sales.ler')` e IGNORA `allowedModules` -- a queda para o
    // modelo antigo (podePeloModulo) so' acontece quando o RBAC nao existe.
    // Um usuario criado com allowedModules:['sales'] e nenhum papel leva 403 em
    // TODA rota de Vendas, nao so' nesta. E' o mesmo que aconteceria com uma
    // pessoa cadastrada a mao e esquecida na tela de Papeis e Permissoes.
    await db.rbac.definirPapeisDoUsuario(usuarioA.id, ['usuario'], null);
    await db.rbac.definirPapeisDoUsuario(usuarioB.id, ['usuario'], null);

    // ESTE e' o check que a suite estatica nao alcanca: a coluna seller_id
    // existe na tabela `users` e voltou preenchida na leitura.
    check(usuarioA.sellerId === vendedorA.id,
      'users.seller_id existe e guardou o vinculo (fase AL aplicada)',
      `sellerId lido: "${usuarioA.sellerId}"`);
    if (usuarioA.sellerId !== vendedorA.id) {
      console.log('      >> rode banco/migrations/fase-al-usuario-vendedor.sql; sem ela o painel fica vazio para todos.');
    }

    const pedidoA = await db.createOrder({
      code: CODIGO_A, date: '2026-08-20', status: 'pedido-faturado',
      sellerId: vendedorA.id, clientSupplierName: `Cliente da Prova A ${CARIMBO}`,
      totalAmount: 500, items: [], note: 'PEDIDO DE PROVA - pode apagar'
    });
    const pedidoB = await db.createOrder({
      code: CODIGO_B, date: '2026-08-21', status: 'pedido-faturado',
      sellerId: vendedorB.id, clientSupplierName: `Cliente da Prova B ${CARIMBO}`,
      totalAmount: 700, items: [], note: 'PEDIDO DE PROVA - pode apagar'
    });
    criados.pedidos.push(pedidoA.id, pedidoB.id);
    check(Boolean(pedidoA.id && pedidoB.id), 'dois pedidos criados, um para cada vendedor');
    check(String(pedidoA.code) !== String(pedidoB.code),
      '  com codigos DIFERENTES (senao a prova se compara consigo mesma)',
      `${pedidoA.code} x ${pedidoB.code}`);

    // ------------------------------------------------------------------ acesso
    console.log('\n--- 2. o usuario comum entra e ve o proprio painel ---');
    const tokenA = await entrar(usuarioA.username, SENHA);
    const tokenB = await entrar(usuarioB.username, SENHA);
    check(Boolean(tokenA && tokenB), 'os dois logins funcionaram');

    const painelA = await pedir('/api/sales/meu-painel', tokenA);
    check(painelA.status === 200, 'a rota respondeu 200 para um usuario COMUM (nao admin)',
      `HTTP ${painelA.status} ${painelA.corpo.error || ''}`);
    check(painelA.corpo.escopo && painelA.corpo.escopo.temAcesso === true,
      '  e ele tem acesso (o vinculo chegou ate a rota)',
      painelA.corpo.escopo ? painelA.corpo.escopo.motivo || 'sem motivo, como esperado' : 'sem escopo');

    const codigos = (resposta) => (resposta.corpo.vendas || []).map((v) => String(v.pedido));
    check(codigos(painelA).includes(String(pedidoA.code)),
      'o pedido dele aparece', codigos(painelA).join(',') || 'nenhum');
    check(!codigos(painelA).includes(String(pedidoB.code)),
      'o pedido do COLEGA nao aparece');
    check(!JSON.stringify(painelA.corpo).includes(`Cliente da Prova B ${CARIMBO}`),
      '  e o cliente do colega nao esta em lugar nenhum do corpo da resposta');

    const painelB = await pedir('/api/sales/meu-painel', tokenB);
    check(codigos(painelB).includes(String(pedidoB.code)) && !codigos(painelB).includes(String(pedidoA.code)),
      'e o outro ve o dele, sem o do primeiro', codigos(painelB).join(','));

    // ------------------------------------------------- o ataque, com token real
    console.log('\n--- 3. mandar o id do colega na URL nao muda nada ---');
    const TENTATIVAS = [
      `vendedorId=${encodeURIComponent(vendedorB.id)}`,
      `sellerId=${encodeURIComponent(vendedorB.id)}`,
      `vendedorId=todos`,
      `vendedorId=${encodeURIComponent(vendedorB.id)}&sellerId=${encodeURIComponent(vendedorB.id)}`,
      `escopo=todos&sellerIds[]=${encodeURIComponent(vendedorB.id)}`,
      `dataDe=1900-01-01&dataAte=2999-12-31&vendedorId=${encodeURIComponent(vendedorB.id)}`
    ];
    for (const [i, query] of TENTATIVAS.entries()) {
      const r = await pedir(`/api/sales/meu-painel?${query}`, tokenA);
      const viuOColega = codigos(r).includes(String(pedidoB.code))
        || JSON.stringify(r.corpo).includes(`Cliente da Prova B ${CARIMBO}`);
      check(!viuOColega, `  tentativa ${i + 1} nao vazou nada`, query.slice(0, 60));
    }

    // A comparacao que da' sentido as' seis de cima: a rota ANTIGA, que esta
    // tela nao usa, entrega os pedidos de todo mundo no corpo -- e faz isso
    // legitimamente, porque o Painel Vendedor e' tela de gestao. E' exatamente
    // por isso que o Meu Painel precisou de rota propria.
    // O PAINEL VENDEDOR TAMBEM E' PRIVADO -- e ja' foi o contrario.
    //
    // Esta prova cobrava, ate' 26/08/2026, que /api/sales/dashboard entregasse
    // o time inteiro: era tela de gestao e o recorte ficava por conta de quem
    // desenhava. Na pratica isso significava que um vendedor comum abria o
    // Painel Vendedor, escolhia o colega no seletor e lia a lista de pedidos
    // dele -- cliente, valor e data. A tela mostrava um; a resposta trazia
    // todos. Agora a rota recorta pelo escopo antes de responder.
    const outraTela = await pedir('/api/sales/dashboard', tokenA);
    check(outraTela.status === 200,
      '/api/sales/dashboard responde ao mesmo usuario', `HTTP ${outraTela.status}`);
    check(!JSON.stringify(outraTela.corpo).includes(`Cliente da Prova B ${CARIMBO}`),
      '  e NAO entrega mais os pedidos do colega no corpo');
    const vendedoresNaResposta = (outraTela.corpo.bySeller || []).map((v) => v.sellerName);
    check(!vendedoresNaResposta.includes(`Prova Vendedor B ${CARIMBO}`),
      '  nem o NOME do colega no seletor de vendedor', vendedoresNaResposta.join(', ') || 'nenhum');
    check(outraTela.corpo.escopo && outraTela.corpo.escopo.podeEscolherVendedor === false,
      '  e avisa a tela para nao desenhar o seletor');

    // O gestor continua vendo todo mundo -- o recorte e' por PAPEL, nao um
    // muro que fecha a tela para todos. Sem este check, "ninguem ve nada"
    // passaria como se fosse a correcao certa.
    const tokenGestor = await entrar('admin', process.env.SENHA_ADMIN || 'admin123');
    if (tokenGestor) {
      const comoGestor = await pedir('/api/sales/dashboard', tokenGestor);
      const nomes = (comoGestor.corpo.bySeller || []).map((v) => v.sellerName);
      check(nomes.includes(`Prova Vendedor A ${CARIMBO}`) && nomes.includes(`Prova Vendedor B ${CARIMBO}`),
        'o GESTOR continua vendo os dois vendedores', `${nomes.length} vendedores`);
      check(comoGestor.corpo.escopo && comoGestor.corpo.escopo.podeEscolherVendedor === true,
        '  e para ele o seletor continua de pe');
    } else {
      console.log('  -- PULADO: nao consegui entrar como admin (passe SENHA_ADMIN=... se a senha mudou)');
    }

    // ---------------------------------------------------------------- a NF-e
    console.log('\n--- 4. a coluna NF-e sai preenchida ---');
    const { data: notas } = await banco.from('nfe').select('id, numero').limit(1);
    const nota = (notas || [])[0];
    if (!nota) {
      console.log('  -- PULADO: nao ha NF-e no banco, e esta prova NAO emite uma so para testar');
      console.log('     (documento fiscal se cancela, nunca se apaga -- emitir aqui deixaria lixo permanente)');
    } else {
      await db.updateOrder(pedidoA.id, { ...pedidoA, nfeId: nota.id });
      const comNota = await pedir('/api/sales/meu-painel', tokenA);
      const linha = (comNota.corpo.vendas || []).find((v) => String(v.pedido) === String(pedidoA.code));
      check(Boolean(linha && linha.temNota), 'o pedido de prova aparece com nota');
      check(Boolean(linha && String(linha.nfeNumero) === String(nota.numero)),
        '  e a coluna traz o NUMERO da nota, nao o uuid',
        linha ? `"${linha.nfeNumero}" (esperado "${nota.numero}")` : 'linha nao encontrada');
      check(Boolean(comNota.corpo.indicadores && comNota.corpo.indicadores.comNota >= 1),
        '  e o card "Com NF-e emitida" contou');
    }

    // ------------------------------------------------- o caso que falha fechado
    console.log('\n--- 5. usuario sem vinculo nao cai no ramo "sem filtro" ---');
    const usuarioSem = await db.createUser({
      username: `prova-sem-${CARIMBO}`, password: SENHA, name: 'Prova Sem Vinculo',
      role: 'user', allowedModules: ['dashboard', 'sales']
    });
    criados.usuarios.push(usuarioSem.id);
    await db.rbac.definirPapeisDoUsuario(usuarioSem.id, ['usuario'], null);
    const tokenSem = await entrar(usuarioSem.username, SENHA);
    const painelSem = await pedir('/api/sales/meu-painel', tokenSem);
    check(painelSem.status === 200, 'a rota responde 200 (nao e erro, e ausencia de vinculo)', `HTTP ${painelSem.status}`);
    check((painelSem.corpo.vendas || []).length === 0, 'nenhuma venda -- nem a dele, nem a de ninguem');
    check(painelSem.corpo.escopo && painelSem.corpo.escopo.temAcesso === false, 'temAcesso e falso');
    check(/vincul/i.test((painelSem.corpo.escopo || {}).motivo || ''),
      'e o motivo diz o que fazer', (painelSem.corpo.escopo || {}).motivo);

    console.log('\n--- 6. sem sessao, nada ---');
    const semToken = await pedir('/api/sales/meu-painel', '');
    check(semToken.status === 401 || semToken.status === 403,
      'sem token a rota recusa', `HTTP ${semToken.status}`);
    const tokenFalso = await pedir('/api/sales/meu-painel', 'token-inventado-por-mim');
    check(tokenFalso.status === 401 || tokenFalso.status === 403,
      'com token inventado tambem', `HTTP ${tokenFalso.status}`);
  } finally {
    console.log('\n--- 7. limpeza ---');
    for (const id of criados.pedidos) {
      try { await db.deleteOrder(id); check(true, `pedido ${id} removido`); }
      catch (e) { check(false, `pedido ${id} NAO foi removido`, e.message); }
    }
    for (const id of criados.usuarios) {
      try { await db.deleteUser(id); check(true, `usuario ${id} removido`); }
      catch (e) { check(false, `usuario ${id} NAO foi removido`, e.message); }
    }
    for (const id of criados.pessoas) {
      try { await db.deletePerson(id); check(true, `vendedor ${id} removido`); }
      catch (e) { check(false, `vendedor ${id} NAO foi removido`, e.message); }
    }
  }

  console.log(`\n===== ${falhas === 0 ? 'O MEU PAINEL ESTA DE PE NO BANCO E NO SERVIDOR' : falhas + ' FALHA(S)'} =====`);
  process.exit(falhas ? 1 : 0);
})().catch((erro) => {
  console.error('\nXX  a prova parou no meio:', erro.message);
  console.error('    Pode ter ficado dado de prova no banco, carimbado com', CARIMBO);
  console.error('    pessoas:', criados.pessoas.join(', ') || '-');
  console.error('    usuarios:', criados.usuarios.join(', ') || '-');
  console.error('    pedidos:', criados.pedidos.join(', ') || '-');
  process.exit(1);
});
