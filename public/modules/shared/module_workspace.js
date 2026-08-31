window.MavisModuleRegistry = window.MavisModuleRegistry || {};
window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};

// ============================================================================
// ÁREA DE TRABALHO DO MÓDULO
//
// Abrir um módulo pelo menu caía direto numa tela arbitrária (Vendas em
// "Pedidos e Orçamentos", Compras em "Nova compra"), e as outras 8 ou 17 telas
// só existiam para quem soubesse abrir o submenu lateral. Agora o módulo abre
// numa área de trabalho que mostra TUDO que existe dentro dele, com uma frase
// dizendo para que serve cada tela.
//
// A lista vem de moduleSubItems (app.js), a mesma que alimenta menu, submenu e
// favoritos. Não há segunda lista para manter em dia: cadastrar a tela lá faz
// ela aparecer aqui sozinha.
// ============================================================================

// Ícone pela natureza da tela. A regra lê o rótulo porque os nomes deste
// sistema já seguem convenção ("Novo X" cria, "Painel X" resume) — vale mais
// que carimbar um campo `kind` em 60 entradas e ter que lembrar de mantê-lo.
// A ORDEM importa: "Nova NF-e Avulsa" é tela de criação, não de documento,
// então a regra de criar vem antes da regra de nota.
const REGRAS_ICONE = [
  [/^nov[oa]\b/i, 'criar'],
  [/painel|dashboard/i, 'painel'],
  [/nf-?e|nota/i, 'documento'],
  [/importar|\blog/i, 'importar'],
  [/usuári|permiss|auditoria|empresa/i, 'config']
];

const ICONES = {
  criar: '<path d="M12 5v14"></path><path d="M5 12h14"></path>',
  painel: '<line x1="18" y1="20" x2="18" y2="10"></line><line x1="12" y1="20" x2="12" y2="4"></line><line x1="6" y1="20" x2="6" y2="14"></line>',
  documento: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="8" y1="13" x2="16" y2="13"></line><line x1="8" y1="17" x2="13" y2="17"></line>',
  importar: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line>',
  pendente: '<circle cx="12" cy="12" r="9"></circle><polyline points="12 7 12 12 15 14"></polyline>',
  config: '<line x1="4" y1="21" x2="4" y2="14"></line><line x1="4" y1="10" x2="4" y2="3"></line><line x1="12" y1="21" x2="12" y2="12"></line><line x1="12" y1="8" x2="12" y2="3"></line><line x1="20" y1="21" x2="20" y2="16"></line><line x1="20" y1="12" x2="20" y2="3"></line><line x1="1" y1="14" x2="7" y2="14"></line><line x1="9" y1="8" x2="15" y2="8"></line><line x1="17" y1="16" x2="23" y2="16"></line>',
  lista: '<line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line>'
};

function tipoDaTela(item) {
  if (item.kind && ICONES[item.kind]) return item.kind; // override explícito
  const regra = REGRAS_ICONE.find(([padrao]) => padrao.test(item.label || ''));
  return regra ? regra[1] : 'lista';
}

function svgDoTipo(tipo) {
  return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONES[tipo] || ICONES.lista}</svg>`;
}

// moduleSubItems e moduleLabels são `const` no topo do app.js. `const` de nível
// superior NÃO vira propriedade de window, então `window.moduleSubItems` é
// undefined — a referência tem que ser pelo nome puro, como o dashboard já faz.
// Funciona porque este arquivo carrega antes do app.js mas só LÊ as listas na
// hora de renderizar, quando o app.js já executou.
// Delega para telasVisiveis() do app.js, que e' quem sabe filtrar por usuario
// (as telas marcadas `somenteAdmin` somem para quem nao e' administrador).
//
// A funcao nova NASCEU chamada `telasDoModulo`, igual a esta, e as duas sao
// declaracoes globais: module_workspace.js carrega antes, o app.js declara
// depois e sobrescreve -- entao esta aqui passou a chamar a si mesma e a Area
// de Trabalho estourou a pilha. Nomes diferentes, e o desvio fica explicito.
function telasDoModulo(moduleName) {
  if (typeof telasVisiveis === 'function') return telasVisiveis(moduleName);
  return (typeof moduleSubItems !== 'undefined' && moduleSubItems[moduleName]) || [];
}

window.MavisWorkspace = {
  // Sem sub-tela escolhida, o módulo abre na área de trabalho. O Dashboard
  // Geral fica de fora: ele já é uma tela própria, com gráficos e favoritos.
  deveAbrir(moduleName, state) {
    if (!moduleName || moduleName === 'dashboard') return false;
    if (state.activeSub) return false;
    return telasDoModulo(moduleName).length > 0;
  },

  // Devolve o item quando a sub-tela escolhida ainda não foi construída.
  telaPendente(moduleName, state) {
    if (!state.activeSub) return null;
    return telasDoModulo(moduleName).find((i) => i.key === state.activeSub && i.pendente) || null;
  },

  // Tela de sub-tela ainda não construída.
  //
  // Não é o "será implementado em breve" que existia antes e que o usuário
  // mandou apagar: aquele mostrava uma TABELA VAZIA, dando a entender que o
  // cadastro funcionava e estava sem registros. Aqui não há tabela nem botão
  // falso — a tela diz o que falta e o que destrava.
  renderPendente(ctx, moduleName, item) {
    const { content, escapeHtml, state, renderApp, loadModule } = ctx;
    const modulo = (typeof moduleLabels !== 'undefined' && moduleLabels[moduleName]) || moduleName;
    const prontas = telasDoModulo(moduleName).filter((i) => !i.pendente).length;
    const total = telasDoModulo(moduleName).length;

    content.innerHTML = `
      <div class="panel workspace-pendente">
        <span class="workspace-pendente-icone">${svgDoTipo('pendente')}</span>
        <h3>${escapeHtml(item.label)}</h3>
        <p class="muted">${escapeHtml(item.desc || '')}</p>
        <p>Esta tela está desenhada, mas ainda não tem onde gravar: as tabelas
        de <strong>${escapeHtml(modulo)}</strong> são criadas pela migração
        <code>supabase/migrations/fase-r-modulos-novos.sql</code>, que ainda não
        foi executada no banco.</p>
        <p class="muted">${prontas} de ${total} telas de ${escapeHtml(modulo)} já estão no ar.</p>
        <button type="button" id="voltarAreaTrabalho">Voltar à Área de Trabalho</button>
      </div>
    `;

    content.querySelector('#voltarAreaTrabalho')?.addEventListener('click', () => {
      state.activeSub = null;
      renderApp();
      loadModule(moduleName);
    });
  },

  render(ctx, moduleName) {
    const { content, state, escapeHtml, renderApp, loadModule, showToast } = ctx;
    const itens = telasDoModulo(moduleName);
    const titulo = (typeof moduleLabels !== 'undefined' && moduleLabels[moduleName]) || moduleName;

    // Favoritos deste módulo. A chave é a mesma do Dashboard Geral
    // ("modulo::tela"), então fixar aqui também alimenta os favoritos de lá —
    // é uma lista só, não duas.
    const fixados = typeof getDashboardPinSet === 'function' ? getDashboardPinSet() : new Set();
    const chaveFixar = (item) => `${moduleName}::${item.key}`;
    const favoritos = itens.filter((item) => fixados.has(chaveFixar(item)));

    const botaoFixar = (item) => {
      const fixado = fixados.has(chaveFixar(item));
      return `
        <span class="workspace-fixar ${fixado ? 'active' : ''}" role="button" tabindex="0"
          data-fixar="${escapeHtml(chaveFixar(item))}"
          aria-pressed="${fixado ? 'true' : 'false'}"
          title="${fixado ? 'Desfixar' : 'Fixar'} ${escapeHtml(item.label)}">
          ${typeof favoriteIconSvg === 'function' ? favoriteIconSvg(fixado) : '★'}
        </span>
      `;
    };

    content.innerHTML = `
      <div class="workspace">
        <section class="panel workspace-head">
          <!-- Sem repetir o nome do módulo: o cabeçalho da página já o exibe, e
               ler "Vendas" duas vezes na mesma tela não informa nada. -->
          <p class="muted">${itens.length} tela${itens.length === 1 ? '' : 's'} neste módulo.</p>
          <!-- FIXAR O MÓDULO INTEIRO.
               Isso morava na barra lateral, que agora é só ícones e nunca
               abre — o botão não teria onde caber. Aqui é melhor lugar: quem
               decide fixar um módulo está justamente olhando para ele.
               A chave é o nome do módulo sem "::tela", que é o que distingue
               módulo fixado de tela fixada na mesma lista de favoritos. -->
          <button type="button" class="workspace-fixar-modulo ${fixados.has(moduleName) ? 'active' : ''}"
            data-fixar="${escapeHtml(moduleName)}"
            aria-pressed="${fixados.has(moduleName) ? 'true' : 'false'}"
            title="${fixados.has(moduleName) ? 'Desfixar' : 'Fixar'} ${escapeHtml(titulo)} no Dashboard Geral">
            ${typeof favoriteIconSvg === 'function' ? favoriteIconSvg(fixados.has(moduleName)) : '★'}
            <span>${fixados.has(moduleName) ? 'Módulo fixado' : 'Fixar módulo'}</span>
          </button>
        </section>

        ${favoritos.length ? `
          <section class="panel workspace-favoritos">
            <h4>Mais usadas</h4>
            <div class="workspace-favoritos-lista">
              ${favoritos.map((item) => `
                <button type="button" class="workspace-atalho" data-open-sub="${escapeHtml(item.key)}">
                  <span class="workspace-atalho-icone">${svgDoTipo(item.pendente ? 'pendente' : tipoDaTela(item))}</span>
                  ${escapeHtml(item.label)}
                </button>
              `).join('')}
            </div>
          </section>
        ` : ''}

        <div class="workspace-grid" id="workspaceGrid">
          ${itens.map((item) => {
            const tipo = item.pendente ? 'pendente' : tipoDaTela(item);
            // O bloco é <div>, não <button>: o fixar mora dentro dele, e botão
            // dentro de botão é HTML inválido — o navegador desmonta a marcação
            // e o clique passa a cair no lugar errado.
            return `
              <div class="workspace-tile workspace-tile-${tipo}${item.pendente ? ' is-pendente' : ''}"
                role="button" tabindex="0"
                data-open-sub="${escapeHtml(item.key)}">
                <span class="workspace-tile-icon">${svgDoTipo(tipo)}</span>
                <span class="workspace-tile-text">
                  <strong>${escapeHtml(item.label)}${item.pendente ? '<em class="workspace-tag">em preparo</em>' : ''}</strong>
                  <span>${escapeHtml(item.desc || '')}</span>
                </span>
                ${botaoFixar(item)}
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;

    const abrir = (chave) => {
      state.activeSub = chave;
      renderApp();
      loadModule(moduleName);
    };

    content.querySelectorAll('[data-open-sub]').forEach((alvo) => {
      alvo.addEventListener('click', (evento) => {
        // Clique no alfinete não abre a tela: são duas ações no mesmo bloco.
        if (evento.target.closest('[data-fixar]')) return;
        abrir(alvo.dataset.openSub);
      });
      // O bloco virou <div role="button">, então teclado precisa ser ligado na
      // mão — <button> fazia isso sozinho.
      alvo.addEventListener('keydown', (evento) => {
        if (evento.key !== 'Enter' && evento.key !== ' ') return;
        if (evento.target.closest('[data-fixar]')) return;
        evento.preventDefault();
        abrir(alvo.dataset.openSub);
      });
    });

    const alternarFixado = async (chave) => {
      const estava = fixados.has(chave);
      const proximos = estava
        ? [...fixados].filter((k) => k !== chave)
        : [...fixados, chave];
      try {
        // saveDashboardPins é global do app.js e recebe UM argumento. O módulo
        // do Dashboard Geral documenta uma colisão de nomes que já zerou todos
        // os favoritos aqui — por isso a chamada é explícita em window.
        if (typeof window.saveDashboardPins === 'function') await window.saveDashboardPins(proximos);
        else if (state.user) state.user.dashboardPins = proximos;
        if (showToast) showToast(estava ? 'Removido das mais usadas.' : 'Fixado nas mais usadas.', 'success');
        renderApp();
        loadModule(moduleName);
      } catch (erro) {
        if (showToast) showToast(erro.message || 'Não foi possível salvar o favorito.', 'error');
      }
    };

    content.querySelectorAll('[data-fixar]').forEach((alvo) => {
      alvo.addEventListener('click', (evento) => {
        evento.stopPropagation();
        alternarFixado(alvo.dataset.fixar);
      });
      alvo.addEventListener('keydown', (evento) => {
        if (evento.key !== 'Enter' && evento.key !== ' ') return;
        evento.preventDefault();
        evento.stopPropagation();
        alternarFixado(alvo.dataset.fixar);
      });
    });

  }
};
