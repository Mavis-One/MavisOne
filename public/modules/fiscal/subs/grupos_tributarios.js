window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.fiscal = window.MavisSubscreenRegistry.fiscal || {};

// GRUPOS TRIBUTÁRIOS — o eixo que faltava na parametrização fiscal.
//
// O PROBLEMA QUE ESTA TELA RESOLVE, medido em 21/09/2026
// ------------------------------------------------------
//   produtos cadastrados ............. 5.475
//   NCM distintos entre eles ..........  759
//   regras fiscais cadastradas ........    0
//
// A regra fiscal casa pelo NCM do item. Com 759 NCMs, deixar o catálogo apto a
// emitir exigiria até 759 regras — vezes cada tipo de operação, vezes cada UF
// que mereça tratamento próprio. É por isso que o número de regras é zero: a
// tarefa, daquele jeito, não cabia em ninguém.
//
// O NCM é classificação ADUANEIRA: diz o que a mercadoria É, não como a empresa
// a TRIBUTA. O grupo tributário é a segunda etiqueta, a que faltava. Meia dúzia
// de grupos ("Revenda tributada", "Com substituição", "Monofásico") cobre os
// 5.475 produtos, e a matriz de regras vira algo que uma pessoa mantém.
//
// A EXCEÇÃO CONTINUA POSSÍVEL: regra por NCM ganha de regra por grupo quando as
// duas casam, e ganha por ser mais específica — não por prioridade. O peso está
// em `especificidade`, em lib/db/fiscal.js, com o porquê.
//
// NÃO HÁ BOTÃO DE EXCLUIR, e é decisão: apagar um grupo deixaria produto sem
// classificação e levaria as regras dele embora (o `on delete cascade`), e o
// efeito prático seria nota emitida com tributação diferente da combinada sem
// ninguém entender por quê. Desativar atende ao caso de uso — o grupo sai da
// lista de escolha e continua explicando o passado.
(function (F) {
  function contador(rotulo, valor) {
    return `<div class="card"><h3>${rotulo}</h3><p>${valor}</p></div>`;
  }

  async function desenhar(ctx) {
    const { api, content, escapeHtml, state, showToast } = ctx;
    const redesenhar = () => desenhar(ctx);

    const { lista: empresas, escolhida, erro } = await F.carregarEmpresas(ctx);
    if (!empresas.length) { content.innerHTML = F.semEmpresa(escapeHtml, 'Grupos Tributários', erro); return; }

    let grupos = [];
    let erroConsulta = null;
    try {
      const res = await api(`/api/fiscal/grupos-tributarios?empresaId=${encodeURIComponent(escolhida)}&comUso=1`);
      grupos = res.grupos || [];
    } catch (e) {
      erroConsulta = e.message || 'Não foi possível carregar os grupos.';
    }

    const ativos = grupos.filter((g) => g.ativo);
    const classificados = grupos.reduce((s, g) => s + Number(g.produtos || 0), 0);

    // O MESMO formulário cria e edita, com o grupo em edição guardado no estado
    // — é o desenho que regras.js já usa nesta mesma aba. A alternativa seria
    // pedir nome e descrição em duas caixas seguidas do navegador, e o repo
    // proíbe o prompt cru justamente porque ele não valida nada e perde o texto
    // digitado quando o valor não serve (ver test-nfe-actions.js).
    //
    // O estado é conferido contra a lista carregada: grupo apagado por outra
    // sessão deixaria o formulário editando um id que não existe mais.
    const editando = grupos.some((g) => g.id === (state.gtEditando || {}).id) ? state.gtEditando : null;
    state.gtEditando = editando;

    const linhas = grupos.length
      ? grupos.map((g) => `
        <tr${g.ativo ? '' : ' class="muted"'}>
          <td>
            <strong>${escapeHtml(g.nome)}</strong>
            ${g.descricao ? `<br><span class="muted">${escapeHtml(g.descricao)}</span>` : ''}
          </td>
          <td>${Number(g.produtos || 0).toLocaleString('pt-BR')}</td>
          <td>${Number(g.regras || 0).toLocaleString('pt-BR')}</td>
          <td>${g.ativo ? 'Ativo' : 'Desativado'}</td>
          <td class="acoes">
            <button type="button" class="ghost" data-editar="${escapeHtml(g.id)}">Editar</button>
            <button type="button" class="ghost" data-alternar="${escapeHtml(g.id)}"
              data-ativo="${g.ativo ? '1' : '0'}">${g.ativo ? 'Desativar' : 'Reativar'}</button>
          </td>
        </tr>`).join('')
      : '<tr><td colspan="5" class="muted">Nenhum grupo cadastrado nesta empresa.</td></tr>';

    content.innerHTML = `
      <div class="workspace-head">
        <div>
          <h2>Grupos Tributários</h2>
          <p class="muted">Como a empresa tributa cada produto. A regra fiscal usa o grupo
            como critério, no lugar de uma regra por NCM.</p>
        </div>
        ${F.seletorEmpresa(escapeHtml, empresas, escolhida)}
      </div>

      ${erroConsulta ? `<div class="panel"><p class="muted">${escapeHtml(erroConsulta)}</p></div>` : ''}

      <div class="cards">
        ${contador('Grupos ativos', ativos.length)}
        ${contador('Produtos classificados', classificados.toLocaleString('pt-BR'))}
        ${contador('Produtos sem grupo', '<span id="gtSemGrupo" class="muted">—</span>')}
      </div>

      <div class="panel">
        <h3>${editando ? 'Editar grupo' : 'Novo grupo'}</h3>
        <p class="muted">Um nome que diga o TRATAMENTO, não o produto: "Revenda tributada",
          "Com substituição tributária", "Monofásico PIS/COFINS".</p>
        <form id="gtForm" class="form-grid">
          <label>Nome *<input name="nome" required minlength="2" maxlength="80"
            placeholder="Revenda tributada" value="${escapeHtml(editando ? editando.nome : '')}" /></label>
          <label>Descrição<input name="descricao" maxlength="200"
            placeholder="Quando usar este grupo" value="${escapeHtml(editando ? editando.descricao : '')}" /></label>
          <div class="form-acoes">
            <button type="submit">${editando ? 'Salvar' : 'Criar grupo'}</button>
            ${editando ? '<button type="button" id="gtCancelar" class="ghost">Cancelar</button>' : ''}
          </div>
        </form>
      </div>

      <div class="panel">
        <h3>Grupos desta empresa</h3>
        <table class="data-table">
          <thead><tr><th>Grupo</th><th>Produtos</th><th>Regras</th><th>Situação</th><th></th></tr></thead>
          <tbody>${linhas}</tbody>
        </table>
      </div>

      <div class="panel">
        <h3>Classificar produtos</h3>
        <p class="muted">Aplica um grupo a todos os produtos que casam com a busca. É assim
          que 5.475 produtos são classificados sem abrir um por um.</p>
        ${ativos.length ? `
        <form id="gtLoteForm" class="form-grid">
          <label>Buscar produtos<input name="busca" maxlength="60" placeholder="Nome, SKU ou NCM" /></label>
          <label>Grupo a aplicar *
            <select name="grupoTributarioId" required>
              <option value="">escolha</option>
              ${ativos.map((g) => `<option value="${escapeHtml(g.id)}">${escapeHtml(g.nome)}</option>`).join('')}
            </select>
          </label>
          <div class="form-acoes">
            <button type="button" id="gtPrever" class="ghost">Ver quantos casam</button>
            <button type="submit" id="gtAplicar" disabled>Aplicar ao conjunto</button>
          </div>
        </form>
        <p class="muted" id="gtPrevia"></p>` : '<p class="muted">Crie um grupo ativo antes de classificar.</p>'}
      </div>`;

    F.ligarSeletorEmpresa(ctx, redesenhar);

    // O total sem grupo é uma segunda consulta, e chega depois do desenho de
    // propósito: é um número informativo, e esperá-lo atrasaria a tela toda.
    (async () => {
      try {
        const res = await api('/api/stock/products?grupoTributario=sem');
        const el = content.querySelector('#gtSemGrupo');
        if (el) el.textContent = Number(res.total || 0).toLocaleString('pt-BR');
      } catch { /* o cartão fica com o travessão: não vale um erro na tela. */ }
    })();

    const form = content.querySelector('#gtForm');
    if (form) {
      form.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const dados = Object.fromEntries(new FormData(form).entries());
        const corpo = { nome: dados.nome, descricao: dados.descricao };
        try {
          if (editando) {
            await api(`/api/fiscal/grupos-tributarios/${encodeURIComponent(editando.id)}`, {
              method: 'PUT', body: JSON.stringify(corpo)
            });
            state.gtEditando = null;
            showToast('Grupo atualizado.');
          } else {
            await api('/api/fiscal/grupos-tributarios', {
              method: 'POST', body: JSON.stringify({ ...corpo, empresaId: escolhida })
            });
            showToast('Grupo criado.');
          }
          redesenhar();
        } catch (e) {
          showToast(e.message || 'Não foi possível salvar o grupo.', 'error');
        }
      });
    }

    content.querySelector('#gtCancelar')?.addEventListener('click', () => {
      state.gtEditando = null;
      redesenhar();
    });

    content.querySelectorAll('[data-editar]').forEach((botao) => {
      botao.addEventListener('click', () => {
        const alvo = grupos.find((g) => g.id === botao.dataset.editar);
        if (!alvo) return;
        state.gtEditando = { id: alvo.id, nome: alvo.nome, descricao: alvo.descricao || '' };
        redesenhar();
      });
    });

    content.querySelectorAll('[data-alternar]').forEach((botao) => {
      botao.addEventListener('click', async () => {
        const ligando = botao.dataset.ativo !== '1';
        try {
          await api(`/api/fiscal/grupos-tributarios/${encodeURIComponent(botao.dataset.alternar)}`, {
            method: 'PUT', body: JSON.stringify({ ativo: ligando })
          });
          showToast(ligando ? 'Grupo reativado.' : 'Grupo desativado. Os produtos e as regras continuam apontando para ele.');
          redesenhar();
        } catch (e) {
          showToast(e.message || 'Não foi possível mudar a situação.', 'error');
        }
      });
    });

    // CLASSIFICAR EM LOTE, em dois passos: PREVER e depois APLICAR.
    //
    // O botão de aplicar nasce desabilitado e só liga depois de a prévia dizer
    // quantos produtos casam. Um clique aqui muda a tributação de um conjunto
    // inteiro, e a única defesa contra uma busca vazia pegar os 5.475 é ver o
    // número antes. A lista de ids vem da prévia, e não de um filtro reenviado:
    // assim o que se aplica é exatamente o que se viu.
    const lote = content.querySelector('#gtLoteForm');
    if (lote) {
      let escolhidos = [];
      const previa = content.querySelector('#gtPrevia');
      const aplicar = content.querySelector('#gtAplicar');

      content.querySelector('#gtPrever').addEventListener('click', async () => {
        const busca = new FormData(lote).get('busca') || '';
        escolhidos = [];
        aplicar.disabled = true;
        previa.textContent = 'Conferindo…';
        try {
          const res = await api(`/api/stock/products?search=${encodeURIComponent(busca)}`);
          escolhidos = (res.products || []).map((p) => p.id);
          previa.textContent = escolhidos.length
            ? `${escolhidos.length.toLocaleString('pt-BR')} produto(s) casam com "${busca || 'tudo'}".`
            : 'Nenhum produto casa com essa busca.';
          aplicar.disabled = escolhidos.length === 0;
        } catch (e) {
          previa.textContent = e.message || 'Não foi possível conferir.';
        }
      });

      lote.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const grupoTributarioId = new FormData(lote).get('grupoTributarioId');
        if (!grupoTributarioId || !escolhidos.length) return;
        aplicar.disabled = true;
        try {
          const res = await api('/api/fiscal/grupos-tributarios/classificar', {
            method: 'POST', body: JSON.stringify({ produtoIds: escolhidos, grupoTributarioId })
          });
          showToast(`${Number(res.produtos || 0).toLocaleString('pt-BR')} produto(s) classificados.`);
          redesenhar();
        } catch (e) {
          showToast(e.message || 'Não foi possível classificar.', 'error');
          aplicar.disabled = false;
        }
      });
    }
  }

  window.MavisSubscreenRegistry.fiscal.grupos_tributarios = { render: desenhar };
}(window.MavisFiscal));
