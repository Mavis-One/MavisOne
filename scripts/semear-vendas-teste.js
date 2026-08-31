#!/usr/bin/env node
// DADO DE TESTE PARA O MEU PAINEL: dois vendedores, um deles com login proprio.
//
//   node scripts/semear-vendas-teste.js
//   node scripts/semear-vendas-teste.js --usuario admin
//   node scripts/semear-vendas-teste.js --senha minhasenha123
//   node scripts/semear-vendas-teste.js --limpar
//
// O CENARIO, E POR QUE SAO DOIS VENDEDORES
// ----------------------------------------
// Com um vendedor so', o Meu Painel parece funcionar mesmo se o recorte de
// acesso estiver quebrado: nao ha venda de outra pessoa para vazar. O cenario
// util e' o que tem DUAS pessoas vendendo:
//
//   Vendedor de Teste  -> vinculado ao login que administra (por padrao `admin`)
//   Marina Ferreira    -> tem login PROPRIO, de vendedora comum
//
// Com isso da' para conferir na tela as tres coisas que importam:
//   1. cada um abre o Meu Painel e ve so' as vendas dele;
//   2. o administrador continua vendo TODO MUNDO no Painel Vendedor e no
//      Relatorio de Vendas -- o recorte e' do painel pessoal, nao do sistema;
//   3. a vendedora comum NAO consegue ver as vendas do outro por nenhum
//      caminho, nem mexendo na URL.
//
// A SENHA NAO FICA ESCRITA AQUI
// -----------------------------
// Por padrao ela e' sorteada e IMPRESSA no fim da execucao. Nao ha senha em
// texto puro neste arquivo de proposito: arquivo versionado e' o pior lugar
// para guardar credencial, ainda que de teste, e este repositorio ja teve o
// historico reescrito uma vez por causa disso. Para fixar uma senha sua, use
// `--senha`, que nao passa pelo arquivo nem fica no historico do shell se voce
// preferir exportar SENHA_VENDEDOR no ambiente.
//
// TUDO NASCE COM ID FIXO, COMECANDO EM "teste-"
// ---------------------------------------------
// Nada de carimbo de hora aqui, ao contrario das provas: id fixo faz o script
// ser IDEMPOTENTE (rodar duas vezes nao duplica nada) e, principalmente, faz a
// limpeza ser exata. `--limpar` apaga uma lista de ids conhecidos -- nao
// procura por nome parecido, nao apaga "o que parece de teste". Dado de teste
// que so' da' para achar por semelhanca acaba morando no banco para sempre,
// porque ninguem tem coragem de apagar pelo `like`.
//
// GRAVA DIRETO NA CAMADA DE DADOS, E NAO PELA API
// -----------------------------------------------
// Um pedido criado pela rota /api/sales/records com status "Pedido Faturado"
// baixa estoque e gera contas a receber. Isso e' o certo para uma venda de
// verdade e e' exatamente o que nao se quer aqui: sobrariam movimentacoes de
// estoque e lancamentos financeiros que `--limpar` nao remove, e o saldo do
// unico produto de exemplo (20 unidades) nao aguentaria onze pedidos. Gravando
// por db.createOrder, o efeito colateral nao acontece e a limpeza fecha.
require('dotenv').config();

const crypto = require('crypto');
const db = require('../db');
const { banco } = require('../lib/db/client');

const argumentos = process.argv.slice(2);
const LIMPAR = argumentos.includes('--limpar');
const valorDe = (bandeira, padrao) => {
  const i = argumentos.indexOf(bandeira);
  return i >= 0 ? argumentos[i + 1] : padrao;
};
const LOGIN_ADMIN = valorDe('--usuario', 'admin');

// Sorteada com crypto, nao com Math.random: nao e' paranoia com esta senha em
// particular, e' nao deixar um gerador fraco de credencial no repositorio para
// alguem copiar depois para um lugar onde importa.
const SENHA_VENDEDORA = valorDe('--senha', process.env.SENHA_VENDEDOR
  || `Vend-${crypto.randomBytes(6).toString('base64url')}`);

let falhas = 0;
const check = (ok, titulo, detalhe) => {
  console.log(`  ${ok ? 'OK ' : 'XX '} ${titulo}${detalhe !== undefined ? ' -> ' + detalhe : ''}`);
  if (!ok) falhas++;
};
const brl = (v) => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// --------------------------------------------------------------- o elenco
const VENDEDORES = [
  {
    id: 'pes-teste-vendedor', name: 'Vendedor de Teste', document: '39053344705',
    // Sem login proprio: quem "e'" este vendedor e' o administrador, por vinculo.
    login: null
  },
  {
    id: 'pes-teste-vendedora-2', name: 'Marina Ferreira', document: '19100000012',
    // Login de vendedora COMUM: sem papel de admin, sem acesso a Configuracoes.
    // E' esta conta que prova o recorte -- entrando com ela, o Meu Painel tem
    // que mostrar so' as vendas dela, e o Relatorio tambem.
    login: {
      username: 'marina.vendedora', name: 'Marina Ferreira',
      // Vendas + relatorios + dashboard. Nada de settings: vendedor comum nao
      // administra usuario nenhum, e deixar settings aqui esconderia o recorte
      // atras de um usuario poderoso demais para servir de teste.
      allowedModules: ['dashboard', 'sales', 'reports'],
      // O PAPEL, e nao so' allowedModules. Com o RBAC ligado, o portao central
      // decide por `sales.ler` e ignora allowedModules -- um usuario sem papel
      // leva 403 em TODA rota de Vendas. E' o mesmo esquecimento que acontece
      // com uma pessoa cadastrada a mao e nunca aberta em Papeis e Permissoes.
      papeis: ['usuario']
    }
  }
];

const CLIENTES = [
  { id: 'pes-teste-cliente-1', name: 'Metalurgica Aurora Ltda', document: '11222333000181' },
  { id: 'pes-teste-cliente-2', name: 'Comercial Sao Jorge', document: '11444777000161' },
  { id: 'pes-teste-cliente-3', name: 'Joao Batista da Silva', document: '52998224725' },
  { id: 'pes-teste-cliente-4', name: 'Distribuidora Vale Verde', document: '28517183000167' }
];

// Datas espalhadas de proposito, para o filtro de periodo ter o que filtrar, e
// status variados, para cada card ter uma venda que o justifique:
//   faturado                      -> "Faturados" e "Total vendido"
//   aprovado sem faturamento      -> conta no total, NAO conta em faturados
//   nao faturado                  -> so' no total
//   cancelado                     -> aparece na tabela, fica fora dos totais
const PEDIDOS = [
  // --- Vendedor de Teste (o administrador) ---------------------------------
  { id: 'ord-teste-1', code: 9001, vendedor: 0, cliente: 0, date: '2026-04-18', status: 'pedido-faturado', qtd: 12, preco: 154.5 },
  { id: 'ord-teste-2', code: 9002, vendedor: 0, cliente: 1, date: '2026-05-27', status: 'pedido-faturado', qtd: 30, preco: 114 },
  { id: 'ord-teste-3', code: 9003, vendedor: 0, cliente: 2, date: '2026-06-30', status: 'pedido-aprovado-sem-faturamento', qtd: 8, preco: 117.5 },
  { id: 'ord-teste-4', code: 9004, vendedor: 0, cliente: 0, date: '2026-07-14', status: 'pedido-nao-faturado', qtd: 25, preco: 86 },
  { id: 'ord-teste-5', code: 9005, vendedor: 0, cliente: 1, date: '2026-08-11', status: 'pedido-faturado', qtd: 40, preco: 144.5 },
  { id: 'ord-teste-6', code: 9006, vendedor: 0, cliente: 2, date: '2026-08-22', status: 'pedido-cancelado', qtd: 10, preco: 120 },

  // --- Marina Ferreira (login proprio) -------------------------------------
  // Valores e clientes DIFERENTES dos de cima de proposito: se o recorte
  // vazar, a diferenca salta aos olhos na tela em vez de passar por engano.
  { id: 'ord-teste-11', code: 9101, vendedor: 1, cliente: 3, date: '2026-05-09', status: 'pedido-faturado', qtd: 18, preco: 232.5 },
  { id: 'ord-teste-12', code: 9102, vendedor: 1, cliente: 2, date: '2026-06-22', status: 'pedido-faturado', qtd: 6, preco: 480 },
  { id: 'ord-teste-13', code: 9103, vendedor: 1, cliente: 3, date: '2026-07-31', status: 'pedido-nao-faturado', qtd: 22, preco: 97.5 },
  { id: 'ord-teste-14', code: 9104, vendedor: 1, cliente: 0, date: '2026-08-15', status: 'pedido-faturado', qtd: 15, preco: 318 },
  { id: 'ord-teste-15', code: 9105, vendedor: 1, cliente: 3, date: '2026-08-24', status: 'pedido-cancelado', qtd: 9, preco: 210 }
];

const IDS_PESSOAS = [...VENDEDORES.map((v) => v.id), ...CLIENTES.map((c) => c.id)];
const IDS_PEDIDOS = PEDIDOS.map((p) => p.id);

async function acharUsuario(username) {
  const { data } = await banco.from('users')
    .select('id, username, seller_id, role').eq('username', username).maybeSingle();
  return data ? { id: data.id, username: data.username, sellerId: data.seller_id || '', role: data.role } : null;
}

async function limpar(admin) {
  console.log('\n--- limpando o dado de teste ---');
  for (const id of IDS_PEDIDOS) {
    const { error } = await banco.from('orders').delete().eq('id', id);
    check(!error, `pedido ${id}`, error ? error.message : undefined);
  }

  for (const vendedor of VENDEDORES) {
    if (!vendedor.login) continue;
    const usuario = await acharUsuario(vendedor.login.username);
    if (!usuario) { check(true, `login ${vendedor.login.username}`, 'nao existia'); continue; }
    await banco.from('user_roles').delete().eq('user_id', usuario.id);
    const { error } = await banco.from('users').delete().eq('id', usuario.id);
    check(!error, `login ${vendedor.login.username} removido`, error ? error.message : undefined);
  }

  if (admin && admin.sellerId === VENDEDORES[0].id) {
    // So' desfaz o vinculo se ele apontar para o vendedor DESTE script. Um
    // vinculo com um vendedor de verdade, feito a mao depois, nao e' assunto
    // daqui e apagar seria destruir configuracao que ninguem pediu para tirar.
    await banco.from('users').update({ seller_id: null }).eq('id', admin.id);
    check(true, `vinculo de "${admin.username}" desfeito`);
  } else if (admin) {
    check(true, `vinculo de "${admin.username}" preservado`,
      admin.sellerId ? 'aponta para outro vendedor' : 'nao havia vinculo');
  }

  for (const id of IDS_PESSOAS) {
    const { error } = await banco.from('people').delete().eq('id', id);
    check(!error, `pessoa ${id}`, error ? error.message : undefined);
  }
}

(async () => {
  const admin = await acharUsuario(LOGIN_ADMIN);
  if (!admin) {
    console.error(`\nXX  nao existe usuario "${LOGIN_ADMIN}".\n`);
    process.exit(1);
  }

  if (LIMPAR) {
    await limpar(admin);
    console.log(`\n===== ${falhas === 0 ? 'LIMPO' : falhas + ' FALHA(S)'} =====\n`);
    process.exit(falhas ? 1 : 0);
  }

  // Idempotencia: apaga o que este mesmo script tenha deixado antes, para
  // rodar de novo nao esbarrar na chave primaria nem no code duplicado.
  console.log('\n--- 0. removendo uma semeadura anterior, se houver ---');
  for (const id of IDS_PEDIDOS) await banco.from('orders').delete().eq('id', id);
  for (const vendedor of VENDEDORES) {
    if (!vendedor.login) continue;
    const antigo = await acharUsuario(vendedor.login.username);
    if (antigo) {
      await banco.from('user_roles').delete().eq('user_id', antigo.id);
      await banco.from('users').delete().eq('id', antigo.id);
    }
  }
  for (const id of IDS_PESSOAS) await banco.from('people').delete().eq('id', id);
  console.log('  -- pronto');

  console.log('\n--- 1. vendedores ---');
  for (const vendedor of VENDEDORES) {
    await db.createPerson({
      id: vendedor.id, name: vendedor.name, type: 'pessoa-fisica', document: vendedor.document,
      roles: ['Vendedor'], status: 'ativo'
    });
    check(true, 'vendedor criado', `${vendedor.name}${vendedor.login ? ` (login: ${vendedor.login.username})` : ' (sem login proprio)'}`);
  }

  console.log('\n--- 2. clientes ---');
  for (const cliente of CLIENTES) {
    await db.createPerson({
      id: cliente.id, name: cliente.name,
      type: cliente.document.length === 14 ? 'pessoa-juridica' : 'pessoa-fisica',
      document: cliente.document, roles: ['Cliente'], status: 'ativo'
    });
    check(true, 'cliente criado', cliente.name);
  }

  console.log('\n--- 3. logins e vinculos ---');
  const { error: erroVinculo } = await banco.from('users')
    .update({ seller_id: VENDEDORES[0].id }).eq('id', admin.id);
  check(!erroVinculo, `"${admin.username}" vinculado a ${VENDEDORES[0].name}`,
    erroVinculo ? erroVinculo.message : undefined);
  if (erroVinculo) {
    console.log('      >> se a coluna nao existe, rode banco/migrations/fase-al-usuario-vendedor.sql');
  }

  for (const vendedor of VENDEDORES) {
    if (!vendedor.login) continue;
    const novo = await db.createUser({
      username: vendedor.login.username, password: SENHA_VENDEDORA, name: vendedor.login.name,
      role: 'user', allowedModules: vendedor.login.allowedModules, sellerId: vendedor.id
    });
    await db.rbac.definirPapeisDoUsuario(novo.id, vendedor.login.papeis, null);
    check(novo.sellerId === vendedor.id, `login "${vendedor.login.username}" criado e vinculado`,
      `papel ${vendedor.login.papeis.join(', ')} | modulos ${vendedor.login.allowedModules.join(', ')}`);
  }

  console.log('\n--- 4. pedidos ---');
  // O produto de exemplo do schema. Se nao existir, os itens vao sem vinculo:
  // o painel soma pelo total do pedido e nao depende do produto, entao a
  // ausencia nao invalida o teste -- so' deixa a aba Itens mais pobre.
  const { data: produto } = await banco.from('products')
    .select('id, name, sku').eq('id', 'prod-1').maybeSingle();

  for (const p of PEDIDOS) {
    const cliente = CLIENTES[p.cliente];
    const vendedor = VENDEDORES[p.vendedor];
    const bruto = Math.round(p.qtd * p.preco * 100) / 100;
    await db.createOrder({
      id: p.id, code: p.code, date: p.date, status: p.status,
      sellerId: vendedor.id, clientSupplierId: cliente.id, clientSupplierName: cliente.name,
      items: [{
        productId: produto ? produto.id : '', name: produto ? produto.name : 'Item de teste',
        sku: produto ? produto.sku : 'SKU-TESTE', quantity: p.qtd, unitPrice: p.preco, total: bruto
      }],
      itemsTotal: bruto, totalAmount: bruto,
      note: 'PEDIDO DE TESTE — criado por scripts/semear-vendas-teste.js',
      createdByName: 'semear-vendas-teste'
    });
    check(true, `#${p.code}  ${p.date}  ${vendedor.name.padEnd(18).slice(0, 18)}  ${cliente.name.padEnd(24).slice(0, 24)}  ${brl(bruto).padStart(13)}`, p.status);
  }

  // ------------------------------------------------------------------------
  console.log('\n--- 5. conferindo pelo mesmo caminho que a tela usa ---');
  // Nao adianta conferir a linha no banco: o que interessa e' o que a funcao do
  // painel devolve para CADA usuario, que e' o que a tela vai desenhar.
  const escopoLib = require('../lib/relatorios-escopo');
  const painelLib = require('../lib/painel-pessoal-vendas');
  const registros = (await db.getOrders()).map((o) => ({
    id: o.id, type: 'order', code: o.code, customer: o.clientSupplierName,
    sellerId: o.sellerId, status: o.status, date: o.date, amount: o.totalAmount,
    nfeId: o.nfeId || '', nfeNumero: ''
  }));
  const painelDe = (sellerId) => painelLib.montarPainel({
    registros, escopo: escopoLib.escopoPessoal({ id: 'x', active: true, sellerId })
  });

  const resumo = VENDEDORES.map((vendedor) => {
    const visao = painelDe(vendedor.id);
    const meus = PEDIDOS.filter((p) => VENDEDORES[p.vendedor].id === vendedor.id);
    const ativos = meus.filter((p) => p.status !== 'pedido-cancelado');
    const esperado = Math.round(ativos.reduce((s, p) => s + p.qtd * p.preco, 0) * 100) / 100;

    console.log(`\n  ${vendedor.name}`);
    check(visao.vendas.length === meus.length, `  ${meus.length} vendas na tabela`, String(visao.vendas.length));
    check(visao.indicadores.pedidos === ativos.length, '  o cancelado ficou fora da contagem',
      `${visao.indicadores.pedidos} pedidos`);
    check(Math.abs(visao.indicadores.valorTotal - esperado) < 0.01, '  total vendido',
      brl(visao.indicadores.valorTotal));
    check(visao.indicadores.semNota === ativos.length, '  todos ainda sem NF-e',
      `${visao.indicadores.semNota} sem nota`);

    // O CHECK QUE DA' SENTIDO AO CENARIO: nenhum pedido do outro apareceu.
    const dosOutros = PEDIDOS.filter((p) => VENDEDORES[p.vendedor].id !== vendedor.id).map((p) => String(p.code));
    const vazou = visao.vendas.map((v) => String(v.pedido)).filter((c) => dosOutros.includes(c));
    check(vazou.length === 0, '  NENHUMA venda do outro vendedor apareceu',
      vazou.length ? `VAZOU: ${vazou.join(', ')}` : `${dosOutros.length} pedidos do outro ficaram de fora`);

    return { vendedor, visao };
  });

  // ------------------------------------------------------------------------
  console.log('\n\n==================== ACESSO PARA TESTAR ====================\n');
  const vendedoraComLogin = VENDEDORES.find((v) => v.login);
  console.log(`  ADMINISTRADOR   usuario: ${admin.username}`);
  console.log(`                  vendedor vinculado: ${VENDEDORES[0].name}`);
  console.log(`                  no Meu Painel ve so' as vendas dele; no Painel`);
  console.log(`                  Vendedor e no Relatorio, ve todos.\n`);
  console.log(`  VENDEDORA       usuario: ${vendedoraComLogin.login.username}`);
  console.log(`                  senha:   ${SENHA_VENDEDORA}`);
  console.log(`                  vendedor vinculado: ${vendedoraComLogin.name}`);
  console.log(`                  ve so' as vendas dela, em qualquer tela.\n`);
  resumo.forEach(({ vendedor, visao }) => {
    console.log(`  ${vendedor.name.padEnd(20)} ${String(visao.indicadores.pedidos).padStart(2)} pedidos  ${brl(visao.indicadores.valorTotal).padStart(13)}  ticket ${brl(visao.indicadores.ticketMedio)}`);
  });
  console.log('\n  A senha e sorteada a cada execucao. Para fixar uma sua:');
  console.log('    node scripts/semear-vendas-teste.js --senha SUA-SENHA-AQUI');
  console.log('\n  Para apagar tudo depois (pedidos, pessoas e o login criado):');
  console.log('    npm run semear-vendas:limpar');
  console.log('\n============================================================');
  console.log(`\n===== ${falhas === 0 ? 'DADO DE TESTE NO AR' : falhas + ' FALHA(S)'} =====`);
  console.log('    Saia e entre de novo no sistema: a sessao aberta ainda nao conhece o vinculo.\n');
  process.exit(falhas ? 1 : 0);
})().catch((erro) => {
  console.error('\nXX  parou no meio:', erro.message);
  console.error('    Rode com --limpar para remover o que ficou.\n');
  process.exit(1);
});
