window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.fiscal = window.MavisSubscreenRegistry.fiscal || {};

// NF-e Emitidas e Nova NF-e Avulsa dentro do Fiscal.
//
// São as MESMAS telas do Financeiro, não uma cópia. Copiar o código deixaria
// duas versões para corrigir a cada mudança — e é assim que elas começam a
// divergir sem ninguém perceber. Aqui o registro do Fiscal aponta para a
// função já registrada em finance, que por sua vez decide para onde voltar
// olhando state.activeModule (ver moduloAtual() nos dois arquivos de lá).
//
// O aviso que sobra: se o Financeiro deixar de registrar essas telas, o Fiscal
// perde as duas junto. Por isso a delegação é resolvida na hora da chamada, e
// não na carga — assim a falta vira uma mensagem explicando, em vez de uma
// tela em branco.
(function () {
  function delegar(chave, titulo) {
    return async function (ctx) {
      const tela = window.MavisSubscreenRegistry.finance?.[chave];
      if (typeof tela !== 'function') {
        ctx.content.innerHTML = `
          <div class="panel">
            <h3>${ctx.escapeHtml(titulo)}</h3>
            <p class="muted">Esta tela é a mesma do Financeiro e não está carregada agora.</p>
            <p class="muted">Verifique se <code>modules/finance/subs/${ctx.escapeHtml(chave)}.js</code>
            continua listado no <code>index.html</code>.</p>
          </div>`;
        return;
      }
      await tela(ctx);
    };
  }

  window.MavisSubscreenRegistry.fiscal.nfe_emitidas = delegar('nfe_emitidas', 'NF-e Emitidas');
  window.MavisSubscreenRegistry.fiscal.nova_nfe_avulsa = delegar('nova_nfe_avulsa', 'Nova NF-e Avulsa');
  // A emissão de verdade (transmite à SEFAZ pela Focus) morava só no menu do
  // Financeiro. Ela pertence aqui: é no Fiscal que estão a regra fiscal que
  // decide a tributação, os eventos e os logs da transmissão — o caminho
  // inteiro cadastrar regra → emitir → acompanhar acontece neste módulo.
  window.MavisSubscreenRegistry.fiscal.emitir_nfe_focus = delegar('emitir_nfe_focus', 'Emitir NF-e (SEFAZ)');
})();
