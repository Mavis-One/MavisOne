window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.fiscal = window.MavisSubscreenRegistry.fiscal || {};

// EXIGÊNCIAS DE NF-e POR CLIENTE (fase FB, 22/10/2026).
//
// O usuário colou "006_exigencias_nfe_cliente.sql": clientes como a ARWEG
// (Grupo WEG) só aceitam a nota com o pedido de compra deles em cada item, o
// código do material, o pedido nas informações complementares, sem dados
// bancários, e o XML por e-mail. Cada cliente assim tem aqui o seu perfil.
//
// O que o perfil faz:
//   * no pedido de venda dele aparece o bloco "Pedido do cliente";
//   * a emissão leva xPed/nItemPed, o código do material e o texto do modelo;
//   * a nota que não atende é recusada ANTES de transmitir, com a lista do que
//     falta (shared/exigencias_nfe.js, a mesma regra na tela e no servidor);
//   * autorizada, a Focus manda o XML e a DANFE aos e-mails daqui.
window.MavisSubscreenRegistry.fiscal.exigencias_cliente = async function renderExigenciasCliente(ctx) {
  const { api, content, escapeHtml, showToast, confirmModal } = ctx;
  const Exigencias = window.MavisExigenciasNfe;

  let perfis = [];
  // Documento do perfil aberto no formulário: 'novo' para um perfil novo,
  // null com o formulário fechado.
  let editando = null;

  async function carregar() {
    const res = await api('/api/fiscal/exigencias-cliente');
    perfis = res.perfis || [];
  }

  try {
    await carregar();
  } catch (error) {
    content.innerHTML = `<div class="panel"><h3>Exigências de NF-e por Cliente</h3><p class="muted">${escapeHtml(error.message || 'Não foi possível carregar os perfis.')}</p></div>`;
    return;
  }

  const iconeEditar = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>';
  const iconeExcluir = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/></svg>';

  const documentoFormatado = (d) => {
    const x = String(d || '').replace(/\D/g, '');
    if (x.length === 14) return x.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
    if (x.length === 11) return x.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
    return x;
  };

  function linha(p) {
    const marcadas = Exigencias.MARCAS.filter((m) => p[m.campo]);
    return `
      <tr>
        <td class="op-acoes">
          <button type="button" class="icon-button edit" data-editar-exigencia="${escapeHtml(p.cnpjCpf)}" title="Editar perfil" aria-label="Editar o perfil de ${escapeHtml(p.nome)}">${iconeEditar}</button>
          <button type="button" class="icon-button delete" data-excluir-exigencia="${escapeHtml(p.cnpjCpf)}" title="Excluir perfil" aria-label="Excluir o perfil de ${escapeHtml(p.nome)}">${iconeExcluir}</button>
        </td>
        <td><strong>${escapeHtml(p.nome)}</strong><small class="muted">${escapeHtml(documentoFormatado(p.cnpjCpf))}</small></td>
        <td title="${escapeHtml(marcadas.map((m) => m.rotulo).join('\n'))}">${marcadas.length} de ${Exigencias.MARCAS.length}</td>
        <td>${p.emailsXml.length ? escapeHtml(p.emailsXml.join(', ')) : '<span class="muted">—</span>'}</td>
        <td>${p.ativo ? '<span class="finance-badge finance-badge-success">Ativo</span>' : '<span class="finance-badge finance-badge-muted">Inativo</span>'}</td>
      </tr>
    `;
  }

  function formulario() {
    if (!editando) return '';
    const p = editando === 'novo'
      ? { cnpjCpf: '', nome: '', ativo: true, emailsXml: [], rotuloMaterial: 'MATERIAL', modeloInfcpl: '', observacoes: '' }
      : perfis.find((x) => x.cnpjCpf === editando);
    if (!p) return '';
    const grupo = (nome) => Exigencias.MARCAS.filter((m) => m.grupo === nome).map((m) => `
      <label class="cadastro-check">
        <input type="checkbox" name="${m.campo}" ${p[m.campo] ? 'checked' : ''} />
        <span>${escapeHtml(m.rotulo)}</span>
      </label>`).join('');
    return `
      <div class="panel" id="fiscalExigenciaPainel">
        <div class="cadastro-page-head">
          <div>
            <h3>${editando === 'novo' ? 'Novo perfil de exigências' : `Exigências de ${escapeHtml(p.nome)}`}</h3>
            ${p.alteradoPorNome ? `<p class="muted">Alterado por ${escapeHtml(p.alteradoPorNome)}${p.alteradoEm ? ' em ' + escapeHtml(new Date(p.alteradoEm).toLocaleString('pt-BR')) : ''}</p>` : ''}
          </div>
        </div>
        <form id="fiscalExigenciaForm" class="form-grid">
          <div class="row">
            <label>CNPJ ou CPF do cliente *
              <input name="cnpjCpf" required inputmode="numeric" value="${escapeHtml(documentoFormatado(p.cnpjCpf))}" placeholder="00.000.000/0000-00" />
            </label>
            <label>Nome *
              <input name="nome" required maxlength="200" value="${escapeHtml(p.nome)}" />
            </label>
            <label class="cadastro-check" style="align-self:end;">
              <input type="checkbox" name="ativo" ${p.ativo ? 'checked' : ''} />
              <span>Ativo</span>
            </label>
          </div>
          <h4 class="produto-subtitulo">No XML</h4>
          <div class="cadastro-check-grid">${grupo('XML')}</div>
          <h4 class="produto-subtitulo">Na DANFE</h4>
          <div class="cadastro-check-grid">${grupo('DANFE')}</div>
          <div class="row">
            <label>Rótulo do código do material
              <input name="rotuloMaterial" maxlength="40" value="${escapeHtml(p.rotuloMaterial || 'MATERIAL')}" placeholder="MATERIAL ARWEG" />
              <small class="muted">Sai no texto de cada item: "${escapeHtml(p.rotuloMaterial || 'MATERIAL')}: 12345".</small>
            </label>
            <label>E-mails para o XML (até ${Exigencias.LIMITE_DE_EMAILS})
              <input name="emailsXml" value="${escapeHtml((p.emailsXml || []).join(', '))}" placeholder="nfe@cliente.com.br" />
              <small class="muted">Separados por vírgula. Na autorização, a Focus manda o XML e a DANFE.</small>
            </label>
          </div>
          <label>Texto das informações complementares
            <textarea name="modeloInfcpl" rows="3" maxlength="1000">${escapeHtml(p.modeloInfcpl || '')}</textarea>
            <small class="muted">Entra sozinho nas observações da nota. Variáveis: {pedido} {cond_pagto} {centro} {deposito}.</small>
          </label>
          <label>Observações (só para consulta)
            <textarea name="observacoes" rows="3" maxlength="2000">${escapeHtml(p.observacoes || '')}</textarea>
          </label>
          <div class="finance-actions-row">
            <button type="submit">Salvar perfil</button>
            <button type="button" class="secondary" id="fiscalExigenciaCancelar">Cancelar</button>
          </div>
          <p class="fiscal-regra-erro" id="fiscalExigenciaErro" hidden></p>
        </form>
      </div>
    `;
  }

  function desenhar() {
    content.innerHTML = `
      <div class="panel">
        <div class="cadastro-page-head">
          <div>
            <h3>Exigências de NF-e por Cliente</h3>
            <p class="muted">O que cada cliente exige na nota. No pedido dele aparece o bloco "Pedido do cliente", e a NF-e que não atende é recusada antes de transmitir.</p>
          </div>
          <button type="button" id="fiscalExigenciaNovo">Novo perfil</button>
        </div>
        ${perfis.length ? `
          <div class="table-scroll">
            <table class="table table-actions">
              <thead><tr><th>Ações</th><th>Cliente</th><th>Exigências</th><th>E-mails do XML</th><th>Situação</th></tr></thead>
              <tbody>${perfis.map(linha).join('')}</tbody>
            </table>
          </div>` : '<p class="muted">Nenhum cliente com exigências cadastradas.</p>'}
      </div>
      ${formulario()}
    `;
    ligar();
  }

  function mostrarErro(texto) {
    const erro = content.querySelector('#fiscalExigenciaErro');
    if (!erro) return;
    erro.textContent = texto;
    erro.hidden = !texto;
  }

  function abrir(documento) {
    editando = documento;
    desenhar();
    content.querySelector('#fiscalExigenciaPainel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function ligar() {
    content.querySelector('#fiscalExigenciaNovo')?.addEventListener('click', () => abrir('novo'));
    content.querySelectorAll('[data-editar-exigencia]').forEach((botao) => {
      botao.addEventListener('click', () => abrir(botao.dataset.editarExigencia));
    });
    content.querySelectorAll('[data-excluir-exigencia]').forEach((botao) => {
      botao.addEventListener('click', async () => {
        const perfil = perfis.find((x) => x.cnpjCpf === botao.dataset.excluirExigencia);
        const ok = await confirmModal(`Excluir as exigências de "${perfil ? perfil.nome : ''}"? As próximas notas dele saem sem o pedido de compra e sem a conferência. Para só suspender, desmarque "Ativo".`);
        if (!ok) return;
        try {
          await api(`/api/fiscal/exigencias-cliente/${encodeURIComponent(botao.dataset.excluirExigencia)}`, { method: 'DELETE' });
          showToast('Perfil excluído.', 'success');
          if (editando === botao.dataset.excluirExigencia) editando = null;
          await carregar();
          desenhar();
        } catch (error) {
          showToast(error.message || 'Erro ao excluir o perfil.', 'error');
        }
      });
    });
    content.querySelector('#fiscalExigenciaCancelar')?.addEventListener('click', () => {
      editando = null;
      desenhar();
    });
    content.querySelector('#fiscalExigenciaForm')?.addEventListener('submit', async (evento) => {
      evento.preventDefault();
      const form = evento.currentTarget;
      const campo = (nome) => form.querySelector(`[name="${nome}"]`);
      const corpo = {
        cnpjCpf: campo('cnpjCpf').value,
        nome: campo('nome').value,
        ativo: campo('ativo').checked,
        rotuloMaterial: campo('rotuloMaterial').value,
        emailsXml: campo('emailsXml').value,
        modeloInfcpl: campo('modeloInfcpl').value,
        observacoes: campo('observacoes').value
      };
      Exigencias.MARCAS.forEach((m) => { corpo[m.campo] = campo(m.campo).checked; });
      // A mesma conferência do servidor, antes de ir: e-mail inválido e
      // documento curto aparecem aqui, sem ida e volta.
      const { erros } = Exigencias.normalizarPerfil(corpo);
      if (erros.length) { mostrarErro(erros.join(' ')); return; }
      mostrarErro('');
      try {
        const res = await api(`/api/fiscal/exigencias-cliente/${encodeURIComponent(editando)}`, { method: 'PUT', body: JSON.stringify(corpo) });
        showToast('Perfil salvo.', 'success');
        editando = null;
        await carregar();
        desenhar();
        if (res.perfil) content.querySelector(`[data-editar-exigencia="${res.perfil.cnpjCpf}"]`)?.closest('tr')?.scrollIntoView({ block: 'center' });
      } catch (error) {
        mostrarErro(error.message || 'Erro ao salvar o perfil.');
      }
    });
  }

  desenhar();
};
