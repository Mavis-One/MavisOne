window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.settings = window.MavisSubscreenRegistry.settings || {};

// CONTAS BANCÁRIAS POR ESTABELECIMENTO (fase CD).
//
// Uma matriz de marcar caixas: linha é conta, coluna é estabelecimento. O que
// esta tela mostra é informação, não é o controle — quem recusa é o servidor,
// na gravação do lançamento, lendo a MESMA regra
// (public/modules/shared/contas_por_estabelecimento.js). Esconder uma opção
// nunca bloqueou ninguém.
//
// O ESTADO DE CADA LINHA É O QUE PRECISA FICAR ÓBVIO
// --------------------------------------------------
// Conta sem nenhuma marcação segue a REGRA PADRÃO, calculada a cada pergunta.
// Conta com marcação vale exatamente o que está marcado. A diferença não é
// decorativa: uma conta no automático continua valendo para a filial que for
// criada no ano que vem; uma conta configurada à mão é uma fotografia daquele
// dia, e a filial nova nasce de fora dela.
//
// Por isso a linha no automático mostra as caixas do padrão em cinza, com a
// etiqueta "regra padrão", e o primeiro clique numa delas transforma a linha em
// configurada — partindo exatamente do que estava visível, para que clicar não
// mude nada além do que a pessoa clicou.
window.MavisSubscreenRegistry.settings.contas_por_estabelecimento = async function renderContasPorEstabelecimento(ctx) {
  const { content, api, showToast, escapeHtml, confirmModal, loadModule, state } = ctx;
  const REGRA = window.MavisContasPorEstabelecimento;

  let dados;
  try {
    dados = await api('/api/settings/contas-por-estabelecimento');
  } catch (error) {
    content.innerHTML = `<div class="panel"><p class="muted">${escapeHtml(error.message || 'Erro ao carregar as contas por estabelecimento.')}</p></div>`;
    return;
  }

  const estabelecimentos = (dados.estabelecimentos || []).filter((e) => e.ativo !== false);
  const contas = (dados.contas || []).filter((c) => c.ativo !== false);

  // Rascunho em memória: `marcadas` é um Set de "contaId estabelecimentoId", e
  // `configuradas` diz quais linhas saíram do automático. Os dois juntos são o
  // estado que o Salvar manda.
  const chave = (contaId, estabId) => `${contaId} ${estabId}`;
  const marcadas = new Set((dados.vinculos || []).map((v) => chave(v.contaId, v.estabelecimentoId)));
  const configuradas = new Set((dados.vinculos || []).map((v) => v.contaId));
  const doPadrao = new Set((dados.padrao || []).map((p) => chave(p.contaId, p.estabelecimentoId)));
  let sujo = false;

  const nomeEstab = (e) => e.nomeFantasia || e.razaoSocial || 'Sem nome';
  const ehMatriz = (e) => String(e.tipo || '').toUpperCase() === 'MATRIZ';

  function donoDaConta(conta) {
    if (!conta.estabelecimentoId) return '<span class="muted">Sem dono — conta da casa</span>';
    const dono = estabelecimentos.find((e) => e.id === conta.estabelecimentoId);
    if (!dono) return '<span class="muted">Dono não encontrado</span>';
    return `${escapeHtml(nomeEstab(dono))} <span class="chip-estab ${ehMatriz(dono) ? 'is-matriz' : ''}">${ehMatriz(dono) ? 'matriz' : 'filial'}</span>`;
  }

  function marcada(contaId, estabId) {
    // Linha no automático espelha o padrão; linha configurada, o que foi salvo.
    return configuradas.has(contaId) ? marcadas.has(chave(contaId, estabId)) : doPadrao.has(chave(contaId, estabId));
  }

  function render() {
    if (!estabelecimentos.length) {
      content.innerHTML = `
        <div class="cadastro-page-head"><div><h3>Contas por Estabelecimento</h3></div></div>
        <div class="panel">
          <p>Não há estabelecimento cadastrado ainda, e esta tela decide o que cada um pode usar.</p>
          <p class="muted">Cadastre a matriz e as filiais em <strong>Configurações › Empresa</strong> e volte aqui.</p>
          <button type="button" id="irParaEmpresa">Ir para Empresa</button>
        </div>`;
      content.querySelector('#irParaEmpresa')?.addEventListener('click', () => {
        state.activeSub = 'fiscal';
        loadModule('settings');
      });
      return;
    }

    if (!contas.length) {
      content.innerHTML = `
        <div class="cadastro-page-head"><div><h3>Contas por Estabelecimento</h3></div></div>
        <div class="panel">
          <p>Não há conta bancária ativa cadastrada.</p>
          <p class="muted">Cadastre em <strong>Cadastros › Contas Bancárias</strong>. É lá também que se diz de qual estabelecimento cada conta é — e é desse vínculo que a regra padrão sai.</p>
        </div>`;
      return;
    }

    const semDono = contas.filter((c) => !c.estabelecimentoId).length;

    content.innerHTML = `
      <div class="cadastro-page-head">
        <div>
          <h3>Contas por Estabelecimento</h3>
          <p class="muted">${contas.length} conta${contas.length === 1 ? '' : 's'} · ${estabelecimentos.length} estabelecimento${estabelecimentos.length === 1 ? '' : 's'}</p>
        </div>
        <div class="cadastro-list-actions">
          <button type="button" class="secondary" id="voltarPadrao">Voltar tudo para a regra padrão</button>
          <button type="button" id="salvarMatriz" ${sujo ? '' : 'disabled'}>Salvar</button>
        </div>
      </div>

      <div class="panel">
        <p class="muted" style="margin-top:0">
          Marque quem pode <strong>usar</strong> cada conta nos lançamentos do Financeiro.
          Sem marcação nenhuma, a conta segue a <strong>regra padrão</strong>:
          a matriz usa todas; a filial usa as contas das filiais e as contas sem dono, mas não a da matriz.
        </p>
        ${semDono ? `<p class="sales-totals-alerta">
          ${semDono} conta${semDono === 1 ? '' : 's'} sem dono — ${semDono === 1 ? 'ela vale' : 'elas valem'} para todo mundo.
          Para a regra padrão distinguir, diga de qual estabelecimento ${semDono === 1 ? 'ela é' : 'elas são'} em Cadastros › Contas Bancárias.
        </p>` : ''}

        <div class="table-scroll">
          <table class="table matriz-contas">
            <thead>
              <tr>
                <th>Conta</th>
                <th>De quem é</th>
                ${estabelecimentos.map((e) => `
                  <th class="col-estab">
                    ${escapeHtml(nomeEstab(e))}
                    <span class="chip-estab ${ehMatriz(e) ? 'is-matriz' : ''}">${ehMatriz(e) ? 'matriz' : 'filial'}</span>
                  </th>`).join('')}
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              ${contas.map((conta) => {
                const manual = configuradas.has(conta.id);
                return `
                <tr data-conta="${escapeHtml(conta.id)}" class="${manual ? 'linha-manual' : 'linha-padrao'}">
                  <td>
                    <strong>${escapeHtml(conta.name)}</strong>
                    ${conta.bank || conta.agency || conta.number
                      ? `<br><span class="muted">${escapeHtml([conta.bank, [conta.agency, conta.number].filter(Boolean).join(' / ')].filter(Boolean).join(' · '))}</span>`
                      : ''}
                  </td>
                  <td>${donoDaConta(conta)}</td>
                  ${estabelecimentos.map((e) => `
                    <td class="col-estab">
                      <input type="checkbox" class="celula-conta"
                        data-conta="${escapeHtml(conta.id)}" data-estab="${escapeHtml(e.id)}"
                        ${marcada(conta.id, e.id) ? 'checked' : ''} />
                    </td>`).join('')}
                  <td>
                    ${manual
                      ? `<span class="estado-manual">configurada</span>
                         <br><button type="button" class="link-botao" data-voltar="${escapeHtml(conta.id)}">voltar ao padrão</button>`
                      : '<span class="muted">regra padrão</span>'}
                  </td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;

    ligar();
  }

  function ligar() {
    content.querySelectorAll('.celula-conta').forEach((caixa) => {
      caixa.addEventListener('change', () => {
        const contaId = caixa.dataset.conta;
        const estabId = caixa.dataset.estab;
        // Primeiro clique numa linha do automático: ela vira configurada
        // partindo do que estava visível. Sem isto, marcar uma caixa apagaria
        // silenciosamente todas as outras daquela linha — a pessoa clicou em
        // uma coisa e perderia outras cinco.
        if (!configuradas.has(contaId)) {
          configuradas.add(contaId);
          for (const e of estabelecimentos) {
            if (doPadrao.has(chave(contaId, e.id))) marcadas.add(chave(contaId, e.id));
          }
        }
        if (caixa.checked) marcadas.add(chave(contaId, estabId));
        else marcadas.delete(chave(contaId, estabId));
        sujo = true;
        render();
      });
    });

    content.querySelectorAll('[data-voltar]').forEach((botao) => {
      botao.addEventListener('click', async () => {
        const contaId = botao.dataset.voltar;
        try {
          await api(`/api/settings/contas-por-estabelecimento/${encodeURIComponent(contaId)}`, { method: 'DELETE' });
          configuradas.delete(contaId);
          for (const e of estabelecimentos) marcadas.delete(chave(contaId, e.id));
          showToast('Conta voltou a seguir a regra padrão.', 'success');
          render();
        } catch (error) {
          showToast(error.message || 'Não consegui voltar a conta ao padrão.', 'error');
        }
      });
    });

    content.querySelector('#salvarMatriz')?.addEventListener('click', async () => {
      // Só as linhas configuradas viram vínculo. As do automático não mandam
      // nada — é a ausência que as mantém no automático.
      const vinculos = [];
      for (const contaId of configuradas) {
        for (const e of estabelecimentos) {
          if (marcadas.has(chave(contaId, e.id))) vinculos.push({ contaId, estabelecimentoId: e.id });
        }
      }
      try {
        const res = await api('/api/settings/contas-por-estabelecimento', {
          method: 'PUT',
          body: JSON.stringify({ vinculos })
        });
        sujo = false;
        showToast(`Salvo: ${res.gravados} vínculo${res.gravados === 1 ? '' : 's'}.`, 'success');
        render();
      } catch (error) {
        showToast(error.message || 'Erro ao salvar.', 'error');
      }
    });

    content.querySelector('#voltarPadrao')?.addEventListener('click', async () => {
      const ok = await confirmModal({
        title: 'Voltar tudo para a regra padrão',
        message: 'Toda configuração manual desta tela será apagada, e as contas voltam a seguir a regra: '
          + 'a matriz usa todas; a filial usa as contas das filiais e as sem dono, mas não a da matriz. '
          + 'Contas e filiais criadas depois passam a seguir a regra sozinhas.',
        confirmText: 'Voltar ao padrão',
        danger: true
      });
      if (!ok) return;
      try {
        await api('/api/settings/contas-por-estabelecimento', {
          method: 'PUT',
          body: JSON.stringify({ voltarTudoAoPadrao: true })
        });
        marcadas.clear();
        configuradas.clear();
        sujo = false;
        showToast('Tudo de volta à regra padrão.', 'success');
        render();
      } catch (error) {
        showToast(error.message || 'Erro ao voltar ao padrão.', 'error');
      }
    });
  }

  // A regra do navegador e a do servidor são a MESMA função. Se o arquivo
  // compartilhado não tiver carregado, esta tela mostraria um padrão inventado
  // por ela — e o servidor recusaria o que ela ofereceu. Melhor dizer.
  if (!REGRA) {
    content.innerHTML = '<div class="panel"><p class="sales-totals-alerta">A regra de contas por estabelecimento não carregou. Recarregue a página.</p></div>';
    return;
  }

  render();
};
