/**
 * A FILIAL DE UMA VENDA — lida da CATEGORIA, e por que dali.
 *
 * O campo certo seria `orders.company_id`, e ele está VAZIO nos 14.864 pedidos
 * e nos 78 orçamentos desta base (medido em 25/09/2026, junto com
 * `deposit_id`). A filial só existe num lugar: o fim da categoria.
 *
 *   "Venda de Materiais e Serviços / Araquari"          -> Araquari
 *   "Venda de Materiais e Serviços / Joinville Centro"  -> Joinville Centro
 *   "Venda de Materiais e Serviços / Assistência"       -> Assistência
 *
 * Todos os sufixos são filiais — Assistência, Electric, Plus, Marcolla e Kaccau
 * inclusive (confirmado pelo usuário). Por isso a lista não é escrita aqui: ela
 * sai dos próprios pedidos, e uma loja nova aparece no filtro sozinha.
 *
 * SEM "/", SEM FILIAL. "Transferencia entre Filiais", "Remessa", "Garantia" e a
 * categoria vazia não dizem de onde saíram, e chutar uma loja para eles
 * inflaria a filial chutada. Esses pedidos continuam no "Todas as filiais" e em
 * nenhuma outra.
 *
 * O dia em que `company_id` for preenchido, é esta função que muda — a rota e a
 * tela só conhecem "a filial desta venda".
 */

/** O texto depois da ÚLTIMA barra, aparado. '' quando não há filial. */
function filialDaCategoria(categoria) {
  const texto = String(categoria || '');
  const barra = texto.lastIndexOf('/');
  if (barra < 0) return '';
  return texto.slice(barra + 1).replace(/\s+/g, ' ').trim();
}

/**
 * Chave de comparação: sem acento, sem caixa, sem espaço duplo.
 *
 * A categoria é digitada à mão no sistema de origem — "Timbo" hoje pode ser
 * "Timbó" amanhã, e as duas são a mesma loja. Sem isto o filtro mostraria duas
 * Timbós com metade das vendas cada.
 */
function chaveDaFilial(nome) {
  return String(nome || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * DUAS GRAFIAS SAO A MESMA FILIAL. O comparador canonico.
 *
 * Estava escrito a mao em server.js -- `(a, b) => chaveDaFilial(a) === chaveDaFilial(b)`
 * num lugar, e o DEFAULT de `metasDoRecorte` (`a === b`, sem chave) no outro.
 * O segundo compara cru: uma meta cadastrada em "Timbó" nao casaria com a
 * filial "Timbo" dos pedidos, e a tela mostraria "sem meta" para uma filial
 * que tem meta. Com um dono so, os dois lados concordam por construcao.
 */
function mesmaFilial(a, b) {
  return chaveDaFilial(a) === chaveDaFilial(b);
}

function daFilial(registro, filial) {
  const alvo = chaveDaFilial(filial);
  if (!alvo) return true;
  return chaveDaFilial(filialDaCategoria(registro.category)) === alvo;
}

/**
 * MOVIMENTAÇÃO INTERNA: o pedido existe, e não é venda.
 *
 * O QUE MEDIU A DECISÃO, em 30/09/2026
 * ------------------------------------
 * A linha "Pedidos" do Fluxo de Vendas somava TODO pedido não cancelado, e
 * nisso entrava a transferência entre filiais:
 *
 *   linha "Pedidos" de 2026 ......... R$ 23.254.202,00
 *   -- transferência entre filiais .. R$  8.778.283,24   37,7%
 *
 * Trinta e sete por cento da linha era mercadoria andando de uma loja para
 * outra. É por isso que "Pedidos" ficava tão acima de "Faturado" no gráfico: as
 * duas linhas não mediam a mesma coisa, e nada na tela dizia isso.
 *
 * O "Faturado" já estava certo, por acidente e não por regra: transferência usa
 * o status `pedido-aprovado-sem-faturamento`, que `geraFinanceiro` recusa. Mas o
 * status NÃO identifica transferência — 35 vendas de verdade (R$ 899 mil) usam o
 * mesmo status. Por isso a regra é da CATEGORIA, e não do status.
 *
 * POR QUE PELO TEXTO DA CATEGORIA
 * -------------------------------
 * Porque não há outro lugar. `orders` tem uma coluna sobre isto: `category`,
 * texto. `sales_categories` existe e tem 0 linhas. `lib/operacaoFiscal.js` tem o
 * catálogo com `TRANSFERENCIA` e `geraFinanceiro: false`, e nada em `orders`
 * aponta para ele.
 *
 * Ler o texto é o que este arquivo já faz para descobrir a filial, então não é
 * um mecanismo novo — é o mesmo, aplicado à outra metade da mesma string. O dia
 * em que a operação for uma coluna, são estas duas funções que mudam.
 *
 * DUAS OPERAÇÕES, E NÃO QUATRO. Entram transferência e remessa. Ficam de fora,
 * de propósito, as que a medição mostrou pequenas e de natureza discutível:
 * "DOAÇÕES E BRINDES" (R$ 25.950 em 2026) e "Garantia" (R$ 8.665) — as duas
 * saem mercadoria de verdade para fora da empresa, e somam 0,15% da linha.
 * Recortar o que não muda o desenho só aumenta a chance de recortar errado.
 */
const MOVIMENTACAO_INTERNA = [
  // "Transferencia entre Filiais", e também "Transferência" com acento: a
  // categoria é digitada à mão no sistema de origem, e as duas grafias
  // aparecem. Casa pelo radical, sem acento, pelo mesmo motivo de
  // `chaveDaFilial`.
  /transfer/,
  /remessa/
];

/**
 * Este pedido é movimentação interna?
 *
 * Compara sobre a chave (sem acento, sem caixa) para "Remessa", "remessa" e
 * "REMESSA" serem a mesma coisa — a categoria vem digitada à mão.
 */
function ehMovimentacaoInterna(categoria) {
  const chave = chaveDaFilial(categoria);
  if (!chave) return false;
  return MOVIMENTACAO_INTERNA.some((re) => re.test(chave));
}

/** O contrário, para ler no filtro sem negação: `lista.filter(ehVenda)`. */
function ehVenda(registro) {
  return !ehMovimentacaoInterna(registro && registro.category);
}

/**
 * As filiais que aparecem nos registros, com quantos pedidos cada uma tem.
 *
 * O nome exibido é o da grafia MAIS usada para aquela chave — se 240 pedidos
 * dizem "Timbo" e 5 dizem "Timbó", a lista mostra "Timbo". Ordenada por nome.
 */
function listarFiliais(registros) {
  const porChave = new Map();
  for (const r of (registros || [])) {
    const nome = filialDaCategoria(r.category);
    if (!nome) continue;
    const chave = chaveDaFilial(nome);
    const item = porChave.get(chave) || { total: 0, grafias: new Map() };
    item.total += 1;
    item.grafias.set(nome, (item.grafias.get(nome) || 0) + 1);
    porChave.set(chave, item);
  }
  return [...porChave.values()]
    .map((item) => ({
      nome: [...item.grafias.entries()].sort((a, b) => b[1] - a[1])[0][0],
      pedidos: item.total
    }))
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}

module.exports = {
  filialDaCategoria, chaveDaFilial, mesmaFilial, daFilial, listarFiliais,
  ehMovimentacaoInterna, ehVenda, MOVIMENTACAO_INTERNA
};
