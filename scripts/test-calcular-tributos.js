// Aba Impostos e calcularTributos.
//
// Passo 6 do módulo Vendas. O que este teste guarda:
//
//   1. que a apuração usa a MESMA montagem da emissão (buildNfeItemPayload).
//      Dois cálculos separados dariam duas respostas, e a divergência só
//      apareceria depois da nota autorizada;
//   2. que item sem regra, sem NCM ou com CST não suportado NÃO entra nas
//      somas — somar zero por ele faria o total parecer completo;
//   3. que "não há esse imposto" e "não apuramos esse imposto" são exibidos
//      diferente. É o defeito clássico desta tela: alguém vê ISS zerado e
//      conclui que não há ISS a pagar.
//
// AS ALÍQUOTAS AQUI SÃO INVENTADAS DE PROPÓSITO. O teste verifica ARITMÉTICA —
// que 200 × 17% dá 34 —, não política tributária. As alíquotas de verdade são
// as da regra cadastrada, e quem as confirma é o contador.
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const ler = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');
const semComentarios = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};

const { calcularTributos, NAO_APURADOS, estruturaZerada } = require('../lib/calcularTributos');

const EMPRESA = { id: 'emp-1', razaoSocial: 'Emitente', aliquotaCreditoIcmsSn: 0 };
const ESTAB = { id: 'est-1', razaoSocial: 'Matriz', uf: 'SC', cnpj: '00000000000191' };
const ITEM = { descricao: 'Cadeado', ncm: '73181500', origem: 0, quantidade: 2, valorUnitario: 100 };

// Regra completa, com alíquotas INVENTADAS para conferir a conta.
const REGRA = {
  cfop: '5102',
  cstIcms: '00',
  aliquotaIcms: 17,
  cstPis: '01',
  aliquotaPis: 1.65,
  cstCofins: '01',
  aliquotaCofins: 7.6,
  cstIpi: '50',
  aliquotaIpi: 5,
  cstIbsCbs: '000',
  classTrib: '000001',
  aliquotaIbsUf: 0.1,
  aliquotaIbsMun: 0,
  aliquotaCbs: 0.9
};

const comRegra = (regra) => ({ resolverRegraFiscal: async () => regra });

(async () => {
  console.log('--- a conta sai da mesma montagem da emissão ---');
  const r = await calcularTributos(
    { itens: [ITEM], empresa: EMPRESA, estabelecimento: ESTAB, destinatario: { uf: 'SC', contribuinte: true } },
    comRegra(REGRA)
  );
  check('apurou sem pendência', r.calculado === true, JSON.stringify(r.pendencias));
  check('valor total = 2 × 100', r.valoresDaNota.valorTotal === 200, String(r.valoresDaNota.valorTotal));
  check('base do ICMS = 200', r.icms.baseCalculoDestacado === 200, String(r.icms.baseCalculoDestacado));
  check('ICMS = 17% de 200', r.icms.valorDestacado === 34, String(r.icms.valorDestacado));
  check('PIS = 1,65% de 200', r.pis.valor === 3.3, String(r.pis.valor));
  check('COFINS = 7,6% de 200', r.cofins.valor === 15.2, String(r.cofins.valor));
  check('IPI = 5% de 200', r.outros.valorIpi === 10, String(r.outros.valorIpi));
  // A base do IBS/CBS é a do PIS/COFINS (valor da mercadoria), não a do ICMS,
  // que pode vir reduzida — redução de base do ICMS é benefício do ICMS.
  check('base IBS/CBS = 200', r.ibsCbs.baseCalculo === 200, String(r.ibsCbs.baseCalculo));
  check('IBS = 0,1% da UF + 0,0% do município', r.ibsCbs.valorIbs === 0.2, String(r.ibsCbs.valorIbs));
  check('CBS = 0,9% de 200', r.ibsCbs.valorCbs === 1.8, String(r.ibsCbs.valorCbs));
  check('a linha do item traz CFOP e situação', r.porItem[0].cfop === '5102' && r.porItem[0].situacaoIcms === '00',
    `${r.porItem[0].cfop}/${r.porItem[0].situacaoIcms}`);

  console.log('\n--- dois itens somam ---');
  const dois = await calcularTributos(
    { itens: [ITEM, { ...ITEM, quantidade: 1, valorUnitario: 50 }], empresa: EMPRESA, estabelecimento: ESTAB, destinatario: { uf: 'SC' } },
    comRegra(REGRA)
  );
  check('valor total = 200 + 50', dois.valoresDaNota.valorTotal === 250, String(dois.valoresDaNota.valorTotal));
  check('ICMS = 17% de 250', dois.icms.valorDestacado === 42.5, String(dois.icms.valorDestacado));
  check('e há uma linha por item', dois.porItem.length === 2);

  console.log('\n--- DIFAL só em venda interestadual para não contribuinte ---');
  const regraDifal = { ...REGRA, aliquotaIcms: 12, aliquotaInternaUfDestino: 18 };
  const paraContribuinte = await calcularTributos(
    { itens: [ITEM], empresa: EMPRESA, estabelecimento: ESTAB, destinatario: { uf: 'PR', contribuinte: true } },
    comRegra(regraDifal)
  );
  // Contribuinte recolhe por conta própria — não há diferencial a partilhar.
  check('contribuinte não gera DIFAL', paraContribuinte.icms.valorDiferencialAliquota === 0,
    String(paraContribuinte.icms.valorDiferencialAliquota));
  const paraConsumidor = await calcularTributos(
    { itens: [ITEM], empresa: EMPRESA, estabelecimento: ESTAB, destinatario: { uf: 'PR', contribuinte: false } },
    comRegra(regraDifal)
  );
  check('não contribuinte gera DIFAL de (18-12)% sobre 200', paraConsumidor.icms.valorDiferencialAliquota === 12,
    String(paraConsumidor.icms.valorDiferencialAliquota));
  // Mesma UF não tem diferencial nenhum, seja quem for o destinatário.
  const interna = await calcularTributos(
    { itens: [ITEM], empresa: EMPRESA, estabelecimento: ESTAB, destinatario: { uf: 'SC', contribuinte: false } },
    comRegra(regraDifal)
  );
  check('operação interna não gera DIFAL', interna.icms.valorDiferencialAliquota === 0);

  console.log('\n--- item que não pôde ser apurado NÃO entra nas somas ---');
  const semRegra = await calcularTributos(
    { itens: [ITEM], empresa: EMPRESA, estabelecimento: ESTAB, destinatario: { uf: 'SC' } },
    { resolverRegraFiscal: async () => null }
  );
  check('sem regra vira pendência', semRegra.pendencias.length === 1);
  check('  e a pendência diz o NCM e onde cadastrar', /73181500/.test(semRegra.pendencias[0].motivo) && /Regras Fiscais/.test(semRegra.pendencias[0].motivo));
  // Somar o valor de um item que não foi apurado faria o total parecer completo.
  check('  o total fica ZERO, não 200', semRegra.valoresDaNota.valorTotal === 0, String(semRegra.valoresDaNota.valorTotal));
  check('  e calculado = false', semRegra.calculado === false);

  const semNcm = await calcularTributos(
    { itens: [{ ...ITEM, ncm: '' }], empresa: EMPRESA, estabelecimento: ESTAB, destinatario: { uf: 'SC' } },
    comRegra(REGRA)
  );
  check('sem NCM vira pendência', /Sem NCM/.test(semNcm.pendencias[0].motivo));

  // CST que a emissão recusa (falta montar o grupo) derruba a NOTA, e está
  // certo. Aqui derrubaria a aba inteira, então vira pendência e o resto soma.
  const misto = await calcularTributos(
    { itens: [ITEM, { ...ITEM, descricao: 'Item com CST não suportado' }], empresa: EMPRESA, estabelecimento: ESTAB, destinatario: { uf: 'SC' } },
    { resolverRegraFiscal: async (args) => (args.ncm === 'x' ? null : REGRA) }
  );
  check('itens bons continuam somando', misto.valoresDaNota.valorTotal === 400, String(misto.valoresDaNota.valorTotal));

  console.log('\n--- sem contexto fiscal, não inventa conta ---');
  const semEstab = await calcularTributos(
    { itens: [ITEM], empresa: EMPRESA, estabelecimento: null, destinatario: { uf: 'SC' } },
    comRegra(REGRA)
  );
  check('sem estabelecimento devolve zerado com motivo', semEstab.calculado === false && /estabelecimento fiscal/.test(semEstab.pendencias[0].motivo));
  const semUf = await calcularTributos(
    { itens: [ITEM], empresa: EMPRESA, estabelecimento: ESTAB, destinatario: {} },
    comRegra(REGRA)
  );
  // A alíquota depende do destino: interna e interestadual não são a mesma conta.
  check('cliente sem UF devolve zerado com motivo', semUf.calculado === false && /UF/.test(semUf.pendencias[0].motivo));

  console.log('\n--- zero apurado x zero não apurado ---');
  const vazia = estruturaZerada();
  check('a estrutura tem todos os blocos do briefing',
    ['valoresDaNota', 'icms', 'fcp', 'cofins', 'pis', 'issqn', 'outros', 'ibsCbs', 'is'].every((k) => k in vazia));
  // Reforma tributária: IBS/CBS e IS existem no modelo desde já.
  check('IBS/CBS e IS existem desde já', 'ibsCbs' in vazia && 'is' in vazia);
  ['issqn.valor', 'outros.irrf', 'is.valor', 'fcp.valor'].forEach((c) => {
    check(`  ${c} está declarado como não apurado`, NAO_APURADOS.includes(c));
  });
  // O que o sistema APURA não pode estar na lista de não apurados: seria dizer
  // "—" num campo que tem número.
  ['icms.valorDestacado', 'pis.valor', 'cofins.valor', 'outros.valorIpi', 'ibsCbs.valorIbs'].forEach((c) => {
    check(`  ${c} NÃO está na lista`, !NAO_APURADOS.includes(c));
  });
  // O FCP do estado de destino é outro campo da nota (vFCPUFDest): somá-lo em
  // "Valor FCP" faria dois impostos diferentes virarem um número só.
  check('o FCP do destino é linha separada', 'ufDestino' in vazia.fcp);

  console.log('\n--- um motor só ---');
  const calcSrc = semComentarios(ler('lib/calcularTributos.js'));
  check('usa buildNfeItemPayload da emissão', /require\('\.\/nfePayloadBuilder'\)/.test(calcSrc) && /buildNfeItemPayload\(/.test(calcSrc));
  check('e não recalcula imposto por conta própria',
    !/aliquota\s*\/\s*100|\*\s*aliquota/i.test(calcSrc));
  const serverSrc = semComentarios(ler('server.js'));
  check('a rota existe', /pathname === '\/api\/sales\/tributos' && req\.method === 'POST'/.test(serverSrc));
  // A rota recebe o pedido como está na TELA: uma prévia que só funcionasse
  // depois de salvar não serviria para conferir antes de faturar.
  check('a rota é POST com o pedido, não GET por id', !/\/api\/sales\/tributos\/:/.test(serverSrc));
  check('usa o mesmo resolverRegraFiscal da emissão', /resolverRegraFiscal: fiscalDb\.resolverRegraFiscal/.test(serverSrc));
  // Leitura, nunca gravação: a aba não pode alterar o pedido.
  check('a rota não grava nada', !/\/api\/sales\/tributos[\s\S]{0,1500}db\.(update|create)Order/.test(serverSrc));

  console.log('\n--- a tela ---');
  const appSrc = ler('public/app.js');
  check('a aba mostra "—" no que não é apurado', /vazio \? '—' : salesFormatBRL/.test(appSrc));
  check('e explica a diferença no title', /ainda não apura este campo — não é o mesmo que zero/.test(appSrc));
  check('as pendências aparecem na aba', /Apuração incompleta/.test(appSrc));
  // Emitente e destino MUDAM a conta: sem eles à vista, a pessoa vê um número
  // sem saber sobre qual operação ele foi feito.
  check('o contexto fiscal fica à vista', /tributos\.contexto\.ufEmitente/.test(appSrc) && /contribuinte' : 'não contribuinte'/.test(appSrc));
  check('há a tabela por item', /tributos\.porItem\.map/.test(appSrc));
  check('e o botão de recalcular', /salesRecalcularTributosBtn/.test(appSrc));
  // Uma chamada por caractere digitado em outra aba seria absurdo.
  check('apura ao ENTRAR na aba, não a cada redesenho', /'impostos' && !tributos && items\.length\) carregarTributos\(\)/.test(appSrc));
  // Apuração que falhou não tem número nenhum para mostrar.
  check('falha vira "—" em tudo, não R$ 0,00', /if \(t && t\.falhou\) return true;/.test(appSrc));
  // Nenhum item apurado = nenhum número para mostrar. O aviso vermelho explica,
  // mas um R$ 0,00 ao lado dele continua sendo lido como "não há esse imposto",
  // e é o número que fica na memória depois que a pessoa rola a tela.
  check('nenhum item apurado também vira "—"',
    /\(t\.porItem \|\| \[\]\)\.length === 0 && \(t\.pendencias \|\| \[\]\)\.length\) return true;/.test(appSrc));
  check('não sobrou zero chumbado na aba', !/linhas: zeros\(/.test(appSrc));

  console.log(`\n===== ${falhas === 0 ? 'TODOS OS CHECKS PASSARAM' : falhas + ' FALHA(S)'} =====`);
  process.exit(falhas ? 1 : 0);
})();
