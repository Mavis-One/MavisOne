/**
 * O RELATÓRIO DE ESTOQUE DO VIPERERP — leitura do PDF já convertido em texto.
 *
 * POR QUE ISTO EXISTE
 * -------------------
 * A carga anterior (scripts/importar-saldo-viper.js) trazia 35 linhas
 * TRANSCRITAS À MÃO, porque os PDFs não ficavam em disco. Elas se provavam
 * pelo TOTAIS impresso, mas cobriam só a cauda do alfabeto: 1.653 de 5.653
 * linhas. Os seis arquivos chegaram, e transcrever 5.653 linhas não é opção —
 * um dígito errado viraria um produto inexistente sem nada acusando.
 *
 * Então o relatório passa a ser LIDO. Este módulo é a leitura, e ele é puro:
 * recebe o texto que o `pdftotext -table` produz e devolve linhas e totais.
 * Não conhece banco, PDF nem disco.
 *
 * O QUE TORNA ISTO CONFIÁVEL, E POR QUE NÃO É O `-layout`
 * -------------------------------------------------------
 * `pdftotext -layout` e `pdftotext -table` DISCORDAM no pareamento
 * código↔nome deste relatório: no `-layout` a coluna Código corre mais rápido
 * que a coluna Produto e as linhas saem trocadas. Quem decidiu entre os dois
 * não foi preferência, foram três provas independentes:
 *
 *   1. ARITMÉTICA POR LINHA. `saldo × custo = custoTotal` e
 *      `saldo × venda = vendaTotal` fecham em 10.298 de 10.298 linhas. Isso
 *      prova que as cinco colunas numéricas pertencem à mesma linha.
 *   2. O TOTAIS IMPRESSO. A soma das linhas lidas tem de bater com a linha
 *      TOTAIS/MÉDIA do próprio relatório, nos quatro totais. Ver
 *      `conferirTotais`: qualquer linha perdida quebra a conta.
 *   3. O DESLOCAMENTO. O cadastro deste sistema foi importado do próprio
 *      Viper, então o nome de cada código é conhecido. Medindo o casamento
 *      com a coluna Código deslocada de −3 a +3 linhas, o deslocamento ZERO
 *      casa 88% e os vizinhos 5% — se houvesse troca, um vizinho venceria.
 *
 * AS TRÊS ARMADILHAS DESTE PDF
 * ----------------------------
 * a) SALDO NEGATIVO existe (−3 numa mesa, −5 num notebook). Um regex de
 *    número sem sinal descarta essas linhas EM SILÊNCIO, e o único sintoma é
 *    o TOTAIS de saldo não fechar. Ver `NUMERO`.
 * b) A célula do nome é CENTRALIZADA VERTICALMENTE. Quando o nome ocupa duas
 *    ou três linhas, o código aparece na linha do MEIO — e os fragmentos do
 *    nome ficam acima E abaixo dele. Por isso o nome lido é um pedaço, nunca
 *    o nome inteiro, e por isso este módulo não casa produto por nome.
 * c) Em 8 linhas o nome é tão longo que EMPURRA a coluna Código para fora e o
 *    código não sai em lugar nenhum. Elas vêm em `semCodigo`, não são
 *    descartadas caladas. Nas seis vias do relatório, todas as 8 têm saldo
 *    zero — mas isso é observação, não garantia, e por isso elas são
 *    devolvidas com os valores que têm.
 *
 * O GÊNERO É ANCORADO NO RÓTULO, NÃO NOS DÍGITOS
 * ----------------------------------------------
 * Procurar `\d\d –` acha "78 HELENA-" e "30 BRANCO" dentro de nomes de
 * produto, e ainda deixa o texto do gênero colado no nome. Os rótulos são
 * sete e são fechados (`ROTULOS_GENERO`), então a âncora é o rótulo. Em nomes
 * muito longos o texto do nome COLIDE com a coluna Gênero e os caracteres das
 * duas saem intercalados (`...EletriciDs7ta–sFM1a8terial de Uso e Consumo`);
 * nesse caso o gênero fica `null`, e fica.
 *
 * O gênero é o TIPO_ITEM do registro 0200 da EFD. Este sistema não tem campo
 * para ele (`products.tipo_produto_fiscal` é outra coisa: diz se o item é
 * normal/kit/combustível para a NF-e). Ele é lido e devolvido para não se
 * perder, não porque alguma carga o use.
 */

'use strict';

// Os sete rótulos do Gênero, como o relatório os imprime. São a âncora.
const ROTULOS_GENERO = Object.freeze({
  '00': 'Mercadoria para Revenda',
  '01': 'Matéria-Prima',
  '02': 'Embalagem',
  '03': 'Produto em Processo',
  '04': 'Produto Acabado',
  '05': 'Subproduto',
  '06': 'Produto Intermediário',
  '07': 'Material de Uso e Consumo',
  '08': 'Ativo Imobilizado',
  '09': 'Serviços',
  '10': 'Outros insumos',
  '99': 'Outras',
});

// O relatório separa as palavras do rótulo com um ou mais espaços -- às vezes
// dois, quando a coluna está larga. O travessão pode ser "–" ou "-".
const REGEX_GENERO = new RegExp(
  '(\\d\\d)\\s*[\u2013-]\\s*(' +
  Object.values(ROTULOS_GENERO)
    .map((r) => r.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+'))
    .join('|') +
  ')',
);

// ARMADILHA (a): o sinal. Sem ele a linha de saldo negativo é descartada.
const NUMERO = '-?[\\d.]+,\\d\\d';
const CINCO_NUMEROS = new RegExp(
  `\\s(${NUMERO})\\s+(${NUMERO})\\s+(${NUMERO})\\s+(${NUMERO})\\s+(${NUMERO})\\s*$`,
);
const CODIGO_NO_INICIO = /^\s*(\d+)\s/;

// Linhas de moldura que o pdftotext repete em cada página.
const MOLDURA = [
  /^\s*Código\s+Produto/,
  /^\s*Estoque\s*$/,
  /Geração do Relatório/,
  /Filtros aplicados/,
];

/** "1.234,56" e "-3,00" viram número. Formato pt-BR, ponto é milhar. */
function paraNumero(texto) {
  return Number(String(texto).trim().replace(/\./g, '').replace(',', '.'));
}

/** Separa nome e gênero do trecho que sobra entre o código e os números. */
function separarNomeEGenero(trecho) {
  const m = trecho.match(REGEX_GENERO);
  if (!m) return { nome: trecho.trim().replace(/\s+/g, ' '), genero: null, generoTexto: null };
  return {
    nome: trecho.slice(0, m.index).trim().replace(/\s+/g, ' '),
    genero: m[1],
    generoTexto: ROTULOS_GENERO[m[1]] || null,
  };
}

/**
 * Lê uma via do relatório.
 *
 * Devolve `{ totais, linhas, semCodigo, moldura, continuacoes }`. `totais` é
 * a linha TOTAIS/MÉDIA do próprio relatório, ou `null` se ela não aparecer.
 * `continuacoes` são os fragmentos de nome -- não se sabe a que linha cada um
 * pertence (armadilha b), então vêm apenas contados.
 */
function parseRelatorio(texto, arquivo = null) {
  const linhas = [];
  const semCodigo = [];
  const continuacoes = [];
  let totais = null;
  let moldura = 0;

  // O NOME QUE CONTINUA NA LINHA SEGUINTE. Os fragmentos que aparecem DEPOIS da
  // linha de dados, até a próxima linha de dados ou o cabeçalho da página
  // seguinte, pertencem a ela: "ABRACADEIRA PLASTICA COR PRETA, TAMANHO" +
  // "5MM x 300MM". Sem isso o nome sai cortado justamente onde está o que
  // distingue um produto do outro -- o cadastro tem a de 5MM x 400MM e a de
  // 3,6MM x 300MM, e são produtos diferentes.
  //
  // A regra se mede: colando os fragmentos, o nome lido passa a bater EXATO com
  // o nome do cadastro em 4.920 dos 5.471 produtos que casam (89,9%), contra
  // 3.795 sem colar (69,4%): 1.171 passaram a bater e 46 deixaram de bater. O
  // cadastro veio do proprio Viper, então ele é fonte independente desta regra. O que ela não alcança é o fragmento que o pdftotext põe ANTES da
  // linha do código (a célula é centralizada verticalmente, então um nome de
  // três linhas tem o código no meio) -- esse fica no fragmento da linha
  // anterior, e é por isso que `nome` continua existindo ao lado de `nomeCompleto`.
  let pendentes = [];
  let ultima = null;
  const entregarPendentes = () => {
    if (pendentes.length && ultima) {
      ultima.depois = pendentes.slice();
      ultima.nomeCompleto = [ultima.nome, ...pendentes].join(' ').replace(/\s+/g, ' ').trim();
    }
    pendentes = [];
  };
  let ordem = 0;

  for (const bruta of String(texto).split(/\r?\n/)) {
    if (!bruta.trim()) continue;
    // O cabeçalho da página é FRONTEIRA: o fragmento que vem antes dele ainda
    // é da linha anterior, mas o que vem depois já é de outra página e não pode
    // voltar para ela. Por isso `ultima` é zerada aqui.
    if (MOLDURA.some((r) => r.test(bruta))) { entregarPendentes(); ultima = null; moldura += 1; continue; }

    const numeros = bruta.match(CINCO_NUMEROS);

    if (/TOTAIS\/MÉDIA/.test(bruta)) {
      entregarPendentes();
      ultima = null;
      moldura += 1;
      if (numeros) {
        totais = {
          saldo: paraNumero(numeros[1]),
          custo: paraNumero(numeros[2]),
          custoTotal: paraNumero(numeros[3]),
          venda: paraNumero(numeros[4]),
          vendaTotal: paraNumero(numeros[5]),
        };
      }
      continue;
    }

    if (!numeros) {
      const fragmento = bruta.trim();
      continuacoes.push(fragmento);
      pendentes.push(fragmento);
      continue;
    }

    entregarPendentes();
    const antes = bruta.slice(0, bruta.length - numeros[0].length);
    const codigo = antes.match(CODIGO_NO_INICIO);
    const { nome, genero, generoTexto } = separarNomeEGenero(
      codigo ? antes.slice(codigo[0].length) : antes,
    );
    ordem += 1;
    const registro = {
      ordem,
      codigo: codigo ? codigo[1] : null,
      nome,
      nomeCompleto: nome,
      depois: [],
      genero,
      generoTexto,
      saldo: paraNumero(numeros[1]),
      custo: paraNumero(numeros[2]),
      custoTotal: paraNumero(numeros[3]),
      venda: paraNumero(numeros[4]),
      vendaTotal: paraNumero(numeros[5]),
      arquivo,
    };
    // ARMADILHA (c): sem código não é descarte, é pendência declarada.
    ultima = registro;
    if (codigo) linhas.push(registro); else semCodigo.push(registro);
  }
  entregarPendentes();

  return { totais, linhas, semCodigo, moldura, continuacoes };
}

const centavos = (n) => Math.round(n * 100) / 100;

/**
 * PROVA 1 -- a aritmética de cada linha. `saldo × custo` tem de dar
 * `custoTotal`, e `saldo × venda` tem de dar `vendaTotal`.
 *
 * O VIPER NÃO VALORIZA SALDO NEGATIVO: nas duas linhas de saldo negativo do
 * relatório (−3 e −5) ele imprime `custoTotal 0,00` e `vendaTotal 0,00` em vez
 * de −926,10 e −17.911,50. Isso é regra dele, não erro de leitura -- e o
 * TOTAIS/MÉDIA também soma zero nessas linhas, o que é o que faz a PROVA 2
 * fechar. A regra é CONFERIDA, não dispensada: se um dia vier um total
 * negativo de verdade, cai aqui.
 */
function conferirAritmetica(linhas, tolerancia = 0.05) {
  const quebras = [];
  for (const l of linhas) {
    const negativo = l.saldo < 0;
    const espCusto = negativo ? 0 : centavos(l.saldo * l.custo);
    const espVenda = negativo ? 0 : centavos(l.saldo * l.venda);
    if (Math.abs(espCusto - l.custoTotal) > tolerancia) {
      quebras.push({ codigo: l.codigo, campo: 'custoTotal', esperado: espCusto, lido: l.custoTotal, negativo });
    }
    if (Math.abs(espVenda - l.vendaTotal) > tolerancia) {
      quebras.push({ codigo: l.codigo, campo: 'vendaTotal', esperado: espVenda, lido: l.vendaTotal, negativo });
    }
  }
  return { ok: quebras.length === 0, quebras, conferidas: linhas.length };
}

/**
 * PROVA 3 -- a coluna Código é a única que não tem checksum, e ela FALHA em 6
 * das 5.653 linhas, todas na primeira via:
 *
 *   3 linhas em que o nome é tão longo que empurrou o código para fora
 *     (vêm em `semCodigo`)
 *   3 linhas em que o pdftotext REPETIU o código da linha anterior --
 *     `9915` sai em três linhas que são três produtos diferentes (TUBO
 *     POLIETILENO 3/8 a 3,79 e a 3,99), e `100682` em duas
 *
 * Nas outras cinco vias cada linha tem código único. As 6 linhas têm saldo
 * ZERO, e é por isso que a carga não se contamina -- mas isso é observação
 * desta geração do relatório, não garantia. Daí esta função: quem for gravar
 * saldo chama e para se um código duvidoso trouxer saldo.
 */
function conferirCodigos(relatorio) {
  const vezes = new Map();
  for (const l of relatorio.linhas) vezes.set(l.codigo, (vezes.get(l.codigo) || 0) + 1);
  const repetidos = [...vezes.entries()]
    .filter(([, n]) => n > 1)
    .map(([codigo, n]) => ({ codigo, vezes: n }));
  const duvidosas = relatorio.linhas
    .filter((l) => vezes.get(l.codigo) > 1)
    .concat(relatorio.semCodigo);
  const comSaldo = duvidosas.filter((l) => l.saldo !== 0);
  return {
    ok: comSaldo.length === 0,
    repetidos,
    semCodigo: relatorio.semCodigo.length,
    duvidosas: duvidosas.length,
    duvidosasComSaldo: comSaldo,
  };
}

/**
 * PROVA 2 -- o TOTAIS impresso. Soma as linhas lidas (as com código E as
 * `semCodigo`, que também são linhas do relatório) e compara com a linha
 * TOTAIS/MÉDIA. É o único jeito de saber que nenhuma linha se perdeu.
 */
function conferirTotais(relatorio, tolerancia = 0.05) {
  if (!relatorio.totais) return { ok: false, motivo: 'o relatório não traz a linha TOTAIS/MÉDIA' };
  const todas = relatorio.linhas.concat(relatorio.semCodigo);
  const soma = (campo) => centavos(todas.reduce((s, l) => s + l[campo], 0));
  const campos = ['saldo', 'custo', 'custoTotal', 'venda', 'vendaTotal'];
  const diferencas = [];
  for (const campo of campos) {
    const nosso = soma(campo);
    const dele = relatorio.totais[campo];
    if (Math.abs(nosso - dele) > tolerancia) {
      diferencas.push({ campo, relatorio: dele, lido: nosso, diferenca: centavos(nosso - dele) });
    }
  }
  return { ok: diferencas.length === 0, diferencas, linhas: todas.length };
}

/**
 * Junta as vias. Os seis arquivos NÃO são faixas disjuntas: cada um traz cerca
 * de 2.000 linhas a partir da linha pedida, então `1_ate_1000` e
 * `1001_ate_2000` compartilham 999 códigos. Somar os seis duplicaria 4.652
 * linhas -- juntar é por código, e a repetição é esperada.
 *
 * `conflitos` é o que importa: o mesmo código com VALOR diferente em duas
 * vias. Os seis PDFs saíram da mesma geração (30/09/2026 16:48), então
 * conflito nenhum é o esperado -- e se aparecer, alguma leitura está errada.
 */
function unir(relatorios) {
  const porCodigo = new Map();
  const conflitos = [];
  for (const r of relatorios) {
    for (const l of r.linhas) {
      const antes = porCodigo.get(l.codigo);
      if (!antes) { porCodigo.set(l.codigo, l); continue; }
      for (const campo of ['saldo', 'custo', 'venda']) {
        if (Math.abs(antes[campo] - l[campo]) > 0.005) {
          conflitos.push({ codigo: l.codigo, campo, a: antes[campo], b: l[campo], entre: [antes.arquivo, l.arquivo] });
        }
      }
    }
  }
  return { linhas: [...porCodigo.values()], conflitos };
}

module.exports = {
  ROTULOS_GENERO,
  REGEX_GENERO,
  paraNumero,
  separarNomeEGenero,
  parseRelatorio,
  conferirAritmetica,
  conferirTotais,
  conferirCodigos,
  unir,
};
