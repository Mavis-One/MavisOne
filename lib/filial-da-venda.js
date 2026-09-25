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

function daFilial(registro, filial) {
  const alvo = chaveDaFilial(filial);
  if (!alvo) return true;
  return chaveDaFilial(filialDaCategoria(registro.category)) === alvo;
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

module.exports = { filialDaCategoria, chaveDaFilial, daFilial, listarFiliais };
