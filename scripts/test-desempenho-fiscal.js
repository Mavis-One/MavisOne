#!/usr/bin/env node
/**
 * O FISCAL MAIS LEVE SEM CONFERIR OUTRA COISA (rodada de desempenho, 07/10/2026).
 *
 * O pré-check de um mês fazia 3.479 consultas em fila (3,8 s) e o de nove
 * meses, 32 s; a Análise Fiscal refazia a análise a cada clique; os Logs
 * recarregavam todas as notas a cada filtro. As correções mexem em COMO se lê,
 * nunca no que se confere — e é isso que este teste prende, sem banco:
 *
 *   1. o recorte do período só entra com dia de calendário de verdade;
 *   2. a memória de UMA conferência (leiturasDaConferencia) lê uma vez, devolve
 *      cópia, esquece o que falhou e não confunde id numérico com texto;
 *   3. a escolha da regra fiscal é a mesma com as regras compartilhadas, e não
 *      mexe nelas (o pré-check passa as MESMAS linhas para todos os itens);
 *   4. directoryName acha o mesmo nome que directory().find achava;
 *   5. a credenciadora sai igual pelos dois caminhos;
 *   6. o SPED só pula a releitura quando a resposta é "já estava" — tudo o que
 *      grava relê na hora;
 *   7. as telas: a Análise Fiscal corta no mesmo número que a tela desenha, e
 *      Pré-check e Análise não refazem a consulta à toa — mas os Logs NF-e
 *      buscam de novo a cada filtro, porque o status muda pelo webhook e uma
 *      lista guardada serviria status velho (achado da revisão);
 *   9. as notas de um pedido saem na mesma ordem estável pelos dois caminhos
 *      (emissão e pré-check), para a mensagem citar a mesma nota.
 *
 * A igualdade das respostas contra o código de antes, com o banco real, foi
 * provada à parte (dia, mês, nove meses, entradas tortas, estabelecimento
 * inexistente) — ver a mensagem do commit.
 */
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const ler = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas += 1;
};
const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const src = ler('server.js');
// O texto de uma função de topo do server.js, da assinatura até a chave que a
// fecha na coluna 0.
function funcaoDoServer(assinatura) {
  const ini = src.indexOf(assinatura);
  if (ini < 0) throw new Error(`não achei ${assinatura}`);
  const fim = src.indexOf('\n}\n', ini);
  return src.slice(ini, fim + 2);
}

(async () => {
  console.log('\n--- 1. o recorte do período só com dia de verdade ---');
  const ehDiaIso = new Function(`${funcaoDoServer('function ehDiaIso(')}; return ehDiaIso;`)();
  check('2026-09-08 é dia', ehDiaIso('2026-09-08'));
  check('29/02 de ano bissexto é dia', ehDiaIso('2024-02-29'));
  // Date.parse aceita e vira 02/03; o Postgres recusaria a consulta inteira.
  check('2026-02-30 NÃO (o Postgres recusaria)', !ehDiaIso('2026-02-30'));
  check('2026-13-01 NÃO', !ehDiaIso('2026-13-01'));
  check('2026-9-8 NÃO (lá a janela é comparação de texto)', !ehDiaIso('2026-9-8'));
  check('ano 0000 NÃO', !ehDiaIso('0000-01-01'));
  check('vazio e nulo NÃO', !ehDiaIso('') && !ehDiaIso(null));
  const rota = src.slice(src.indexOf("if (pathname === '/api/fiscal/pre-check' && req.method === 'GET')"));
  const corpoRota = rota.slice(0, rota.indexOf("if (pathname === '/api/fiscal/nfe' && req.method === 'GET')"));
  check('a rota só recorta quando DE e ATÉ são dias', /if \(ehDiaIso\(de\) && ehDiaIso\(ate\)\) \{\s*await syncSalesDataDoPeriodo\(dados, \{ de, ate \}\);\s*\} else \{\s*await syncSalesData\(dados\);/.test(corpoRota));
  // O filtro de data em JavaScript continua: no caminho antigo é ele que decide.
  check('  e o filtro de texto continua depois', /return dia >= de && dia <= ate;/.test(corpoRota));
  check('o empate de code se desfaz pelo id', /Number\(a\.code \|\| 0\) - Number\(b\.code \|\| 0\)\)\s*\|\| \(String\(a\.id\) < String\(b\.id\)/.test(corpoRota));
  check('cede o event loop durante o laço', /setImmediate/.test(corpoRota));
  check('a mesma função da emissão, com as leituras da requisição', /await prepararNfeParaTransmitir\(corpo, \{ leituras \}\);/.test(corpoRota));

  console.log('\n--- 2. a memória de UMA conferência ---');
  const preparar = src.slice(src.indexOf('async function prepararNfeParaTransmitir'), src.indexOf('async function emitirNfeFiscal'));
  // A primeira linha decide de onde as leituras vêm; a emissão não passa
  // `leituras` e lê direto (o regex da emissão está em test-pre-check-fiscal).
  check('prepararNfeParaTransmitir sombreia as três leituras logo no começo',
    /^async function prepararNfeParaTransmitir\(body, opcoes = \{\}\) \{\s*(\/\/[^\n]*\n\s*)*const \{ fiscalDb, db, pagamentosComCredenciadora \} = opcoes\.leituras \|\| LEITURAS_DIRETAS;/.test(preparar));
  check('  e LEITURAS_DIRETAS são os módulos de verdade', /const LEITURAS_DIRETAS = \{ fiscalDb, db, pagamentosComCredenciadora \};/.test(src));

  const chamadas = [];
  const conta = (nome) => chamadas.filter((c) => c === nome).length;
  let falharEstab = 0;
  let erroDasRegras = 0;
  let falharPrecarga = false;
  const fiscalDbFalso = {
    outra: () => 'continua',
    async getEstabelecimentoById(id) {
      chamadas.push('estab');
      if (falharEstab > 0) { falharEstab -= 1; throw new Error('conexão caiu'); }
      return { id, uf: 'SC', ativo: true };
    },
    async getEmpresaById(id) { chamadas.push('empresa'); return { id }; },
    async getNfesPorPedido(id) { chamadas.push(`nfe:${id}`); return []; },
    async getNfesPorPedidos(ids) {
      chamadas.push('nfes-lote');
      if (falharPrecarga) throw new Error('lote falhou');
      return new Map(ids.map((id) => [String(id).trim(), id === 'P1' ? [{ id: 'n1', status: 'ERRO' }] : []]));
    },
    async lerRegrasCandidatas(chave) {
      chamadas.push(`regras:${chave.referencia}`);
      if (erroDasRegras > 0) { erroDasRegras -= 1; return { data: null, error: { message: 'passageiro' } }; }
      return { data: [{ id: 'r1' }], error: null };
    },
    async resolverRegraFiscal(params, { lerRegras }) {
      const { data, error } = await lerRegras({ empresaId: params.empresaId, tipoOperacao: params.tipoOperacao, referencia: params.data });
      if (error) throw new Error(`resolverRegraFiscal: ${error.message}`);
      return data[0];
    }
  };
  const dbFalso = {
    getProducts: async () => [],
    async getProductById(id) { chamadas.push(`produto:${id}`); return id === 'nao-existe' ? null : { id, ncm: '87116000' }; },
    async getProductsEmMapaPorIds(ids) {
      chamadas.push('produtos-lote');
      if (falharPrecarga) throw new Error('lote falhou');
      const so = ids.filter((id) => typeof id === 'string' && id);
      return new Map(so.map((id) => [id, id === 'sumiu' ? null : { id, ncm: '87116000' }]));
    }
  };
  const fabrica = new Function('fiscalDb', 'db', 'loadData', 'adquirentesDb', 'credenciadoraNasLinhas',
    `${funcaoDoServer('function leiturasDaConferencia(')}; return leiturasDaConferencia;`);
  const credenciadora = new Function(`${funcaoDoServer('async function credenciadoraNasLinhas(')}; return credenciadoraNasLinhas;`)();
  const adquirentesFalso = { async listar() { chamadas.push('adquirentes'); return [{ id: 'a1', cnpj: '11222333000181' }]; } };
  const loadDataFalso = () => { chamadas.push('loadData'); return { paymentMethods: [{ id: 'f1', cardAcquirerId: 'a1' }] }; };
  const novaConferencia = fabrica(fiscalDbFalso, dbFalso, loadDataFalso, adquirentesFalso, credenciadora);

  {
    const l = novaConferencia();
    const e1 = await l.fiscalDb.getEstabelecimentoById('E');
    const e2 = await l.fiscalDb.getEstabelecimentoById('E');
    check('estabelecimento lido UMA vez', conta('estab') === 1);
    e1.uf = 'XX';
    check('  e cada nota recebe a SUA cópia', e2.uf === 'SC' && (await l.fiscalDb.getEstabelecimentoById('E')).uf === 'SC');
    await l.fiscalDb.getEmpresaById('M'); await l.fiscalDb.getEmpresaById('M');
    check('empresa lida UMA vez', conta('empresa') === 1);
    check('o resto do módulo continua lá', l.fiscalDb.outra() === 'continua' && typeof l.db.getProducts === 'function');

    chamadas.length = 0;
    const p = { empresaId: 'M', tipoOperacao: 'VENDA' };
    await l.fiscalDb.resolverRegraFiscal({ ...p, data: '2026-09-08' });
    await l.fiscalDb.resolverRegraFiscal({ ...p, data: '2026-09-08' });
    await l.fiscalDb.resolverRegraFiscal({ ...p, data: '2026-09-09' });
    check('regras lidas uma vez por (empresa, operação, data)', conta('regras:2026-09-08') === 1 && conta('regras:2026-09-09') === 1);

    chamadas.length = 0;
    erroDasRegras = 1;
    let erro = null;
    try { await l.fiscalDb.resolverRegraFiscal({ ...p, data: '2026-10-01' }); } catch (e) { erro = e.message; }
    await l.fiscalDb.resolverRegraFiscal({ ...p, data: '2026-10-01' });
    // Sem a memória cada item leria de novo: o erro passageiro não pode ficar
    // guardado e aparecer em todos os pedidos seguintes.
    check('regra que voltou com { error } é esquecida (o próximo item relê)', erro && conta('regras:2026-10-01') === 2, erro);

    chamadas.length = 0;
    const l2 = novaConferencia();
    falharEstab = 1;
    let erroEstab = null;
    try { await l2.fiscalDb.getEstabelecimentoById('E'); } catch (e) { erroEstab = e.message; }
    const depois = await l2.fiscalDb.getEstabelecimentoById('E');
    check('leitura que LANÇOU é esquecida: o erro sai na linha da nota e a próxima relê',
      erroEstab === 'conexão caiu' && depois && conta('estab') === 2);
  }

  {
    chamadas.length = 0;
    const l = novaConferencia();
    await l.precarregar({ produtoIds: ['A', 'B', 'sumiu', 5, '', undefined], pedidoIds: ['P1', 'P2'] });
    check('a pré-carga é UMA consulta de produtos e UMA de notas', conta('produtos-lote') === 1 && conta('nfes-lote') === 1);
    const a1 = await l.db.getProductById('A');
    a1.ncm = 'mexido';
    const a2 = await l.db.getProductById('A');
    check('produto pré-carregado sai do mapa, em cópia', a2.ncm === '87116000' && conta('produto:A') === 0);
    check('produto que não existe dá null, como getProductById', (await l.db.getProductById('sumiu')) === null && conta('produto:sumiu') === 0);
    // Id numérico não entra no mapa: 5 e "5" seriam chaves diferentes e o
    // produto pareceria não existir. Lido direto, como sempre.
    const cinco = await l.db.getProductById(5);
    check('id que não é texto é lido direto (não vira "não existe")', cinco && cinco.id === 5 && conta('produto:5') === 1);
    await l.db.getProductById('C'); await l.db.getProductById('C');
    check('produto fora da pré-carga: lido uma vez', conta('produto:C') === 1);
    const n1 = await l.fiscalDb.getNfesPorPedido(' P1 ');
    check('notas do pedido saem do lote (com o mesmo trim)', n1.length === 1 && n1[0].status === 'ERRO' && conta('nfe:P1') === 0);
    n1[0].status = 'AUTORIZADO';
    check('  em cópia', (await l.fiscalDb.getNfesPorPedido('P1'))[0].status === 'ERRO');
    await l.fiscalDb.getNfesPorPedido('P9');
    check('pedido fora do lote consulta sozinho', conta('nfe:P9') === 1);
  }

  {
    chamadas.length = 0;
    falharPrecarga = true;
    const l = novaConferencia();
    await l.precarregar({ produtoIds: ['A'], pedidoIds: ['P1'] });
    await l.db.getProductById('A');
    await l.fiscalDb.getNfesPorPedido('P1');
    // Um 500 da lista inteira seria pior do que hoje: o erro tem de sair na
    // linha de cada pedido, e para isso cada um volta a ler sozinho.
    check('pré-carga que falha deixa cada pedido ler sozinho', conta('produto:A') === 1 && conta('nfe:P1') === 1);
    falharPrecarga = false;
  }

  console.log('\n--- 3. a escolha da regra, com as regras compartilhadas ---');
  const fiscalDb = require('../lib/db/fiscal');
  check('lerRegrasCandidatas exportada', typeof fiscalDb.lerRegrasCandidatas === 'function');
  const congelar = (o) => { Object.values(o).forEach((v) => v && typeof v === 'object' && congelar(v)); return Object.freeze(o); };
  const linha = (id, extra) => ({
    id, empresa_id: 'M', tipo_operacao: 'VENDA', ncm: null, grupo_tributario_id: null, origem: null, uf_destino: null,
    dentro_do_estado: null, destinatario_contribuinte: null, prioridade: 0, vigencia_inicio: '2026-01-01', vigencia_fim: null,
    cfop: '5102', ...extra
  });
  const linhas = congelar([
    linha('geral'),
    linha('grupo', { grupo_tributario_id: 'G1', cfop: '5405' }),
    linha('ncm', { ncm: '87116000', cfop: '5101' }),
    linha('vencida', { ncm: '87116000', vigencia_fim: '2026-02-01', prioridade: 9 })
  ]);
  const lidas = [];
  const lerRegras = async (chave) => { lidas.push(chave); return { data: linhas, error: null }; };
  const params = { empresaId: 'M', tipoOperacao: 'VENDA', ufDestino: 'SC', dentroDoEstado: true, destinatarioContribuinte: false, origem: 0, data: '2026-09-08' };
  const r1 = await fiscalDb.resolverRegraFiscal({ ...params, ncm: '87116000', grupoTributarioId: 'G1' }, { lerRegras });
  const r2 = await fiscalDb.resolverRegraFiscal({ ...params, ncm: '99999999', grupoTributarioId: 'G1' }, { lerRegras });
  const r3 = await fiscalDb.resolverRegraFiscal({ ...params, ncm: '99999999', grupoTributarioId: '' }, { lerRegras });
  check('a exceção por NCM ganha do grupo', r1 && r1.id === 'ncm', r1 && r1.id);
  check('o grupo ganha do coringa', r2 && r2.id === 'grupo', r2 && r2.id);
  check('sem grupo nem NCM, a geral', r3 && r3.id === 'geral', r3 && r3.id);
  // As linhas estão congeladas: se a escolha mexesse nelas (sort no próprio
  // array, campo atribuído), o pré-check, que passa as MESMAS linhas a todos os
  // itens, deixaria um item influenciar o seguinte.
  check('  e as linhas compartilhadas saem intactas (congeladas, sem erro)', linhas.length === 4 && linhas[0].id === 'geral');
  check('a chave de leitura é (empresa, operação, data)', igual(lidas[0], { empresaId: 'M', tipoOperacao: 'VENDA', referencia: '2026-09-08' }));

  console.log('\n--- 4. o nome do cliente ---');
  const cadastrosCore = require('../lib/cadastros-core');
  const viaDiretorio = (data, id) => {
    if (!id) return '';
    const found = cadastrosCore.directory(data).find((e) => e.id === id);
    return found ? found.name : '';
  };
  const dados = {
    people: [{ id: 'p1', name: 'Ana' }, { id: 'dup', name: 'Pessoa' }, { id: 'p1', name: 'Ana (2ª linha)' }],
    cnpjs: [{ id: 'c1', name: 'Loja' }, { id: 'dup', name: 'Empresa' }]
  };
  const ids = ['p1', 'c1', 'dup', 'nada', '', null, undefined];
  check('directoryName = directory().find, em todos os casos',
    ids.every((id) => cadastrosCore.directoryName(dados, id) === viaDiretorio(dados, id)),
    ids.map((id) => `${id}:${cadastrosCore.directoryName(dados, id)}`).join(' '));
  check('  com as listas ausentes', cadastrosCore.directoryName({}, 'p1') === '' && viaDiretorio({}, 'p1') === '');

  console.log('\n--- 5. a credenciadora ---');
  check('pagamentosComCredenciadora usa o mesmo núcleo', /async function pagamentosComCredenciadora\(pagamentos\) \{\s*return credenciadoraNasLinhas\(pagamentos, \{/.test(src));
  {
    chamadas.length = 0;
    const l = novaConferencia();
    const linhasPg = [{ methodId: 'f1', amount: 10 }, { amount: 5 }];
    const a = await l.pagamentosComCredenciadora(linhasPg);
    await l.pagamentosComCredenciadora(linhasPg);
    check('o CNPJ da credenciadora entra na linha com forma', a[0].cnpjCredenciadora === '11222333000181' && a[1].cnpjCredenciadora === undefined);
    check('  formas e credenciadoras lidas uma vez por conferência', conta('adquirentes') === 1 && conta('loadData') === 1);
    check('sem methodId nenhum, devolve como veio e não lê nada', (await credenciadora([{ amount: 1 }], { formas: () => { throw new Error('leu'); }, adquirentes: () => { throw new Error('leu'); } }))[0].amount === 1);
    check('não-lista devolve null', (await credenciadora('x', {})) === null);
  }

  console.log('\n--- 6. SPED: só o "já estava" pula a releitura ---');
  const sped = require('../lib/db/sped-escrituracao');
  const clienteFalso = (respostas) => {
    const sqls = [];
    return {
      sqls,
      async query(sql) {
        sqls.push(sql.replace(/\s+/g, ' ').trim());
        const r = respostas.find(([trecho]) => sql.includes(trecho));
        if (r && r[1] instanceof Error) throw r[1];
        return { rows: r ? r[1] : [] };
      }
    };
  };
  const est = { id: 'E', cnpj: '43792899000135' };
  {
    const c = clienteFalso([]);
    const r = await sped.escriturarNfeEmitida({ id: 'n1', status: 'AUTORIZADO' }, est, { cliente: c, jaEscriturado: { id: 'd1', situacao: 'REGULAR' } });
    check('autorizada já escriturada: "ja_estava" sem consulta', r.situacao === 'ja_estava' && c.sqls.length === 0);
  }
  {
    const c = clienteFalso([]);
    const r = await sped.escriturarNfeEmitida({ id: 'n1', status: 'CANCELADO' }, est, { cliente: c, jaEscriturado: { id: 'd1', situacao: 'CANCELADO' } });
    check('cancelada já cancelada: "ja_estava" sem consulta', r.situacao === 'ja_estava' && c.sqls.length === 0);
  }
  {
    // A foto do mês dizia REGULAR, mas alguém já cancelou: relê e não grava.
    const c = clienteFalso([['from fiscal_documentos where nfe_id = $1', [{ id: 'd1', situacao: 'CANCELADO' }]]]);
    const r = await sped.escriturarNfeEmitida({ id: 'n1', status: 'CANCELADO' }, est, { cliente: c, jaEscriturado: { id: 'd1', situacao: 'REGULAR' } });
    check('cancelamento a seguir: RELÊ na hora (a foto não decide escrita)', r.situacao === 'ja_estava' && c.sqls.length === 1);
  }
  {
    const c = clienteFalso([]);
    const r = await sped.escriturarNfeEmitida({ id: 'n1', status: 'AUTORIZADO' }, est, { cliente: c });
    check('sem a foto: a consulta de sempre (e o XML que falta vira pendência)', r.situacao === 'pendente' && c.sqls.length === 2);
  }
  {
    const notas = [
      { id: 'n1', status: 'AUTORIZADO', numero: 1 },
      { id: 'n2', status: 'AUTORIZADO', numero: 2 },
      { id: 'n3', status: 'AUTORIZADO', numero: 3 }
    ];
    const c = clienteFalso([
      ['from nfe\n', notas],
      ['where nfe_id = any($1)', [{ nfe_id: 'n1', id: 'd1', situacao: 'REGULAR' }, { nfe_id: 'n2', id: 'd2', situacao: 'REGULAR' }]],
      ['from nfe_entrada', []]
    ]);
    const rel = await sped.sincronizarPeriodo({ estabelecimento: est, ini: '2026-09-01', fim: '2026-09-30', cliente: c });
    const porNota = c.sqls.filter((s) => s.includes('from fiscal_documentos where nfe_id = $1')).length;
    check('o mês: UMA leitura do que já está escriturado, e só a nota nova relê', porNota === 1 && c.sqls.filter((s) => s.includes('any($1)')).length === 1, `${c.sqls.length} consultas`);
    check('  com a nota nova pendente, como antes', rel.pendentes.length === 1 && /NF-e 3/.test(rel.pendentes[0]));
    const daNfe = c.sqls.find((s) => s.includes('from nfe where'));
    check('  e sem os dois jsonb da nota', daNfe && !/select \*/.test(daNfe) && !/payload_enviado|resposta_focus/.test(daNfe), daNfe && daNfe.slice(0, 60));
  }
  {
    const c = clienteFalso([
      ['from nfe\n', [{ id: 'n1', status: 'AUTORIZADO', numero: 1 }]],
      ['where nfe_id = any($1)', new Error('caiu')],
      ['from nfe_entrada', []]
    ]);
    const rel = await sped.sincronizarPeriodo({ estabelecimento: est, ini: '2026-09-01', fim: '2026-09-30', cliente: c });
    check('a leitura do mês que falha volta à consulta por nota', c.sqls.filter((s) => s.includes('from fiscal_documentos where nfe_id = $1')).length === 1 && rel.pendentes.length === 1);
  }

  console.log('\n--- 7. as telas ---');
  const analiseTela = ler('public/modules/fiscal/subs/analise_fiscal.js');
  const limiteTela = Number((/const LIMITE_NA_TELA = (\d+);/.exec(analiseTela) || [])[1]);
  const rotaAnalise = src.slice(src.indexOf("if (pathname === '/api/fiscal/analise-fiscal' && req.method === 'GET')"));
  const corte = Number((/produtos: a\.produtos\.slice\(0, (\d+)\)/.exec(rotaAnalise.slice(0, 1200)) || [])[1]);
  // Se a tela passar a mostrar mais do que o servidor manda, a lista sai
  // cortada sem aviso nenhum.
  check('o servidor corta no MESMO número que a tela desenha', limiteTela > 0 && corte === limiteTela, `${corte} x ${limiteTela}`);
  check('  e "e mais N" conta pela quantidade total', /a\.quantidade > LIMITE_NA_TELA \? `<p class="muted">e mais \$\{num\(a\.quantidade - LIMITE_NA_TELA\)\}/.test(analiseTela));
  check('abrir um alerta não refaz a análise', /desenhar\(ctx, \{ reusar: true \}\);/.test(analiseTela));
  // A análise guardada é a mesma que os números da tela contam; quem corrigiu
  // um cadastro em outra aba precisa de um jeito de ver o resultado novo sem
  // sair e entrar.
  check('  e há "Analisar de novo", que analisa sem reusar', /id="analiseFiscalDeNovo"/.test(analiseTela)
    && /#analiseFiscalDeNovo'\)\?\.addEventListener\('click', \(\) => desenhar\(ctx\)\)/.test(analiseTela));

  const preCheckTela = ler('public/modules/fiscal/subs/pre_check.js');
  check('pré-check: a data digitada espera a digitação parar', /setTimeout\([\s\S]{0,80}ESPERA_DA_DIGITACAO_MS\)/.test(preCheckTela));
  check('  só a última conferência desenha', /if \(minhaVez !== vez(?: \|\| !aindaNaTela\(state\))?\) return;[\s\S]*\{ signal: controle\.signal \}\);[\s\S]*if \(minhaVez !== vez\) return;/.test(preCheckTela));
  // A resposta que chega depois de a pessoa ter ido para outra tela não pode
  // desenhar por cima dela (achado da revisão: `vez` não basta, porque ninguém
  // chamou desenhar de novo). A guarda é executada de verdade aqui.
  {
    const corpo = (/function aindaNaTela\(state\) \{([\s\S]*?)\n  \}/.exec(preCheckTela) || [])[1];
    const aindaNaTela = corpo ? new Function('state', corpo) : () => true;
    check('  e só desenha se a pessoa ainda está no pré-check',
      aindaNaTela({ activeModule: 'fiscal', activeSub: 'pre_check' }) === true
      && aindaNaTela({ activeModule: 'fiscal', activeSub: 'painel' }) === false
      && aindaNaTela({ activeModule: 'sales', activeSub: 'pre_check' }) === false);
    const depoisDaConsulta = preCheckTela.slice(preCheckTela.indexOf('{ signal: controle.signal }'));
    check('    conferido depois da consulta e antes de desenhar',
      /if \(!aindaNaTela\(state\)\) return;/.test(depoisDaConsulta.slice(0, depoisDaConsulta.indexOf('content.innerHTML'))));
  }

  const logsTela = ler('public/modules/fiscal/subs/logs.js');
  // O FILTRO BUSCA DE NOVO. Uma versão desta rodada guardava a lista da visita
  // e só redesenhava; a revisão pegou que o status muda pelo webhook
  // (PROCESSANDO -> AUTORIZADO/ERRO) e o clique em "Com problema" mostrava o
  // status de quando a pessoa entrou. Este check prende o comportamento de antes.
  check('logs: o filtro busca a lista de novo (status muda pelo webhook)',
    /state\.fiscalLogFiltro = botao\.dataset\.logFiltro;\s*redesenhar\(\);/.test(logsTela) && !/reusar/.test(logsTela));
  check('  o JSON da nota só é montado no clique em Detalhes', !/\$\{F\.blocoJson\(escapeHtml, 'Enviado à SEFAZ', r\.payloadEnviado\)\}/.test(logsTela)
    && /F\.blocoJson\(escapeHtml, 'Enviado à SEFAZ', visiveis\[i\]\.payloadEnviado\)/.test(logsTela));

  console.log('\n--- 8. notas contra o CNPJ ---');
  const rotaDfe = src.slice(src.indexOf("if (pathname === '/api/fiscal/dfe' && req.method === 'GET')"));
  check('os ponteiros de NSU são lidos em paralelo', /await Promise\.all\(cnpjsDosEstabelecimentos\.map/.test(rotaDfe.slice(0, 2500)));

  console.log('\n--- 9. a ordem das notas de um pedido ---');
  {
    // Sem banco: troca banco.from por um gravador e confere o que cada função
    // pede. A ordenação em si é do Postgres; o que se prende aqui é que os dois
    // caminhos (emissão e pré-check) pedem a MESMA ordem estável, e que o Map
    // não a embaralha — senão a mensagem "já tem a NF-e N" podia citar outra
    // nota num pedido com duas vivas.
    const { banco } = require('../lib/db/client');
    const fiscalDbOrdem = require('../lib/db/fiscal');
    const original = banco.from;
    const pedidas = [];
    const linhas = [
      { id: 'b', order_id: 'P1', status: 'AUTORIZADO', numero: 120 },
      { id: 'x', order_id: 'P2', status: 'ERRO', numero: 5 },
      { id: 'a', order_id: 'P1', status: 'AUTORIZADO', numero: 121 }
    ];
    banco.from = (tabela) => {
      const q = { tabela, ordens: [], filtros: [] };
      pedidas.push(q);
      const b = {
        select() { return b; },
        eq(c) { q.filtros.push(['eq', c]); return b; },
        in(c) { q.filtros.push(['in', c]); return b; },
        order(c, o) { q.ordens.push([c, !(o && o.ascending === false)]); return b; },
        then(ok, erro) {
          const dados = q.filtros[0][0] === 'eq' ? linhas.filter((l) => l.order_id === 'P1') : linhas;
          return Promise.resolve({ data: dados, error: null }).then(ok, erro);
        }
      };
      return b;
    };
    try {
      const uma = await fiscalDbOrdem.getNfesPorPedido('P1');
      const varias = await fiscalDbOrdem.getNfesPorPedidos(['P1', 'P2']);
      const esperado = [['criado_em', true], ['id', true]];
      check('emissão: criado_em e depois id, crescentes', igual(pedidas[0].ordens, esperado), JSON.stringify(pedidas[0].ordens));
      check('  pré-check: a MESMA ordem', igual(pedidas[1].ordens, pedidas[0].ordens), JSON.stringify(pedidas[1].ordens));
      check('  o Map guarda a ordem em que as linhas vieram',
        igual(varias.get('P1').map((n) => n.numero), [120, 121]) && igual(uma.map((n) => n.numero), varias.get('P1').map((n) => n.numero)));
    } finally {
      banco.from = original;
    }
  }

  console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TODOS OS CHECKS PASSARAM =====');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
