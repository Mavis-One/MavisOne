window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.fiscal = window.MavisSubscreenRegistry.fiscal || {};

// PRÉ-CHECK: quais pedidos seriam RECUSADOS se fossem transmitidos agora.
//
// A pergunta que esta tela responde é feita todo dia, e hoje só tem uma forma
// de ser respondida: emitir e ver. Nota rejeitada consumiu numeração, e a
// numeração não volta.
//
// Na observação do ViperERP de 08/09/2026 o operador descobriu um defeito de
// CADASTRO assim — emitiu, foi recusado com "Falha no Schema XML (Cod: 225)",
// corrigiu a nota à mão, emitiu a seguinte, e foi recusado igual. O erro era o
// mesmo nas duas porque a origem era uma só. Uma lista com as duas lado a lado
// teria mostrado isso na primeira olhada.
//
// A CONFERÊNCIA É A MESMA DA EMISSÃO, no servidor (prepararNfeParaTransmitir).
// Esta tela não sabe nenhuma regra fiscal e é assim de propósito: uma segunda
// lista de conferências, escrita aqui para ser "rápida", diria "tudo certo"
// para notas que a SEFAZ recusa no dia em que uma regra entrasse só do outro
// lado — e aí alguém confia nela.
(function (F) {
  function hoje() {
    return new Date().toISOString().slice(0, 10);
  }

  // 'aaaa-mm-dd' -> 'dd/mm/aaaa', sem passar por Date: converter e reformatar
  // faz a data pular um dia em fuso negativo, que é o Brasil inteiro.
  function diaBr(iso) {
    const texto = String(iso || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(texto)) return texto || '-';
    const [a, m, d] = texto.split('-');
    return `${d}/${m}/${a}`;
  }

  // UMA CONFERÊNCIA POR VEZ, E SÓ A ÚLTIMA DESENHA.
  //
  // O Chrome dispara `change` num <input type="date"> A CADA TECLA que forma
  // uma data válida: digitar o ano 2026 passa por 0002, 0020 e 0202 (oito teclas,
  // oito `change`). Cada um refazia o pré-check — e "De 0202-01-08" com o
  // "Até" já preenchido é o histórico inteiro, 13.698 pedidos. As respostas
  // voltavam fora de ordem, e a última a desenhar podia ser a de uma data que
  // ninguém quis. Agora a tela espera a digitação parar e descarta a resposta
  // que chegar depois de outra conferência ter começado.
  const ESPERA_DA_DIGITACAO_MS = 500;
  let vez = 0;
  let adiada = null;
  let emCurso = null;

  // A PESSOA AINDA ESTÁ NESTA TELA? Uma conferência longa (meses) pode voltar
  // depois de ela ter ido para o Painel ou para outro módulo; sem esta
  // pergunta, a resposta desenharia o pré-check por cima da tela seguinte.
  // `vez` não basta: ninguém chamou desenhar de novo, então a vez continua
  // sendo dela.
  function aindaNaTela(state) {
    return state.activeModule === 'fiscal' && state.activeSub === 'pre_check';
  }

  async function desenhar(ctx) {
    const { api, content, escapeHtml, state } = ctx;
    const redesenhar = () => desenhar(ctx);
    clearTimeout(adiada);
    const minhaVez = ++vez;

    const { lista, escolhido, erro } = await F.carregarEstabelecimentos(ctx);
    if (minhaVez !== vez || !aindaNaTela(state)) return;
    if (!lista.length) { content.innerHTML = F.semEstabelecimento(escapeHtml, 'Pré-check fiscal', erro); return; }

    const de = state.fiscalPreCheckDe || hoje();
    const ate = state.fiscalPreCheckAte || de;

    let resultado = null;
    let erroConsulta = null;
    if (emCurso) emCurso.abort();
    const controle = new AbortController();
    emCurso = controle;
    try {
      resultado = await api(`/api/fiscal/pre-check?estabelecimentoId=${encodeURIComponent(escolhido)}`
        + `&de=${encodeURIComponent(de)}&ate=${encodeURIComponent(ate)}`, { signal: controle.signal });
    } catch (e) {
      erroConsulta = e.message || 'Não foi possível rodar o pré-check.';
    }
    // Outra conferência começou enquanto esta esperava: a tela é dela.
    if (minhaVez !== vez) return;
    emCurso = null;
    if (!aindaNaTela(state)) return;

    const pedidos = (resultado && resultado.pedidos) || [];
    const comProblema = pedidos.filter((p) => !p.ok);
    // OS PROBLEMAS PRIMEIRO. Numa tela de conferência o que interessa é a
    // exceção; obrigar a rolar até achar o vermelho é esconder a resposta.
    const ordenados = comProblema.concat(pedidos.filter((p) => p.ok));

    // O MESMO PROBLEMA EM VÁRIOS PEDIDOS quase sempre é UM defeito de cadastro,
    // não N pedidos ruins — foi exatamente assim no ERP observado. Agrupar é o
    // que transforma "seis pedidos com erro" em "uma credenciadora sem CNPJ".
    const porProblema = new Map();
    for (const p of comProblema) {
      const atual = porProblema.get(p.problema) || [];
      atual.push(p.code);
      porProblema.set(p.problema, atual);
    }
    const repetidos = [...porProblema.entries()].filter(([, codes]) => codes.length > 1);

    content.innerHTML = `
      <div class="panel">
        <div class="cadastro-page-head">
          <div>
            <h3>Pré-check fiscal</h3>
          </div>
          ${F.seletorEstabelecimento(escapeHtml, lista, escolhido)}
        </div>

        <div class="row" style="max-width: 460px;">
          <label>De<input type="date" id="preCheckDe" value="${escapeHtml(de)}" /></label>
          <label>Até<input type="date" id="preCheckAte" value="${escapeHtml(ate)}" /></label>
        </div>

        ${erroConsulta ? `<p class="form-error">${escapeHtml(erroConsulta)}</p>` : ''}

        ${!erroConsulta && !pedidos.length ? `
          <p class="muted">Nenhum pedido pendente de faturamento neste período.</p>` : ''}

        ${pedidos.length ? `
          <p class="${comProblema.length ? 'sales-totals-alerta' : 'sales-totals-nota'}">
            ${comProblema.length
              ? `<strong>${comProblema.length} de ${pedidos.length} ${pedidos.length === 1 ? 'pedido seria recusado' : 'pedidos seriam recusados'}.</strong>
                 Corrija antes de transmitir: cada recusa consome a numeração e ela não volta.`
              : `<strong>Os ${pedidos.length} ${pedidos.length === 1 ? 'pedido passa' : 'pedidos passam'} na conferência.</strong>`}
          </p>` : ''}

        ${repetidos.length ? `
          <div class="fiscal-detalhe">
            <h4>O mesmo problema em mais de um pedido</h4>
            <ul>
              ${repetidos.map(([problema, codes]) => `
                <li><strong>${codes.length} pedidos</strong> (${codes.map((c) => escapeHtml(String(c))).join(', ')}):
                  ${escapeHtml(problema)}</li>`).join('')}
            </ul>
          </div>` : ''}

        ${pedidos.length ? `
        <table class="table">
          <thead>
            <tr>
              <th></th>
              <th>Pedido</th>
              <th>Data</th>
              <th>Cliente</th>
              <th class="num">Valor</th>
              <th>O que impede</th>
            </tr>
          </thead>
          <tbody>
            ${ordenados.map((p) => `
              <tr>
                <td><span class="finance-badge finance-badge-${p.ok ? 'success' : 'danger'}">${p.ok ? 'passa' : 'recusa'}</span></td>
                <td>${escapeHtml(String(p.code || '-'))}</td>
                <td>${escapeHtml(diaBr(p.date))}</td>
                <td>${escapeHtml(p.cliente || '-')}</td>
                <td class="num">${Number(p.valor || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</td>
                <td class="fiscal-justificativa">${p.ok ? '<span class="muted">—</span>' : escapeHtml(p.problema)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
        ` : ''}
      </div>`;

    F.ligarSeletor(ctx, redesenhar);
    const aplicar = (campo, chave) => {
      document.getElementById(campo)?.addEventListener('change', (evento) => {
        state[chave] = evento.target.value;
        // "Até" nunca antes de "De": inverter devolveria uma lista vazia sem
        // explicar por quê.
        if (chave === 'fiscalPreCheckDe' && (state.fiscalPreCheckAte || '') < evento.target.value) {
          state.fiscalPreCheckAte = evento.target.value;
        }
        // Espera a digitação parar: ver ESPERA_DA_DIGITACAO_MS. Se nesse meio
        // tempo a pessoa saiu da tela, o campo não existe mais e nada se
        // desenha — senão o pré-check cairia em cima da tela seguinte.
        clearTimeout(adiada);
        adiada = setTimeout(() => {
          if (document.getElementById(campo)) redesenhar();
        }, ESPERA_DA_DIGITACAO_MS);
      });
    };
    aplicar('preCheckDe', 'fiscalPreCheckDe');
    aplicar('preCheckAte', 'fiscalPreCheckAte');
  }

  window.MavisSubscreenRegistry.fiscal.pre_check = desenhar;
})(window.MavisFiscalDocs);
