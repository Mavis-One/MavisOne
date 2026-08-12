/**
 * Painéis por módulo — a CONTA, separada da tela.
 *
 * Funções puras: recebem as listas já lidas do banco e devolvem
 * `{ kpis, series, blocos }`. Nada de rede aqui, para o teste conseguir provar
 * cada indicador com quatro linhas de dado inventado em vez de um banco.
 *
 * TRÊS REGRAS QUE VALEM PARA TODOS OS PAINÉIS
 * -------------------------------------------
 * 1. INDICADOR SÓ EXISTE SE O DADO EXISTE. Nenhum painel inventa meta, projeção
 *    ou média de mercado. Onde não há histórico, a variação sai `null` — e o
 *    cartão simplesmente não mostra seta, em vez de mostrar "0%", que afirmaria
 *    que nada mudou.
 * 2. VARIAÇÃO É CONTRA O PERÍODO ANTERIOR DE MESMO TAMANHO. Comparar 7 dias com
 *    o mês passado inteiro produziria quedas de 80% toda semana.
 * 3. CUSTO QUE SOBE NÃO É BOA NOTÍCIA. Cartões de gasto marcam `inverterCor`,
 *    senão "Frota +40%" apareceria em verde.
 */

const num = (v) => Number(v || 0);
const soma = (lista, pegar) => (lista || []).reduce((s, item) => s + num(pegar(item)), 0);
const dia = (v) => String(v || '').slice(0, 10);
const dentro = (data, { from, to }) => Boolean(dia(data)) && dia(data) >= from && dia(data) <= to;

/** Variação percentual. `null` quando não há base — zero seria uma afirmação. */
function variacao(atual, anterior) {
  const base = num(anterior);
  if (!base) return null;
  return ((num(atual) - base) / Math.abs(base)) * 100;
}

function somaDias(dataISO, dias) {
  const d = new Date(`${dataISO}T00:00:00`);
  d.setDate(d.getDate() + dias);
  return d.toISOString().slice(0, 10);
}

/** Intervalo a partir do seletor padrão do painel (ver MavisPainel.PERIODOS). */
const DIAS_POR_PERIODO = { hoje: 1, semana: 7, mes: 30, trimestre: 90, ano: 365 };

function intervaloDoPeriodo(periodo, hoje) {
  const dias = DIAS_POR_PERIODO[periodo] || DIAS_POR_PERIODO.mes;
  return { from: somaDias(hoje, -(dias - 1)), to: hoje, dias };
}

/** O período de mesmo tamanho imediatamente anterior. */
function anterior({ from, dias }) {
  const to = somaDias(from, -1);
  return { from: somaDias(to, -(dias - 1)), to, dias };
}

/**
 * Divide o intervalo em fatias para o gráfico de tendência.
 *
 * O número de pontos é fixo por período (7 dias -> 7 pontos, 12 meses -> 12
 * meses) porque um gráfico com 365 rótulos não é legível e um com 2 não é
 * gráfico.
 */
function fatias({ from, to, dias }) {
  if (dias <= 31) {
    const lista = [];
    for (let i = 0; i < dias; i += 1) {
      const d = somaDias(from, i);
      lista.push({ from: d, to: d, label: d.slice(8, 10) + '/' + d.slice(5, 7) });
    }
    return lista;
  }
  // Acima de um mês, agrupa por mês do calendário: "de 12 a 11" não é um
  // recorte que alguém reconheça no relatório contábil.
  const lista = [];
  let cursor = `${from.slice(0, 7)}-01`;
  while (cursor <= to) {
    const fimMes = new Date(Number(cursor.slice(0, 4)), Number(cursor.slice(5, 7)), 0)
      .toISOString().slice(0, 10);
    lista.push({
      from: cursor < from ? from : cursor,
      to: fimMes > to ? to : fimMes,
      label: `${cursor.slice(5, 7)}/${cursor.slice(2, 4)}`
    });
    cursor = somaDias(fimMes, 1);
  }
  return lista;
}

/** Série de tendência: uma linha por chave declarada. */
function serie(intervalo, registros, campoData, linhas) {
  return fatias(intervalo).map((fatia) => {
    const doPeriodo = (registros || []).filter((r) => dentro(r[campoData], fatia));
    const ponto = { label: fatia.label };
    for (const [chave, calcular] of Object.entries(linhas)) {
      ponto[chave] = calcular(doPeriodo);
    }
    return ponto;
  });
}

/** Agrupa e devolve os N maiores — o formato que barras e ranking consomem. */
function topN(registros, { chave, rotulo, valor, limite = 6, detalhe }) {
  const grupos = new Map();
  for (const r of (registros || [])) {
    const k = chave(r) || '(sem)';
    if (!grupos.has(k)) grupos.set(k, { label: rotulo(r, k), valor: 0, itens: 0 });
    const g = grupos.get(k);
    g.valor += num(valor(r));
    g.itens += 1;
  }
  return [...grupos.values()]
    .sort((a, b) => b.valor - a.valor)
    .slice(0, limite)
    .map((g) => ({ label: g.label, valor: g.valor, detalhe: detalhe ? detalhe(g) : `${g.itens} registro${g.itens === 1 ? '' : 's'}` }));
}

const plural = (n, um, muitos) => `${n} ${n === 1 ? um : muitos}`;

// ------------------------------------------------------------------- COMPRAS

function painelCompras({ compras, intervalo }) {
  const ant = anterior(intervalo);
  const noPeriodo = (compras || []).filter((c) => dentro(c.date, intervalo));
  const noAnterior = (compras || []).filter((c) => dentro(c.date, ant));
  const total = soma(noPeriodo, (c) => c.total);
  const totalAnterior = soma(noAnterior, (c) => c.total);
  const fornecedores = new Set(noPeriodo.map((c) => c.supplierId || c.supplier).filter(Boolean));

  return {
    kpis: [
      {
        id: 'compras-total', titulo: 'Total comprado', valor: total, formato: 'moeda',
        // Comprar mais não é bom nem ruim por si — depende de estoque e venda —
        // então este cartão NÃO inverte cor. Só os de custo puro invertem.
        variacao: variacao(total, totalAnterior),
        detalhe: plural(noPeriodo.length, 'compra', 'compras')
      },
      {
        id: 'compras-ticket', titulo: 'Ticket médio', formato: 'moeda',
        valor: noPeriodo.length ? total / noPeriodo.length : 0,
        variacao: variacao(
          noPeriodo.length ? total / noPeriodo.length : 0,
          noAnterior.length ? totalAnterior / noAnterior.length : 0
        ),
        detalhe: 'por compra no período'
      },
      {
        id: 'compras-fornecedores', titulo: 'Fornecedores', valor: fornecedores.size, formato: 'numero',
        variacao: null, detalhe: 'com compra no período'
      },
      {
        id: 'compras-itens', titulo: 'Itens comprados', formato: 'numero',
        valor: soma(noPeriodo, (c) => c.quantity),
        variacao: variacao(soma(noPeriodo, (c) => c.quantity), soma(noAnterior, (c) => c.quantity)),
        detalhe: 'unidades que entraram'
      }
    ],
    tendencia: serie(intervalo, compras, 'date', {
      valor: (rs) => soma(rs, (c) => c.total),
      itens: (rs) => soma(rs, (c) => c.quantity)
    }),
    porFornecedor: topN(noPeriodo, {
      chave: (c) => c.supplierId || c.supplier,
      rotulo: (c) => c.supplier || '(sem fornecedor)',
      valor: (c) => c.total
    })
  };
}

// ------------------------------------------------------------------- ESTOQUE

function painelEstoque({ produtos, movimentos, depositos, reservas, intervalo }) {
  const lista = produtos || [];
  const valorParado = soma(lista, (p) => num(p.stockQuantity) * num(p.costPrice));
  const abaixo = lista.filter((p) => p.situation === 'abaixo-minimo' || p.situation === 'zerado');
  const doPeriodo = (movimentos || []).filter((m) => dentro(m.date, intervalo));
  const entradas = soma(doPeriodo.filter((m) => m.type === 'entrada'), (m) => m.quantity);
  const saidas = soma(doPeriodo.filter((m) => m.type === 'saida'), (m) => m.quantity);
  const ant = anterior(intervalo);
  const saidasAnterior = soma(
    (movimentos || []).filter((m) => m.type === 'saida' && dentro(m.date, ant)), (m) => m.quantity
  );

  const nomeDeposito = new Map((depositos || []).map((d) => [d.id, d.name]));

  return {
    kpis: [
      {
        id: 'estoque-valor', titulo: 'Valor em estoque', valor: valorParado, formato: 'moeda',
        // Sem histórico de valor de estoque no sistema, não há base honesta de
        // comparação — e uma seta inventada aqui seria lida como tendência.
        variacao: null,
        detalhe: `${lista.length} produto${lista.length === 1 ? '' : 's'}`,
        faixa: lista.length && abaixo.length
          ? { valor: abaixo.length, percentual: Math.round((abaixo.length / lista.length) * 100), rotulo: 'abaixo do mínimo', tom: 'alerta', contagem: true }
          : null
      },
      {
        id: 'estoque-saidas', titulo: 'Saídas', valor: saidas, formato: 'numero',
        variacao: variacao(saidas, saidasAnterior), detalhe: 'unidades no período'
      },
      {
        id: 'estoque-entradas', titulo: 'Entradas', valor: entradas, formato: 'numero',
        variacao: null, detalhe: 'unidades no período'
      },
      {
        id: 'estoque-reservado', titulo: 'Reservado', formato: 'numero',
        valor: reservas ? [...reservas.porProduto.values()].reduce((s, v) => s + v, 0) : 0,
        variacao: null,
        detalhe: reservas ? 'prometido em pedidos abertos' : 'reservas não calculadas'
      },
      {
        id: 'estoque-critico', titulo: 'Abaixo do mínimo', valor: abaixo.length, formato: 'numero',
        variacao: null, tom: abaixo.length ? 'alerta' : '',
        detalhe: abaixo.length ? 'precisam de reposição' : 'nenhum produto crítico'
      }
    ],
    tendencia: serie(intervalo, movimentos, 'date', {
      entradas: (ms) => soma(ms.filter((m) => m.type === 'entrada'), (m) => m.quantity),
      saidas: (ms) => soma(ms.filter((m) => m.type === 'saida'), (m) => m.quantity)
    }),
    // Rosca: as partes SOMAM o valor total do estoque, então a composição é
    // honesta. Um produto sem depósito entra como "sem depósito" em vez de
    // sumir — senão as fatias não fecham com o cartão.
    porDeposito: (() => {
      const porId = new Map();
      for (const produto of lista) {
        for (const b of (produto.balances || [])) {
          if (!num(b.quantity)) continue;
          const k = b.depositId || '';
          porId.set(k, (porId.get(k) || 0) + num(b.quantity) * num(produto.costPrice));
        }
        if (num(produto.unallocated)) {
          porId.set('', (porId.get('') || 0) + num(produto.unallocated) * num(produto.costPrice));
        }
      }
      return [...porId.entries()]
        .map(([id, valor]) => ({ label: nomeDeposito.get(id) || 'Sem depósito', valor }))
        .filter((f) => f.valor > 0)
        .sort((a, b) => b.valor - a.valor);
    })(),
    maioresValores: lista
      .map((p) => ({ label: p.name, valor: num(p.stockQuantity) * num(p.costPrice), detalhe: `${num(p.stockQuantity).toLocaleString('pt-BR')} un.` }))
      .filter((p) => p.valor > 0)
      .sort((a, b) => b.valor - a.valor)
      .slice(0, 6)
  };
}

// -------------------------------------------------------------------- FISCAL

// Status que a SEFAZ devolve, agrupados pelo que significam para quem opera.
// 'autorizada' é o único desfecho bom; os demais exigem ação.
const FISCAL_GRUPOS = {
  autorizada: 'Autorizadas',
  cancelada: 'Canceladas',
  erro: 'Com erro',
  rejeitada: 'Com erro',
  denegada: 'Com erro',
  processando: 'Em processamento',
  pendente: 'Em processamento'
};

function painelFiscal({ notas, intervalo }) {
  const ant = anterior(intervalo);
  const dataDaNota = (n) => dia(n.autorizadoEm || n.dataEmissao || n.criadoEm);
  const noPeriodo = (notas || []).filter((n) => dentro(dataDaNota(n), intervalo));
  const noAnterior = (notas || []).filter((n) => dentro(dataDaNota(n), ant));

  const autorizadas = noPeriodo.filter((n) => n.status === 'autorizada');
  const autorizadasAntes = noAnterior.filter((n) => n.status === 'autorizada');
  const comErro = noPeriodo.filter((n) => FISCAL_GRUPOS[n.status] === 'Com erro');
  const canceladas = noPeriodo.filter((n) => n.status === 'cancelada');

  // Valor autorizado exclui cancelada de propósito: nota cancelada não é
  // faturamento, e somá-la faria o painel fiscal discordar do de Vendas.
  const valor = soma(autorizadas, (n) => n.valorTotal);

  return {
    kpis: [
      {
        id: 'fiscal-autorizadas', titulo: 'Notas autorizadas', valor: autorizadas.length, formato: 'numero',
        variacao: variacao(autorizadas.length, autorizadasAntes.length), detalhe: 'no período'
      },
      {
        id: 'fiscal-valor', titulo: 'Valor autorizado', valor, formato: 'moeda',
        variacao: variacao(valor, soma(autorizadasAntes, (n) => n.valorTotal)),
        detalhe: 'sem as canceladas'
      },
      {
        id: 'fiscal-erro', titulo: 'Com erro', valor: comErro.length, formato: 'numero',
        variacao: null, tom: comErro.length ? 'alerta' : '', inverterCor: true,
        detalhe: comErro.length ? 'rejeitadas ou denegadas' : 'nenhuma rejeição'
      },
      {
        id: 'fiscal-canceladas', titulo: 'Canceladas', valor: canceladas.length, formato: 'numero',
        variacao: null, inverterCor: true, detalhe: 'no período'
      }
    ],
    tendencia: serie(intervalo, (notas || []).map((n) => ({ ...n, _data: dataDaNota(n) })), '_data', {
      autorizadas: (ns) => ns.filter((n) => n.status === 'autorizada').length,
      erros: (ns) => ns.filter((n) => FISCAL_GRUPOS[n.status] === 'Com erro').length
    }),
    porStatus: (() => {
      const grupos = new Map();
      for (const n of noPeriodo) {
        const g = FISCAL_GRUPOS[n.status] || 'Outros';
        grupos.set(g, (grupos.get(g) || 0) + 1);
      }
      return [...grupos.entries()].map(([label, valor]) => ({ label, valor })).sort((a, b) => b.valor - a.valor);
    })(),
    porOperacao: topN(autorizadas, {
      chave: (n) => n.tipoOperacaoFiscal || 'VENDA',
      rotulo: (n, k) => String(k).replace(/_/g, ' '),
      valor: (n) => n.valorTotal
    })
  };
}

// --------------------------------------------------------------------- FROTA

function painelFrota({ veiculos, manutencoes, abastecimentos, intervalo }) {
  const ant = anterior(intervalo);
  const manut = (manutencoes || []).filter((m) => dentro(m.date, intervalo));
  const abast = (abastecimentos || []).filter((a) => dentro(a.date, intervalo));
  const custoManut = soma(manut, (m) => m.cost);
  const custoAbast = soma(abast, (a) => a.total);
  const custoAnterior = soma((manutencoes || []).filter((m) => dentro(m.date, ant)), (m) => m.cost)
    + soma((abastecimentos || []).filter((a) => dentro(a.date, ant)), (a) => a.total);
  const litros = soma(abast, (a) => a.liters);
  const ativos = (veiculos || []).filter((v) => (v.status || 'ativo') === 'ativo');
  const nomeVeiculo = new Map((veiculos || []).map((v) => [v.id, v.plate || v.description || v.model || v.id]));

  return {
    kpis: [
      {
        id: 'frota-custo', titulo: 'Custo da frota', valor: custoManut + custoAbast, formato: 'moeda',
        // Custo subindo é má notícia — sem inverterCor a seta verde
        // comemoraria um problema.
        variacao: variacao(custoManut + custoAbast, custoAnterior), inverterCor: true,
        detalhe: 'combustível + manutenção'
      },
      {
        id: 'frota-combustivel', titulo: 'Combustível', valor: custoAbast, formato: 'moeda',
        variacao: null, inverterCor: true,
        detalhe: litros ? `${litros.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} litros` : 'sem abastecimento'
      },
      {
        id: 'frota-manutencao', titulo: 'Manutenção', valor: custoManut, formato: 'moeda',
        variacao: null, inverterCor: true,
        detalhe: plural(manut.length, 'serviço', 'serviços')
      },
      {
        id: 'frota-preco-litro', titulo: 'Preço médio do litro', formato: 'moeda',
        valor: litros ? custoAbast / litros : 0,
        variacao: null, inverterCor: true,
        detalhe: litros ? 'no período' : 'sem litros lançados'
      },
      {
        id: 'frota-veiculos', titulo: 'Veículos ativos', valor: ativos.length, formato: 'numero',
        variacao: null, detalhe: `${(veiculos || []).length} na frota`
      }
    ],
    tendencia: serie(intervalo, [
      ...(manutencoes || []).map((m) => ({ date: m.date, manutencao: num(m.cost), combustivel: 0 })),
      ...(abastecimentos || []).map((a) => ({ date: a.date, manutencao: 0, combustivel: num(a.total) }))
    ], 'date', {
      combustivel: (rs) => soma(rs, (r) => r.combustivel),
      manutencao: (rs) => soma(rs, (r) => r.manutencao)
    }),
    porVeiculo: topN([
      ...manut.map((m) => ({ vehicleId: m.vehicleId, custo: num(m.cost) })),
      ...abast.map((a) => ({ vehicleId: a.vehicleId, custo: num(a.total) }))
    ], {
      chave: (r) => r.vehicleId,
      rotulo: (r, k) => nomeVeiculo.get(k) || '(veículo removido)',
      valor: (r) => r.custo,
      detalhe: (g) => `${g.itens} lançamento${g.itens === 1 ? '' : 's'}`
    }),
    porTipoManutencao: (() => {
      const grupos = new Map();
      for (const m of manut) {
        const k = m.kind || 'preventiva';
        grupos.set(k, (grupos.get(k) || 0) + num(m.cost));
      }
      return [...grupos.entries()]
        .map(([k, valor]) => ({ label: k.charAt(0).toUpperCase() + k.slice(1), valor }))
        .sort((a, b) => b.valor - a.valor);
    })()
  };
}

// ------------------------------------------------------------------------ RH

function painelRh({ colaboradores, afastamentos, departamentos, intervalo, hoje }) {
  const lista = colaboradores || [];
  const ativos = lista.filter((c) => !c.dismissedAt && (c.status || 'ativo') === 'ativo');
  const admitidos = lista.filter((c) => dentro(c.admittedAt, intervalo));
  const desligados = lista.filter((c) => dentro(c.dismissedAt, intervalo));
  const ant = anterior(intervalo);
  const folha = soma(ativos, (c) => c.salary);

  // Afastado HOJE: começou e ainda não terminou. Sem fim informado, conta como
  // em aberto — é o caso de afastamento sem previsão de retorno.
  const afastadosHoje = (afastamentos || []).filter((a) => dia(a.startDate) <= hoje
    && (!a.endDate || dia(a.endDate) >= hoje));

  const nomeDepto = new Map((departamentos || []).map((d) => [d.id, d.name]));

  return {
    kpis: [
      {
        id: 'rh-ativos', titulo: 'Colaboradores ativos', valor: ativos.length, formato: 'numero',
        variacao: null, detalhe: `${lista.length} na base`
      },
      {
        id: 'rh-folha', titulo: 'Folha mensal', valor: folha, formato: 'moeda',
        variacao: null,
        // Salário em branco no cadastro faria a folha parecer menor do que é.
        // Dizer quantos faltam é a diferença entre um número e um número
        // confiável.
        detalhe: (() => {
          const sem = ativos.filter((c) => !num(c.salary)).length;
          return sem ? `${sem} sem salário cadastrado` : 'somando os ativos';
        })()
      },
      {
        id: 'rh-admissoes', titulo: 'Admissões', valor: admitidos.length, formato: 'numero',
        variacao: variacao(admitidos.length, lista.filter((c) => dentro(c.admittedAt, ant)).length),
        detalhe: 'no período'
      },
      {
        id: 'rh-desligamentos', titulo: 'Desligamentos', valor: desligados.length, formato: 'numero',
        variacao: variacao(desligados.length, lista.filter((c) => dentro(c.dismissedAt, ant)).length),
        inverterCor: true, detalhe: 'no período'
      },
      {
        id: 'rh-afastados', titulo: 'Afastados hoje', valor: afastadosHoje.length, formato: 'numero',
        variacao: null, tom: afastadosHoje.length ? 'alerta' : '', inverterCor: true,
        detalhe: afastadosHoje.length ? 'fora do expediente' : 'equipe completa'
      }
    ],
    tendencia: serie(intervalo, [
      ...lista.filter((c) => c.admittedAt).map((c) => ({ date: c.admittedAt, admissoes: 1, desligamentos: 0 })),
      ...lista.filter((c) => c.dismissedAt).map((c) => ({ date: c.dismissedAt, admissoes: 0, desligamentos: 1 }))
    ], 'date', {
      admissoes: (rs) => soma(rs, (r) => r.admissoes),
      desligamentos: (rs) => soma(rs, (r) => r.desligamentos)
    }),
    porDepartamento: topN(ativos, {
      chave: (c) => c.departmentId,
      rotulo: (c, k) => nomeDepto.get(k) || 'Sem departamento',
      valor: () => 1,
      limite: 8,
      detalhe: (g) => `${g.itens} pessoa${g.itens === 1 ? '' : 's'}`
    }),
    porTipoAfastamento: (() => {
      const grupos = new Map();
      for (const a of (afastamentos || []).filter((x) => dentro(x.startDate, intervalo))) {
        const k = a.kind || 'Outros';
        grupos.set(k, (grupos.get(k) || 0) + 1);
      }
      return [...grupos.entries()].map(([label, valor]) => ({ label, valor })).sort((a, b) => b.valor - a.valor);
    })()
  };
}

// ----------------------------------------------------------------------- PCP

function painelPcp({ ordens, apontamentos, setores, inspecoes, intervalo, hoje }) {
  const lista = ordens || [];
  // "Aberta" e "em produção" são as etapas fixas que o código lê (ver o campo
  // `status` de pcp_orders); `statusId` é o rótulo que a empresa cadastrou e
  // não serve para decidir nada.
  const emAndamento = lista.filter((o) => o.status !== 'concluida' && o.status !== 'cancelada');
  const atrasadas = emAndamento.filter((o) => o.dueDate && dia(o.dueDate) < hoje);
  const apont = (apontamentos || []).filter((a) => dentro(a.date, intervalo));
  const ant = anterior(intervalo);
  const produzido = soma(apont, (a) => a.quantity);
  const produzidoAntes = soma((apontamentos || []).filter((a) => dentro(a.date, ant)), (a) => a.quantity);

  const insp = (inspecoes || []).filter((i) => dentro(i.date, intervalo));
  const inspecionado = soma(insp, (i) => i.quantidadeInspecionada);
  const aprovado = soma(insp, (i) => i.quantidadeAprovada);

  const nomeSetor = new Map((setores || []).map((s) => [s.id, s.name]));

  return {
    kpis: [
      {
        id: 'pcp-abertas', titulo: 'OPs em andamento', valor: emAndamento.length, formato: 'numero',
        variacao: null, detalhe: `${lista.length} no total`
      },
      {
        id: 'pcp-atrasadas', titulo: 'Em atraso', valor: atrasadas.length, formato: 'numero',
        variacao: null, tom: atrasadas.length ? 'alerta' : '', inverterCor: true,
        detalhe: atrasadas.length ? 'passaram da entrega' : 'nenhuma atrasada'
      },
      {
        id: 'pcp-produzido', titulo: 'Produzido', valor: produzido, formato: 'numero',
        variacao: variacao(produzido, produzidoAntes), detalhe: 'unidades apontadas'
      },
      {
        id: 'pcp-qualidade', titulo: 'Aprovação na qualidade', formato: 'percentual',
        valor: inspecionado ? (aprovado / inspecionado) * 100 : 0,
        variacao: null,
        // Sem inspeção o índice sairia 0% — que se lê como "tudo reprovado",
        // o oposto do que aconteceu (nada foi medido).
        detalhe: inspecionado
          ? `${aprovado.toLocaleString('pt-BR')} de ${inspecionado.toLocaleString('pt-BR')} inspecionadas`
          : 'nenhuma inspeção no período',
        tom: inspecionado && (aprovado / inspecionado) < 0.9 ? 'alerta' : ''
      }
    ],
    tendencia: serie(intervalo, apontamentos, 'date', {
      produzido: (rs) => soma(rs, (r) => r.quantity)
    }),
    porSetor: topN(emAndamento, {
      chave: (o) => o.sectorId,
      rotulo: (o, k) => nomeSetor.get(k) || 'Sem setor',
      valor: (o) => num(o.quantity) - num(o.quantityDone),
      limite: 8,
      detalhe: (g) => `${g.itens} OP${g.itens === 1 ? '' : 's'}`
    }),
    porEtapa: (() => {
      const grupos = new Map();
      for (const o of lista) {
        const k = o.status || 'aberta';
        grupos.set(k, (grupos.get(k) || 0) + 1);
      }
      return [...grupos.entries()]
        .map(([k, valor]) => ({ label: k.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()), valor }))
        .sort((a, b) => b.valor - a.valor);
    })()
  };
}

// ----------------------------------------------------------------- CONTRATOS

// Quanto o contrato vale POR MÊS. Sem isso, um anual de R$ 120 mil e um mensal
// de R$ 120 mil somariam igual, e a receita recorrente ficaria doze vezes maior
// do que é.
const MESES_POR_CICLO = { mensal: 1, bimestral: 2, trimestral: 3, semestral: 6, anual: 12, unico: 0 };

function valorMensal(contrato) {
  const meses = MESES_POR_CICLO[contrato.billingCycle];
  // Ciclo desconhecido ou pagamento único não entram na recorrência: chutar
  // "mensal" inflaria o número que o financeiro usa para projetar caixa.
  if (!meses) return 0;
  return num(contrato.value) / meses;
}

function painelContratos({ contratos, tipos, intervalo, hoje }) {
  const lista = contratos || [];
  const ativos = lista.filter((c) => (c.status || 'ativo') === 'ativo');
  const em30 = ativos.filter((c) => c.endDate && dia(c.endDate) >= hoje && dia(c.endDate) <= somaDias(hoje, 30));
  const em90 = ativos.filter((c) => c.endDate && dia(c.endDate) >= hoje && dia(c.endDate) <= somaDias(hoje, 90));
  const vencidos = lista.filter((c) => (c.status || 'ativo') === 'ativo' && c.endDate && dia(c.endDate) < hoje);
  const recorrente = soma(ativos, valorMensal);
  const nomeTipo = new Map((tipos || []).map((t) => [t.id, t.name]));

  return {
    kpis: [
      {
        id: 'contratos-ativos', titulo: 'Contratos ativos', valor: ativos.length, formato: 'numero',
        variacao: null, detalhe: `${lista.length} no total`
      },
      {
        id: 'contratos-recorrente', titulo: 'Receita recorrente', valor: recorrente, formato: 'moeda',
        variacao: null, detalhe: 'por mês, dos contratos ativos'
      },
      {
        id: 'contratos-30', titulo: 'Vencem em 30 dias', valor: em30.length, formato: 'numero',
        variacao: null, tom: em30.length ? 'alerta' : '', inverterCor: true,
        detalhe: em30.length ? 'precisam de renovação' : 'nada vencendo',
        faixa: em90.length ? { valor: em90.length, percentual: Math.round((em30.length / em90.length) * 100), rotulo: 'vencem em 90 dias', tom: 'alerta', contagem: true } : null
      },
      {
        id: 'contratos-vencidos', titulo: 'Vencidos em aberto', valor: vencidos.length, formato: 'numero',
        variacao: null, tom: vencidos.length ? 'alerta' : '', inverterCor: true,
        // Contrato passou da data e continua marcado como ativo: ou renova, ou
        // encerra. Ficar assim é o estado que ninguém decidiu.
        detalhe: vencidos.length ? 'passaram da data e seguem ativos' : 'nenhum pendente'
      }
    ],
    // A tendência aqui olha para FRENTE: contrato não é evento do passado, é
    // compromisso que vence. O gráfico mostra o que vence em cada mês à frente.
    tendencia: serie(
      { from: hoje, to: somaDias(hoje, 365), dias: 366 },
      ativos.filter((c) => c.endDate),
      'endDate',
      {
        vencendo: (cs) => cs.length,
        valor: (cs) => soma(cs, valorMensal)
      }
    ),
    porTipo: (() => {
      const grupos = new Map();
      for (const c of ativos) {
        const k = c.typeId || '';
        if (!grupos.has(k)) grupos.set(k, { label: nomeTipo.get(k) || 'Sem tipo', valor: 0 });
        grupos.get(k).valor += valorMensal(c);
      }
      return [...grupos.values()].filter((g) => g.valor > 0).sort((a, b) => b.valor - a.valor);
    })(),
    maiores: ativos
      .map((c) => ({ label: c.title || `Contrato ${c.code || ''}`, valor: valorMensal(c), detalhe: c.partyName || '' }))
      .filter((c) => c.valor > 0)
      .sort((a, b) => b.valor - a.valor)
      .slice(0, 6)
  };
}

module.exports = {
  variacao,
  somaDias,
  intervaloDoPeriodo,
  anterior,
  fatias,
  serie,
  topN,
  valorMensal,
  painelCompras,
  painelEstoque,
  painelFiscal,
  painelFrota,
  painelRh,
  painelPcp,
  painelContratos
};
