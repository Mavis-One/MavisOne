window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.stock = window.MavisSubscreenRegistry.stock || {};

// Tabela oficial de origem da mercadoria — é o primeiro dígito do CST/CSOSN na
// NF-e. Fica escrita aqui, e não vem de /api/fiscal/tabelas, para o cadastro de
// produto não depender do módulo Fiscal estar acessível ao usuário: quem cria
// produto costuma ser do estoque, sem permissão fiscal nenhuma.
const ORIGENS_MERCADORIA = [
  { value: '0', label: '0 — Nacional' },
  { value: '1', label: '1 — Estrangeira, importação direta' },
  { value: '2', label: '2 — Estrangeira, adquirida no mercado interno' },
  { value: '3', label: '3 — Nacional, conteúdo de importação > 40% e <= 70%' },
  { value: '4', label: '4 — Nacional, produção conforme processos básicos' },
  { value: '5', label: '5 — Nacional, conteúdo de importação <= 40%' },
  { value: '6', label: '6 — Estrangeira, importação direta, sem similar nacional' },
  { value: '7', label: '7 — Estrangeira, mercado interno, sem similar nacional' },
  { value: '8', label: '8 — Nacional, conteúdo de importação > 70%' }
];

// Unidades oferecidas na busca do campo "Un". Outra qualquer continua podendo
// ser digitada: a lista é sugestão, não trava.
const UNIDADES_DO_PRODUTO = ['UN', 'PC', 'CX', 'KG', 'G', 'MT', 'M2', 'M3', 'LT', 'ML', 'PAR', 'JG', 'KIT', 'CJ', 'CT', 'DZ', 'FD', 'PCT', 'RL', 'SC', 'TB', 'GL'];

// O CADASTRO DE PRODUTO EM BLOCOS (15/10/2026). Pedido do usuário, com o print
// de outro sistema: uma página só, com tudo à vista, no lugar das cinco abas
// (Dados, Preços, Fiscal, Estoque, Classes):
//   1. identificação — código, código do fabricante, código de barras,
//      unidade, descrição, serviço e ativo;
//   2. grupo e marca (buscar ou criar), controla estoque, pode vender e
//      matéria-prima;
//   3. dados fiscais — NCM (conferido na tabela oficial), CEST (os do NCM),
//      origem e tipo de tributação (grupo tributário); o resto do fiscal só
//      no visual completo;
//   4. preços e estoque — custo, margem (as setas calculam o preço pela margem
//      ou a margem pelo preço), à vista, a prazo, mínimo, estoque atual e
//      mínimo;
//   5. cores (classes) e observações, no visual completo.
// "Vender sem estoque" do print NÃO entra: desde 13/10/2026 nenhum produto
// fatura sem saldo (só o serviço, que não controla estoque).
window.MavisSubscreenRegistry.stock.new_product = async function renderNewProduct(ctx) {
  const { content, api, showToast, state, loadModule, confirmModal } = ctx;
  const S = window.MavisStock;

  // Sem `produtos`: esta tela não tem seletor de produto (ver Stock.loadMeta).
  const meta = await S.loadMeta(api, showToast, { produtos: false });
  const editId = state.stockEditProductId || null;
  state.stockEditProductId = null;

  let current = null;
  if (editId) {
    try {
      const res = await api(`/api/stock/products/${editId}`);
      current = res.product;
    } catch (error) {
      showToast('Não foi possível carregar o produto para edição.', 'error');
    }
  }

  // CÓDIGO AUTOMÁTICO (16/10/2026): o campo já vem com o próximo da sequência
  // (lib/codigo-do-produto.js). Quem quiser outro, digita. Mantido o sugerido,
  // o servidor tira o código na hora de gravar: se outro cadastro levou este,
  // vem o seguinte.
  const codigoLivre = !(current && String(current.sku || '').trim());
  let codigoSugerido = '';
  if (codigoLivre) {
    try {
      codigoSugerido = String((await api('/api/stock/products/proximo-codigo')).codigo || '');
    } catch (erro) {
      codigoSugerido = '';
    }
  }

  const value = (key, fallback = '') => S.escape(current ? current[key] ?? fallback : fallback);
  const ehAdmin = typeof usuarioEhAdmin === 'function' && usuarioEhAdmin();

  // CLASSES (COR e, no futuro, VOLTAGEM/TAMANHO).
  //
  // Só na EDIÇÃO: a atribuição aponta para o id do produto, que não existe
  // antes de salvar. Oferecer as cores num produto ainda inexistente daria uma
  // escolha que se perderia no submit.
  let catalogoClasses = [];
  let classesDoProduto = [];
  if (current) {
    try {
      const [cat, doProduto] = await Promise.all([
        api('/api/stock/classes'),
        api(`/api/stock/products/${encodeURIComponent(current.id)}/classes`)
      ]);
      catalogoClasses = cat.classes || [];
      classesDoProduto = doProduto.classes || [];
    } catch (error) {
      // Sem as classes o resto do cadastro continua salvável — o produto não
      // depende delas para existir.
      catalogoClasses = [];
    }
  }

  const usaClasse = (classId) => classesDoProduto.some((c) => c.classId === classId);
  const usaValor = (classId, valorId) => classesDoProduto
    .find((c) => c.classId === classId)?.valores.some((v) => v.id === valorId) || false;

  function blocoClasses() {
    if (!current) {
      return '<p class="muted">Salve o produto primeiro.</p>';
    }
    if (!catalogoClasses.length) {
      return `
        <p class="muted">Nenhuma classe cadastrada ainda. Cadastre "Cor" e as cores que você usa — depois volte para dizer quais deste produto.</p>
        <button type="button" class="secondary" id="produtoIrParaClasses">Cadastrar classes e cores</button>`;
    }
    return `
      <!-- A cor que falta só aparece na hora de marcar. Sem esta saída, o
           caminho seria sair do produto, achar o catálogo no menu e voltar
           procurando o produto de novo. -->
      <button type="button" class="secondary finance-pill-sm" id="produtoIrParaClasses">Cadastrar nova classe ou cor</button>
      <div class="classe-lista">
        ${catalogoClasses.map((classe) => `
          <section class="classe-bloco ${usaClasse(classe.id) ? 'is-ativa' : ''}" data-classe="${S.escape(classe.id)}">
            <label class="classe-cabecalho">
              <input type="checkbox" class="classe-usar" data-classe="${S.escape(classe.id)}" ${usaClasse(classe.id) ? 'checked' : ''} />
              <strong>${S.escape(classe.name)}</strong>
              <span class="muted">${S.escape(classe.description || '')}</span>
            </label>
            <div class="classe-valores" ${usaClasse(classe.id) ? '' : 'hidden'}>
              ${(classe.valores || []).length ? (classe.valores || []).map((valor) => `
                <label class="classe-valor">
                  <input type="checkbox" class="classe-valor-check" data-classe="${S.escape(classe.id)}" data-valor="${S.escape(valor.id)}" ${usaValor(classe.id, valor.id) ? 'checked' : ''} />
                  ${valor.hex ? `<span class="classe-amostra" style="background:${S.escape(valor.hex)}"></span>` : ''}
                  <span>${S.escape(valor.name)}</span>
                  ${valor.code ? `<em class="muted">${S.escape(valor.code)}</em>` : ''}
                </label>
              `).join('') : '<p class="muted">Esta classe ainda não tem valores cadastrados.</p>'}
            </div>
          </section>
        `).join('')}
      </div>`;
  }

  // VISUAL RESUMIDO OU COMPLETO, como no print: o resumido mostra o que se
  // preenche em todo produto; o completo, também o fiscal de exceção (IPI,
  // escala), o estoque de depósito, as cores e as observações. A escolha é de
  // cada usuário e fica nas preferências. Os campos escondidos continuam no
  // formulário (só `hidden`): salvar no resumido não apaga o que não aparece.
  const preferencia = (state.preferences && state.preferences.produto_cadastro) || {};
  let resumida = preferencia.resumida === true;
  const completo = (corpo) => `<div class="produto-completo" ${resumida ? 'hidden' : ''}>${corpo}</div>`;

  // Grupo do produto = a categoria. Digitado: o nome existente é escolhido; um
  // nome novo é criado pelo servidor ao salvar (categoryName).
  const categorias = (meta.productCategories || []).filter((c) => c.status !== 'inativo');
  const nomeDaCategoria = current && current.categoryId
    ? ((meta.productCategories || []).find((c) => c.id === current.categoryId) || {}).name || ''
    : '';
  const chave = (name, rotulo, ligado, extra = '') => `
    <label class="produto-chave">
      <span>${rotulo}</span>
      <input type="checkbox" name="${name}" ${ligado ? 'checked' : ''} ${extra} />
    </label>`;
  const precoOuVazio = (v) => (v === null || v === undefined || v === '' ? '' : Number(v));
  const servico = Boolean(current && current.movimentaEstoque === false);

  content.innerHTML = `
    <div class="produto-form-wrap">
      <div class="panel">
        ${S.pageHead(current ? 'Editar Produto' : 'Novo Produto')}

        <form id="stockProductForm" class="form-grid produto-em-blocos">
          <datalist id="produtoUnidades">${UNIDADES_DO_PRODUTO.map((u) => `<option value="${u}"></option>`).join('')}</datalist>
          <datalist id="produtoGrupos">${categorias.map((c) => `<option value="${S.escape(c.name)}"></option>`).join('')}</datalist>
          <datalist id="produtoMarcas">${(meta.marcas || []).map((m) => `<option value="${S.escape(m)}"></option>`).join('')}</datalist>
          <datalist id="produtoModelos">${(meta.modelos || []).map((m) => `<option value="${S.escape(m)}"></option>`).join('')}</datalist>
          <datalist id="produtoCests"></datalist>

          <section class="produto-bloco produto-bloco-identificacao">
            <button type="button" class="produto-visual" id="produtoVisual" aria-pressed="${resumida}" title="Alternar entre o visual resumido e o completo">
              <span>Visual</span>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
              <em>${resumida ? 'Resumida' : 'Completa'}</em>
            </button>
            ${/* Fase EJ: o código de um produto cadastrado não muda — o banco
                 recusa. Só leitura (e não desabilitado: ele precisa ir no
                 envio). Produto sem código ainda recebe o primeiro, que vem
                 da sequência; vazio, o servidor também tira da sequência. */''}
            ${!codigoLivre
              ? `<label class="campo-somente-leitura produto-codigo" title="O código de um produto cadastrado não pode ser alterado.">Código*<input name="sku" readonly value="${value('sku')}" /></label>`
              : `<label class="produto-codigo">Código<input name="sku" value="${S.escape(codigoSugerido)}" placeholder="Automático" /></label>`}
            <label class="produto-codigo">C.Fabricante<input name="codigoFabricante" value="${value('codigoFabricante')}" placeholder="C.Fabricante" /></label>
            <label class="produto-codigo">C.Barras<input name="ean" value="${value('ean')}" placeholder="C.Barras" /></label>
            <label class="produto-unidade">Un*<input name="unit" list="produtoUnidades" required value="${value('unit', 'UN')}" placeholder="UN" /></label>
            <label class="produto-descricao">Descrição*<input name="name" required value="${value('name')}" /></label>
            ${chave('servico', 'Serviço', servico)}
            ${chave('ativo', 'Ativo', !current || current.status !== 'inativo')}
          </section>

          <section class="produto-bloco">
            <div class="produto-linha produto-linha-grupo">
              <label>Grupo do Produto
                <input name="categoryName" list="produtoGrupos" value="${S.escape(nomeDaCategoria)}" placeholder="Digite para buscar ou criar grupo..." />
              </label>
              <label>Marca do Produto
                <input name="brand" list="produtoMarcas" value="${value('brand')}" placeholder="Digite para buscar ou criar marca..." />
              </label>
              <label>Modelo do Produto
                <input name="model" list="produtoModelos" value="${value('model')}" placeholder="Digite para buscar ou criar modelo..." />
              </label>
              ${chave('controlaEstoque', 'Controla Estoque', !servico, servico ? 'disabled' : '')}
              ${chave('podeVender', 'Pode Vender', !current || current.podeVender !== false)}
              ${chave('materiaPrima', 'Matéria-Prima', Boolean(current && current.materiaPrima))}
              ${chave('controlaMontagem', 'Controla Montagem', Boolean(current && current.controlaMontagem))}
            </div>

            <!-- Sem NCM e origem preenchidos, a emissão de NF-e não acha a regra
                 fiscal do item e a nota é recusada. É o motivo de estes campos
                 ficarem no cadastro do produto e não na hora de emitir: quem
                 emite não tem como saber a classificação de cada produto. -->
            <h4 class="produto-subtitulo">Dados Fiscais</h4>
            <div class="produto-linha produto-linha-fiscal">
              <label>NCM
                <span class="produto-ncm">
                  <input name="ncm" data-campo="ncm" value="${value('ncm')}" />
                  <i id="produtoNcmSinal" aria-hidden="true"></i>
                </span>
                <small class="muted" id="produtoNcmDescricao"></small>
              </label>
              <label>CEST
                <input name="cest" data-campo="cest" list="produtoCests" value="${value('cest')}" placeholder="Digite para buscar CEST..." />
              </label>
              <label>Origem ICMS
                <select name="origem">
                  <option value="" ${current && (current.origem === null || current.origem === undefined) ? 'selected' : ''}>—</option>
                  ${ORIGENS_MERCADORIA.map((o) => `<option value="${o.value}" ${String(current ? current.origem ?? '' : '0') === o.value ? 'selected' : ''}>${S.escape(o.label)}</option>`).join('')}
                </select>
              </label>
              <!-- GRUPO TRIBUTÁRIO (fase CP), o "Tipo de Tributação" do print:
                   o NCM diz o que a mercadoria É (igual para todo mundo), e o
                   grupo diz como ESTA empresa a tributa. É o grupo que faz uma
                   regra fiscal valer para centenas de produtos de uma vez. -->
              <label>Tipo de Tributação
                <select name="grupoTributarioId">${S.options(meta.grupoTributarios, current ? current.grupoTributarioId : '', { empty: 'Sem grupo' })}</select>
              </label>
            </div>
            ${completo(`
              <!-- IPI E ESCALA (fase CS): a exceção do grupo tributário. O IPI
                   daqui VENCE a regra fiscal (a alíquota segue a TIPI, que é do
                   produto); vazio = usa a regra. -->
              <div class="produto-linha produto-linha-fiscal-extra">
                <label>Unidade tributável
                  <input name="unidadeTributavel" value="${value('unidadeTributavel', current ? '' : 'UN')}" placeholder="igual à unidade" />
                </label>
                <label>CST do IPI
                  <input name="cstIpi" maxlength="2" inputmode="numeric" value="${value('cstIpi')}" placeholder="da regra" />
                </label>
                <label>Alíquota de IPI (%)
                  <input name="aliquotaIpi" type="number" step="0.01" min="0" max="100"
                         value="${current && current.aliquotaIpi !== null && current.aliquotaIpi !== undefined ? current.aliquotaIpi : ''}" placeholder="da regra" />
                </label>
                <label>EX TIPI
                  <input name="codigoExTipi" maxlength="3" inputmode="numeric" value="${value('codigoExTipi')}" placeholder="2 ou 3 dígitos" />
                </label>
              </div>
              <div class="produto-linha produto-linha-escala">
                <!-- TRÊS estados, e o vazio é o que importa: "não declarado" faz
                     a nota OMITIR o indEscala. A pergunta é pela NEGATIVA ("não
                     relevante"), o rótulo do Convênio 52/2017; a inversão para
                     escala_relevante acontece no envio, num lugar só. (Sem
                     acento grave neste comentário: ele vive dentro de um
                     template literal.) -->
                <label>Produzido em escala NÃO relevante
                  <select name="escalaNaoRelevante">
                    <option value="" ${current && (current.escalaRelevante === null || current.escalaRelevante === undefined) ? 'selected' : (current ? '' : 'selected')}>Não declarado</option>
                    <option value="1" ${current && current.escalaRelevante === false ? 'selected' : ''}>Sim — escala não relevante</option>
                    <option value="0" ${current && current.escalaRelevante === true ? 'selected' : ''}>Não — escala relevante</option>
                  </select>
                </label>
                <label>CNPJ do fabricante
                  <input name="cnpjFabricante" data-campo="cnpj" value="${value('cnpjFabricante')}" placeholder="exigido em escala não relevante" />
                </label>
              </div>
            `)}

            <h4 class="produto-subtitulo">Preços e Estoque</h4>
            <div class="produto-linha produto-linha-precos">
              ${/* Custo só para administrador (14/10/2026): o servidor não manda o
                   número aos demais e guarda o que o produto já tinha ao salvar.
                   A margem sai do custo, então some junto. */''}
              ${ehAdmin ? `
                <label>Preço de Custo*<input type="number" step="0.01" min="0" name="costPrice" required value="${current ? Number(current.costPrice || 0) : 0}" /></label>
                <div class="produto-margem">
                  <label>Margem (%)<input type="number" step="0.01" name="margem" data-nao-dinheiro id="produtoMargem" /></label>
                  <div class="produto-margem-setas">
                    <button type="button" class="icon-button" id="produtoMargemParaPreco" title="Calcular o preço à vista pela margem" aria-label="Calcular o preço pela margem">→</button>
                    <button type="button" class="icon-button" id="produtoPrecoParaMargem" title="Calcular a margem pelo preço à vista" aria-label="Calcular a margem pelo preço">←</button>
                  </div>
                  <small class="muted">Sobre custo: <strong id="produtoSobreCusto">—</strong></small>
                </div>` : ''}
              <label>Preço à Vista*<input type="number" step="0.01" min="0" name="salePrice" required value="${current ? Number(current.salePrice || 0) : 0}" />
                ${ehAdmin ? '<small class="muted">Sobre venda: <strong data-sobre-venda="salePrice">—</strong></small>' : ''}
              </label>
              <label>Preço a Prazo<input type="number" step="0.01" min="0" name="precoPrazo" value="${current ? precoOuVazio(current.precoPrazo) : ''}" />
                ${ehAdmin ? '<small class="muted">Sobre venda: <strong data-sobre-venda="precoPrazo">—</strong></small>' : ''}
              </label>
              <label>Preço Mínimo<input type="number" step="0.01" min="0" name="precoMinimo" value="${current ? precoOuVazio(current.precoMinimo) : ''}" /></label>
            </div>
            <div class="produto-linha produto-linha-estoque">
              ${current ? `
                <div class="produto-estoque-atual">
                  <label>Estoque Atual<input value="${S.formatQty(current.stockQuantity)}" disabled /></label>
                  <button type="button" class="icon-button" id="produtoEstoqueHistorico" title="Histórico e saldo por depósito" aria-label="Histórico do estoque">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"></path><polyline points="3 3 3 8 8 8"></polyline><polyline points="12 7 12 12 15 14"></polyline></svg>
                  </button>
                  <button type="button" class="icon-button" id="produtoEstoqueAjuste" title="Nova movimentação deste produto" aria-label="Ajustar o estoque">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="21" x2="4" y2="14"></line><line x1="4" y1="10" x2="4" y2="3"></line><line x1="12" y1="21" x2="12" y2="12"></line><line x1="12" y1="8" x2="12" y2="3"></line><line x1="20" y1="21" x2="20" y2="16"></line><line x1="20" y1="12" x2="20" y2="3"></line><line x1="1" y1="14" x2="7" y2="14"></line><line x1="9" y1="8" x2="15" y2="8"></line><line x1="17" y1="16" x2="23" y2="16"></line></svg>
                  </button>
                  <small class="muted">Todas as empresas: ${S.formatQty(current.stockQuantity)}</small>
                </div>
              ` : `
                <label>Estoque inicial<input type="number" step="0.001" min="0" name="stockQuantity" value="0" /></label>
                ${/* À vista no produto novo: estoque inicial exige o depósito. */''}
                <label>Depósito padrão<select name="defaultDepositId">${S.options(depositosParaEscolha(meta.deposits), '', { empty: 'Nenhum' })}</select></label>
              `}
              <label>Estoque Mínimo<input type="number" step="0.001" min="0" name="minStock" value="${current ? Number(current.minStock || 0) : 0}" /></label>
            </div>
            ${completo(`
              <div class="produto-linha produto-linha-deposito">
                <label>Estoque máximo<input type="number" step="0.001" min="0" name="maxStock" value="${current ? Number(current.maxStock || 0) : 0}" /></label>
                ${current ? `<label>Depósito padrão<select name="defaultDepositId">${S.options(depositosParaEscolha(meta.deposits, current.defaultDepositId), current.defaultDepositId, { empty: 'Nenhum' })}</select></label>` : ''}
                <label>Localização<input name="location" value="${value('location')}" placeholder="Ex.: Corredor 3, prateleira B" /></label>
                ${current ? '' : `<label>Categoria da movimentação inicial<select name="movementCategoryId">${S.options(meta.movementCategories, '', { empty: 'Sem categoria' })}</select></label>`}
              </div>
            `)}
          </section>

          ${completo(`
            <section class="produto-bloco">
              <h4 class="produto-subtitulo">Cores e Classes</h4>
              ${blocoClasses()}
              <label class="produto-observacoes">Observações<textarea name="notes" rows="2">${value('notes')}</textarea></label>
            </section>
          `)}

          <div class="finance-actions-row">
            <button type="submit">${current ? 'Salvar alterações' : 'Salvar produto'}</button>
            <button type="button" class="secondary" id="stockProductCancel">Ver lista</button>
          </div>
        </form>
      </div>
    </div>
  `;

  const form = document.getElementById('stockProductForm');
  const campo = (name) => form.querySelector(`[name="${name}"]`);

  // VISUAL: troca só o `hidden` dos blocos do completo, sem redesenhar (o que
  // foi digitado fica). A escolha vai para as preferências do usuário.
  document.getElementById('produtoVisual')?.addEventListener('click', (evento) => {
    resumida = !resumida;
    content.querySelectorAll('.produto-completo').forEach((bloco) => { bloco.hidden = resumida; });
    evento.currentTarget.setAttribute('aria-pressed', String(resumida));
    evento.currentTarget.querySelector('em').textContent = resumida ? 'Resumida' : 'Completa';
    if (typeof salvarPreferencia === 'function') salvarPreferencia('produto_cadastro', { resumida });
  });

  // SERVIÇO E CONTROLA ESTOQUE são o mesmo dado (movimenta_estoque): serviço
  // não tem saldo. Ligar um desliga e trava o outro.
  campo('servico')?.addEventListener('change', () => {
    const controla = campo('controlaEstoque');
    if (!controla) return;
    controla.checked = !campo('servico').checked;
    controla.disabled = campo('servico').checked;
  });
  campo('controlaEstoque')?.addEventListener('change', () => {
    if (campo('servico')) campo('servico').checked = !campo('controlaEstoque').checked;
  });
  // Fase ER: no produto novo, a chave acompanha o NCM (8711 marca) até a
  // pessoa mexer nela.
  campo('controlaMontagem')?.addEventListener('change', () => {
    campo('controlaMontagem').dataset.mexido = '1';
  });
  if (!current) {
    campo('ncm')?.addEventListener('input', () => {
      const chaveMontagem = campo('controlaMontagem');
      if (!chaveMontagem || chaveMontagem.dataset.mexido) return;
      chaveMontagem.checked = /^8711/.test(String(campo('ncm').value || '').replace(/\D/g, ''));
    });
  }

  // MARGEM, como no print: "→" põe no preço à vista o custo + margem; "←"
  // tira a margem do preço. Embaixo, a margem sobre o custo e sobre a venda de
  // cada preço — a mesma conta do servidor (stock-core: margin = (venda −
  // custo) / custo). A margem não é gravada: sai sempre dos dois preços.
  const numero = (name) => {
    const n = Number(campo(name)?.value || 0);
    return Number.isFinite(n) ? n : 0;
  };
  const pct = (n) => (Number.isFinite(n) ? `${n.toFixed(2).replace('.', ',')}%` : '—');
  function atualizarMargens() {
    if (!ehAdmin) return;
    const custo = numero('costPrice');
    const venda = numero('salePrice');
    const sobreCusto = document.getElementById('produtoSobreCusto');
    if (sobreCusto) sobreCusto.textContent = custo > 0 && venda > 0 ? pct(((venda - custo) / custo) * 100) : '—';
    content.querySelectorAll('[data-sobre-venda]').forEach((caixa) => {
      const preco = numero(caixa.dataset.sobreVenda);
      caixa.textContent = preco > 0 && custo > 0 ? pct(((preco - custo) / preco) * 100) : '—';
    });
  }
  function margemDoPreco() {
    const custo = numero('costPrice');
    const venda = numero('salePrice');
    const margem = document.getElementById('produtoMargem');
    if (margem) margem.value = custo > 0 && venda > 0 ? (((venda - custo) / custo) * 100).toFixed(2) : '';
  }
  document.getElementById('produtoMargemParaPreco')?.addEventListener('click', () => {
    const custo = numero('costPrice');
    const margem = Number(document.getElementById('produtoMargem')?.value || 0);
    if (!(custo > 0)) { showToast('Informe o preço de custo para calcular pela margem.', 'warning'); return; }
    campo('salePrice').value = Math.round(custo * (1 + margem / 100) * 100) / 100;
    atualizarMargens();
  });
  document.getElementById('produtoPrecoParaMargem')?.addEventListener('click', () => {
    margemDoPreco();
    atualizarMargens();
  });
  ['costPrice', 'salePrice', 'precoPrazo'].forEach((nome) => {
    campo(nome)?.addEventListener('input', atualizarMargens);
    campo(nome)?.addEventListener('change', atualizarMargens);
  });
  margemDoPreco();
  atualizarMargens();

  // NCM CONFERIDO NA TABELA OFICIAL (fiscal_ncm, Siscomex): ✓ com a
  // descrição, ou ✗ quando o código não existe. E os CEST do NCM entram na
  // busca do campo CEST (fiscal_cest, Convênio 142/18).
  let ncmConferido = '';
  async function conferirNcm() {
    const ncm = String(campo('ncm')?.value || '').replace(/\D/g, '');
    const sinal = document.getElementById('produtoNcmSinal');
    const descricao = document.getElementById('produtoNcmDescricao');
    if (ncm === ncmConferido) return;
    ncmConferido = ncm;
    if (ncm.length !== 8) {
      if (sinal) sinal.className = '';
      if (descricao) descricao.textContent = '';
      return;
    }
    try {
      const resposta = await api(`/api/stock/ncm/${ncm}`);
      if (String(campo('ncm')?.value || '').replace(/\D/g, '') !== ncm) return;
      if (sinal) sinal.className = resposta.ncm ? 'produto-ncm-ok' : 'produto-ncm-erro';
      if (descricao) descricao.textContent = resposta.ncm ? resposta.ncm.descricao : 'NCM não encontrado na tabela oficial.';
      const lista = document.getElementById('produtoCests');
      if (lista) {
        lista.innerHTML = (resposta.cests || [])
          .map((c) => `<option value="${S.escape(c.cest)}">${S.escape(c.cest)} — ${S.escape(c.descricao)}</option>`).join('');
      }
    } catch (_) {
      // Sem a conferência o cadastro continua: o NCM é validado de novo na nota.
      if (sinal) sinal.className = '';
    }
  }
  campo('ncm')?.addEventListener('input', conferirNcm);
  campo('ncm')?.addEventListener('blur', conferirNcm);
  conferirNcm();

  // Marcar a classe revela os valores dela. Desmarcar esconde, mas NÃO limpa
  // as escolhas: quem desmarca por engano e remarca não perde as cores que já
  // tinha selecionado.
  content.querySelectorAll('.classe-usar').forEach((caixa) => {
    caixa.addEventListener('change', () => {
      const bloco = caixa.closest('.classe-bloco');
      bloco?.classList.toggle('is-ativa', caixa.checked);
      const valores = bloco?.querySelector('.classe-valores');
      if (valores) valores.hidden = !caixa.checked;
    });
  });

  // Lê o estado final da tela. Classe marcada sem nenhum valor fica de fora:
  // um produto que "usa COR" mas não oferece cor nenhuma travaria a venda,
  // que pediria uma escolha sem opções.
  function lerClassesDaTela() {
    return [...content.querySelectorAll('.classe-usar')]
      .filter((caixa) => caixa.checked)
      .map((caixa) => {
        const classId = caixa.dataset.classe;
        const valores = [...content.querySelectorAll(`.classe-valor-check[data-classe="${classId}"]`)]
          .filter((v) => v.checked)
          .map((v) => v.dataset.valor);
        return { classId, valores };
      })
      .filter((c) => c.valores.length);
  }

  // Ir ao catálogo de classes e voltar para ESTE produto. O que já foi
  // digitado no formulário se perde — a tela é reconstruída do servidor — por
  // isso a confirmação: descobrir a perda depois de voltar seria pior.
  document.getElementById('produtoIrParaClasses')?.addEventListener('click', async () => {
    const seguir = await confirmModal('Ir para o cadastro de classes? Alterações não salvas neste produto serão perdidas.');
    if (!seguir) return;
    state.stockClassesVoltarPara = { sub: 'new_product', productId: current ? current.id : null };
    state.activeSub = 'classes';
    loadModule('stock');
  });

  // Estoque atual: o histórico e o saldo por depósito estão no Status do
  // Produto; o ajuste é uma movimentação, que já abre com este produto.
  document.getElementById('produtoEstoqueHistorico')?.addEventListener('click', () => {
    state.stockStatusProductId = current.id;
    state.activeSub = 'product_status';
    loadModule('stock');
  });
  document.getElementById('produtoEstoqueAjuste')?.addEventListener('click', () => {
    state.stockMovementProductId = current.id;
    state.activeSub = 'new_movement';
    loadModule('stock');
  });

  document.getElementById('stockProductCancel')?.addEventListener('click', () => {
    state.activeSub = 'products';
    loadModule('stock');
  });

  // Campo obrigatório no visual resumido não fica escondido (Código, Un,
  // Descrição, Custo e Preço à Vista estão todos à vista); se um dia um
  // obrigatório for para o completo, o navegador não conseguiria apontá-lo —
  // por isso o completo abre sozinho quando um campo escondido é recusado.
  form.addEventListener('invalid', (event) => {
    const bloco = event.target.closest('.produto-completo');
    if (bloco && bloco.hidden) content.querySelectorAll('.produto-completo').forEach((b) => { b.hidden = false; });
  }, true);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submitBtn = event.target.querySelector('button[type="submit"]');
    if (submitBtn?.disabled) return;
    if (submitBtn) submitBtn.disabled = true;
    const formData = new FormData(event.target);
    // O grupo digitado: o existente pelo nome (sem diferença de maiúscula); um
    // nome novo vai como categoryName e o servidor cria o grupo.
    const nomeDoGrupo = String(formData.get('categoryName') || '').trim();
    const grupo = categorias.find((c) => String(c.name || '').trim().toLowerCase() === nomeDoGrupo.toLowerCase());
    const servicoMarcado = Boolean(campo('servico')?.checked);
    const payload = {
      id: current ? current.id : undefined,
      name: formData.get('name'),
      sku: formData.get('sku'),
      codigoAutomatico: codigoLivre && Boolean(codigoSugerido) && String(formData.get('sku') || '').trim() === codigoSugerido,
      codigoFabricante: formData.get('codigoFabricante'),
      ean: formData.get('ean'),
      categoryId: grupo ? grupo.id : '',
      categoryName: grupo ? '' : nomeDoGrupo,
      unit: formData.get('unit'),
      brand: formData.get('brand'),
      model: formData.get('model'),
      status: campo('ativo')?.checked ? 'ativo' : 'inativo',
      // Serviço = não controla estoque (a mão de obra é o caso de hoje).
      movimentaEstoque: !servicoMarcado,
      podeVender: Boolean(campo('podeVender')?.checked),
      materiaPrima: Boolean(campo('materiaPrima')?.checked),
      // Fase ER: saldo em Desmontado e Montado. No produto novo, sem mexer na
      // chave, quem decide é o NCM (8711 nasce marcado, no servidor).
      controlaMontagem: current || campo('controlaMontagem')?.dataset.mexido
        ? Boolean(campo('controlaMontagem')?.checked)
        : undefined,
      costPrice: Number(formData.get('costPrice') || 0),
      salePrice: Number(formData.get('salePrice') || 0),
      // Vazio = sem preço a prazo / sem mínimo (não é zero).
      precoPrazo: formData.get('precoPrazo') === '' ? '' : Number(formData.get('precoPrazo') || 0),
      precoMinimo: formData.get('precoMinimo') === '' ? '' : Number(formData.get('precoMinimo') || 0),
      ncm: formData.get('ncm'),
      cest: formData.get('cest'),
      origem: formData.get('origem'),
      // Vazio chega como '' e o servidor o converte em null (textoOuNulo em
      // camposFiscaisDoProduto): "Sem grupo" precisa poder ser escolhido de
      // volta, e não só ser o estado inicial.
      grupoTributarioId: formData.get('grupoTributarioId'),
      // Fase CS
      cstIpi: formData.get('cstIpi'),
      aliquotaIpi: formData.get('aliquotaIpi'),
      codigoExTipi: formData.get('codigoExTipi'),
      // A INVERSÃO ACONTECE AQUI, e só aqui. O campo pergunta "produzido em
      // escala NÃO relevante" (o rótulo do Convênio 52/2017, que o operador
      // conhece) e a coluna guarda `escala_relevante`, o nome que a Focus
      // espera — assim não há negação no meio do caminho entre banco e payload,
      // que é o jeito mais fácil de emitir a nota com a informação trocada.
      // '' continua '' de propósito: é o terceiro estado, "não declarado".
      escalaRelevante: (() => {
        const bruto = formData.get('escalaNaoRelevante');
        if (bruto === '' || bruto === null) return '';
        return bruto === '1' ? 'false' : 'true';
      })(),
      cnpjFabricante: formData.get('cnpjFabricante'),
      unidadeTributavel: formData.get('unidadeTributavel'),
      minStock: Number(formData.get('minStock') || 0),
      maxStock: Number(formData.get('maxStock') || 0),
      defaultDepositId: formData.get('defaultDepositId'),
      location: formData.get('location'),
      notes: formData.get('notes')
    };
    if (!current) {
      payload.stockQuantity = Number(formData.get('stockQuantity') || 0);
      payload.movementCategoryId = formData.get('movementCategoryId') || '';
    }

    try {
      const salvo = await api('/api/stock/products', { method: 'POST', body: JSON.stringify(payload) });
      // As classes salvam DEPOIS e por rota própria, mas no mesmo clique: dois
      // botões de salvar na mesma tela fariam metade do cadastro ser perdida
      // por quem clicasse no errado.
      //
      // Falhar aqui não desfaz o produto, que já foi gravado — por isso o
      // aviso diz exatamente o que ficou para trás, em vez de "erro ao salvar".
      if (current) {
        try {
          await api(`/api/stock/products/${encodeURIComponent(current.id)}/classes`, {
            method: 'PUT',
            body: JSON.stringify({ classes: lerClassesDaTela() })
          });
        } catch (erroClasses) {
          showToast(`Produto salvo, mas as classes não: ${erroClasses.message || erroClasses}`, 'error');
          if (submitBtn) submitBtn.disabled = false;
          return;
        }
      }
      showToast(current ? 'Produto atualizado.' : `Produto ${salvo?.product?.sku || ''} criado.`, 'success');
      state.activeSub = 'products';
      loadModule('stock');
    } catch (error) {
      showToast(error.message || 'Erro ao salvar produto.', 'error');
      if (submitBtn) submitBtn.disabled = false;
    }
  });
};
