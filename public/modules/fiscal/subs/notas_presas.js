window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.fiscal = window.MavisSubscreenRegistry.fiscal || {};

// NOTAS COM PROBLEMA — as que não chegaram ao fim, e o que fazer com cada uma.
//
// O QUE FALTAVA, e onde a informação estava escondida
// --------------------------------------------------
// `nfe.mensagem_sefaz` guarda a recusa desde sempre. Ela aparecia em dois
// lugares, e nenhum dos dois é onde alguém olha por rotina:
//
//   Logs NF-e ......... ordem cronológica de TUDO o que foi enviado e
//                       respondido. Para achar a recusa de ontem é preciso
//                       rolar por cima de todas as autorizações;
//   tela de emissão ... mostra a mensagem da nota que falhou — mas só se você
//                       já souber qual nota procurar.
//
// E o Painel Fiscal mostra a contagem por status numa rosca: dá para ver que
// existem três notas com erro, e não dá para saber quais nem por quê. Era o
// pior arranjo possível: o sistema sabia a resposta e não tinha onde dizê-la.
//
// A TELA É ORGANIZADA PELO QUE ACONTECEU COM A NUMERAÇÃO, não pelo status, e
// essa é a decisão central. Os quatro status não são o mesmo problema:
//
//   DENEGADO     numeração CONSUMIDA. Não dá para cancelar, a mercadoria não
//                pode circular, e a nota AINDA ASSIM tem de ser escriturada.
//                É o mais grave e o menos óbvio — parece um erro qualquer.
//   ERRO         numeração não consumida. Corrigir o que a SEFAZ apontou e
//                transmitir de novo resolve por inteiro.
//   PROCESSANDO  em voo, ou presa. Aqui a IDADE é o dado: dez segundos é
//                normal, quatro dias é um lote que nunca voltou.
//   RASCUNHO     nasceu e não foi transmitida. Numeração não consumida.
//
// O QUE ESTA TELA NÃO FAZ: não corrige a nota. O requisito VM-FIS-04 do raio-X
// pedia "o botão de correção que leva direto ao campo culpado", e o caminho até
// ele não existe hoje — a correção acontece na tela de emissão, a partir do
// pedido. A tela leva ao PEDIDO de origem, que é o passo real, em vez de
// prometer um atalho que não tem para onde ir.
//
// E não oferece excluir nada. Documento fiscal não se apaga — denegada
// inclusive, que é justamente a que alguém quer apagar.
(function (F) {
  const ROTULO = {
    DENEGADO: 'Denegada pela SEFAZ',
    ERRO: 'Rejeitada',
    PROCESSANDO: 'Em processamento',
    RASCUNHO: 'Rascunho não transmitido'
  };

  // O que o operador precisa saber, por status. Fica aqui, ao lado do rótulo,
  // porque é a razão de a tela existir: a lista sem isto é a mesma rosca do
  // painel, só em formato de tabela.
  const NUMERACAO = {
    DENEGADO: { consumiu: true, texto: 'A numeração FOI consumida e a nota não pode ser cancelada. A mercadoria não pode circular com ela — e ela precisa ser escriturada de todo modo.' },
    ERRO: { consumiu: false, texto: 'A numeração não foi consumida. Corrija o que a SEFAZ apontou e transmita de novo, pelo pedido de origem.' },
    PROCESSANDO: { consumiu: false, texto: 'Aguardando resposta. Se já passou de alguns minutos, a consulta à Focus precisa ser refeita pela tela de emissão.' },
    RASCUNHO: { consumiu: false, texto: 'Nunca foi transmitida e não consumiu numeração. Transmita pelo pedido, ou deixe como está.' }
  };

  const ORDEM = ['DENEGADO', 'ERRO', 'PROCESSANDO', 'RASCUNHO'];

  function dinheiro(v) {
    return Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  // 'aaaa-mm-dd...' -> 'dd/mm/aaaa' por corte de string, sem passar por Date:
  // converter e reformatar faz a data pular um dia em fuso negativo, que é o
  // Brasil inteiro. É a mesma decisão da tela de Arquivos Fiscais.
  function diaBr(iso) {
    const t = String(iso || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return t || '-';
    const [a, m, d] = t.split('-');
    return `${d}/${m}/${a}`;
  }

  /**
   * Há quanto tempo a nota está parada.
   *
   * Existe por causa do PROCESSANDO, onde a idade é o único dado que separa
   * "normal" de "presa". Comparar duas datas ISO em UTC é seguro; é converter
   * para local que estraga.
   */
  function idade(iso) {
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return null;
    const minutos = Math.floor((Date.now() - t) / 60000);
    if (minutos < 0) return null;
    if (minutos < 60) return `${minutos} min`;
    const horas = Math.floor(minutos / 60);
    if (horas < 48) return `${horas} h`;
    return `${Math.floor(horas / 24)} dias`;
  }

  async function desenhar(ctx) {
    const { api, content, escapeHtml, state, loadModule } = ctx;
    const redesenhar = () => desenhar(ctx);

    const { lista, escolhido, erro } = await F.carregarEstabelecimentos(ctx);
    if (!lista.length) { content.innerHTML = F.semEstabelecimento(escapeHtml, 'Notas com Problema', erro); return; }

    let notas = [];
    let erroConsulta = null;
    try {
      const res = await api(`/api/fiscal/nfe/problemas?estabelecimentoId=${encodeURIComponent(escolhido)}`);
      notas = res.notas || [];
    } catch (e) {
      erroConsulta = e.message || 'Não foi possível carregar as notas.';
    }

    const porStatus = ORDEM
      .map((s) => ({ status: s, itens: notas.filter((n) => n.status === s) }))
      .filter((g) => g.itens.length);

    const consumiram = notas.filter((n) => NUMERACAO[n.status] && NUMERACAO[n.status].consumiu).length;

    const grupo = (g) => {
      const info = NUMERACAO[g.status] || { texto: '' };
      return `
      <div class="panel">
        <h3>${escapeHtml(ROTULO[g.status] || g.status)} — ${g.itens.length}</h3>
        <p class="muted${info.consumiu ? ' notas-presas-grave' : ''}">${escapeHtml(info.texto)}</p>
        <table class="data-table">
          <thead><tr>
            <th>Nota</th><th>Emissão</th><th>Parada há</th>
            <th>Destinatário</th><th>Valor</th><th>O que a SEFAZ respondeu</th><th></th>
          </tr></thead>
          <tbody>
            ${g.itens.map((n) => `
              <tr>
                <td>${n.numero ? `${escapeHtml(String(n.numero))}/${escapeHtml(String(n.serie || '1'))}` : '<span class="muted">sem número</span>'}</td>
                <td>${escapeHtml(diaBr(n.dataEmissao))}</td>
                <td>${escapeHtml(idade(n.criadoEm || n.dataEmissao) || '-')}</td>
                <td>${escapeHtml(n.destinatarioNome || '-')}</td>
                <td>${escapeHtml(dinheiro(n.valorTotal))}</td>
                <td>${n.mensagemSefaz
    ? `<span class="notas-presas-motivo">${escapeHtml(n.mensagemSefaz)}</span>`
    : '<span class="muted">nada registrado — a nota não chegou a ser transmitida</span>'}</td>
                <td class="acoes">${n.orderCode
    ? `<button type="button" class="ghost" data-codigo="${escapeHtml(n.orderCode)}">Ver pedido ${escapeHtml(n.orderCode)}</button>`
    : (n.orderId ? '<span class="muted">pedido apagado</span>' : '<span class="muted">avulsa</span>')}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
    };

    content.innerHTML = `
      <div class="workspace-head">
        <div>
          <h2>Notas com Problema</h2>
          <p class="muted">O que a SEFAZ recusou, o que ficou em processamento e o que nunca
            foi transmitido — com o motivo de cada uma.</p>
        </div>
        ${F.seletorEstabelecimento(escapeHtml, lista, escolhido)}
      </div>

      ${erroConsulta ? `<div class="panel"><p class="muted">${escapeHtml(erroConsulta)}</p></div>` : ''}

      ${notas.length ? `
        <div class="cards">
          <div class="card"><h3>Notas paradas</h3><p>${notas.length}</p></div>
          <div class="card">
            <h3>Com numeração consumida</h3>
            <p${consumiram ? ' class="notas-presas-grave"' : ''}>${consumiram}</p>
          </div>
        </div>
        ${porStatus.map(grupo).join('')}
      ` : `
        <div class="panel">
          <h3>Nenhuma nota parada</h3>
          <p class="muted">Toda nota deste estabelecimento está autorizada ou cancelada.
            Rejeitada, denegada, em processamento e rascunho: nenhuma.</p>
        </div>`}

      <div class="panel">
        <h3>Onde esta tela não vai</h3>
        <p class="muted">Ela não corrige a nota e não apaga nada. A correção acontece no
          pedido de origem, pela tela de emissão — é para lá que o botão leva. Documento
          fiscal não se exclui: nota denegada, em especial, consumiu numeração e continua
          existindo para o fisco.</p>
      </div>`;

    F.ligarSeletor(ctx, redesenhar);

    // IR PARA O PEDIDO, pelo CÓDIGO e não pelo id.
    //
    // A lista de vendas filtra por texto (`ordersFilters.search`), e é o único
    // canal que ela oferece a quem chega de fora. O `order_id` é um uuid: a
    // busca não o acha, e navegar com ele entrega os 14.864 pedidos sem
    // filtro nenhum — que é o que `irParaVenda`, em
    // public/modules/finance/subs/nfe_emitidas.js, faz hoje: grava
    // `state.salesOpenRecordId`, que NENHUMA tela lê, e pede a sub-tela
    // 'sales_records', que não existe (o fallback em app.js salva a navegação
    // e manda para 'orders_quotes', então ninguém vê erro — só a lista inteira).
    //
    // `ordersUrlLida` volta a false de propósito: sem isso o bloco que lê os
    // filtros da URL não roda de novo e o filtro que acabamos de pôr é
    // ignorado no primeiro desenho.
    content.querySelectorAll('[data-codigo]').forEach((botao) => {
      botao.addEventListener('click', () => {
        const draft = state.salesDraft || (state.salesDraft = {});
        draft.ordersUrlLida = true;
        draft.ordersFilters = { search: botao.dataset.codigo };
        draft.ordersPage = 1;
        draft.showOrdersFilters = true;
        state.activeSub = 'orders_quotes';
        loadModule('sales');
      });
    });
  }

  window.MavisSubscreenRegistry.fiscal.notas_presas = { render: desenhar };
}(window.MavisFiscal));
