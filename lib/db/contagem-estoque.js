/**
 * CONTAGEM DE ESTOQUE (fase CU).
 *
 * A folha de contagem por depósito. Enquanto está `aberta` não toca em saldo
 * nenhum: é uma lista de leituras. Ao FECHAR, cada item vira um movimento de
 * ajuste — e é o fechamento que faz dela a carga inicial (VM-EST-08) e o
 * inventário cíclico (VM-EST-04) ao mesmo tempo. Ver banco/migrations/fase-cu.
 *
 * O QUE ESTE MÓDULO NÃO FAZ
 * -------------------------
 * Não mexe em `stock_movements` nem em `products.stock_quantity`. Quem mexe é
 * `commitStockMovements`, em server.js, que é o ponto único por onde TODA
 * movimentação do sistema passa — venda, compra, transferência, PCP, nota de
 * entrada, estorno. Este arquivo monta o documento e devolve os números; a
 * gravação do saldo continua com um dono só.
 *
 * `atualizarFechamento` e `marcarItensFechados` recebem o `cliente` da
 * transação de quem chamou, e não abrem a sua: o fechamento da contagem tem de
 * acontecer no MESMO instante dos movimentos que ela gera. Fora da transação,
 * um processo morto no meio deixaria a contagem dizendo "fechada" com o estoque
 * intacto — ou o contrário, que é pior: o ajuste aplicado numa contagem que
 * ainda se oferece para ser fechada de novo, dobrando o saldo no segundo clique.
 */
const { consultar } = require('./conexao');

const STATUS = ['aberta', 'fechada', 'cancelada'];

/** A coluna `date` volta como Date do driver; o sistema compara 'YYYY-MM-DD'. */
function data(valor) {
  if (valor instanceof Date) return valor.toISOString().slice(0, 10);
  return String(valor || '');
}

function instante(valor) {
  if (valor instanceof Date) return valor.toISOString();
  return valor ? String(valor) : '';
}

function mapContagem(row) {
  return {
    id: row.id,
    code: row.code,
    date: data(row.date),
    depositId: row.deposit_id || '',
    status: row.status,
    note: row.note || '',
    closedAt: instante(row.closed_at),
    closedBy: row.closed_by || '',
    closedByName: row.closed_by_name || '',
    cancelReason: row.cancel_reason || '',
    createdBy: row.created_by || '',
    createdByName: row.created_by_name || '',
    createdAt: instante(row.created_at),
    // Vêm do agregado quando a consulta os traz (a listagem), e ficam em 0 na
    // leitura de um registro só — que carrega os itens de verdade.
    itens: row.itens === undefined ? 0 : Number(row.itens),
    divergentes: row.divergentes === undefined ? 0 : Number(row.divergentes)
  };
}

function mapItem(row) {
  return {
    id: row.id,
    countId: row.count_id,
    productId: row.product_id,
    productName: row.product_name || '',
    classId: row.class_id || '',
    classValueId: row.class_value_id || '',
    // numeric volta como string no driver (para não perder precisão); aqui vira
    // número porque é com ele que a aritmética do ajuste é feita.
    countedQuantity: Number(row.counted_quantity),
    expectedQuantity: Number(row.expected_quantity),
    adjustment: Number(row.adjustment),
    movementId: row.movement_id || '',
    note: row.note || '',
    countedBy: row.counted_by || '',
    countedByName: row.counted_by_name || '',
    createdAt: instante(row.created_at)
  };
}

/**
 * A LISTAGEM TRAZ OS AGREGADOS DO BANCO, e não a folha inteira.
 *
 * Uma contagem de galpão tem milhares de itens. Trazê-los para contar quantos
 * são e quantos divergem — que é tudo o que a lista mostra — carregaria a
 * contagem inteira de cada linha da tela. O `left join lateral` responde as duas
 * perguntas em uma consulta, sem trazer um item.
 *
 * "Divergente" é `counted <> expected`: o que o sistema errou. É a medida de
 * acuracidade que o VM-EST-04 pede, e não `adjustment <> 0`, que só existe
 * depois do fechamento.
 */
async function listar({ status = '', depositoId = '' } = {}) {
  const filtros = [];
  const parametros = [];
  if (status) {
    parametros.push(status);
    filtros.push(`c.status = $${parametros.length}`);
  }
  if (depositoId) {
    parametros.push(depositoId);
    filtros.push(`c.deposit_id = $${parametros.length}`);
  }
  const onde = filtros.length ? `where ${filtros.join(' and ')}` : '';
  const { rows } = await consultar(
    `select c.*, coalesce(a.itens, 0) as itens, coalesce(a.divergentes, 0) as divergentes
       from stock_counts c
       left join lateral (
         select count(*)::int as itens,
                count(*) filter (where i.counted_quantity <> i.expected_quantity)::int as divergentes
           from stock_count_items i
          where i.count_id = c.id
       ) a on true
      ${onde}
      order by c.created_at desc, c.code desc`,
    parametros
  );
  return rows.map(mapContagem);
}

async function buscar(id) {
  const { rows } = await consultar('select * from stock_counts where id = $1', [String(id || '')]);
  return rows.length ? mapContagem(rows[0]) : null;
}

async function itensDaContagem(countId) {
  const { rows } = await consultar(
    'select * from stock_count_items where count_id = $1 order by product_name asc, created_at asc',
    [String(countId || '')]
  );
  return rows.map(mapItem);
}

async function criar(contagem) {
  const { rows } = await consultar(
    `insert into stock_counts
       (id, code, date, deposit_id, status, note, created_by, created_by_name)
     values ($1, $2, $3, $4, 'aberta', $5, $6, $7)
     returning *`,
    [
      contagem.id, contagem.code, contagem.date, contagem.depositId,
      contagem.note || '', contagem.createdBy || '', contagem.createdByName || ''
    ]
  );
  return mapContagem(rows[0]);
}

/**
 * RECONTAR SUBSTITUI, NÃO ACUMULA.
 *
 * O índice único (count_id, product_id, class_value_id) transforma a segunda
 * leitura do mesmo item num UPDATE. Sem isso, contar 8 e recontar 5 deixaria os
 * dois na folha e o fechamento aplicaria os dois ajustes — o saldo acabaria em
 * 5 por acidente, com um +8 fantasma no razão.
 *
 * `expected_quantity` é REGRAVADO na recontagem de propósito: ao recontar, o
 * saldo do sistema é o de agora, e é contra ele que a divergência desta leitura
 * deve ser medida.
 */
async function salvarItem(item) {
  const { rows } = await consultar(
    `insert into stock_count_items
       (id, count_id, product_id, product_name, class_id, class_value_id,
        counted_quantity, expected_quantity, note, counted_by, counted_by_name)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     on conflict (count_id, product_id, class_value_id) do update set
       counted_quantity = excluded.counted_quantity,
       expected_quantity = excluded.expected_quantity,
       product_name = excluded.product_name,
       class_id = excluded.class_id,
       note = excluded.note,
       counted_by = excluded.counted_by,
       counted_by_name = excluded.counted_by_name,
       created_at = now()
     returning *`,
    [
      item.id, item.countId, item.productId, item.productName || '',
      item.classId || '', item.classValueId || '',
      item.countedQuantity, item.expectedQuantity || 0,
      item.note || '', item.countedBy || '', item.countedByName || ''
    ]
  );
  return mapItem(rows[0]);
}

/**
 * O MESMO PRODUTO CONTADO "INTEIRO" E "POR COR" NA MESMA FOLHA SE CONTRADIZ.
 *
 * O índice único deixa passar, e com razão: `('' , 'vermelho')` são duas chaves
 * diferentes. Mas as duas leituras falam do mesmo saldo por caminhos que se
 * somam. Contar "o produto no galpão = 10" e "os vermelhos = 4" faz o
 * fechamento ajustar o total do depósito pela primeira e o balde da cor pela
 * segunda — e o total recebe as duas, terminando em algo que nenhuma das duas
 * leituras afirmou.
 *
 * Então é uma escolha por produto: ou se conta o produto, ou se contam as cores
 * dele. Devolve true quando a leitura nova briga com uma que já está na folha.
 */
async function conflitaComOutraForma(countId, productId, temCor) {
  const condicao = temCor ? "class_value_id = ''" : "class_value_id <> ''";
  const { rows } = await consultar(
    `select 1 from stock_count_items
      where count_id = $1 and product_id = $2 and ${condicao}
      limit 1`,
    [String(countId || ''), String(productId || '')]
  );
  return rows.length > 0;
}

async function apagarItem(countId, itemId) {
  const { rows } = await consultar(
    'delete from stock_count_items where count_id = $1 and id = $2 returning id',
    [String(countId || ''), String(itemId || '')]
  );
  return rows.length > 0;
}

/**
 * TRAVA A CONTAGEM E DEVOLVE O STATUS DELA, dentro da transação de quem chamou.
 *
 * É o que impede dois fechamentos simultâneos. Sem a trava, dois cliques em
 * "Fechar" leriam `aberta` os dois, gerariam os dois conjuntos de ajuste e o
 * saldo receberia o delta em dobro — e a segunda escrita do status não
 * reclamaria, porque gravar 'fechada' por cima de 'fechada' é um UPDATE válido.
 */
async function travarParaFechar(cliente, id) {
  const { rows } = await cliente.query(
    'select * from stock_counts where id = $1 for update',
    [String(id || '')]
  );
  return rows.length ? mapContagem(rows[0]) : null;
}

/**
 * SALDO DO DEPÓSITO PARA N PRODUTOS, EM UMA CONSULTA, dentro da transação.
 *
 * Existe porque `razaoEstoque.saldosPorDeposito` faz uma consulta POR PAR — o
 * que serve à venda, que move dois ou três itens, e não serve aqui: a carga
 * inicial de uma loja é uma folha de milhares de linhas, e milhares de idas ao
 * banco dentro da transação seriam milhares de latências com a trava de todos
 * os produtos na mão.
 *
 * Devolve dois mapas porque são duas perguntas:
 *   porProduto — o depósito inteiro, somando as cores (o item contado sem cor)
 *   porCor     — `produtoId|corId` (o item contado por cor)
 *
 * Chamada DEPOIS de os movimentos entrarem, ela responde à única pergunta que
 * fecha a contagem com honestidade: o saldo ficou sendo exatamente o contado?
 */
async function saldosDoDeposito(cliente, depositoId, produtoIds) {
  const porProduto = new Map();
  const porCor = new Map();
  const ids = [...new Set(produtoIds.filter(Boolean))];
  if (!ids.length) return { porProduto, porCor };
  const { rows } = await cliente.query(
    `select product_id, class_value_id,
            coalesce(sum(case when type = 'saida' then -quantity else quantity end), 0) as saldo
       from stock_movements
      where deposit_id = $1 and product_id = any($2)
      group by product_id, class_value_id`,
    [String(depositoId || ''), ids]
  );
  for (const row of rows) {
    const saldo = Number(row.saldo);
    porProduto.set(row.product_id, (porProduto.get(row.product_id) || 0) + saldo);
    if (row.class_value_id) porCor.set(`${row.product_id}|${row.class_value_id}`, saldo);
  }
  return { porProduto, porCor };
}

async function atualizarFechamento(cliente, id, { closedBy, closedByName }) {
  await cliente.query(
    `update stock_counts
        set status = 'fechada', closed_at = now(), closed_by = $2, closed_by_name = $3
      where id = $1`,
    [String(id || ''), closedBy || '', closedByName || '']
  );
}

/**
 * Grava, por item, o ajuste aplicado e o movimento que o aplicou.
 *
 * Um UPDATE com `from (values ...)` em vez de N updates: uma contagem de galpão
 * tem milhares de itens, e milhares de idas ao banco dentro da transação são
 * milhares de latências com a trava dos produtos na mão.
 */
async function marcarItensFechados(cliente, ajustes) {
  if (!ajustes.length) return;
  const valores = [];
  const grupos = ajustes.map((a, i) => {
    valores.push(a.itemId, a.adjustment, a.movementId || '');
    return `($${i * 3 + 1}, $${i * 3 + 2}::numeric, $${i * 3 + 3})`;
  });
  await cliente.query(
    `update stock_count_items as i
        set adjustment = v.adjustment, movement_id = v.movement_id
       from (values ${grupos.join(', ')}) as v(id, adjustment, movement_id)
      where i.id = v.id`,
    valores
  );
}

async function cancelar(id, motivo) {
  const { rows } = await consultar(
    `update stock_counts
        set status = 'cancelada', cancel_reason = $2
      where id = $1 and status = 'aberta'
      returning *`,
    [String(id || ''), String(motivo || '')]
  );
  return rows.length ? mapContagem(rows[0]) : null;
}

/** Quantas contagens ABERTAS existem neste depósito. Ver o uso em server.js. */
async function abertasNoDeposito(depositoId) {
  const { rows } = await consultar(
    "select count(*)::int as n from stock_counts where deposit_id = $1 and status = 'aberta'",
    [String(depositoId || '')]
  );
  return rows[0].n;
}

/**
 * Quantas contagens existem neste depósito, de qualquer status.
 *
 * Serve à guarda de exclusão de depósito. Ela já contava as MOVIMENTAÇÕES, o
 * que pega toda contagem fechada (fechada gera movimento) — mas não a ABERTA,
 * que ainda não gerou nada. Excluir o depósito nesse instante deixaria a folha
 * apontando para um lugar que não existe, e a contagem abriria dizendo
 * "depósito " em branco.
 */
async function contarPorDeposito(depositoId) {
  const { rows } = await consultar(
    'select count(*)::int as n from stock_counts where deposit_id = $1',
    [String(depositoId || '')]
  );
  return rows[0].n;
}

module.exports = {
  STATUS,
  listar, buscar, itensDaContagem,
  criar, salvarItem, apagarItem, conflitaComOutraForma,
  travarParaFechar, saldosDoDeposito, atualizarFechamento, marcarItensFechados, cancelar,
  abertasNoDeposito, contarPorDeposito,
  mapContagem, mapItem
};
