// O CUSTO DO PRODUTO SÓ PARA ADMINISTRADOR (14/10/2026).
//
// Pedido do usuário, urgente: "nenhum usuário comum pode ter acesso ao preço
// de custo de um produto conforme pesquisam". O bloqueio é no SERVIDOR: para
// quem não é administrador, o custo nem sai da API — esconder só na tela
// deixaria o número no navegador, a um F12 de distância.
//
// `semCusto` passa em TODA resposta JSON desse usuário (ver sendJson): tira as
// chaves de custo em qualquer profundidade, as colunas de custo das listas de
// colunas ({ campo: 'custo' }) e os nomes de custo das listas de totais.
// `relatorioSemCusto` faz o mesmo num resultado do motor de relatórios antes
// do CSV — e, quando o relatório tinha coluna de custo, tira também o "valor",
// que ali é saldo × custo (custo = valor ÷ saldo).
'use strict';

const CAMPOS_DE_CUSTO = new Set([
  'costPrice', 'cost_price',
  'custo', 'custoMedio', 'custoUnitario', 'custoComponente', 'custoDasSaidas', 'custoTotal',
  // Os que dão o custo de volta por conta: margem e lucro (com o preço de
  // venda ou o faturamento), valor do estoque a custo (÷ saldo) e o último
  // preço de compra do produto, que é o próprio custo.
  'medios', 'margem', 'margin', 'margemPercentual', 'lucro',
  'valorParado', 'valorEmEstoque', 'stockValue', 'ultimoPreco'
]);

const ehColunaDeCusto = (item) => item && typeof item === 'object' && !Array.isArray(item)
  && typeof item.campo === 'string' && CAMPOS_DE_CUSTO.has(item.campo);

function semCusto(valor) {
  if (Array.isArray(valor)) {
    return valor
      .filter((item) => !ehColunaDeCusto(item) && !(typeof item === 'string' && CAMPOS_DE_CUSTO.has(item)))
      .map(semCusto);
  }
  if (valor && typeof valor === 'object' && !(valor instanceof Date) && !Buffer.isBuffer(valor)) {
    const saida = {};
    for (const [chave, v] of Object.entries(valor)) {
      if (CAMPOS_DE_CUSTO.has(chave)) continue;
      saida[chave] = semCusto(v);
    }
    return saida;
  }
  return valor;
}

/** Um resultado do motor de relatórios ({ colunas, linhas, totais, ... }) sem custo. */
function relatorioSemCusto(resultado) {
  if (!resultado || !Array.isArray(resultado.colunas)) return semCusto(resultado);
  const tinhaCusto = resultado.colunas.some(ehColunaDeCusto);
  const fora = new Set(CAMPOS_DE_CUSTO);
  if (tinhaCusto) fora.add('valor');
  const tirar = (obj) => {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return obj;
    const saida = {};
    for (const [k, v] of Object.entries(obj)) if (!fora.has(k)) saida[k] = v;
    return saida;
  };
  return semCusto({
    ...resultado,
    colunas: resultado.colunas.filter((c) => !(c && fora.has(c.campo))),
    linhas: Array.isArray(resultado.linhas) ? resultado.linhas.map(tirar) : resultado.linhas,
    totais: Array.isArray(resultado.totais) ? resultado.totais.filter((t) => !fora.has(t)) : tirar(resultado.totais)
  });
}

module.exports = { CAMPOS_DE_CUSTO, semCusto, relatorioSemCusto };
