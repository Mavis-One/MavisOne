window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.fiscal = window.MavisSubscreenRegistry.fiscal || {};

// Inutilizar NF-e: declara à SEFAZ que uma faixa de numeração não será usada.
//
// O caminho inteiro já existia — a rota POST /api/fiscal/inutilizar, a chamada
// à Focus NFe e a gravação em nfe_eventos. Só não havia tela, então a função
// estava pronta e inalcançável.
//
// É irreversível: número inutilizado não volta, e a faixa não pode ser
// reaproveitada. Por isso a tela confirma repetindo a faixa em vez de perguntar
// "tem certeza?" — o que se erra aqui é o NÚMERO, e um "tem certeza?" genérico
// não faz ninguém reler o número.
(function (F) {
  const MIN_JUSTIFICATIVA = 15;

  async function desenhar(ctx) {
    const { api, content, escapeHtml, showToast, state } = ctx;
    const redesenhar = () => desenhar(ctx);

    const { lista, escolhido, erro } = await F.carregarEstabelecimentos(ctx, { somenteEmitentes: true });
    if (!lista.length) {
      content.innerHTML = F.semEstabelecimento(escapeHtml, 'Inutilizar NF-e',
        erro || 'Nenhum estabelecimento habilitado para emitir NF-e.');
      return;
    }

    const rascunho = state.fiscalInutilizarDraft || { serie: '', numeroInicial: '', numeroFinal: '', justificativa: '' };

    content.innerHTML = `
      <div class="panel">
        <div class="cadastro-page-head">
          <div>
            <h3>Inutilizar NF-e</h3>
            <p class="muted">Avisa a SEFAZ de que esses números não virarão nota — é o que explica um pulo na sequência.</p>
          </div>
          ${F.seletorEstabelecimento(escapeHtml, lista, escolhido)}
        </div>

        <div class="fiscal-aviso">
          <p><strong>Não tem volta.</strong> Número inutilizado não pode ser reaproveitado.
          Use quando a numeração se perdeu de verdade — falha na emissão, quebra de sequência —
          e não para corrigir uma nota: nota emitida se <strong>cancela</strong>, não se inutiliza.</p>
        </div>

        <form id="inutilizarForm" class="form-grid">
          <div class="row">
            <label>Série
              <input name="serie" required inputmode="numeric" value="${escapeHtml(rascunho.serie)}" placeholder="Ex.: 1" />
            </label>
            <label>Número inicial
              <input name="numeroInicial" required inputmode="numeric" value="${escapeHtml(rascunho.numeroInicial)}" />
            </label>
            <label>Número final
              <input name="numeroFinal" required inputmode="numeric" value="${escapeHtml(rascunho.numeroFinal)}" />
              <small class="muted">Para um número só, repita o inicial.</small>
            </label>
          </div>

          <label>Justificativa
            <textarea name="justificativa" required rows="3"
              placeholder="Explique por que esta faixa não será usada.">${escapeHtml(rascunho.justificativa)}</textarea>
            <small class="muted" id="inutilizarContador">Mínimo de ${MIN_JUSTIFICATIVA} caracteres — exigência da SEFAZ, não do sistema.</small>
          </label>

          <p class="form-error" id="inutilizarErro" hidden></p>
          <p id="inutilizarResumo" class="fiscal-resumo" hidden></p>

          <div class="finance-actions-row">
            <button type="submit" class="btn-danger" id="inutilizarBtn">Inutilizar faixa</button>
          </div>
        </form>
      </div>`;

    F.ligarSeletor(ctx, redesenhar);

    const form = content.querySelector('#inutilizarForm');
    const erroEl = content.querySelector('#inutilizarErro');
    const resumoEl = content.querySelector('#inutilizarResumo');
    const contador = content.querySelector('#inutilizarContador');

    const lerCampos = () => {
      const fd = new FormData(form);
      return {
        serie: String(fd.get('serie') || '').trim(),
        numeroInicial: String(fd.get('numeroInicial') || '').trim(),
        numeroFinal: String(fd.get('numeroFinal') || '').trim(),
        justificativa: String(fd.get('justificativa') || '')
      };
    };

    // As MESMAS regras que o servidor aplica (server.js/inutilizarNumeracaoFiscal).
    // Repetidas aqui só para o erro aparecer antes de transmitir; o servidor
    // continua sendo quem decide — validação de tela não é controle.
    function validar(v) {
      if (!v.serie) return 'Informe a série.';
      const ini = Number(v.numeroInicial);
      const fim = Number(v.numeroFinal);
      if (!Number.isFinite(ini) || !Number.isFinite(fim)) return 'Informe números válidos para o início e o fim da faixa.';
      if (ini <= 0 || fim <= 0) return 'A numeração começa em 1.';
      if (fim < ini) return 'O número final não pode ser menor que o inicial.';
      if (v.justificativa.trim().length < MIN_JUSTIFICATIVA) {
        return `A justificativa precisa ter ao menos ${MIN_JUSTIFICATIVA} caracteres (exigência da SEFAZ).`;
      }
      return null;
    }

    function atualizarResumo() {
      const v = lerCampos();
      state.fiscalInutilizarDraft = v;
      const faltam = MIN_JUSTIFICATIVA - v.justificativa.trim().length;
      contador.textContent = faltam > 0
        ? `Faltam ${faltam} caractere${faltam === 1 ? '' : 's'} na justificativa (exigência da SEFAZ).`
        : 'Justificativa com tamanho suficiente.';

      const ini = Number(v.numeroInicial);
      const fim = Number(v.numeroFinal);
      if (v.serie && Number.isFinite(ini) && Number.isFinite(fim) && fim >= ini) {
        const quantos = fim - ini + 1;
        resumoEl.hidden = false;
        resumoEl.innerHTML = `Vai inutilizar <strong>${quantos} número${quantos === 1 ? '' : 's'}</strong> da série <strong>${escapeHtml(v.serie)}</strong>: do <strong>${ini}</strong> ao <strong>${fim}</strong>.`;
      } else {
        resumoEl.hidden = true;
      }
    }

    form.addEventListener('input', atualizarResumo);
    atualizarResumo();

    form.addEventListener('submit', async (evento) => {
      evento.preventDefault();
      const v = lerCampos();
      const problema = validar(v);
      erroEl.hidden = !problema;
      if (problema) { erroEl.textContent = problema; return; }

      const ini = Number(v.numeroInicial);
      const fim = Number(v.numeroFinal);
      const quantos = fim - ini + 1;
      const estab = lista.find((e) => e.id === state.fiscalEstabelecimentoId);
      // A confirmação repete a faixa: é o número que se erra aqui, então é o
      // número que precisa ser relido antes de confirmar.
      const confirmado = window.confirm(
        `Inutilizar ${quantos} número${quantos === 1 ? '' : 's'} da série ${v.serie}, do ${ini} ao ${fim}?\n\n` +
        `Estabelecimento: ${estab ? estab.razaoSocial : '-'}\n\n` +
        'Isso é definitivo: os números não poderão ser usados depois.'
      );
      if (!confirmado) return;

      const botao = content.querySelector('#inutilizarBtn');
      botao.disabled = true;
      botao.textContent = 'Transmitindo…';
      try {
        await api('/api/fiscal/inutilizar', {
          method: 'POST',
          body: JSON.stringify({
            estabelecimentoId: state.fiscalEstabelecimentoId,
            serie: v.serie,
            numeroInicial: ini,
            numeroFinal: fim,
            justificativa: v.justificativa.trim()
          })
        });
        state.fiscalInutilizarDraft = null;
        showToast('Faixa inutilizada na SEFAZ.', 'success');
        // Leva para a lista: a prova de que deu certo é o registro aparecer lá.
        state.activeSub = 'inutilizadas';
        ctx.renderApp();
        ctx.loadModule('fiscal');
      } catch (e) {
        erroEl.hidden = false;
        erroEl.textContent = e.message || 'Não foi possível inutilizar a faixa.';
        botao.disabled = false;
        botao.textContent = 'Inutilizar faixa';
      }
    });
  }

  window.MavisSubscreenRegistry.fiscal.inutilizar = desenhar;
})(window.MavisFiscalDocs);
