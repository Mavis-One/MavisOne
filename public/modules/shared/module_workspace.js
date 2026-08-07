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

// Busca sem acento: quem digita "orcamento" tem que achar "Orçamento".
function semAcento(texto) {
  return String(texto || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

// moduleSubItems e moduleLabels são `const` no topo do app.js. `const` de nível
// superior NÃO vira propriedade de window, então `window.moduleSubItems` é
// undefined — a referência tem que ser pelo nome puro, como o dashboard já faz.
// Funciona porque este arquivo carrega antes do app.js mas só LÊ as listas na
// hora de renderizar, quando o app.js já executou.
function telasDoModulo(moduleName) {
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
    const { content, state, escapeHtml, renderApp, loadModule } = ctx;
    const itens = telasDoModulo(moduleName);
    const titulo = (typeof moduleLabels !== 'undefined' && moduleLabels[moduleName]) || moduleName;

    content.innerHTML = `
      <div class="workspace">
        <section class="panel workspace-head">
          <!-- Sem repetir o nome do módulo: o cabeçalho da página já o exibe, e
               ler "Vendas" duas vezes na mesma tela não informa nada. -->
          <p class="muted">${itens.length} tela${itens.length === 1 ? '' : 's'} neste módulo.</p>
          <input type="search" class="workspace-filter" id="workspaceFilter"
            placeholder="Filtrar telas…" autocomplete="off"
            aria-label="Filtrar telas de ${escapeHtml(titulo)}" />
        </section>

        <div class="workspace-grid" id="workspaceGrid">
          ${itens.map((item) => {
            const tipo = item.pendente ? 'pendente' : tipoDaTela(item);
            return `
              <button type="button" class="workspace-tile workspace-tile-${tipo}${item.pendente ? ' is-pendente' : ''}"
                data-open-sub="${escapeHtml(item.key)}"
                data-busca="${escapeHtml(semAcento(`${item.label} ${item.desc || ''}`))}">
                <span class="workspace-tile-icon">${svgDoTipo(tipo)}</span>
                <span class="workspace-tile-text">
                  <strong>${escapeHtml(item.label)}${item.pendente ? '<em class="workspace-tag">em preparo</em>' : ''}</strong>
                  <span>${escapeHtml(item.desc || '')}</span>
                </span>
              </button>
            `;
          }).join('')}
        </div>

        <p class="workspace-empty muted" id="workspaceEmpty" hidden>Nenhuma tela encontrada.</p>
      </div>
    `;

    content.querySelectorAll('[data-open-sub]').forEach((botao) => {
      botao.addEventListener('click', () => {
        state.activeSub = botao.dataset.openSub;
        renderApp();
        loadModule(moduleName);
      });
    });

    const filtro = content.querySelector('#workspaceFilter');
    const vazio = content.querySelector('#workspaceEmpty');
    filtro?.addEventListener('input', () => {
      const termo = semAcento(filtro.value.trim());
      let visiveis = 0;
      content.querySelectorAll('.workspace-tile').forEach((tile) => {
        const casa = !termo || tile.dataset.busca.includes(termo);
        tile.hidden = !casa;
        if (casa) visiveis++;
      });
      vazio.hidden = visiveis > 0;
    });
  }
};
