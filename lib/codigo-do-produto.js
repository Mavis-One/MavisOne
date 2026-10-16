// O CÓDIGO DO PRODUTO NOVO SAI DA SEQUÊNCIA (16/10/2026). Pedido do usuário:
// "verifique os códigos dos produtos para gerar códigos automáticos de acordo
// com a sequência".
//
// Até aqui o código era digitado à mão no cadastro, e a entrada de nota usava
// o código do FORNECEDOR. Os códigos do catálogo são os do Viper, numéricos e
// em sequência (em 16/10/2026 o último era 101297), com alguns soltos bem
// acima dela (108442, 902534: código de fornecedor digitado como código). Por
// isso "o maior + 1" não serve: daria 902535 e a sequência pularia para lá.
//
// O FIM DA SEQUÊNCIA é o maior código numérico que tem vizinhos logo abaixo
// dele (pelo menos MINIMO_NA_JANELA dos JANELA números anteriores existem). Um
// código solto não tem vizinhos e fica de fora. Sem nenhuma sequência ainda
// (catálogo pequeno), vale o maior. O próximo é o fim + 1, pulando o que já
// existe (quando a sequência alcançar 108442, ela segue para 108443).
'use strict';

const JANELA = 20;
const MINIMO_NA_JANELA = 3;

const numeroDoCodigo = (sku) => {
  const texto = String(sku ?? '').trim();
  return /^\d{1,15}$/.test(texto) ? Number(texto) : null;
};

/** O próximo código da sequência, como texto. `skus` = todos os códigos do catálogo. */
function proximoCodigo(skus) {
  const textos = new Set();
  const numeros = new Set();
  for (const sku of skus || []) {
    const texto = String(sku ?? '').trim().toLowerCase();
    if (texto) textos.add(texto);
    const numero = numeroDoCodigo(sku);
    if (numero !== null) numeros.add(numero);
  }
  const doMaior = [...numeros].sort((a, b) => b - a);
  let fim = null;
  for (const numero of doMaior) {
    let vizinhos = 0;
    for (let k = 1; k <= JANELA && vizinhos < MINIMO_NA_JANELA; k += 1) {
      if (numeros.has(numero - k)) vizinhos += 1;
    }
    if (vizinhos >= MINIMO_NA_JANELA) {
      fim = numero;
      break;
    }
  }
  if (fim === null) fim = doMaior.length ? doMaior[0] : 0;
  let proximo = fim + 1;
  while (numeros.has(proximo) || textos.has(String(proximo))) proximo += 1;
  return String(proximo);
}

// UM CÓDIGO POR VEZ. Dois cadastros ao mesmo tempo leriam o mesmo "próximo" e
// gravariam o mesmo código (products.sku não tem índice único: a repetição é
// barrada na rota). O servidor roda num processo só (PM2 em fork, 1
// instância), então uma fila na memória basta: quem pega a vez lê o próximo,
// grava o produto e só então libera.
let fila = Promise.resolve();
function umPorVez(tarefa) {
  const vez = fila.then(() => tarefa());
  fila = vez.catch(() => {});
  return vez;
}

module.exports = { JANELA, MINIMO_NA_JANELA, proximoCodigo, umPorVez };
