// A NF-E COM ERRO: O MOTIVO EM POPUP E A CORREÇÃO (fase EO, 14/10/2026).
//
// Pedido do usuário: "quando uma nota fiscal der erro, mostrar o motivo do erro
// em pop up e me permita entrar dentro dela pra conseguir editar o que já foi
// feito". Usado pela lista NF-e Emitidas e pela própria emissão (recusa na
// hora).
//
// Corrigir não reenvia a nota com erro: ela fica no histórico (nunca excluir
// documento fiscal). O servidor a transforma em NOTA EM EDIÇÃO (fase EL) e a
// emissão abre com o que ela tinha; emitir dali é uma emissão nova.
(function (raiz) {
  // O mesmo que o servidor monta (motivosDoErroDaNfe), para quando a tela já
  // tem a nota na mão (resposta da emissão) e não precisa ir buscar.
  function motivosDaNota(nfe) {
    const resposta = (nfe && nfe.respostaFocus) || {};
    const linhas = [];
    const incluir = (texto) => {
      const t = String(texto || '').trim();
      if (t && !linhas.includes(t)) linhas.push(t);
    };
    incluir(nfe && nfe.mensagemSefaz);
    incluir(resposta.mensagem_sefaz);
    incluir(resposta.mensagem);
    (Array.isArray(resposta.erros) ? resposta.erros : []).forEach((e) => {
      if (e && typeof e === 'object') incluir([e.codigo, e.mensagem].filter(Boolean).join(' — '));
      else incluir(e);
    });
    return { statusSefaz: String(resposta.status_sefaz || ''), motivos: linhas };
  }

  /**
   * O popup. Resolve 'corrigir' quando a pessoa escolhe corrigir, senão null.
   * `podeCorrigir` false esconde o botão (ex.: a tela de emissão, onde a nota
   * já está aberta para corrigir).
   */
  function mostrar({ titulo = 'NF-e com erro', motivos = [], statusSefaz = '', podeCorrigir = true, rotuloCorrigir = 'Corrigir nota', podeExcluir = false } = {}) {
    return new Promise((resolve) => {
      document.getElementById('erroNfeModal')?.remove();
      const overlay = document.createElement('div');
      overlay.id = 'erroNfeModal';
      overlay.className = 'modal-overlay';
      overlay.innerHTML = `
        <div class="modal erro-nfe-modal" role="dialog" aria-modal="true" aria-labelledby="erroNfeTitulo">
          <div class="modal-body">
            <h4 class="prompt-titulo" id="erroNfeTitulo"></h4>
            <p class="erro-nfe-codigo muted" hidden></p>
            <ul class="erro-nfe-motivos"></ul>
          </div>
          <div class="modal-actions">
            ${podeExcluir ? '<button type="button" class="btn btn-danger erro-nfe-excluir" data-acao="excluir">Excluir nota</button>' : ''}
            <button type="button" class="btn btn-muted" data-acao="fechar">Fechar</button>
            ${podeCorrigir ? '<button type="button" class="btn btn-primary" data-acao="corrigir"></button>' : ''}
          </div>
        </div>
      `;
      overlay.querySelector('#erroNfeTitulo').textContent = titulo;
      const botaoCorrigir = overlay.querySelector('[data-acao=corrigir]');
      if (botaoCorrigir) botaoCorrigir.textContent = rotuloCorrigir;
      if (statusSefaz) {
        const codigo = overlay.querySelector('.erro-nfe-codigo');
        codigo.textContent = `Código SEFAZ ${statusSefaz}`;
        codigo.hidden = false;
      }
      const lista = overlay.querySelector('.erro-nfe-motivos');
      (motivos.length ? motivos : ['A SEFAZ não devolveu o motivo. Consulte a nota na Focus NFe.']).forEach((m) => {
        const li = document.createElement('li');
        li.textContent = m;
        lista.appendChild(li);
      });
      const fechar = (valor) => { overlay.remove(); document.removeEventListener('keydown', aoTeclar); resolve(valor); };
      const aoTeclar = (e) => { if (e.key === 'Escape') fechar(null); };
      document.addEventListener('keydown', aoTeclar);
      overlay.addEventListener('click', (e) => { if (e.target === overlay) fechar(null); });
      overlay.querySelector('[data-acao=fechar]').addEventListener('click', () => fechar(null));
      overlay.querySelector('[data-acao=corrigir]')?.addEventListener('click', () => fechar('corrigir'));
      overlay.querySelector('[data-acao=excluir]')?.addEventListener('click', () => fechar('excluir'));
      document.body.appendChild(overlay);
      (overlay.querySelector('[data-acao=corrigir]') || overlay.querySelector('[data-acao=fechar]')).focus();
    });
  }

  async function chamarCorrigir(id, substituir) {
    const token = (typeof getSessionToken === 'function' ? getSessionToken() : '') || '';
    const resposta = await fetch(`/api/fiscal/nfe/${encodeURIComponent(id)}/corrigir`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-auth-token': token },
      body: JSON.stringify({ substituir })
    });
    const corpo = await resposta.json().catch(() => ({}));
    return { ok: resposta.ok, status: resposta.status, corpo };
  }

  /**
   * Prepara a correção no servidor. Resolve com { pedidoId, pedidoCodigo } para
   * abrir a emissão, ou null se a pessoa desistiu. Já havendo nota em edição
   * na mesma chave, pergunta antes de substituir.
   */
  async function prepararCorrecao(id, { confirmar }) {
    let r = await chamarCorrigir(id, false);
    if (r.status === 409 && r.corpo.jaHaNotaEmEdicao) {
      const seguir = confirmar ? await confirmar(r.corpo.error) : false;
      if (!seguir) return null;
      r = await chamarCorrigir(id, true);
    }
    if (!r.ok) throw new Error(r.corpo.error || `Não foi possível abrir a nota para correção (HTTP ${r.status}).`);
    return r.corpo;
  }

  const api = { motivosDaNota, mostrar, prepararCorrecao };
  raiz.MavisErroNfe = api;
})(window);
