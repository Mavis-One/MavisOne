#!/usr/bin/env node
// CONTAR NÃO É CARREGAR (fase CJ).
//
// A tela de Configurações levava 1 s para devolver 2 KB. O motivo não era o
// dado que ela manda — era o que ela pedia ao banco para poder contar: as
// coleções INTEIRAS, para usar `.length` delas. Medido neste banco:
//
//     getOrders() .......... 496 ms   14.864 itens   27,3 MB de JSON
//     getProducts() ......... 56 ms    5.475 itens    1,9 MB
//
// Cerca de 30 MB de memória por requisição para escrever cinco números em cinco
// cartões. O conserto foi na primitiva, e não em cada rota: o construtor de
// consultas passou a aceitar `head: true`, que faz o count(*) SEM a consulta
// de dados — é o que o supabase-js sempre fez e esta camada não tinha.
//
// O QUE ESTE TESTE PROTEGE, em ordem de estrago:
//
//   1. head:true NÃO PODE DISPARAR A CONSULTA DE DADOS. Se disparar, a opção
//      vira enfeite: o custo volta inteiro e ninguém percebe, porque a resposta
//      continua certa. É o tipo de regressão que só aparece no relógio.
//
//   2. ESCRITA SEM select() TEM DE CONTINUAR EXECUTANDO. O mesmo `if` que pula
//      a consulta em head é o que decide se um delete roda. Trocar a condição
//      por engano faria 34 deletes e 25 inserts do sistema pararem de escrever
//      e devolverem sucesso — o pior resultado possível.
//
//   3. Contar produto tem de dar o MESMO número que a lista mostra. `escritural`
//      não é coluna, e a coluna de onde ele sai é nullable: um `neq` perderia as
//      linhas nulas, que o filtro em JavaScript inclui.
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const ler = (p) => fs.readFileSync(path.join(RAIZ, p), 'utf8').replace(/\r\n/g, '\n');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};

function dublar(caminho, exports) {
  const resolvido = require.resolve(caminho);
  require.cache[resolvido] = { id: resolvido, filename: resolvido, loaded: true, children: [], paths: [], exports };
}

// Grava QUAIS consultas saíram. É a única coisa que este teste precisa saber:
// não interessa o que o banco responderia, e sim quantas vezes ele foi
// incomodado e com qual comando.
let disparadas = [];
dublar('../lib/db/conexao', {
  consultar: async (texto) => {
    disparadas.push(String(texto).replace(/\s+/g, ' ').trim());
    return { rows: [{ total: 42 }] };
  }
});
// Catálogo de mentira com os fatos que o montador consulta.
dublar('../lib/db/catalogo', {
  obterCatalogo: async () => ({}),
  ehColunaJson: () => false,
  chavePrimaria: () => 'id',
  ligacao: () => null
});

const { Consulta } = require('../lib/db/consulta');
const nova = (tabela) => new Consulta(tabela);
const reset = () => { disparadas = []; };

(async () => {
  console.log('--- head: true dispara UMA consulta, e ela é o count ---');
  reset();
  const r = await nova('orders').select('*', { count: 'exact', head: true });
  check('saiu uma consulta só', disparadas.length === 1, String(disparadas.length));
  check('e ela é um count(*)', /^select count\(\*\)/.test(disparadas[0] || ''), (disparadas[0] || '').slice(0, 40));
  // O regex casa o SQL REAL (`select "t".* from ...`). A primeira versão deste
  // teste procurava `select * from` e passava por engano: nunca casava, então o
  // "não saiu consulta de dados" era verdadeiro por construção, e teria
  // continuado verdadeiro mesmo se a consulta saísse.
  check('nenhuma consulta de dados saiu', !disparadas.some((s) => /^select "t"\.\* from/.test(s)));
  check('devolve a contagem', r.count === 42, String(r.count));
  check('e data vem null — não há linhas para devolver', r.data === null);

  console.log('\n--- sem head, as DUAS saem (é o custo que a opção evita) ---');
  reset();
  await nova('orders').select('*', { count: 'exact' });
  check('saíram duas consultas', disparadas.length === 2, String(disparadas.length));
  check('uma de dados', disparadas.some((s) => /^select "t"\.\* from/.test(s)));
  check('e uma de contagem', disparadas.some((s) => /^select count\(\*\)/.test(s)));

  console.log('\n--- o filtro viaja para o count ---');
  reset();
  await nova('purchases').select('*', { count: 'exact', head: true }).neq('status', 'cancelada');
  check('o count leva o where', /where/i.test(disparadas[0] || ''), disparadas[0]);

  console.log('\n--- head sem count é recusado, não silenciosamente inútil ---');
  let erro = null;
  try {
    nova('orders').select('*', { head: true });
  } catch (e) {
    erro = e;
  }
  check('estoura', Boolean(erro));
  check('e a mensagem diz o que fazer', erro && /count: 'exact'/.test(erro.message), erro && erro.message.slice(0, 50));

  console.log('\n--- A ESCRITA NÃO PODE PARAR DE ESCREVER ---');
  // O mesmo `if` que pula a consulta em head decide se o delete roda.
  reset();
  const apagou = await nova('orders').delete().eq('id', 'x');
  check('delete sem select() executa', disparadas.some((s) => /^delete from/.test(s)), (disparadas[0] || '').slice(0, 30));
  check('  e devolve data null, como sempre devolveu', apagou.data === null);
  reset();
  await nova('orders').insert({ id: 'x' });
  check('insert sem select() executa', disparadas.some((s) => /^insert into/.test(s)));
  reset();
  const comRetorno = await nova('orders').insert({ id: 'x' }).select();
  check('insert com select() executa e devolve linhas', Array.isArray(comRetorno.data));

  console.log('\n--- as rotas contam em vez de carregar ---');
  const servidor = ler('server.js');
  const blocoSettings = servidor.slice(
    servidor.indexOf("if (pathname === '/api/settings' && req.method === 'GET')"),
    servidor.indexOf("if (pathname === '/api/settings' && req.method === 'POST')")
  );
  check('Configurações usa contarOrders', /db\.contarOrders\(\)/.test(blocoSettings));
  check('  contarProducts', /db\.contarProducts\(\)/.test(blocoSettings));
  check('  contarPurchasesAtivas', /db\.contarPurchasesAtivas\(\)/.test(blocoSettings));
  check('  contarFinancialEntries', /db\.contarFinancialEntries\(\)/.test(blocoSettings));
  check('  e NÃO chama mais getProducts/getOrders para contar',
    !/db\.getProducts\(\)/.test(blocoSettings) && !/syncSalesData\(data\)/.test(blocoSettings));
  check('  nem os syncs que só serviam para o .length',
    !/syncPurchasesData\(data\)/.test(blocoSettings) && !/syncFinanceData\(data\)/.test(blocoSettings));
  // Este sobrou porque getSellersDirectory lê a coleção de verdade.
  check('  mas o de cadastros fica: a lista de vendedores precisa das linhas',
    /syncCadastroData\(data\)/.test(blocoSettings));

  console.log('\n--- o diretório da lista de Vendas vai só com id e nome ---');
  check('a meta da lista corta os dez campos para dois',
    /directory: getCadastroDirectory\(data\)\.map\(\(c\) => \(\{ id: c\.id, name: c\.name \}\)\)/.test(servidor));
  // O corte é no ponto de uso. A função inteira serve o formulário do pedido,
  // que precisa de endereço e documento para preencher entrega e nota.
  check('  sem mexer na função, que outros usam inteira',
    /function getCadastroDirectory\(data\) \{\s*\n\s*return indiceDoCadastro\(data\)\.lista;/.test(servidor));

  console.log('\n--- contar produto concorda com listar produto ---');
  const estoque = ler('lib/db/estoque.js');
  check('são duas contagens, e não um neq que perderia os nulos',
    /const \{ count: escriturais[\s\S]{0,200}\.eq\('tipo_produto_fiscal', 'ESCRITURAL'\)/.test(estoque));
  check('  o resultado é total menos escriturais',
    /return \(total \|\| 0\) - \(escriturais \|\| 0\);/.test(estoque));

  console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TODOS OS CHECKS PASSARAM =====');
  process.exit(falhas ? 1 : 0);
})().catch((erro) => {
  console.error('O teste quebrou:', erro);
  process.exit(1);
});
