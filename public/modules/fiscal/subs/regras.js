window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.fiscal = window.MavisSubscreenRegistry.fiscal || {};

// Regras Fiscais — o que decide CFOP e tributação de cada item na emissão.
//
// PARA QUE SERVE
// --------------
// Na hora de emitir, o servidor não inventa CFOP nem alíquota: ele procura aqui
// a regra que casa com o item (resolverRegraFiscal, em lib/db/fiscal.js) e usa o
// que ela diz. Sem regra cadastrada, a emissão para com "Nenhuma regra fiscal
// encontrada" — esta tela é o cadastro que destrava isso.
//
// COMO A REGRA É ESCOLHIDA (e por que existe o simulador)
// -------------------------------------------------------
// Campo de critério em branco vale como CORINGA: uma regra sem NCM serve para
// qualquer NCM. Como várias regras podem casar ao mesmo tempo, o desempate é,
// nesta ordem: mais critérios preenchidos (mais específica) > maior prioridade >
// vigência mais recente. Ninguém acerta isso de cabeça olhando uma lista de
// trinta regras — daí o painel "Simular", que chama a MESMA função da emissão e
// responde qual regra ganharia. É a única forma de descobrir por que uma nota
// foi recusada sem tentar emitir de novo.
//
// POR QUE NÃO É A MESMA TELA DE CONFIGURAÇÕES
// -------------------------------------------
// Existe um CRUD de regras em Configurações → Fiscal, mas ele só alcança um
// terço das colunas: não escreve origem, dentro do estado, contribuinte,
// modalidade e redução de BC, nada de ICMS-ST nem de IPI, nem a observação do
// fisco. Todos esses campos existem na tabela e na emissão. Aqui eles são
// preenchíveis, e os códigos vêm das tabelas oficiais (Fase Q) em vez de texto
// livre — digitar 5012 no lugar de 5102 não dá erro na tela, dá problema na
// apuração meses depois.
(function (Docs) {
  const TIPOS_OPERACAO = [
    { value: 'VENDA', label: 'Venda' },
    { value: 'TRANSFERENCIA', label: 'Transferência' },
    { value: 'REMESSA', label: 'Remessa' },
    { value: 'RETORNO', label: 'Retorno' },
    { value: 'DEVOLUCAO', label: 'Devolução' },
    { value: 'BONIFICACAO', label: 'Bonificação' },
    { value: 'ENTRADA_IMPORTACAO', label: 'Entrada de importação' }
  ];
  const ROTULO_OPERACAO = Object.fromEntries(TIPOS_OPERACAO.map((t) => [t.value, t.label]));

  // Modalidade de determinação da base de cálculo do ICMS próprio (campo modBC
  // do layout da NF-e). São só estes quatro valores.
  const MODALIDADES_BC = [
    { value: '0', label: '0 — Margem de Valor Agregado (%)' },
    { value: '1', label: '1 — Pauta (valor)' },
    { value: '2', label: '2 — Preço tabelado máximo (valor)' },
    { value: '3', label: '3 — Valor da operação' }
  ];

  // motDesICMS do layout da NF-e. Lista curta de propósito: são os motivos que
  // aparecem em operação comercial. Os demais (13 a 16) são de regimes
  // específicos e entram quando alguém precisar.
  const MOTIVOS_DESONERACAO = [
    { value: '1', label: '1 — Táxi' },
    { value: '3', label: '3 — Produtor agropecuário' },
    { value: '4', label: '4 — Frotista/locadora' },
    { value: '5', label: '5 — Diplomático/consular' },
    { value: '6', label: '6 — Utilitários e motocicletas da Amazônia Ocidental e Áreas de Livre Comércio' },
    { value: '7', label: '7 — SUFRAMA' },
    { value: '9', label: '9 — Outros' },
    { value: '10', label: '10 — Deficiente condutor' },
    { value: '11', label: '11 — Deficiente não condutor' },
    { value: '12', label: '12 — Órgão de fomento e desenvolvimento agropecuário' }
  ];

  const UFS = ['AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT',
    'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO'];

  // Campos que o formulário envia. Ficam numa lista só para o submit e o
  // "editar" não saírem de sincronia quando um campo novo aparecer.
  const CAMPOS_TEXTO = [
    'tipoOperacao', 'ncm', 'origem', 'ufDestino', 'dentroDoEstado', 'destinatarioContribuinte',
    'cfop', 'csosn', 'cstIcms', 'modalidadeBcIcms', 'aliquotaIcms', 'reducaoBcIcms',
    'aliquotaInternaUfDestino', 'aliquotaFcpUfDestino',
    'cstIcmsSt', 'mvaSt', 'aliquotaIcmsSt', 'cstPis', 'aliquotaPis', 'cstCofins', 'aliquotaCofins',
    'cstIpi', 'aliquotaIpi', 'codigoEnquadramentoIpi',
    // IBS/CBS — Reforma Tributária (LC 214/2025).
    'codigoBeneficioFiscal', 'icmsMotivoDesoneracao',
    'cstIbsCbs', 'classTrib', 'aliquotaIbsUf', 'aliquotaIbsMun', 'aliquotaCbs',
    'prioridade', 'vigenciaInicio', 'vigenciaFim',
    'observacaoFisco'
  ];

  function semAcento(texto) {
    return String(texto || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
  }

  const hoje = () => new Date().toISOString().slice(0, 10);

  // "5102 — Venda de mercadoria..." em vez de só o código: quem cadastra a
  // regra precisa ler a descrição para saber se é aquele mesmo.
  function rotuloCodigo(linha) {
    const desc = String(linha.descricao || '').split(' · ').pop();
    return `${String(linha.codigo).trim()} — ${desc}`;
  }

  async function desenhar(ctx) {
    const { api, content, escapeHtml, state, showToast, confirmModal } = ctx;

    const { lista: empresas, escolhida: empresaId, erro: erroEmpresas } = await Docs.carregarEmpresas(ctx);
    if (!empresaId) {
      content.innerHTML = Docs.semEmpresa(escapeHtml, 'Regras Fiscais', erroEmpresas);
      return;
    }

    // As tabelas oficiais são opcionais: se a migração da Fase Q não rodou, os
    // campos de código caem em texto livre em vez de a tela não abrir.
    let tabelas = { disponivel: false };
    let regras = [];
    let erro = '';
    try {
      [tabelas, regras] = await Promise.all([
        api('/api/fiscal/tabelas').catch(() => ({ disponivel: false })),
        api(`/api/fiscal/regras?empresaId=${encodeURIComponent(empresaId)}`).then((r) => r.regras || [])
      ]);
    } catch (e) {
      erro = e.message || 'Não foi possível carregar as regras fiscais.';
    }

    const form = state.fiscalRegraForm && state.fiscalRegraForm.empresaId === empresaId
      ? state.fiscalRegraForm
      : null;
    const simulacao = state.fiscalRegraSimulacao || null;
    const filtro = state.fiscalRegraFiltro || '';

    /**
     * Select de código oficial; vira <input> se a tabela não existir no banco.
     * O valor gravado é sempre só o código — a descrição é ajuda de tela.
     */
    function campoCodigo(nome, rotulo, linhas, valor, { obrigatorio = false, ajuda = '' } = {}) {
      const req = obrigatorio ? 'required' : '';
      const dica = ajuda ? `<small class="muted">${escapeHtml(ajuda)}</small>` : '';
      if (!linhas || !linhas.length) {
        return `<label>${escapeHtml(rotulo)}<input name="${nome}" ${req} value="${escapeHtml(valor || '')}" placeholder="código" />${dica}</label>`;
      }
      return `
        <label>${escapeHtml(rotulo)}
          <select name="${nome}" ${req}>
            <option value="">${obrigatorio ? 'Selecione' : 'qualquer'}</option>
            ${linhas.map((l) => {
              const codigo = String(l.codigo).trim();
              return `<option value="${escapeHtml(codigo)}" ${String(valor || '').trim() === codigo ? 'selected' : ''}>${escapeHtml(rotuloCodigo(l))}</option>`;
            }).join('')}
          </select>${dica}
        </label>`;
    }

    /**
     * cClassTrib: campo de digitação COM sugestão, não select fechado.
     *
     * A tabela oficial da LC 214/2025 tem centenas de códigos e a carga do
     * sistema é parcial (só o que foi conferido um a um). Um select fechado
     * impediria de cadastrar um código legítimo que ainda não subiu — o
     * usuário ficaria travado por uma limitação nossa. O datalist sugere o que
     * conhecemos e aceita o resto.
     *
     * Sem filtro por CST: o código COMEÇA pelo CST, então digitar "011" já
     * reduz a lista sozinho. A estrutura do código faz o trabalho.
     */
    function campoClassTrib(dados) {
      const linhas = tabelas.classificacaoTributaria || [];
      const valor = escapeHtml(dados.classTrib || '');
      const sugestoes = linhas.map((l) => `<option value="${escapeHtml(String(l.codigo).trim())}">${escapeHtml(rotuloCodigo(l))}</option>`).join('');
      return `
        <label>Classificação tributária (cClassTrib)
          <input name="classTrib" list="listaClassTrib" maxlength="6" inputmode="numeric" value="${valor}" placeholder="6 dígitos — ex.: 000001" />
          <datalist id="listaClassTrib">${sugestoes}</datalist>
          <small class="muted">${linhas.length
            ? `${linhas.length} código(s) sugeridos — a tabela oficial é maior, pode digitar um que não esteja na lista.`
            : 'Tabela ainda não carregada — digite o código.'}</small>
        </label>`;
    }

    // Tri-estado: "qualquer" (coringa, grava NULL) / Sim / Não. Um checkbox não
    // serviria — ele só sabe dizer sim e não, e perderia o coringa.
    function campoTriEstado(nome, rotulo, valor) {
      const atual = valor === true ? 'true' : valor === false ? 'false' : '';
      return `
        <label>${escapeHtml(rotulo)}
          <select name="${nome}">
            <option value="" ${atual === '' ? 'selected' : ''}>qualquer</option>
            <option value="true" ${atual === 'true' ? 'selected' : ''}>Sim</option>
            <option value="false" ${atual === 'false' ? 'selected' : ''}>Não</option>
          </select>
        </label>`;
    }

    function criterios(regra) {
      const partes = [];
      if (regra.ncm) partes.push(`NCM ${regra.ncm}`);
      if (regra.origem !== null && regra.origem !== undefined) partes.push(`origem ${regra.origem}`);
      if (regra.ufDestino) partes.push(`UF ${regra.ufDestino}`);
      if (regra.dentroDoEstado === true) partes.push('dentro do estado');
      if (regra.dentroDoEstado === false) partes.push('fora do estado');
      if (regra.destinatarioContribuinte === true) partes.push('contribuinte');
      if (regra.destinatarioContribuinte === false) partes.push('não contribuinte');
      return partes;
    }

    function vigenciaTexto(regra) {
      const fim = regra.vigenciaFim ? ` até ${regra.vigenciaFim}` : ' (sem prazo)';
      return `${regra.vigenciaInicio || '-'}${fim}`;
    }

    // Regra vencida continua na lista, marcada: apagar histórico de tributação
    // é o que impede reemitir uma nota de mês passado com a regra da época.
    const venceu = (regra) => Boolean(regra.vigenciaFim && regra.vigenciaFim < hoje());

    function linhaRegra(regra) {
      const marcas = criterios(regra);
      return `
        <tr data-busca="${escapeHtml(semAcento([regra.ncm, regra.cfop, regra.ufDestino, ROTULO_OPERACAO[regra.tipoOperacao], regra.csosn, regra.cstIcms].filter(Boolean).join(' ')))}"
            class="${venceu(regra) ? 'fiscal-regra-vencida' : ''}">
          <td>
            <strong>${escapeHtml(ROTULO_OPERACAO[regra.tipoOperacao] || regra.tipoOperacao)}</strong>
            <div class="muted">${marcas.length ? escapeHtml(marcas.join(' · ')) : 'qualquer item'}</div>
          </td>
          <td><strong>${escapeHtml(regra.cfop || '-')}</strong></td>
          <td>${escapeHtml(regra.csosn || regra.cstIcms || '—')}</td>
          <td>${regra.aliquotaIcms === null || regra.aliquotaIcms === undefined ? '—' : escapeHtml(String(regra.aliquotaIcms)) + '%'}</td>
          <td>${escapeHtml([regra.cstPis, regra.cstCofins].filter(Boolean).join(' / ') || '—')}</td>
          <td>${escapeHtml(regra.cstIpi || '—')}</td>
          <td>${escapeHtml(String(regra.prioridade ?? 0))}</td>
          <td class="muted">${escapeHtml(vigenciaTexto(regra))}${venceu(regra) ? ' <span class="finance-badge finance-badge-muted">vencida</span>' : ''}</td>
          <td>
            <button type="button" class="icon-button edit" data-editar="${escapeHtml(regra.id)}" title="Editar regra" aria-label="Editar regra">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>
            </button>
            <button type="button" class="icon-button" data-excluir="${escapeHtml(regra.id)}" title="Excluir regra" aria-label="Excluir regra">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>
            </button>
          </td>
        </tr>`;
    }

    function painelSimulacao() {
      if (!simulacao) return '';
      if (!simulacao.encontrou) {
        return `
          <div class="panel fiscal-simulacao is-vazia">
            <h4>Nenhuma regra se aplica</h4>
            <p class="muted">Com esses dados a emissão pararia com "Nenhuma regra fiscal encontrada".
            Cadastre uma regra que cubra este caso — deixar um critério em branco faz ela valer para qualquer valor daquele campo.</p>
          </div>`;
      }
      const r = simulacao.regra;
      const marcas = criterios(r);
      return `
        <div class="panel fiscal-simulacao">
          <h4>Regra aplicada: ${escapeHtml(ROTULO_OPERACAO[r.tipoOperacao] || r.tipoOperacao)} — CFOP ${escapeHtml(r.cfop)}</h4>
          <dl class="fiscal-simulacao-grid">
            <div><dt>Critérios da regra</dt><dd>${marcas.length ? escapeHtml(marcas.join(' · ')) : 'nenhum (coringa)'}</dd></div>
            <div><dt>CSOSN / CST ICMS</dt><dd>${escapeHtml(r.csosn || r.cstIcms || '—')}</dd></div>
            <div><dt>Alíquota ICMS</dt><dd>${r.aliquotaIcms === null || r.aliquotaIcms === undefined ? '—' : escapeHtml(String(r.aliquotaIcms)) + '%'}</dd></div>
            <div><dt>PIS</dt><dd>${escapeHtml(r.cstPis || '—')} ${r.aliquotaPis === null || r.aliquotaPis === undefined ? '' : escapeHtml(String(r.aliquotaPis)) + '%'}</dd></div>
            <div><dt>COFINS</dt><dd>${escapeHtml(r.cstCofins || '—')} ${r.aliquotaCofins === null || r.aliquotaCofins === undefined ? '' : escapeHtml(String(r.aliquotaCofins)) + '%'}</dd></div>
            <div><dt>IPI</dt><dd>${escapeHtml(r.cstIpi || '—')} ${r.aliquotaIpi === null || r.aliquotaIpi === undefined ? '' : escapeHtml(String(r.aliquotaIpi)) + '%'}</dd></div>
            <div><dt>Prioridade</dt><dd>${escapeHtml(String(r.prioridade ?? 0))}</dd></div>
            <div><dt>Vigência</dt><dd>${escapeHtml(vigenciaTexto(r))}</dd></div>
          </dl>
          <div class="finance-actions-row">
            <button type="button" class="secondary" data-editar="${escapeHtml(r.id)}">Abrir esta regra</button>
          </div>
        </div>`;
    }

    function painelFormulario() {
      if (!form) return '';
      const editando = Boolean(form.id);
      return `
        <div class="panel" id="fiscalRegraPainel">
          <div class="cadastro-page-head">
            <div>
              <h3>${editando ? 'Editar regra fiscal' : 'Nova regra fiscal'}</h3>
              <p class="muted">Critério em branco vale como <strong>qualquer</strong>. Quanto mais critérios preenchidos, mais específica — e a mais específica ganha na emissão.</p>
            </div>
          </div>
          <form id="fiscalRegraForm" class="form-grid">

            <div class="cadastro-section">
              <div class="cadastro-section-header"><h4>Quando esta regra se aplica</h4>
                <p>São os critérios comparados com o item da nota na hora de emitir.</p></div>
              <div class="cadastro-section-body">
                <div class="row">
                  <label>Tipo de operação *
                    <select name="tipoOperacao" required>
                      ${TIPOS_OPERACAO.map((t) => `<option value="${t.value}" ${form.tipoOperacao === t.value ? 'selected' : ''}>${t.label}</option>`).join('')}
                    </select>
                  </label>
                  <label>NCM
                    <input name="ncm" data-campo="ncm" value="${escapeHtml(form.ncm || '')}" placeholder="qualquer" />
                    <small class="muted">8 dígitos, sem ponto.</small>
                  </label>
                  ${campoCodigo('origem', 'Origem da mercadoria', tabelas.origemMercadoria, form.origem === null || form.origem === undefined ? '' : String(form.origem))}
                  <label>UF de destino
                    <select name="ufDestino">
                      <option value="">qualquer</option>
                      ${UFS.map((uf) => `<option value="${uf}" ${form.ufDestino === uf ? 'selected' : ''}>${uf}</option>`).join('')}
                    </select>
                  </label>
                </div>
                <div class="row">
                  ${campoTriEstado('dentroDoEstado', 'Operação dentro do estado', form.dentroDoEstado)}
                  ${campoTriEstado('destinatarioContribuinte', 'Destinatário é contribuinte', form.destinatarioContribuinte)}
                  <label>Prioridade
                    <input name="prioridade" type="number" step="1" value="${Number(form.prioridade ?? 0)}" />
                    <small class="muted">Desempata entre regras igualmente específicas: maior ganha.</small>
                  </label>
                </div>
              </div>
            </div>

            <div class="cadastro-section">
              <div class="cadastro-section-header"><h4>ICMS</h4>
                <p>CSOSN para Simples Nacional; CST para Lucro Presumido e Lucro Real. Preencha o do regime da empresa.</p></div>
              <div class="cadastro-section-body">
                <div class="row">
                  ${campoCodigo('cfop', 'CFOP *', tabelas.cfop, form.cfop, { obrigatorio: true, ajuda: '1/2/3 = entrada · 5/6/7 = saída' })}
                  ${campoCodigo('csosn', 'CSOSN (Simples Nacional)', tabelas.csosn, form.csosn)}
                  ${campoCodigo('cstIcms', 'CST ICMS (Regime Normal)', tabelas.cstIcms, form.cstIcms)}
                </div>
                <!-- Estes campos só existem para CST que tributa a operação
                     própria. Numa isenta (40), não tributada (41) ou suspensão
                     (50) não há base, alíquota nem valor a declarar — e pedir
                     um número que não vai para lugar nenhum convida a
                     preencher. Quem esconde/mostra é o avisoCstIcms() abaixo,
                     lendo o MESMO módulo que o servidor usa para montar o
                     payload. -->
                <div class="row" data-icms-proprio>
                  <label>Modalidade da base de cálculo
                    <select name="modalidadeBcIcms">
                      <option value="">não informar</option>
                      ${MODALIDADES_BC.map((m) => `<option value="${m.value}" ${String(form.modalidadeBcIcms ?? '') === m.value ? 'selected' : ''}>${m.label}</option>`).join('')}
                    </select>
                  </label>
                  <label>Alíquota ICMS (%)<input name="aliquotaIcms" type="number" step="0.01" min="0" max="100" value="${form.aliquotaIcms ?? ''}" /></label>
                  <label data-icms-reducao>Redução da BC (%)<input name="reducaoBcIcms" type="number" step="0.01" min="0" max="100" value="${form.reducaoBcIcms ?? ''}" /></label>
                </div>
                <!-- Benefício fiscal: a SEFAZ recusa CST isento sem ele
                     ("930 - CST com beneficio fiscal e nao informado o codigo
                     de beneficio fiscal"). O código sai da tabela da UF, não
                     de uma lista nossa: em SC, da SEF/SC. Só aparece nos CST
                     que o exigem, pelo mesmo motivo da alíquota sumir. -->
                <div class="row" data-icms-beneficio hidden>
                  <label>Código do benefício fiscal (cBenef)
                    <input name="codigoBeneficioFiscal" maxlength="10" value="${form.codigoBeneficioFiscal ?? ''}" placeholder="da tabela da UF" />
                    <small class="muted">Peça ao contador o código da tabela da SEF/SC. A SEFAZ confere um a um: código errado volta como "931 — benefício fiscal incompatível com CST e UF", e a nota não sai.</small>
                  </label>
                  <label>Motivo da desoneração
                    <select name="icmsMotivoDesoneracao">
                      <option value="">não informar</option>
                      ${MOTIVOS_DESONERACAO.map((m) => `<option value="${m.value}" ${String(form.icmsMotivoDesoneracao ?? '') === m.value ? 'selected' : ''}>${m.label}</option>`).join('')}
                    </select>
                  </label>
                </div>
                <p class="fiscal-aviso-cst" data-aviso-cst hidden></p>
              </div>
            </div>

            <div class="cadastro-section">
              <div class="cadastro-section-header"><h4>DIFAL — venda interestadual para não contribuinte</h4>
                <p>Só se aplica a venda para consumidor final de OUTRO estado que não é contribuinte de ICMS. Deixe em branco em operação interna, em venda para contribuinte e no Simples Nacional — o Simples é dispensado do DIFAL (ADI 5.464 do STF).</p></div>
              <div class="cadastro-section-body">
                <div class="row">
                  <label>Alíquota interna da UF de destino (%)
                    <input name="aliquotaInternaUfDestino" type="number" step="0.01" min="0" max="100" value="${form.aliquotaInternaUfDestino ?? ''}" />
                    <small class="muted">É a alíquota do estado do CLIENTE, não a sua. Varia por UF e por produto.</small>
                  </label>
                  <label>FCP da UF de destino (%)
                    <input name="aliquotaFcpUfDestino" type="number" step="0.01" min="0" max="100" value="${form.aliquotaFcpUfDestino ?? ''}" />
                    <small class="muted">Fundo de Combate à Pobreza, quando o estado de destino cobrar.</small>
                  </label>
                </div>
              </div>
            </div>

            <div class="cadastro-section">
              <div class="cadastro-section-header"><h4>ICMS-ST</h4>
                <p>Só para operação com substituição tributária. Em branco, a nota sai sem ST.</p></div>
              <div class="cadastro-section-body">
                <div class="row">
                  ${campoCodigo('cstIcmsSt', 'CST ICMS-ST', tabelas.cstIcms, form.cstIcmsSt)}
                  <label>MVA / IVA-ST (%)<input name="mvaSt" type="number" step="0.01" min="0" value="${form.mvaSt ?? ''}" /></label>
                  <label>Alíquota ICMS-ST (%)<input name="aliquotaIcmsSt" type="number" step="0.01" min="0" max="100" value="${form.aliquotaIcmsSt ?? ''}" /></label>
                </div>
              </div>
            </div>

            <div class="cadastro-section">
              <div class="cadastro-section-header"><h4>PIS e COFINS</h4>
                <p>No Simples costuma ser CST 49 ou 99 com alíquota zero; no Presumido e no Real, 01 com alíquota.</p></div>
              <div class="cadastro-section-body">
                <div class="row">
                  ${campoCodigo('cstPis', 'CST PIS', tabelas.cstPisCofins, form.cstPis)}
                  <label>Alíquota PIS (%)<input name="aliquotaPis" type="number" step="0.0001" min="0" max="100" value="${form.aliquotaPis ?? ''}" /></label>
                  ${campoCodigo('cstCofins', 'CST COFINS', tabelas.cstPisCofins, form.cstCofins)}
                  <label>Alíquota COFINS (%)<input name="aliquotaCofins" type="number" step="0.0001" min="0" max="100" value="${form.aliquotaCofins ?? ''}" /></label>
                </div>
              </div>
            </div>

            <div class="cadastro-section">
              <div class="cadastro-section-header"><h4>IPI</h4>
                <p>Relevante para indústria e importadora — a importadora é contribuinte de IPI na revenda.</p></div>
              <div class="cadastro-section-body">
                <div class="row">
                  ${campoCodigo('cstIpi', 'CST IPI', tabelas.cstIpi, form.cstIpi)}
                  <label>Alíquota IPI (%)<input name="aliquotaIpi" type="number" step="0.01" min="0" max="100" value="${form.aliquotaIpi ?? ''}" /></label>
                  <label>Código de enquadramento
                    <input name="codigoEnquadramentoIpi" maxlength="3" value="${escapeHtml(form.codigoEnquadramentoIpi || '')}" placeholder="ex.: 999" />
                  </label>
                </div>
              </div>
            </div>

            <div class="cadastro-section">
              <div class="cadastro-section-header"><h4>IBS e CBS — Reforma Tributária</h4>
                <p>Os 3 primeiros dígitos da classificação tributária <strong>são</strong> o CST — digitar "011" já reduz a lista sozinho. Em 2026 vale a fase de teste (CBS 0,9% e IBS 0,1%, compensáveis com PIS/COFINS); confirme as alíquotas com o contador.</p></div>
              <div class="cadastro-section-body">
                <div class="row">
                  ${campoCodigo('cstIbsCbs', 'CST IBS/CBS', tabelas.cstIbsCbs, form.cstIbsCbs)}
                  ${campoClassTrib(form)}
                </div>
                <div class="row">
<!-- O IBS tem DOIS destinatários: o estado e o município, cada um com
                       competência própria para legislar a sua alíquota. A Focus pede os
                       dois separados (pIBSUF e pIBSMun) e a SEFAZ confere o total contra
                       as partes — por isso são dois campos, e não um total dividido ao
                       meio. Em 2026 a UF fica com os 0,1% inteiros e o municipio com 0,0% —
                       zero EXPLICITO, nao em branco: em branco a SEFAZ recusa com 1036. -->
                  <label>Alíquota IBS — estado (%)<input name="aliquotaIbsUf" type="number" step="0.0001" min="0" max="100" value="${form.aliquotaIbsUf ?? ''}" placeholder="2026: 0,1" /></label>
                  <label>Alíquota IBS — município (%)<input name="aliquotaIbsMun" type="number" step="0.0001" min="0" max="100" value="${form.aliquotaIbsMun ?? ''}" placeholder="2026: 0 (zero)" /></label>
                  <label>Alíquota CBS (%)<input name="aliquotaCbs" type="number" step="0.0001" min="0" max="100" value="${form.aliquotaCbs ?? ''}" placeholder="2026: 0,9" /></label>
                </div>
              </div>
            </div>

            <div class="cadastro-section">
              <div class="cadastro-section-header"><h4>Vigência e observação</h4>
                <p>Mudou a lei? Feche a regra antiga com uma data de fim e crie a nova — assim a nota de mês passado continua reemitindo com a tributação da época.</p></div>
              <div class="cadastro-section-body">
                <div class="row">
                  <label>Início da vigência *<input name="vigenciaInicio" type="date" required value="${escapeHtml(form.vigenciaInicio || hoje())}" /></label>
                  <label>Fim da vigência<input name="vigenciaFim" type="date" value="${escapeHtml(form.vigenciaFim || '')}" />
                    <small class="muted">Em branco = sem prazo.</small>
                  </label>
                </div>
                <label>Observação para o fisco
                  <textarea name="observacaoFisco" rows="2" placeholder="Texto exigido por lei, vai no campo de informações adicionais do item.">${escapeHtml(form.observacaoFisco || '')}</textarea>
                </label>
              </div>
            </div>

            <div class="finance-actions-row">
              <button type="submit">${editando ? 'Salvar alterações' : 'Criar regra'}</button>
              <button type="button" class="secondary" id="fiscalRegraCancelar">Cancelar</button>
            </div>
            <p class="fiscal-regra-erro" id="fiscalRegraErro" hidden></p>
          </form>
        </div>`;
    }

    content.innerHTML = `
      <div class="panel">
        <div class="cadastro-page-head">
          <div>
            <h3>Regras Fiscais</h3>
            <p class="muted">${regras.length} regra${regras.length === 1 ? '' : 's'} — definem o CFOP e a tributação usados na emissão de NF-e.</p>
          </div>
          <div class="cadastro-list-actions">
            ${Docs.seletorEmpresa(escapeHtml, empresas, empresaId)}
            <button type="button" id="fiscalRegraNova">+ Nova regra</button>
          </div>
        </div>
        ${erro ? `<p class="fiscal-regra-erro">${escapeHtml(erro)}</p>` : ''}
        ${tabelas.disponivel ? '' : `
          <p class="muted">As tabelas oficiais de CFOP/CST ainda não existem no banco (migração
          <code>banco/migrations/fase-q-tabelas-fiscais.sql</code>), então os códigos aqui são digitados à mão.</p>`}
      </div>

      <details class="panel fiscal-simulador" ${simulacao ? 'open' : ''}>
        <summary><strong>Simular</strong> — qual regra se aplicaria a um item?</summary>
        <p class="muted">Responde com a MESMA função que a emissão usa. Serve para conferir uma regra nova antes de emitir, e para descobrir por que uma nota foi recusada.</p>
        <form id="fiscalSimularForm" class="form-grid">
          <div class="row">
            <label>Tipo de operação *
              <select name="tipoOperacao" required>
                ${TIPOS_OPERACAO.map((t) => `<option value="${t.value}" ${simulacao?.entrada?.tipoOperacao === t.value ? 'selected' : ''}>${t.label}</option>`).join('')}
              </select>
            </label>
            <label>NCM do produto<input name="ncm" data-campo="ncm" value="${escapeHtml(simulacao?.entrada?.ncm || '')}" /></label>
            <label>Origem<input name="origem" type="number" min="0" max="8" value="${escapeHtml(simulacao?.entrada?.origem ?? '')}" /></label>
            <label>UF de destino
              <select name="ufDestino">
                <option value="">—</option>
                ${UFS.map((uf) => `<option value="${uf}" ${simulacao?.entrada?.ufDestino === uf ? 'selected' : ''}>${uf}</option>`).join('')}
              </select>
            </label>
          </div>
          <div class="row">
            <label>Dentro do estado
              <select name="dentroDoEstado">
                <option value="">—</option>
                <option value="true" ${simulacao?.entrada?.dentroDoEstado === 'true' ? 'selected' : ''}>Sim</option>
                <option value="false" ${simulacao?.entrada?.dentroDoEstado === 'false' ? 'selected' : ''}>Não</option>
              </select>
            </label>
            <label>Destinatário contribuinte
              <select name="destinatarioContribuinte">
                <option value="">—</option>
                <option value="true" ${simulacao?.entrada?.destinatarioContribuinte === 'true' ? 'selected' : ''}>Sim</option>
                <option value="false" ${simulacao?.entrada?.destinatarioContribuinte === 'false' ? 'selected' : ''}>Não</option>
              </select>
            </label>
            <label>Data da emissão<input name="data" type="date" value="${escapeHtml(simulacao?.entrada?.data || hoje())}" /></label>
            <div style="align-self: end;"><button type="submit" class="secondary">Simular</button></div>
          </div>
        </form>
      </details>

      ${painelSimulacao()}

      <div class="panel">
        <input type="search" class="workspace-filter" id="fiscalRegraFiltro" value="${escapeHtml(filtro)}"
               placeholder="Filtrar por NCM, CFOP, UF ou operação…" autocomplete="off" aria-label="Filtrar regras" />
        <div class="table-scroll" style="margin-top:12px;">
          <table class="table table-actions">
            <thead><tr>
              <th>Operação / critérios</th><th>CFOP</th><th>CSOSN / CST</th><th>ICMS</th>
              <th>PIS / COFINS</th><th>IPI</th><th>Prior.</th><th>Vigência</th><th>Ações</th>
            </tr></thead>
            <tbody id="fiscalRegraCorpo">
              ${regras.length
                ? regras.map(linhaRegra).join('')
                : '<tr><td colspan="9" class="muted">Nenhuma regra cadastrada. Sem pelo menos uma, a emissão de NF-e não sabe qual CFOP usar e é recusada.</td></tr>'}
            </tbody>
          </table>
        </div>
        <p class="muted" id="fiscalRegraVazio" hidden>Nenhuma regra encontrada com esse filtro.</p>
      </div>

      ${painelFormulario()}
    `;

    Docs.ligarSeletorEmpresa(ctx, () => desenhar(ctx));

    function abrirFormulario(regra) {
      state.fiscalRegraForm = { ...(regra || { prioridade: 0, vigenciaInicio: hoje(), tipoOperacao: 'VENDA' }), empresaId };
      desenhar(ctx).then(() => {
        content.querySelector('#fiscalRegraPainel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }

    content.querySelector('#fiscalRegraNova')?.addEventListener('click', () => abrirFormulario(null));

    content.querySelectorAll('[data-editar]').forEach((botao) => {
      botao.addEventListener('click', () => {
        const regra = regras.find((r) => r.id === botao.dataset.editar);
        if (regra) abrirFormulario(regra);
      });
    });

    content.querySelectorAll('[data-excluir]').forEach((botao) => {
      botao.addEventListener('click', async () => {
        const regra = regras.find((r) => r.id === botao.dataset.excluir);
        if (!regra) return;
        // Regra apagada não é regra corrigida: notas já emitidas guardam a
        // tributação no payload, mas reemitir uma antiga passa a usar outra.
        const ok = await confirmModal(
          `Excluir a regra de ${ROTULO_OPERACAO[regra.tipoOperacao] || regra.tipoOperacao} com CFOP ${regra.cfop}?\n\n` +
          'Se ela só deixou de valer, prefira preencher o fim da vigência — assim as notas antigas continuam reemitindo com a tributação da época.'
        );
        if (!ok) return;
        try {
          await api(`/api/fiscal/regras/${encodeURIComponent(regra.id)}`, { method: 'DELETE' });
          showToast('Regra excluída.', 'success');
          state.fiscalRegraForm = null;
          desenhar(ctx);
        } catch (e) {
          showToast(e.message || 'Não foi possível excluir a regra.', 'error');
        }
      });
    });

    const campoFiltro = content.querySelector('#fiscalRegraFiltro');
    const vazio = content.querySelector('#fiscalRegraVazio');
    campoFiltro?.addEventListener('input', () => {
      const termo = semAcento(campoFiltro.value.trim());
      state.fiscalRegraFiltro = campoFiltro.value;
      let visiveis = 0;
      content.querySelectorAll('#fiscalRegraCorpo tr[data-busca]').forEach((linha) => {
        const casa = !termo || linha.dataset.busca.includes(termo);
        linha.hidden = !casa;
        if (casa) visiveis++;
      });
      if (vazio) vazio.hidden = visiveis > 0 || !regras.length;
    });

    content.querySelector('#fiscalSimularForm')?.addEventListener('submit', async (evento) => {
      evento.preventDefault();
      const dados = new FormData(evento.target);
      const entrada = Object.fromEntries(['tipoOperacao', 'ncm', 'origem', 'ufDestino', 'dentroDoEstado', 'destinatarioContribuinte', 'data']
        .map((campo) => [campo, String(dados.get(campo) || '')]));
      const params = new URLSearchParams({ empresaId });
      Object.entries(entrada).forEach(([chave, valor]) => { if (valor !== '') params.set(chave, valor); });
      try {
        const res = await api(`/api/fiscal/regras/simular?${params.toString()}`);
        state.fiscalRegraSimulacao = { ...res, entrada };
        desenhar(ctx);
      } catch (e) {
        showToast(e.message || 'Não foi possível simular.', 'error');
      }
    });

    content.querySelector('#fiscalRegraCancelar')?.addEventListener('click', () => {
      state.fiscalRegraForm = null;
      desenhar(ctx);
    });

    // Campos de ICMS que só existem para CST que tributa a operação própria.
    //
    // Numa isenta (40), não tributada (41) ou suspensão (50) não há base,
    // alíquota nem valor — o servidor manda SÓ o CST (ver nfePayloadBuilder).
    // Deixar os campos na tela pediria um número que não vai a lugar nenhum, e
    // quem preenchesse acharia que declarou alguma coisa.
    //
    // A decisão vem do MavisCstIcms, o mesmo módulo que o servidor usa: se a
    // tela tivesse a sua própria lista, um CST novo entraria num lado só.
    const campoCstIcms = content.querySelector('#fiscalRegraForm [name="cstIcms"]');
    const campoCsosn = content.querySelector('#fiscalRegraForm [name="csosn"]');
    const linhaIcms = content.querySelector('#fiscalRegraForm [data-icms-proprio]');
    const campoReducao = content.querySelector('#fiscalRegraForm [data-icms-reducao]');
    const avisoCst = content.querySelector('#fiscalRegraForm [data-aviso-cst]');

    function aplicarRegrasDoCst() {
      if (!linhaIcms) return;
      const cst = campoCstIcms?.value || '';
      const usaCsosn = Boolean(campoCsosn?.value);
      const tabela = window.MavisCstIcms;
      // Sem CST escolhido (ou no caminho do Simples, que usa CSOSN) a tela não
      // esconde nada: o usuário ainda está decidindo.
      const situacao = cst && tabela ? tabela.situacao(cst) : null;
      const mostrarTributo = usaCsosn || !cst || !situacao || situacao.icmsProprio;

      linhaIcms.hidden = !mostrarTributo;
      // O benefício é o espelho: aparece justamente onde a alíquota some.
      const linhaBeneficio = content.querySelector('#fiscalRegraForm [data-icms-beneficio]');
      if (linhaBeneficio) linhaBeneficio.hidden = mostrarTributo;
      if (campoReducao) campoReducao.hidden = mostrarTributo && situacao ? !situacao.reducao : false;

      if (!avisoCst) return;
      if (cst && !situacao) {
        avisoCst.hidden = false;
        avisoCst.textContent = `CST "${cst}" não existe na tabela do ICMS.`;
      } else if (situacao && !situacao.suportado) {
        // Recusar na hora de emitir, sem avisar aqui, faria o usuário
        // descobrir só depois de montar a nota inteira.
        avisoCst.hidden = false;
        avisoCst.textContent = `CST ${tabela.normalizar(cst)} (${situacao.rotulo}) ainda não é emitido por este sistema: falta o ${situacao.falta}. A regra pode ser salva, mas a emissão vai recusar.`;
      } else if (situacao && !situacao.icmsProprio) {
        avisoCst.hidden = false;
        avisoCst.textContent = `CST ${tabela.normalizar(cst)} — ${situacao.rotulo}. Não há base, alíquota nem valor de ICMS a declarar: a nota leva só a situação tributária.`;
      } else {
        avisoCst.hidden = true;
        avisoCst.textContent = '';
      }
    }

    campoCstIcms?.addEventListener('input', aplicarRegrasDoCst);
    campoCstIcms?.addEventListener('change', aplicarRegrasDoCst);
    campoCsosn?.addEventListener('input', aplicarRegrasDoCst);
    campoCsosn?.addEventListener('change', aplicarRegrasDoCst);
    // Vale já na abertura: editar uma regra isenta tem que abrir sem os campos.
    aplicarRegrasDoCst();

    content.querySelector('#fiscalRegraForm')?.addEventListener('submit', async (evento) => {
      evento.preventDefault();
      const dados = new FormData(evento.target);
      const erroEl = content.querySelector('#fiscalRegraErro');
      const payload = { empresaId };
      CAMPOS_TEXTO.forEach((campo) => { payload[campo] = String(dados.get(campo) ?? '').trim(); });

      // Os dois tri-estado voltam como texto do <select>: '' é o coringa, e
      // precisa chegar ao servidor como null e não como false.
      ['dentroDoEstado', 'destinatarioContribuinte'].forEach((campo) => {
        payload[campo] = payload[campo] === '' ? null : payload[campo] === 'true';
      });

      const falha = (msg) => {
        erroEl.hidden = false;
        erroEl.textContent = msg;
      };
      erroEl.hidden = true;

      if (!payload.cfop) return falha('Informe o CFOP — é ele que a regra devolve para a nota.');
      if (payload.ncm && !/^\d{8}$/.test(payload.ncm)) return falha('O NCM tem 8 dígitos, sem ponto.');
      if (!payload.csosn && !payload.cstIcms) {
        return falha('Preencha o CSOSN (Simples Nacional) ou o CST ICMS (Regime Normal) — sem um dos dois a nota sai sem situação tributária de ICMS.');
      }
      if (payload.vigenciaFim && payload.vigenciaFim < payload.vigenciaInicio) {
        return falha('O fim da vigência não pode ser antes do início.');
      }

      const editando = Boolean(form.id);
      const botao = evento.target.querySelector('button[type="submit"]');
      botao.disabled = true;
      try {
        if (editando) {
          await api(`/api/fiscal/regras/${encodeURIComponent(form.id)}`, { method: 'PUT', body: JSON.stringify(payload) });
        } else {
          await api('/api/fiscal/regras', { method: 'POST', body: JSON.stringify(payload) });
        }
        showToast(editando ? 'Regra atualizada.' : 'Regra criada.', 'success');
        state.fiscalRegraForm = null;
        desenhar(ctx);
      } catch (e) {
        botao.disabled = false;
        falha(e.message || 'Não foi possível salvar a regra.');
      }
    });
  }

  window.MavisSubscreenRegistry.fiscal.regras = desenhar;
})(window.MavisFiscalDocs);
