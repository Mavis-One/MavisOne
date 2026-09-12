// QUANDO UM <select> DEIXA DE SERVIR — fonte única.
//
// Com 20 opções o <select> é o melhor controle que existe: mostra todas de uma
// vez e escolher é um clique. Com 5.476 ele não se procura — rola-se até achar,
// ou digita-se as primeiras letras rápido o bastante para o navegador contar
// como uma palavra só. Medido no navegador depois da importação do ViperERP:
//
//     Cadastros > Novo cashback ....... 5.477 <option>  ·  5.542 nós no DOM
//     PCP > Nova ordem ................ 5.476 <option>
//
// A TROCA É PELO TAMANHO DA LISTA, e não por uma marcação no campo. Quem
// declara o campo não sabe quantos itens o cadastro vai ter em produção — foi
// exatamente o que aconteceu: esses campos foram escritos quando havia uma
// dúzia de produtos, e nada no código deles ficou errado. O que mudou foi o
// volume, e volume só se conhece em tempo de execução. Exigir que alguém se
// lembre de marcar o campo é garantir que o próximo cadastro grande repita o
// problema.
//
// POR QUE ISTO MORA AQUI, E NÃO DENTRO DE CADA FÁBRICA
// ---------------------------------------------------
// São três fábricas de formulário no sistema (Cadastros, Estoque e Atalhos) e
// duas delas desenham campos com lista de produto. A regra escrita duas vezes
// divergiria na primeira correção feita de um lado — e o modo de falhar é
// silencioso: o campo apareceria como busca de um lado e ninguém ligaria o
// ouvinte dele, ou o contrário. Uma função decide, e quem desenha e quem liga
// os eventos chamam a MESMA.
(function (raiz) {
  // No servidor (e nos testes) vem por require; no navegador, do global que
  // rotulo_produto.js publica. Mesmo padrão de sales_bulk_actions.js.
  //
  // Sem o require, `opcoes()` caía no nome puro quando chamada de fora do
  // navegador — o teste do rótulo passava a medir outra coisa e ficava verde
  // sem provar nada.
  const ROTULOS = (typeof module !== 'undefined' && module.exports)
    ? require('./rotulo_produto')
    : raiz.MavisRotuloProduto;

  // O corte em 200 é onde a rolagem de um <select> deixa de caber numa tela.
  const LIMITE = 200;

  function lista(def, meta) {
    return typeof def.options === 'function' ? def.options(meta) : (def.options || []);
  }

  function ehDeBusca(def, meta) {
    return def && def.type === 'select' && lista(def, meta).length > LIMITE;
  }

  // O id é derivado do nome do campo, então quem desenha e quem liga chegam ao
  // mesmo id sem combinarem nada.
  function idDoCampo(def) {
    return `campoBusca_${def.name}`;
  }

  /**
   * O rótulo leva o SKU QUANDO O ITEM TEM SKU — ou seja, quando é produto.
   *
   * 457 produtos do cadastro têm nome repetido (203 nomes, até 7 vezes cada)
   * com custos diferentes entre si. Sete linhas idênticas na lista são sete
   * chances de escolher a errada, e o erro não aparece na hora: aparece quando
   * o saldo do produto errado fica negativo, ou quando a nota do fornecedor
   * não bate com a ordem de compra.
   *
   * Nas outras listas (depósitos, categorias, setores) não há SKU e o rótulo
   * continua sendo só o nome.
   */
  function opcoes(def, meta) {
    return lista(def, meta).map((item) => ({
      value: item.id,
      label: item.sku !== undefined && ROTULOS ? ROTULOS.rotulo(item) : item.name,
      item
    }));
  }

  /**
   * Liga os ouvintes dos campos que viraram busca. Chamar DEPOIS de inserir o
   * HTML no DOM, como o resto dos handlers das fábricas.
   *
   * `attachSearchableSelect` é global (mora no app.js) e só existe em tempo de
   * execução; a guarda evita explodir num contexto sem ele.
   */
  function ligar(fields, meta) {
    if (typeof raiz.attachSearchableSelect !== 'function') return;
    (fields || []).forEach((def) => {
      if (!ehDeBusca(def, meta)) return;
      raiz.attachSearchableSelect({ id: idDoCampo(def), options: opcoes(def, meta) });
    });
  }

  const api = { LIMITE, lista, ehDeBusca, idDoCampo, opcoes, ligar };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else raiz.MavisCampoDeBusca = api;
})(typeof window !== 'undefined' ? window : globalThis);
