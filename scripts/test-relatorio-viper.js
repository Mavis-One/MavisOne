#!/usr/bin/env node
// A LEITURA DO RELATÓRIO DE ESTOQUE DO VIPERERP.
//
// POR QUE ESTE TESTE EXISTE, E POR QUE ELE NÃO USA OS PDFs. A carga do estoque
// inteiro sai de 5.653 linhas lidas de seis PDFs. Os PDFs não estão no
// repositório — são dados comerciais reais (custo e preço de venda de 5.478
// produtos) e não se publicam. Então o parser é puro e o teste o confere com
// texto sintético, uma fixture por armadilha ENCONTRADA no relatório real:
//
//   1. SALDO NEGATIVO. Um regex de número sem sinal descarta a linha em
//      silêncio. Aconteceu: −3 numa mesa e −5 num notebook, e o único sintoma
//      era o TOTAIS de saldo fechar 8 unidades acima.
//   2. O VIPER NÃO VALORIZA SALDO NEGATIVO. Ele imprime custoTotal 0,00 em vez
//      de −926,10. Se a conferência de aritmética não souber disso, acusa erro
//      onde não tem; se "resolver" ignorando saldo negativo, deixa de conferir.
//   3. LINHA SEM CÓDIGO. Em 3 linhas o nome é tão longo que empurra a coluna
//      Código para fora. Descartar calado é o pior desfecho possível.
//   4. CÓDIGO REPETIDO. O pdftotext repete o código da linha anterior em 3
//      linhas — `9915` sai em três linhas que são três produtos diferentes.
//      A coluna Código é a ÚNICA sem checksum, então ela precisa de vigia.
//   5. O GÊNERO ANCORADO NO RÓTULO. Procurar `\d\d –` acha "78 HELENA-" dentro
//      de nomes de produto e ainda deixa o texto do gênero colado no nome.
//   6. O TOTAIS/MÉDIA COMO CHECKSUM. É a única prova de que nenhuma linha se
//      perdeu, e ela precisa somar as linhas SEM código também.
//   7. AS VIAS SE SOBREPÕEM. Os seis arquivos não são faixas disjuntas: cada um
//      traz ~2.000 linhas a partir da linha pedida. Somar os seis duplicaria
//      4.652 linhas.
const v = require('../lib/relatorio-viper');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};

// Uma linha do relatório, no espaçamento que o `pdftotext -table` produz.
const linha = (codigo, nome, genero, saldo, custo, custoTotal, venda, vendaTotal) =>
  `${String(codigo).padEnd(8)}${String(nome).padEnd(60)}${genero.padEnd(40)}${saldo.padEnd(15)}${custo.padEnd(12)}${custoTotal.padEnd(17)}${venda.padEnd(18)}${vendaTotal}`;

const CABECALHO = [
  '                                                  Estoque',
  '',
  'Geração do Relatório 30/09/2026 16:48:00',
  '',
  'Filtros aplicados: Depósito(s): LOJA CENTRO',
  '',
  'Código  Produto                              Categoria Padrão  Gênero        Saldo Estoque  Custo (R$)  Custo Total(R$)  Valor Venda (R$)  Valor Venda Total  (R$)',
  '',
].join('\n');

console.log('--- 1. o básico: uma linha vira números ---');
{
  const r = v.parseRelatorio(`${CABECALHO}\n${linha('367', 'CAPACETE C2', '00 – Mercadoria para Revenda', '485,00', '28,38', '13764,30', '56,76', '27528,60')}`);
  check('leu exatamente uma linha', r.linhas.length === 1, r.linhas.length);
  const l = r.linhas[0];
  check('código', l.codigo === '367', l.codigo);
  check('nome sem o texto do gênero colado', l.nome === 'CAPACETE C2', JSON.stringify(l.nome));
  check('gênero como código', l.genero === '00', l.genero);
  check('gênero como rótulo', l.generoTexto === 'Mercadoria para Revenda', l.generoTexto);
  check('saldo', l.saldo === 485, l.saldo);
  check('custo', l.custo === 28.38, l.custo);
  check('custo total', l.custoTotal === 13764.3, l.custoTotal);
  check('venda', l.venda === 56.76, l.venda);
  check('venda total', l.vendaTotal === 27528.6, l.vendaTotal);
  check('a moldura foi contada, não lida como dado', r.moldura === 4, r.moldura);
}

console.log('--- 2. número no formato pt-BR, com milhar ---');
check('1.729.646,02', v.paraNumero('1.729.646,02') === 1729646.02, v.paraNumero('1.729.646,02'));
check('8.987,55', v.paraNumero('8.987,55') === 8987.55, v.paraNumero('8.987,55'));
check('0,00', v.paraNumero('0,00') === 0, v.paraNumero('0,00'));
// ARMADILHA 1: o sinal.
check('-3,00 é negativo, não 3', v.paraNumero('-3,00') === -3, v.paraNumero('-3,00'));
check('-17.911,50', v.paraNumero('-17.911,50') === -17911.5, v.paraNumero('-17.911,50'));

console.log('--- 3. ARMADILHA: saldo negativo não pode ser descartado ---');
{
  const texto = [
    CABECALHO,
    linha('11912', 'Mesa Redonda Com Base Em Metal Preto Fosco', '07 – Material de Uso e Consumo', '-3,00', '308,70', '0,00', '308,70', '0,00'),
    linha('9296', 'M1502YA-NJ611- RYZEN 7 / 8 GB / 512 GB / KEEP', '00 – Mercadoria para Revenda', '-5,00', '3582,30', '0,00', '3582,30', '0,00'),
    linha('367', 'CAPACETE C2', '00 – Mercadoria para Revenda', '485,00', '28,38', '13764,30', '28,38', '13764,30'),
  ].join('\n');
  const r = v.parseRelatorio(texto);
  check('as três linhas foram lidas', r.linhas.length === 3, r.linhas.length);
  check('o saldo negativo chegou negativo', r.linhas[0].saldo === -3 && r.linhas[1].saldo === -5,
    `${r.linhas[0].saldo} / ${r.linhas[1].saldo}`);
  // ARMADILHA 2: o Viper imprime total ZERO para saldo negativo.
  const ar = v.conferirAritmetica(r.linhas);
  check('aritmética passa: o Viper zera o total do saldo negativo', ar.ok, JSON.stringify(ar.quebras));
  check('e conferiu as três, não só a positiva', ar.conferidas === 3, ar.conferidas);
}

console.log('--- 4. a regra do saldo negativo é CONFERIDA, não dispensada ---');
{
  // Mesma linha negativa, mas com um total que NÃO é zero: tem de acusar.
  const texto = `${CABECALHO}\n${linha('11912', 'Mesa Redonda', '07 – Material de Uso e Consumo', '-3,00', '308,70', '-926,10', '308,70', '0,00')}`;
  const r = v.parseRelatorio(texto);
  const ar = v.conferirAritmetica(r.linhas);
  check('total diferente de zero em linha negativa é quebra', !ar.ok, JSON.stringify(ar.quebras.map((q) => q.campo)));
  check('e a quebra diz que a linha era negativa', ar.quebras[0] && ar.quebras[0].negativo === true);
}
{
  // SALDO ZERO NÃO É SALDO NEGATIVO. Aritmeticamente dá no mesmo (0 × custo é
  // 0 de qualquer jeito), e por isso é fácil escrever `<= 0` sem notar. Mas o
  // `negativo` é o que diz ao leitor QUAL regra foi aplicada: "o Viper zera o
  // total do negativo" ou "saldo × custo deu zero". Trocar um pelo outro
  // inventa uma regra do Viper onde ela não existe.
  const texto = `${CABECALHO}\n${linha('4321', 'MESA', '07 – Material de Uso e Consumo', '0,00', '308,70', '5,00', '308,70', '0,00')}`;
  const ar = v.conferirAritmetica(v.parseRelatorio(texto).linhas);
  check('custo total não-zero em linha de saldo ZERO é quebra', !ar.ok, JSON.stringify(ar.quebras.map((q) => q.campo)));
  check('e ela NÃO é marcada como negativa', ar.quebras[0] && ar.quebras[0].negativo === false,
    ar.quebras[0] && String(ar.quebras[0].negativo));
}

console.log('--- 5. a aritmética pega coluna trocada de lugar ---');
{
  // saldo × custo = 13.764,30. Pondo 13.764,31 a conferência tem de acusar.
  const texto = `${CABECALHO}\n${linha('367', 'CAPACETE C2', '00 – Mercadoria para Revenda', '485,00', '28,38', '13765,30', '56,76', '27528,60')}`;
  const r = v.parseRelatorio(texto);
  const ar = v.conferirAritmetica(r.linhas);
  check('custo total que não é saldo × custo é quebra', !ar.ok, JSON.stringify(ar.quebras));
  check('e aponta o campo certo', ar.quebras.length === 1 && ar.quebras[0].campo === 'custoTotal',
    ar.quebras.map((q) => q.campo).join(','));
}

console.log('--- 6. ARMADILHA: linha sem código vem declarada, não descartada ---');
{
  const semCod = `        ${'TUBO POLIETILENO INVERTER 5/8 X 10MM'.padEnd(60)}${'10 – Outros insumos'.padEnd(40)}${'0,00'.padEnd(15)}${'5,39'.padEnd(12)}${'0,00'.padEnd(17)}${'5,39'.padEnd(18)}0,00`;
  const r = v.parseRelatorio(`${CABECALHO}\n${semCod}`);
  check('não entrou em linhas', r.linhas.length === 0, r.linhas.length);
  check('entrou em semCodigo', r.semCodigo.length === 1, r.semCodigo.length);
  check('com os valores que tinha', r.semCodigo[0].custo === 5.39, r.semCodigo[0].custo);
  check('e com código nulo, não inventado', r.semCodigo[0].codigo === null, String(r.semCodigo[0].codigo));
  check('e o nome saiu limpo do gênero', r.semCodigo[0].nome === 'TUBO POLIETILENO INVERTER 5/8 X 10MM', r.semCodigo[0].nome);
}

console.log('--- 7. ARMADILHA: o TOTAIS soma as linhas SEM código também ---');
{
  const totais = `                    TOTAIS/MÉDIA                                                  485,00         34,17       13764,30         34,17            13764,30`;
  const comCod = linha('367', 'CAPACETE C2', '00 – Mercadoria para Revenda', '485,00', '28,38', '13764,30', '28,38', '13764,30');
  const semCod = `        ${'TUBO POLIETILENO INVERTER 5/8 X 10MM'.padEnd(60)}${'10 – Outros insumos'.padEnd(40)}${'0,00'.padEnd(15)}${'5,79'.padEnd(12)}${'0,00'.padEnd(17)}${'5,79'.padEnd(18)}0,00`;
  const r = v.parseRelatorio(`${CABECALHO}\n${totais}\n${comCod}\n${semCod}`);
  check('o TOTAIS foi lido', r.totais !== null && r.totais.saldo === 485, JSON.stringify(r.totais));
  check('e não foi contado como linha de produto', r.linhas.length === 1, r.linhas.length);
  const t = v.conferirTotais(r);
  // 28,38 + 5,79 = 34,17. Sem somar a linha sem código daria 28,38 e quebraria.
  check('fecha somando as duas', t.ok, JSON.stringify(t.diferencas));
  check('e diz quantas linhas somou', t.linhas === 2, t.linhas);
}

console.log('--- 8. o TOTAIS pega linha perdida ---');
{
  const totais = `                    TOTAIS/MÉDIA                                                  490,00         34,17       13764,30         34,17            13764,30`;
  const r = v.parseRelatorio(`${CABECALHO}\n${totais}\n${linha('367', 'CAPACETE C2', '00 – Mercadoria para Revenda', '485,00', '34,17', '13764,30', '34,17', '13764,30')}`);
  const t = v.conferirTotais(r);
  check('saldo 5 unidades abaixo do TOTAIS é quebra', !t.ok);
  const d = t.diferencas.find((x) => x.campo === 'saldo');
  check('e diz o campo e o tamanho da diferença', d && d.diferenca === -5, d && d.diferenca);
}
{
  const r = v.parseRelatorio(`${CABECALHO}\n${linha('367', 'CAPACETE C2', '00 – Mercadoria para Revenda', '485,00', '28,38', '13764,30', '28,38', '13764,30')}`);
  const t = v.conferirTotais(r);
  check('relatório sem linha TOTAIS não passa calado', t.ok === false && typeof t.motivo === 'string', t.motivo);
}

console.log('--- 9. ARMADILHA: gênero ancorado no rótulo, não nos dígitos ---');
{
  // "78 HELENA-" dentro do nome: os dígitos não podem virar gênero.
  const r = v.parseRelatorio(`${CABECALHO}\n${linha('4321', 'PANELA 78 HELENA- 20CM', '07 – Material de Uso e Consumo', '0,00', '10,00', '0,00', '10,00', '0,00')}`);
  check('gênero é 07, não 78', r.linhas[0].genero === '07', r.linhas[0].genero);
  check('e o nome manteve o 78 HELENA-', r.linhas[0].nome === 'PANELA 78 HELENA- 20CM', r.linhas[0].nome);
}
{
  // O CASO QUE JUSTIFICA A ÂNCORA. Um regex `\d\d\s*–\s*<qualquer texto>` casa
  // com "09 - T PONTEIRA" dentro do nome do produto: o gênero sai 09 e o nome
  // sai cortado. Foi assim que a primeira leitura produziu gêneros como
  // "78 HELENA-", "30 BRANCO" e "09 T PONTEIRA PARA PERFIL DE".
  const r = v.parseRelatorio(`${CABECALHO}\n${linha('4321', 'PERFIL 09 - T PONTEIRA PARA PERFIL DE ALUMINIO', '07 – Material de Uso e Consumo', '0,00', '10,00', '0,00', '10,00', '0,00')}`);
  check('"09 - T PONTEIRA" no nome não vira gênero 09', r.linhas[0].genero === '07', r.linhas[0].genero);
  check('e o nome sai inteiro, não cortado no 09',
    r.linhas[0].nome === 'PERFIL 09 - T PONTEIRA PARA PERFIL DE ALUMINIO', r.linhas[0].nome);
}
{
  // O relatório às vezes imprime o rótulo com dois espaços entre as palavras.
  const r = v.parseRelatorio(`${CABECALHO}\n${linha('4321', 'SACA XADREZ', '07  –  Material  de  Uso  e  Consumo', '0,00', '8,50', '0,00', '8,50', '0,00')}`);
  check('rótulo com espaço dobrado ainda é reconhecido', r.linhas[0].genero === '07', r.linhas[0].genero);
  check('e o nome não levou o rótulo consigo', r.linhas[0].nome === 'SACA XADREZ', JSON.stringify(r.linhas[0].nome));
}
{
  // Nome longo colidindo com a coluna Gênero: os caracteres saem intercalados.
  const colidido = `11837   AlicateDiagonalUniversalMultifuncionalEPontaFinaCortadoresDeFioParaEletrici0s7ta–sFM1a8terial de Uso e Consumo  0,00           79,00       0,00             79,00                    0,00`;
  const r = v.parseRelatorio(`${CABECALHO}\n${colidido}`);
  check('a linha não se perde', r.linhas.length === 1, r.linhas.length);
  check('os NÚMEROS dela continuam certos', r.linhas[0].custo === 79 && r.linhas[0].saldo === 0, r.linhas[0].custo);
  check('e o gênero fica nulo em vez de inventado', r.linhas[0].genero === null, String(r.linhas[0].genero));
}
{
  const s = v.separarNomeEGenero('MESA DE FERRO                07 – Material de Uso e Consumo   ');
  check('separarNomeEGenero devolve os dois', s.nome === 'MESA DE FERRO' && s.genero === '07', `${s.nome} | ${s.genero}`);
  const sem = v.separarNomeEGenero('MESA DE FERRO SEM GENERO');
  check('sem rótulo, o nome é tudo e o gênero é nulo',
    sem.nome === 'MESA DE FERRO SEM GENERO' && sem.genero === null && sem.generoTexto === null, sem.nome);
}
check('os doze rótulos do gênero estão no módulo', Object.keys(v.ROTULOS_GENERO).length === 12, Object.keys(v.ROTULOS_GENERO).length);
check('e 00/07/10/99, que são os que o relatório usa, estão lá',
  v.ROTULOS_GENERO['00'] === 'Mercadoria para Revenda'
  && v.ROTULOS_GENERO['07'] === 'Material de Uso e Consumo'
  && v.ROTULOS_GENERO['10'] === 'Outros insumos'
  && v.ROTULOS_GENERO['99'] === 'Outras');

console.log('--- 10. ARMADILHA: código repetido é a única coluna sem checksum ---');
{
  const texto = [
    CABECALHO,
    linha('9915', 'TUBO POLIETILENO INVERTER 3/8 X 10MM', '10 – Outros insumos', '0,00', '3,79', '0,00', '3,79', '0,00'),
    linha('9915', 'TUBO POLIETILENO INVERTER 3/8 X 10MM', '10 – Outros insumos', '0,00', '3,99', '0,00', '3,99', '0,00'),
    linha('367', 'CAPACETE C2', '00 – Mercadoria para Revenda', '485,00', '28,38', '13764,30', '28,38', '13764,30'),
  ].join('\n');
  const r = v.parseRelatorio(texto);
  const c = v.conferirCodigos(r);
  check('o código repetido é apontado', c.repetidos.length === 1 && c.repetidos[0].codigo === '9915',
    JSON.stringify(c.repetidos));
  check('e diz quantas vezes', c.repetidos[0].vezes === 2, c.repetidos[0].vezes);
  check('duas linhas duvidosas', c.duvidosas === 2, c.duvidosas);
  // O que decide se a carga pode seguir: nenhuma duvidosa com saldo.
  check('passa porque as duvidosas têm saldo ZERO', c.ok, JSON.stringify(c.duvidosasComSaldo));
}
{
  // A mesma repetição, agora com SALDO. Aí não passa.
  const texto = [
    CABECALHO,
    linha('9915', 'TUBO 3/8', '10 – Outros insumos', '7,00', '3,79', '26,53', '3,79', '26,53'),
    linha('9915', 'TUBO 3/8', '10 – Outros insumos', '0,00', '3,99', '0,00', '3,99', '0,00'),
  ].join('\n');
  const c = v.conferirCodigos(v.parseRelatorio(texto));
  check('código duvidoso COM saldo reprova a leitura', !c.ok, JSON.stringify(c.duvidosasComSaldo.map((l) => l.codigo)));
  check('e entrega a linha para quem for decidir', c.duvidosasComSaldo.length === 1 && c.duvidosasComSaldo[0].saldo === 7,
    c.duvidosasComSaldo[0] && c.duvidosasComSaldo[0].saldo);
}
{
  // Linha SEM código também é duvidosa -- e se tiver saldo, reprova.
  const semCod = `        ${'TUBO 5/8'.padEnd(60)}${'10 – Outros insumos'.padEnd(40)}${'4,00'.padEnd(15)}${'5,39'.padEnd(12)}${'21,56'.padEnd(17)}${'5,39'.padEnd(18)}21,56`;
  const c = v.conferirCodigos(v.parseRelatorio(`${CABECALHO}\n${semCod}`));
  check('linha sem código COM saldo reprova', !c.ok, c.duvidosasComSaldo.length);
  check('e o semCodigo é contado', c.semCodigo === 1, c.semCodigo);
}

console.log('--- 11. ARMADILHA: as vias se sobrepõem, juntar é por código ---');
{
  const via = (nome, linhasTexto) => v.parseRelatorio(`${CABECALHO}\n${linhasTexto.join('\n')}`, nome);
  const a = via('1_ate_1000', [
    linha('367', 'CAPACETE C2', '00 – Mercadoria para Revenda', '485,00', '28,38', '13764,30', '28,38', '13764,30'),
    linha('236', 'KACCAU V8', '00 – Mercadoria para Revenda', '1,00', '7323,08', '7323,08', '7323,08', '7323,08'),
  ]);
  const b = via('1001_ate_2000', [
    linha('236', 'KACCAU V8', '00 – Mercadoria para Revenda', '1,00', '7323,08', '7323,08', '7323,08', '7323,08'),
    linha('11922', 'X13 PRO', '00 – Mercadoria para Revenda', '2,00', '8987,55', '17975,10', '8987,55', '17975,10'),
  ]);
  const u = v.unir([a, b]);
  check('quatro linhas, três produtos', u.linhas.length === 3, u.linhas.length);
  check('e o repetido não duplicou o saldo',
    u.linhas.filter((l) => l.codigo === '236').length === 1
    && u.linhas.reduce((s, l) => s + l.saldo, 0) === 488,
    u.linhas.reduce((s, l) => s + l.saldo, 0));
  check('sem conflito quando as duas vias concordam', u.conflitos.length === 0, JSON.stringify(u.conflitos));
  check('e a via de origem fica registrada', u.linhas.find((l) => l.codigo === '11922').arquivo === '1001_ate_2000');
}
{
  // Mesmo código com valor diferente entre vias: é conflito e tem de aparecer.
  const via = (nome, l) => v.parseRelatorio(`${CABECALHO}\n${l}`, nome);
  const a = via('via-a', linha('236', 'KACCAU V8', '00 – Mercadoria para Revenda', '1,00', '7323,08', '7323,08', '7323,08', '7323,08'));
  const b = via('via-b', linha('236', 'KACCAU V8', '00 – Mercadoria para Revenda', '1,00', '5800,00', '5800,00', '7323,08', '7323,08'));
  const u = v.unir([a, b]);
  check('custo diferente entre vias é conflito', u.conflitos.length === 1, JSON.stringify(u.conflitos));
  check('e diz o campo, os dois valores e as duas vias',
    u.conflitos[0].campo === 'custo' && u.conflitos[0].a === 7323.08 && u.conflitos[0].b === 5800
    && u.conflitos[0].entre.join(',') === 'via-a,via-b',
    JSON.stringify(u.conflitos[0]));
  check('e a primeira leitura é a que fica', u.linhas[0].custo === 7323.08, u.linhas[0].custo);
}
{
  const u = v.unir([]);
  check('unir sem vias não explode', u.linhas.length === 0 && u.conflitos.length === 0);
}

console.log('--- 12. a moldura que se repete em cada página não entra como dado ---');
{
  const texto = [
    CABECALHO,
    linha('367', 'CAPACETE C2', '00 – Mercadoria para Revenda', '485,00', '28,38', '13764,30', '28,38', '13764,30'),
    'Código  Produto                              Categoria Padrão  Gênero        Saldo Estoque  Custo (R$)  Custo Total(R$)  Valor Venda (R$)  Valor Venda Total  (R$)',
    linha('236', 'KACCAU V8', '00 – Mercadoria para Revenda', '1,00', '7323,08', '7323,08', '7323,08', '7323,08'),
  ].join('\n');
  const r = v.parseRelatorio(texto);
  check('duas linhas de produto, não três', r.linhas.length === 2, r.linhas.length);
  check('e a moldura foi contada cinco vezes', r.moldura === 5, r.moldura);
  check('fragmento de nome vai para continuacoes', v.parseRelatorio(`${CABECALHO}\n        BRANCO EPEX`).continuacoes.length === 1);
}

console.log('--- 13. o nome que continua na linha seguinte ---');
{
  // O CASO QUE CUSTARIA CARO. O cadastro tem ABRAÇADEIRA 5MM x 400MM e
  // 3,6MM x 300MM. Sem colar o fragmento, a de 5MM x 300MM entraria como
  // "ABRACADEIRA PLASTICA COR PRETA, TAMANHO" -- indistinguível das outras
  // duas, e 1.000 unidades iriam para o produto errado.
  const texto = [
    CABECALHO,
    linha('101060', 'ABRACADEIRA PLASTICA COR PRETA, TAMANHO', '07 – Material de Uso e Consumo', '1000,00', '0,10', '100,00', '0,10', '100,00'),
    '        5MM x 300MM',
    linha('10512', 'ABRACADEIRA PLASTICA COR PRETA, TAMANHO', '07 – Material de Uso e Consumo', '0,00', '0,12', '0,00', '0,12', '0,00'),
    '        3,6MM x 300MM',
  ].join('\n');
  const r = v.parseRelatorio(texto);
  check('duas linhas de produto', r.linhas.length === 2, r.linhas.length);
  check('o fragmento foi para a linha de CIMA dele',
    r.linhas[0].nomeCompleto === 'ABRACADEIRA PLASTICA COR PRETA, TAMANHO 5MM x 300MM', r.linhas[0].nomeCompleto);
  check('e a linha seguinte ficou com o SEU fragmento',
    r.linhas[1].nomeCompleto === 'ABRACADEIRA PLASTICA COR PRETA, TAMANHO 3,6MM x 300MM', r.linhas[1].nomeCompleto);
  check('`nome` continua sendo só o pedaço da linha do código',
    r.linhas[0].nome === 'ABRACADEIRA PLASTICA COR PRETA, TAMANHO', r.linhas[0].nome);
  check('e o fragmento fica acessível em depois',
    r.linhas[0].depois.length === 1 && r.linhas[0].depois[0] === '5MM x 300MM', JSON.stringify(r.linhas[0].depois));
}
{
  // Três linhas de fragmento: todas colam, na ordem.
  const texto = [
    CABECALHO,
    linha('100998', '(MS13-003) (E10D1) Calibrador De Pneus Analogico', '07 – Material de Uso e Consumo', '0,00', '158,36', '0,00', '158,36', '0,00'),
    '        Com Bico Duplo Steula',
    '        150psi',
  ].join('\n');
  const r = v.parseRelatorio(texto);
  check('dois fragmentos colam na ordem em que aparecem',
    r.linhas[0].nomeCompleto === '(MS13-003) (E10D1) Calibrador De Pneus Analogico Com Bico Duplo Steula 150psi',
    r.linhas[0].nomeCompleto);
}
{
  // Sem fragmento, nomeCompleto é o nome. Não pode virar undefined nem ' '.
  const r = v.parseRelatorio(`${CABECALHO}\n${linha('367', 'CAPACETE C2', '00 – Mercadoria para Revenda', '485,00', '28,38', '13764,30', '28,38', '13764,30')}`);
  check('sem fragmento, nomeCompleto é igual a nome', r.linhas[0].nomeCompleto === 'CAPACETE C2', JSON.stringify(r.linhas[0].nomeCompleto));
  check('e depois é lista vazia', Array.isArray(r.linhas[0].depois) && r.linhas[0].depois.length === 0);
}
{
  // O CABEÇALHO DA PÁGINA É FRONTEIRA. O fragmento que vem antes dele pertence
  // à linha anterior; o que vem depois não pode voltar para ela.
  const texto = [
    CABECALHO,
    linha('101075', 'JOGO DIR OVER NECO PRETO ROSCA', '00 – Mercadoria para Revenda', '4,00', '19,00', '76,00', '19,00', '76,00'),
    'Código  Produto                              Categoria Padrão  Gênero        Saldo Estoque  Custo (R$)  Custo Total(R$)  Valor Venda (R$)  Valor Venda Total  (R$)',
    '        FRAGMENTO DA PAGINA NOVA',
    linha('9308', 'JOGO DE RAIO GALV', '00 – Mercadoria para Revenda', '0,00', '10,00', '0,00', '10,00', '0,00'),
  ].join('\n');
  const r = v.parseRelatorio(texto);
  check('o nome antes do cabeçalho não recebe o fragmento de depois dele',
    r.linhas[0].nomeCompleto === 'JOGO DIR OVER NECO PRETO ROSCA', r.linhas[0].nomeCompleto);
}
{
  // Fragmento numa linha SEM código também tem de ser colado nela.
  const semCod = `        ${'TUBO POLIETILENO INVERTER 5/8 X 10MM'.padEnd(60)}${'10 – Outros insumos'.padEnd(40)}${'0,00'.padEnd(15)}${'5,39'.padEnd(12)}${'0,00'.padEnd(17)}${'5,39'.padEnd(18)}0,00`;
  const r = v.parseRelatorio(`${CABECALHO}\n${semCod}\n        BRANCO EPEX`);
  check('a linha sem código também recebe o fragmento',
    r.semCodigo[0].nomeCompleto === 'TUBO POLIETILENO INVERTER 5/8 X 10MM BRANCO EPEX', r.semCodigo[0].nomeCompleto);
}
{
  // Fragmento ANTES de qualquer linha de dados não pertence a ninguém, e não
  // pode explodir nem ser inventado numa linha futura.
  const r = v.parseRelatorio(`${CABECALHO}\n        ORFAO\n${linha('367', 'CAPACETE C2', '00 – Mercadoria para Revenda', '1,00', '28,38', '28,38', '28,38', '28,38')}`);
  check('fragmento órfão no começo não entra em nome nenhum',
    r.linhas.length === 1 && r.linhas[0].nomeCompleto === 'CAPACETE C2', r.linhas[0].nomeCompleto);
  check('mas foi contado em continuacoes', r.continuacoes.length === 1, r.continuacoes.length);
}
{
  // A ordem das linhas é registrada, e é o que decide qual foi a "última".
  const r = v.parseRelatorio([
    CABECALHO,
    linha('1', 'A', '99 – Outras', '0,00', '1,00', '0,00', '1,00', '0,00'),
    linha('2', 'B', '99 – Outras', '0,00', '1,00', '0,00', '1,00', '0,00'),
  ].join('\n'));
  check('cada linha sabe sua posição na via', r.linhas[0].ordem === 1 && r.linhas[1].ordem === 2,
    `${r.linhas[0].ordem}/${r.linhas[1].ordem}`);
}

console.log('');
console.log(falhas === 0 ? 'TODAS AS CONFERÊNCIAS PASSARAM' : `${falhas} CONFERÊNCIA(S) FALHOU/FALHARAM`);
process.exit(falhas === 0 ? 0 : 1);
