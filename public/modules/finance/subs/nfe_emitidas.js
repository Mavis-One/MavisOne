window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.finance = window.MavisSubscreenRegistry.finance || {};

// A lista mostra as duas origens: a nota transmitida à SEFAZ (tabela `nfe`) e
// o registro manual do Financeiro (tabela `nfes`). Por isso o vocabulário
// cobre os estados dos dois — sem rascunho/processando/erro, uma nota que
// falhou na SEFAZ apareceria com o rótulo cru em maiúsculas, ou pior, como
// autorizada (era o que o normalizador do servidor fazia por padrão).
const NFE_STATUS_META = {
  autorizada: { label: 'Autorizada', tone: 'success' },
  cancelada: { label: 'Cancelada', tone: 'muted' },
  denegada: { label: 'Denegada', tone: 'danger' },
  rejeitada: { label: 'Rejeitada', tone: 'danger' },
  erro: { label: 'Erro', tone: 'danger' },
  inutilizada: { label: 'Inutilizada', tone: 'muted' },
  processando: { label: 'Processando', tone: 'warning' },
  rascunho: { label: 'Rascunho', tone: 'muted' },
  pendente: { label: 'Pendente', tone: 'warning' },
  // A nota salva com "Salvar nota em edição" e ainda não emitida (14/10/2026).
  // Não está na SEFAZ nem na tabela de notas: vem de /api/fiscal/nfe/rascunhos.
  'em-edicao': { label: 'Em edição', tone: 'warning' }
};

function nfeStatusBadge(status) {
  const meta = NFE_STATUS_META[status] || { label: status || '-', tone: 'muted' };
  // escapeHtml (fase EI): status fora do vocabulário entra cru no rótulo.
  return `<span class="finance-badge finance-badge-${meta.tone}">${escapeHtml(meta.label)}</span>`;
}

// A chave inteira na lista (15/10/2026, pedido do usuário): os 44 dígitos em
// blocos de 4, como na DANFE, em duas linhas fixas (6 + 5 blocos). Numa linha
// só a tabela passava da tela; a cópia (data-copiar-chave) leva sem espaços.
function chaveEmBlocos(chave) {
  const digitos = String(chave || '');
  const blocos = (texto) => escapeHtml(texto.replace(/(\d{4})(?=\d)/g, '$1 '));
  return digitos.length > 24 ? `${blocos(digitos.slice(0, 24))}<br>${blocos(digitos.slice(24))}` : blocos(digitos);
}

// DIA E HORA DA NOTA, EM BRASÍLIA (16/10/2026, pedido do usuário: "quero ver
// dia/mês/ano e horário"). O instante chega em UTC; sem o fuso explícito, a
// nota das 21h30 sairia com o dia seguinte. Sem instante (nota importada do
// Viper, que só tem o dia, ou registro manual), fica só o dia.
const NFE_DIA_E_HORA = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
});
function nfeDiaEHora(instante, dia) {
  const momento = new Date(instante || '');
  if (!instante || Number.isNaN(momento.getTime())) return financeFormatDate(dia);
  return NFE_DIA_E_HORA.format(momento).replace(',', '');
}

function nfeFormatDocument(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length === 11) {
    return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  }
  if (digits.length === 14) {
    return digits.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  }
  return value || '-';
}

// Aviso obrigatório: nenhum destes layouts é DANFE oficial. A DANFE de verdade
// vem em PDF da Focus NFe (ação "Baixar DANFE"), que exige a API configurada.
const NFE_AVISO_NAO_FISCAL = 'Documento gerado pelo sistema — registro interno, sem valor fiscal (não é uma DANFE oficial).';

const NFE_PRINT_LAYOUTS = {
  // A4 completo: o layout que já existia.
  completo: (nfe, h) => ({
    css: `
      body { font-family: Arial, sans-serif; padding: 24px; color: #10213a; }
      h1 { font-size: 18px; margin-bottom: 4px; }
      table { width: 100%; border-collapse: collapse; margin-top: 12px; }
      th, td { border: 1px solid #ccc; padding: 6px 8px; text-align: left; font-size: 13px; }
      .muted { color: #666; }
      .total { text-align: right; font-weight: bold; margin-top: 10px; }
    `,
    body: `
      <h1>NF-e ${h(nfe.number)} / Série ${h(nfe.series)}</h1>
      <p class="muted">${NFE_AVISO_NAO_FISCAL}</p>
      <p><strong>Data de emissão:</strong> ${financeFormatDate(nfe.date)} &nbsp; <strong>Status:</strong> ${h((NFE_STATUS_META[nfe.status] || {}).label || nfe.status)}</p>
      <p><strong>Cliente:</strong> ${h(nfe.customer)} &nbsp; <strong>CPF/CNPJ:</strong> ${h(nfeFormatDocument(nfe.clientDocument))}</p>
      <p><strong>Endereço:</strong> ${h(nfe.clientAddress || '-')}, ${h(nfe.clientCity || '-')} - ${h(nfe.clientState || '-')}</p>
      ${nfe.key ? `<p><strong>Chave:</strong> ${h(nfe.key)}</p>` : ''}
      <table>
        <thead><tr><th>Código</th><th>Descrição</th><th>Qtd.</th><th>Valor unit.</th><th>Total</th></tr></thead>
        <tbody>${(nfe.items || []).map((item) => `
          <tr>
            <td>${h(item.code || '-')}</td><td>${h(item.description || '')}</td>
            <td>${h(String(item.quantity ?? ''))}</td>
            <td>${financeFormatBRL(item.unitPrice)}</td><td>${financeFormatBRL(item.total)}</td>
          </tr>`).join('')}
        </tbody>
      </table>
      <p class="total">Valor total: ${financeFormatBRL(nfe.amount)}</p>
    `
  }),

  // Bobina de 80mm: uma coluna, fonte pequena, sem bordas de tabela.
  simplificado: (nfe, h) => ({
    css: `
      @page { size: 80mm auto; margin: 3mm; }
      body { font-family: 'Courier New', monospace; font-size: 11px; color: #000; width: 74mm; margin: 0; }
      h1 { font-size: 13px; text-align: center; margin: 0 0 2px; }
      .center { text-align: center; }
      .sep { border-top: 1px dashed #000; margin: 6px 0; }
      .linha { display: flex; justify-content: space-between; gap: 6px; }
      .item { margin-bottom: 3px; }
      .total { font-size: 13px; font-weight: bold; }
      .aviso { font-size: 9px; text-align: center; margin-top: 8px; }
    `,
    body: `
      <h1>NF-e ${h(nfe.number)}</h1>
      <div class="center">Série ${h(nfe.series)} — ${financeFormatDate(nfe.date)}</div>
      <div class="sep"></div>
      <div>${h(nfe.customer)}</div>
      <div>${h(nfeFormatDocument(nfe.clientDocument))}</div>
      ${nfe.key ? `<div style="word-break:break-all;font-size:9px;">${h(nfe.key)}</div>` : ''}
      <div class="sep"></div>
      ${(nfe.items || []).map((item) => `
        <div class="item">
          <div>${h(item.description || '')}</div>
          <div class="linha"><span>${h(String(item.quantity ?? ''))} x ${financeFormatBRL(item.unitPrice)}</span><span>${financeFormatBRL(item.total)}</span></div>
        </div>`).join('')}
      <div class="sep"></div>
      <div class="linha total"><span>TOTAL</span><span>${financeFormatBRL(nfe.amount)}</span></div>
      <div class="aviso">${NFE_AVISO_NAO_FISCAL}</div>
    `
  }),

  // Etiqueta de despacho: destinatário em destaque para colar no volume.
  etiqueta: (nfe, h) => ({
    css: `
      @page { size: 100mm 50mm; margin: 3mm; }
      body { font-family: Arial, sans-serif; font-size: 11px; color: #000; margin: 0; }
      .etiqueta { border: 1px solid #000; padding: 6px; height: 44mm; box-sizing: border-box; }
      .topo { display: flex; justify-content: space-between; font-size: 10px; border-bottom: 1px solid #000; padding-bottom: 3px; }
      .dest { font-size: 14px; font-weight: bold; margin: 5px 0 2px; }
      .chave { font-size: 8px; word-break: break-all; margin-top: 4px; }
    `,
    body: `
      <div class="etiqueta">
        <div class="topo"><span>NF-e ${h(nfe.number)} / Série ${h(nfe.series)}</span><span>${financeFormatDate(nfe.date)}</span></div>
        <div class="dest">${h(nfe.customer)}</div>
        <div>${h(nfeFormatDocument(nfe.clientDocument))}</div>
        <div>${h(nfe.clientAddress || '-')}</div>
        <div>${h(nfe.clientCity || '-')} - ${h(nfe.clientState || '-')}</div>
        ${nfe.key ? `<div class="chave">${h(nfe.key)}</div>` : ''}
      </div>
    `
  }),

  // Mesma etiqueta, duas por folha lado a lado (via/contravia).
  etiqueta2: (nfe, h) => {
    const uma = NFE_PRINT_LAYOUTS.etiqueta(nfe, h);
    return {
      css: uma.css.replace('@page { size: 100mm 50mm; margin: 3mm; }', '@page { size: A4 landscape; margin: 5mm; }') +
        '.par { display: grid; grid-template-columns: 1fr 1fr; gap: 5mm; }',
      body: `<div class="par">${uma.body}${uma.body}</div>`
    };
  }
};

// O DOCUMENTO de uma nota fiscal é a DANFE, não um resumo montado por nós.
//
// Os layouts acima nasceram para o registro MANUAL do Financeiro, que nunca foi
// à SEFAZ e não tem DANFE. Aplicá-los a uma nota fiscal produzia uma página sem
// sentido, e não por acaso: fiscalNfeParaLista (server.js) devolve `items: []` e
// não devolve endereço, porque a lista não precisa disso. O resultado impresso
// era o número da nota, "Endereço: -, - - -" e uma tabela de produtos VAZIA.
//
// Pior do que inútil: um papel parecido com nota, sem os produtos, é o tipo de
// coisa que alguém entrega junto com a mercadoria achando que é a DANFE.
//
// Etiqueta de despacho continua interna — etiqueta não é documento fiscal, e o
// layout dela só usa destinatário e chave, que a lista tem.
const NFE_LAYOUTS_DE_DOCUMENTO = ['completo', 'simplificado'];

function nfeEscreverAviso(win, texto) {
  win.document.write(`<title>${escapeHtml(texto)}</title><p style="font:16px system-ui;padding:24px">${escapeHtml(texto)}</p>`);
  win.document.close();
}

async function nfePrint(nfe, layout = 'completo') {
  const build = NFE_PRINT_LAYOUTS[layout] || NFE_PRINT_LAYOUTS.completo;
  // SEM 'noopener' na lista de opções — e isso não é descuido de segurança.
  //
  // Por especificação, window.open com noopener devolve NULL: quem chamou não
  // recebe referência nenhuma. Só que a ABA É CRIADA do mesmo jeito. O
  // resultado era: `win` nulo, o `if (!win) return` disparava em 100% dos
  // cliques, nada era escrito, e sobrava uma aba about:blank vazia — sem
  // conteúdo, sem impressão e sem mensagem de erro. Quatro ações caíam aqui:
  // Imprimir, Imprimir 80mm, Etiqueta e Etiqueta em Duas Colunas.
  //
  // Medido em 17/08/2026: com noopener a chamada devolveu NULL e deixou uma
  // aba about:blank; sem ele, o conteúdo é escrito e `win.opener` continua
  // null por causa da linha abaixo. A proteção é a mesma — a janela nova não
  // consegue mexer nesta — e aqui ela é atribuída DEPOIS, quando ainda dá para
  // usar a referência.
  // Agora `!win` significa MESMO pop-up bloqueado, e aí o silêncio é o pior
  // desfecho possível: foi ele que fez o usuário procurar o problema em tudo
  // menos no botão. Lança, que o painel de ações captura e mostra na tela —
  // `showToast` vem do ctx e não existe neste escopo.
  const win = window.open('', '_blank');
  if (!win) throw new Error('O navegador bloqueou a janela de impressão. Libere os pop-ups deste site e tente de novo.');
  win.opener = null;

  // Nota que foi à SEFAZ: imprime a DANFE de verdade, a mesma que o "Baixar
  // DANFE" entrega. Buscada com o token, porque a autenticação é por cabeçalho.
  if (NFE_LAYOUTS_DE_DOCUMENTO.includes(layout) && nfe.origem === 'fiscal') {
    const fechar = () => { try { win.close(); } catch (_) { /* já fechada */ } };
    if (!nfe.temDanfe) {
      fechar();
      throw new Error('A DANFE só existe depois que a SEFAZ autoriza a nota. Enquanto isso não acontece, não há documento para imprimir.');
    }
    nfeEscreverAviso(win, 'Abrindo a DANFE…');
    let resposta;
    try {
      resposta = await fetch(`/api/fiscal/nfe/${encodeURIComponent(nfe.id)}/danfe`, {
        headers: { 'x-auth-token': getSessionToken() || '' }
      });
    } catch (error) {
      fechar();
      throw new Error(`Falha ao buscar a DANFE: ${error.message || 'erro desconhecido'}`);
    }
    if (!resposta.ok) {
      const corpo = await resposta.json().catch(() => ({}));
      fechar();
      throw new Error(corpo.error || `Não foi possível abrir a DANFE (HTTP ${resposta.status}).`);
    }
    // O visualizador de PDF do navegador tem o próprio botão de imprimir;
    // chamar print() de fora dele não é confiável, e falhar em silêncio já
    // custou caro nesta tela. Melhor entregar a DANFE na tela, com o botão.
    // O DANFCe da NFC-e é HTML e abre isolado (shared/abrir_danfe.js).
    await window.MavisDanfe.mostrar(win, await resposta.blob(), Number(nfe.modelo) === 65 ? 'DANFCe' : 'DANFE');
    return;
  }

  // Registro manual do Financeiro (sem DANFE) e etiquetas: layout interno.
  const { css, body } = build(nfe, escapeHtml);
  win.document.write(`<html><head><title>NF-e ${escapeHtml(nfe.number)}</title><meta charset="utf-8" /><style>${css}</style></head><body>${body}</body></html>`);
  win.document.close();
  win.focus();
  win.print();
}

// DUAS TELAS, UMA LISTA (14/10/2026). Pedido do usuário: "faça uma tela de
// NFC-e emitidas, para registro de todos os cupons que foram emitidos, com o
// botão de ações em cima igual ao das NF-e emitidas, no módulo de Vendas".
// "NFC-e Emitidas" é esta mesma lista com o modelo fixo em 65: mesmas ações
// (DANFCe, XML, cancelar, consultar), filtros e página guardados à parte.
// Sem "+ Nova": a NFC-e sai do pedido (Mais Ações › Emitir NFC-e).
const NOTAS_EMITIDAS_TELAS = {
  nfe_emitidas: { titulo: 'NF-e Emitidas', modeloFixo: '', estado: 'nfeLista', singular: 'nota', plural: 'notas', novo: true },
  nfce_emitidas: { titulo: 'NFC-e Emitidas', modeloFixo: '65', estado: 'nfceLista', singular: 'cupom', plural: 'cupons', novo: false }
};

function criarTelaDeNotasEmitidas(telaChave) {
  const tela = NOTAS_EMITIDAS_TELAS[telaChave];
  const estado = (sufixo) => tela.estado + sufixo;
  return async function renderFinanceNfeEmitidas(ctx) {
  const { content, api, showToast, state, loadModule, escapeHtml, confirmModal } = ctx;

  // Esta tela é espelhada: aparece no Financeiro e no Fiscal. A navegação entre
  // ela e "Nova NF-e Avulsa" tem que ficar no módulo por onde a pessoa entrou —
  // 'finance' fixo mandava para o Financeiro quem estava no Fiscal.
  // Só vale para as irmãs: ir para a venda ou para o lançamento continua
  // atravessando de módulo, porque essas telas existem em um lugar só.
  // Vendas também espelha esta tela (app.js, sub 'nfes'), mas NÃO tem a irmã
  // "Nova NF-e Avulsa" no menu — de lá o destino certo é mesmo o Financeiro,
  // que tem. Por isso a queda para 'finance' e não um terceiro caso.
  const moduloAtual = () => (state.activeModule === 'fiscal' ? 'fiscal' : 'finance');

  // Os filtros ficam no state (fase EI), como a ordem e o tamanho da página já
  // ficavam: eram locais e sumiam ao abrir outra tela e voltar. Só as chaves
  // conhecidas e só texto, para um state velho não injetar parâmetro na busca.
  const FILTROS_VAZIOS = { search: '', status: '', dateFrom: '', dateTo: '', estabelecimentoId: '', modelo: '', valorDe: '', valorAte: '' };
  const filters = { ...FILTROS_VAZIOS };
  const filtrosSalvos = state[estado('Filtros')] || {};
  Object.keys(FILTROS_VAZIOS).forEach((chave) => {
    if (typeof filtrosSalvos[chave] === 'string') filters[chave] = filtrosSalvos[chave];
  });
  let page = 1;
  // Notas por página: de 30 a 250 (pedido do usuário, 11/10/2026). Guardado no
  // state para sobreviver a sair e voltar à tela; o servidor também limita.
  const POR_PAGINA = [30, 50, 100, 150, 200, 250];
  let limit = POR_PAGINA.includes(state[estado('PorPagina')]) ? state[estado('PorPagina')] : 30;
  // A ordem: clicar no cabeçalho ordena; clicar de novo inverte. O servidor
  // compara o número COMO número (ordenarNfes em server.js).
  const ordem = state[estado('Ordem')] || { campo: 'data', direcao: 'desc' };
  const COLUNAS_ORDENAVEIS = { numero: 'Número', data: 'Data', empresa: 'Empresa', cliente: 'Cliente', valor: 'Valor', status: 'Status' };

  // Seleção guardada por id (não por índice) para sobreviver a refiltragem;
  // `notasDaPagina` guarda os objetos completos, que o painel de ações precisa.
  const selecionadas = new Set();
  let notasDaPagina = [];
  let apiFiscalConfigurada = false;

  // Descobre uma vez se a Focus NFe está configurada — é o que decide se as
  // ações fiscais aparecem habilitadas ou desabilitadas com o motivo.
  //
  // SEM `await` (fase DS): em produção esta rota faz uma chamada HTTPS à
  // Focus (até 15 s se ela não responder), e a lista de notas não começava a
  // carregar antes disso. O status só alimenta o painel de ações, que só
  // aparece com nota marcada; quando ele chega, o painel é redesenhado. Até
  // lá vale `false`, que é o que já valia quando a consulta falhava.
  //
  // A marca em `content` evita que uma resposta atrasada redesenhe o painel de
  // OUTRA abertura desta tela (sair e voltar cria uma tela nova no mesmo lugar).
  const estaAbertura = {};
  content.__nfeEmitidasAbertura = estaAbertura;
  api('/api/focusnfe/status')
    .then((status) => { apiFiscalConfigurada = Boolean(status.configured && status.connected); })
    .catch(() => { apiFiscalConfigurada = false; })
    .then(() => { if (content.__nfeEmitidasAbertura === estaAbertura) renderActionsPanel(); });

  function buildQuery() {
    const params = new URLSearchParams({ page: String(page), limit: String(limit), sort: ordem.campo, dir: ordem.direcao });
    Object.entries(filters).forEach(([key, value]) => { if (value) params.set(key, value); });
    if (tela.modeloFixo) params.set('modelo', tela.modeloFixo);
    return params.toString();
  }

  // AS NOTAS EM EDIÇÃO (14/10/2026): pedido do usuário, "crie um estado para
  // essas notas e deixe elas em notas emitidas". Vêm de outra tabela (não são
  // documento fiscal), entram no topo da primeira página e respeitam os
  // filtros que fazem sentido para elas. NFC-e não tem nota em edição.
  let rascunhos = [];
  const somenteDigitos = (v) => String(v || '').replace(/\D/g, '');
  function rascunhosVisiveis() {
    if (tela.modeloFixo === '65' || page !== 1) return [];
    if (filters.status && filters.status !== 'em-edicao') return [];
    if (filters.modelo && filters.modelo !== '55') return [];
    const termo = String(filters.search || '').trim().toLowerCase();
    return rascunhos.filter((r) => {
      const dia = String(r.atualizadoEm || '').slice(0, 10);
      if (filters.dateFrom && dia < filters.dateFrom) return false;
      if (filters.dateTo && dia > filters.dateTo) return false;
      if (filters.valorDe && Number(r.valor) < Number(filters.valorDe)) return false;
      if (filters.valorAte && Number(r.valor) > Number(filters.valorAte)) return false;
      if (filters.estabelecimentoId && r.estabelecimentoId !== filters.estabelecimentoId) return false;
      if (!termo) return true;
      return String(r.cliente || '').toLowerCase().includes(termo)
        || (somenteDigitos(termo) && somenteDigitos(r.documento).includes(somenteDigitos(termo)))
        || String(r.pedidoCodigo || '') === termo;
    });
  }

  async function load() {
    let result;
    try {
      const [lista, emEdicao] = await Promise.all([
        filters.status === 'em-edicao'
          ? Promise.resolve({ nfes: [], total: 0, limit })
          : api(`/api/finance/nfe?${buildQuery()}`),
        tela.modeloFixo === '65'
          ? Promise.resolve({ rascunhos: [] })
          : api('/api/fiscal/nfe/rascunhos').catch(() => ({ rascunhos: [] }))
      ]);
      result = lista;
      rascunhos = emEdicao.rascunhos || [];
    } catch (error) {
      content.innerHTML = `<div class="panel"><p class="muted">Erro ao carregar NF-e: ${escapeHtml(error.message || 'erro desconhecido')}</p></div>`;
      return;
    }
    renderView(result);
    vigiarProcessando();
  }

  // O botão Cancelar da linha e o do modal seguem a MESMA regra do painel de
  // ações (fase EI). Olhavam só "autorizada e não importada": fora do prazo
  // (24 h na NF-e, 30 min na NFC-e) o botão aparecia, a pessoa escrevia a
  // justificativa inteira e só então levava a recusa do servidor. Devolve o
  // motivo do bloqueio, ou '' quando pode cancelar. Nota manual continua
  // liberada: a regra só olha prazo de nota que foi à SEFAZ.
  function motivoParaNaoCancelar(nfe) {
    const acoes = window.MavisNfeActions;
    const acao = acoes && acoes.CATALOG.find((a) => a.id === 'cancelar');
    if (!acao) return '';
    const motivo = acoes.motivoBloqueio(acao, { ...actionsContext(), selecionadas: [nfe], nfe });
    if (!motivo) return '';
    // A NF-e (não a NFC-e) vencida ainda tem a saída do extemporâneo.
    const extemporaneoPossivel = nfe.origem === 'fiscal' && nfe.status === 'autorizada' && Number(nfe.modelo) !== 65;
    return extemporaneoPossivel
      ? `${motivo} Para pedir, marque a nota e use "Cancelamento Extemporâneo de NF-e" no painel de ações.`
      : motivo;
  }

  // A chave tem 44 dígitos e, com o nowrap da tabela, ocupava sozinha ~350 px
  // e empurrava Lançamento e Ações para fora da tela (fase EI). Na linha vão os
  // 8 últimos; a inteira fica na dica, no clique (copia) e no modal.
  async function copiarChave(chave) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(chave);
      } else {
        // Fora de HTTPS o navegador não oferece a área de transferência
        // moderna; o caminho antigo ainda funciona.
        const campo = document.createElement('textarea');
        campo.value = chave;
        campo.setAttribute('readonly', '');
        campo.style.position = 'fixed';
        campo.style.opacity = '0';
        document.body.appendChild(campo);
        campo.select();
        const copiou = document.execCommand('copy');
        campo.remove();
        if (!copiou) throw new Error('cópia recusada');
      }
      showToast('Chave de acesso copiada.', 'success');
    } catch (error) {
      showToast('Não foi possível copiar a chave. Abra a nota para ver a chave inteira.', 'error');
    }
  }

  // Contexto entregue ao painel de ações: seleção atual + os callbacks que cada
  // ação chama. Recalculado a cada render para o painel nunca ver estado velho.
  function actionsContext() {
    const lista = notasDaPagina.filter((nfe) => selecionadas.has(nfe.id));
    return {
      // Na tela de NFC-e Emitidas, o painel fala em cupom e DANFCe.
      nomeDoDocumento: tela.modeloFixo === '65' ? 'NFC-e' : 'NF-e',
      selecionadas: lista,
      nfe: lista.length === 1 ? lista[0] : null,
      apiFiscalConfigurada,
      escapeHtml,
      showToast,
      print: nfePrint,
      cancelar: cancelNfe,
      duplicar: duplicarNfe,
      irParaVenda: irParaVenda,
      baixarArquivo: baixarArquivoFiscal,
      baixarLote: baixarLoteFiscal,
      cartaCorrecao: abrirCartaCorrecao,
      consultarStatus: consultarStatusFiscal,
      statusServico: consultarStatusServico,
      limparSelecao: () => { selecionadas.clear(); load(); }
    };
  }

  // ---------------------------------------------------------------- fiscais
  // Estas ações só chegam aqui para notas de origem 'fiscal' — o painel bloqueia
  // as manuais antes, porque elas não existem na SEFAZ.

  // BUSCA com o token e abre o resultado, em vez de apontar a aba para a rota.
  //
  // A versão anterior fazia window.open direto na URL da API, para preservar o
  // nome do Content-Disposition e não segurar o arquivo na memória. Só que a
  // autenticação deste sistema é por CABEÇALHO (x-auth-token, guardado no
  // sessionStorage) e não por cookie: uma aba nova é navegação limpa, chega ao
  // servidor sem token nenhum e leva 403 "Sem permissão".
  //
  // Medido em 15/08/2026 numa nota AUTORIZADA, com o PDF já guardado no banco:
  // a rota devolvia 13 KB de %PDF-1.3 com o token, e 403 sem ele. Baixar DANFE,
  // Baixar XML, DANFE com UN. TRIB. e DANFE em Lote passavam pela mesma função,
  // então nenhum dos quatro funcionava — e a tela não dizia por quê, porque o
  // erro acontecia na outra aba.
  //
  // O nome do arquivo é reposto pelo atributo `download`, e o objeto é liberado
  // depois; o custo de memória é de um DANFE (dezenas de KB), não de um lote.
  //
  // A ABA É ABERTA ANTES DA BUSCA, e isso não é estilo: é a correção de um
  // segundo bug, encontrado com a primeira já no ar. Abrir a aba DEPOIS do
  // await sai do gesto do usuário, e o Chrome trata como pop-up: a janela
  // aparece e a navegação é barrada. O resultado era uma aba "about:blank"
  // parada — nem PDF, nem erro, nem aviso. Não deu para ver isso no Chrome sem
  // interface, que não liga o bloqueador de pop-up; só apareceu no navegador
  // de verdade. Abrindo aqui, dentro do clique, a janela é nossa e navegar
  // nela depois já não é pop-up nenhum.
  async function baixarArquivoFiscal(nfe, tipo, { paraLeitura = true } = {}) {
    const rotulo = tipo === 'xml' ? 'XML' : 'DANFE';
    // PDF abre para LER — é o que a pessoa quer ao clicar em DANFE. XML não tem
    // o que ver na tela, e o LOTE nunca abre aba: dez notas seriam dez pop-ups.
    const querAba = paraLeitura && tipo !== 'xml';
    const aba = querAba ? window.open('', '_blank') : null;
    // Aba em branco enquanto a busca acontece parece travamento.
    if (aba) aba.document.write(`<title>${rotulo}</title><p style="font:16px system-ui;padding:24px">Abrindo o ${rotulo}…</p>`);
    let url = null;
    try {
      const resposta = await fetch(`/api/fiscal/nfe/${encodeURIComponent(nfe.id)}/${tipo}`, {
        headers: { 'x-auth-token': getSessionToken() || '' }
      });
      if (!resposta.ok) {
        // A rota devolve JSON no erro ("ainda não disponível", "Sem permissão").
        const corpo = await resposta.json().catch(() => ({}));
        // Fecha a aba antes do aviso: deixá-la aberta em branco é justamente o
        // sintoma que mandou o usuário procurar problema onde não estava.
        if (aba) aba.close();
        showToast(corpo.error || `Não foi possível abrir o ${rotulo} (HTTP ${resposta.status}).`, 'error');
        return;
      }
      const blob = await resposta.blob();
      // DANFCe (NFC-e) é HTML: na aba, abre isolado; no disco, vai como .html.
      const ehHtml = String(blob.type || '').includes('text/html');
      if (aba && !aba.closed && ehHtml) {
        await window.MavisDanfe.mostrar(aba, blob, 'DANFCe');
        return;
      }
      url = URL.createObjectURL(blob);
      const nome = `nfe-${nfe.number || nfe.key || nfe.id}.${tipo === 'xml' ? 'xml' : (ehHtml ? 'html' : 'pdf')}`;

      if (aba && !aba.closed) {
        // replace e não href: a aba não guarda o "carregando" no histórico, e
        // o botão Voltar dela não volta para uma página que não existe mais.
        aba.location.replace(url);
      } else {
        // Sem aba (XML, lote, ou pop-up bloqueado de vez): vai para o disco.
        const link = document.createElement('a');
        link.href = url;
        link.download = nome;
        document.body.appendChild(link);
        link.click();
        link.remove();
        if (querAba) showToast(`O ${rotulo} foi baixado — o navegador bloqueou a abertura em nova aba.`, 'success');
      }
    } catch (error) {
      if (aba) aba.close();
      showToast(`Falha ao buscar o ${rotulo}: ${error.message || 'erro desconhecido'}`, 'error');
    } finally {
      // Só depois da aba ler o conteúdo — revogar na hora deixa a aba em branco.
      if (url) setTimeout(() => URL.revokeObjectURL(url), 60000);
    }
  }

  function baixarLoteFiscal(notas, tipo) {
    // Um arquivo por nota: a Focus não tem endpoint de lote. Vai espaçado para
    // não disparar N buscas ao mesmo tempo, e sempre para o disco.
    notas.forEach((nfe, i) => setTimeout(() => baixarArquivoFiscal(nfe, tipo, { paraLeitura: false }), i * 400));
    showToast(`Baixando ${notas.length} arquivo(s)…`, 'success');
  }

  async function consultarStatusFiscal(notas) {
    let atualizadas = 0;
    for (const nfe of notas) {
      try {
        // GET da nota reconsulta a SEFAZ e regrava o status — é o que resolve
        // nota parada em "Processando" quando o webhook não chegou.
        const res = await api(`/api/fiscal/nfe/${encodeURIComponent(nfe.id)}`);
        if (res.nfe && res.nfe.status !== nfe.statusFiscal) atualizadas += 1;
      } catch (error) {
        showToast(`NF-e ${nfe.number || nfe.referencia}: ${error.message || 'erro ao consultar'}`, 'error');
      }
    }
    showToast(atualizadas ? `${atualizadas} nota(s) mudaram de status.` : 'Nenhuma mudança de status.', 'success');
    await load();
  }

  async function consultarStatusServico() {
    try {
      const status = await api('/api/focusnfe/status');
      showToast(
        status.connected
          ? `Focus NFe respondendo — ambiente de ${status.ambiente}.${status.travadoEmHomologacao ? ' Notas daqui NÃO têm valor fiscal.' : ''}`
          : `Focus NFe não respondeu: ${status.message || 'sem detalhe'}`,
        status.connected ? 'success' : 'error'
      );
    } catch (error) {
      showToast(error.message || 'Erro ao consultar o serviço.', 'error');
    }
  }

  async function abrirCartaCorrecao(nfe) {
    // A SEFAZ exige de 15 a 1000 caracteres, e a CC-e NÃO pode corrigir valor,
    // data, destinatário nem itens — só dados que não alterem o cálculo do
    // imposto. Dizer isso aqui evita a rejeição depois de digitar tudo.
    const limpo = await promptModal({
      titulo: `Carta de Correção — NF-e ${nfe.number || nfe.referencia || ''}`.trim(),
      aviso: 'Não serve para corrigir valor, data, destinatário nem itens — só dados que não mudam o cálculo do imposto. A SEFAZ recusa o resto.',
      descricao: 'A CC-e é um evento registrado na SEFAZ e fica no histórico da nota.',
      rotulo: 'Descreva a correção',
      placeholder: 'O que precisa ser corrigido na nota.',
      minimo: 15,
      maximo: 1000,
      confirmar: 'Enviar correção',
      tom: 'primary'
    });
    if (limpo === null) return;
    try {
      await api(`/api/fiscal/nfe/${encodeURIComponent(nfe.id)}/cce`, {
        method: 'POST',
        body: JSON.stringify({ correcao: limpo })
      });
      showToast('Carta de Correção enviada.', 'success');
      await load();
    } catch (error) {
      showToast(error.message || 'Erro ao enviar a Carta de Correção.', 'error');
    }
  }

  function renderActionsPanel() {
    const painel = document.getElementById('nfeActionsPanel');
    if (painel) window.MavisNfeActions.render(painel, actionsContext());
  }

  async function duplicarNfe(nfe) {
    // `state.financeDuplicateNfe` era gravado aqui e NÃO era lido por tela
    // nenhuma — duplicar só abria um formulário em branco. Agora usa o mesmo
    // canal de pré-preenchimento da emissão (`state.nfeFromOrder`), sem
    // orderId: uma duplicata é uma nota NOVA e avulsa, e herdar o pedido da
    // original faria a cópia não gerar contas a receber.
    let itens = [];
    if (nfe.origem === 'fiscal') {
      try {
        // Os itens da nota fiscal estão no payload que foi para a SEFAZ — é a
        // única cópia fiel do que foi transmitido.
        const res = await api(`/api/fiscal/nfe/${encodeURIComponent(nfe.id)}`);
        itens = ((res.nfe?.payloadEnviado || {}).items || []).map((item) => ({
          code: item.codigo_produto || '',
          description: item.descricao || '',
          quantity: Number(item.quantidade_comercial || 0),
          unitPrice: Number(item.valor_unitario_comercial || 0)
        }));
      } catch (error) {
        showToast('Não foi possível ler os itens da nota original: ' + (error.message || error), 'error');
        return;
      }
    } else {
      itens = (nfe.items || []).map((item) => ({
        code: item.code || '', description: item.description || '',
        quantity: Number(item.quantity || 0), unitPrice: Number(item.unitPrice || 0)
      }));
    }
    state.nfeFromOrder = {
      orderId: '',
      clientSupplierId: nfe.clientSupplierId || '',
      clientName: nfe.customer || '',
      items: itens
    };
    state.activeSub = 'nova_nfe_avulsa';
    // Módulo atual, não 'finance' fixo: esta tela é espelhada no Fiscal, e
    // fixar o destino jogaria para o Financeiro quem entrou pelo Fiscal.
    // Irmã da mesma dupla (Emitidas <-> Nova) fica sempre no módulo de origem.
    loadModule(moduloAtual());
  }

  // O desfecho de uma nota: autorizada vira aviso com o número; erro (ou
  // denegada) abre o motivo em popup, com "Corrigir nota". Outro status não
  // avisa nada (devolve false).
  function avisarDesfecho(nota) {
    const status = String(nota.status || '').toLowerCase();
    if (status === 'autorizado' || status === 'autorizada') {
      showToast(`NF-e${nota.numero ? ` nº ${nota.numero}` : ''} autorizada.`, 'success', 7000);
      return true;
    }
    if (['erro', 'denegado', 'denegada'].includes(status)) {
      abrirErroDaNota(nota.id);
      return true;
    }
    return false;
  }

  // O RESULTADO DA EMISSÃO (14/10/2026): a emissão vem para cá logo depois de
  // emitir. Autorizada ou com erro, avisa na hora; em processamento, quem
  // avisa é o acompanhamento abaixo, quando o status mudar.
  function mostrarResultadoDaEmissao(resultado) {
    avisarDesfecho(resultado);
  }

  // ACOMPANHAR AS NOTAS EM PROCESSAMENTO (14/10/2026, pedido do usuário: "faça
  // o teste de mudança de status a cada 0,3s e informe apenas quando houver").
  // A tela pergunta ao NOSSO servidor a cada 0,3 s (só banco, ver
  // /api/fiscal/nfe/status); é ele que vai à Focus, no máximo a cada 5 s por
  // nota — a Focus conta cada consulta na cota e recomenda o webhook (doc
  // "cuidados na emissão de documentos assíncronos"). Só avisa quando muda;
  // para sozinho quando nenhuma nota da página está processando ou a tela sai.
  const VIGIA_INTERVALO_MS = 300;
  let vigia = null;
  let vigiaOcupado = false;
  function pararVigia() {
    if (vigia) clearInterval(vigia);
    vigia = null;
    vigiaOcupado = false;
  }
  function vigiarProcessando() {
    pararVigia();
    const pendentes = new Set(notasDaPagina
      .filter((n) => n.origem === 'fiscal' && n.status === 'processando')
      .map((n) => n.id));
    if (!pendentes.size) return;
    const moduloDaTela = state.activeModule;
    vigia = setInterval(async () => {
      if (state.activeSub !== telaChave || state.activeModule !== moduloDaTela || !content.isConnected) { pararVigia(); return; }
      if (vigiaOcupado) return;
      vigiaOcupado = true;
      try {
        const res = await api(`/api/fiscal/nfe/status?ids=${encodeURIComponent([...pendentes].join(','))}`);
        const mudaram = (res.notas || []).filter((n) => pendentes.has(n.id) && n.status !== 'processando');
        if (!mudaram.length) return;
        mudaram.forEach((n) => pendentes.delete(n.id));
        pararVigia();
        await load();
        mudaram.forEach((n) => avisarDesfecho(n));
      } catch (_) {
        // Falha de rede num ciclo não encerra o acompanhamento.
      } finally {
        vigiaOcupado = false;
      }
    }, VIGIA_INTERVALO_MS);
  }

  // Abre o PEDIDO da nota, como a lista de vendas abre (14/10/2026). Antes
  // gravava state.salesOpenRecordId, que ninguém lia, numa tela que não
  // existe ('sales_records'): o botão não levava ao pedido.
  async function irParaVenda(nfe) {
    if (!nfe || !nfe.orderId) return;
    try {
      const res = await api(`/api/sales/records/${encodeURIComponent(nfe.orderId)}`);
      state.salesDraft = state.salesDraft || {};
      state.salesDraft.editRecord = res.record || res;
      state.salesDraft.novoStatus = '';
      state.activeModule = 'sales';
      state.activeSub = 'new_sale';
      if (typeof renderApp === 'function') renderApp();
      loadModule('sales');
    } catch (erro) {
      showToast(erro.message || 'Não consegui abrir o pedido desta nota.', 'error');
    }
  }

  // A NOTA COM ERRO (fase EO, 14/10/2026, pedido do usuário): o motivo em
  // popup e "Corrigir nota", que reabre a emissão com o que a nota tinha. A
  // NFC-e de pedido é montada do pedido no servidor: corrige-se no pedido.
  async function abrirErroDaNota(id) {
    const naLista = notasDaPagina.find((n) => n.id === id) || {};
    const nfce = Number(naLista.modelo) === 65;
    let erro = { motivos: [naLista.mensagemSefaz].filter(Boolean), statusSefaz: '' };
    try {
      const res = await api(`/api/fiscal/nfe/${encodeURIComponent(id)}`);
      erro = res.erro || window.MavisErroNfe.motivosDaNota(res.nfe);
    } catch (_) {
      // Sem o detalhe, vale a mensagem que a lista já tem.
    }
    const podeCorrigir = nfce ? Boolean(naLista.orderId) : true;
    // Excluir: só administrador (o servidor confere o mesmo e consulta a Focus).
    const podeExcluir = typeof usuarioEhAdmin === 'function' && usuarioEhAdmin();
    const escolha = await window.MavisErroNfe.mostrar({
      podeExcluir,
      titulo: `${nfce ? 'NFC-e' : 'NF-e'} com erro${naLista.customer ? ` — ${naLista.customer}` : ''}`,
      motivos: erro.motivos || [],
      statusSefaz: erro.statusSefaz || '',
      podeCorrigir,
      rotuloCorrigir: nfce ? 'Abrir pedido' : 'Corrigir nota'
    });
    if (escolha === 'excluir') {
      const rotulo = `${nfce ? 'NFC-e' : 'NF-e'} com erro${naLista.customer ? ` de ${naLista.customer}` : ''}${naLista.amount ? ` (${financeFormatBRL(naLista.amount)})` : ''}`;
      if (!await confirmModal(`Excluir a ${rotulo}?\n\nEla foi recusada e não vale como documento fiscal. Antes de excluir, o sistema confere na Focus NFe que ela não foi autorizada. A exclusão fica registrada na auditoria.`)) return;
      try {
        await api(`/api/fiscal/nfe/${encodeURIComponent(id)}`, { method: 'DELETE' });
        showToast('NF-e com erro excluída.', 'success');
        await load();
      } catch (erroDaExclusao) {
        showToast(erroDaExclusao.message || 'Não consegui excluir a nota.', 'error', 9000);
        await load();
      }
      return;
    }
    if (escolha !== 'corrigir') return;
    if (nfce) { irParaVenda(naLista); return; }
    try {
      const r = await window.MavisErroNfe.prepararCorrecao(id, { confirmar: confirmModal });
      if (!r) return;
      if (r.pedidoId) state.nfeFromOrder = { orderId: r.pedidoId, code: r.pedidoCodigo || 0 };
      else delete state.nfeFromOrder;
      const modulo = moduloAtual();
      state.activeModule = modulo;
      state.activeSub = 'emitir_nfe_focus';
      if (typeof renderApp === 'function') renderApp();
      loadModule(modulo);
    } catch (erroDaCorrecao) {
      showToast(erroDaCorrecao.message || 'Não consegui abrir a nota para correção.', 'error');
    }
  }

  function cabecalhoOrdenavel(campo) {
    const ativa = campo === ordem.campo;
    const seta = ativa ? (ordem.direcao === 'asc' ? '▲' : '▼') : '';
    const proxima = ativa && ordem.direcao === 'asc' ? 'decrescente' : 'crescente';
    // Dinheiro à direita (fase EI), o título junto da coluna: col-valor alinha
    // o <th>, mas o botão de ordenar é flex e precisa do próprio ajuste.
    const direita = campo === 'valor';
    return `
      <th ${direita ? 'class="col-valor" ' : ''}aria-sort="${ativa ? (ordem.direcao === 'asc' ? 'ascending' : 'descending') : 'none'}">
        <button type="button" class="lista-ordenar ${ativa ? 'is-ativa' : ''}" data-ordenar="${campo}"${direita ? ' style="justify-content: flex-end;"' : ''}
                title="Ordenar por ${escapeHtml(COLUNAS_ORDENAVEIS[campo])} em ordem ${proxima}">
          <span>${escapeHtml(COLUNAS_ORDENAVEIS[campo])}</span>
          <span class="lista-ordenar-seta" aria-hidden="true">${seta}</span>
        </button>
      </th>`;
  }

  function renderView(result) {
    limit = Number(result.limit) || limit;
    const totalPages = Math.max(1, Math.ceil(result.total / limit));
    // Página além do fim (fase EI): cancelar a única nota da última página com
    // Status = Autorizada deixava "Página 3 de 2" vazia e o Próxima desligado.
    // O servidor não corrige a página pelo total; aqui volta para a última, uma
    // recarga só (na volta, page <= totalPages).
    if (page > totalPages && result.total > 0) {
      page = totalPages;
      load();
      return;
    }
    const empresas = (result.empresas || []).filter((e) => e.nome);
    notasDaPagina = result.nfes || [];
    // Descarta da seleção o que saiu da página atual (filtro/paginação mudou).
    const idsVisiveis = new Set(notasDaPagina.map((n) => n.id));
    [...selecionadas].forEach((id) => { if (!idsVisiveis.has(id)) selecionadas.delete(id); });
    const todasMarcadas = notasDaPagina.length > 0 && notasDaPagina.every((n) => selecionadas.has(n.id));
    const emEdicaoVisiveis = rascunhosVisiveis();

    content.innerHTML = `
      <div class="cadastro-page-head">
        <div>
          <h3>${escapeHtml(tela.titulo)}</h3>
          <p class="muted">${emEdicaoVisiveis.length ? `<strong>${emEdicaoVisiveis.length} em edição</strong> · ` : ''}${result.total} ${result.total === 1 ? tela.singular : tela.plural} encontrad${tela.singular === 'cupom' ? 'o' : 'a'}${result.total === 1 ? '' : 's'}${typeof result.valorAutorizado === 'number'
            ? ` · Total autorizado: <strong title="Soma das NF-e autorizadas do filtro inteiro, não só desta página">${financeFormatBRL(result.valorAutorizado)}</strong>` : ''}</p>
        </div>
        <div class="cadastro-list-actions">
          ${tela.novo ? '<button type="button" id="nfeNewBtn">+ Nova NF-e</button>' : ''}
        </div>
      </div>

      <form id="nfeFilterForm" class="nfe-filtros" style="margin-bottom: 12px;">
        <label class="cadastro-field nfe-filtro-busca">
          <span>Busca</span>
          <input name="search" value="${escapeHtml(filters.search)}" placeholder="Número, cliente, CPF/CNPJ ou chave" />
        </label>
        <label class="cadastro-field">
          <span>Status</span>
          <select name="status">
            <option value="">Todos</option>
            ${Object.entries(NFE_STATUS_META).map(([value, meta]) => `<option value="${value}" ${filters.status === value ? 'selected' : ''}>${meta.label}</option>`).join('')}
          </select>
        </label>
        ${tela.modeloFixo ? '' : `<label class="cadastro-field">
          <span>Modelo</span>
          <select name="modelo">
            <option value="">Todos</option>
            <option value="55" ${filters.modelo === '55' ? 'selected' : ''}>NF-e</option>
            <option value="65" ${filters.modelo === '65' ? 'selected' : ''}>NFC-e</option>
          </select>
        </label>`}
        <label class="cadastro-field">
          <span>Data inicial</span>
          <input type="date" name="dateFrom" value="${escapeHtml(filters.dateFrom)}" />
        </label>
        <label class="cadastro-field">
          <span>Data final</span>
          <input type="date" name="dateTo" value="${escapeHtml(filters.dateTo)}" />
        </label>
        <label class="cadastro-field">
          <span>Valor de (R$)</span>
          <input name="valorDe" type="number" step="0.01" min="0" value="${escapeHtml(filters.valorDe)}" placeholder="0,00" />
        </label>
        <label class="cadastro-field">
          <span>Valor até (R$)</span>
          <input name="valorAte" type="number" step="0.01" min="0" value="${escapeHtml(filters.valorAte)}" placeholder="0,00" />
        </label>
        ${empresas.length > 1 ? `
        <label class="cadastro-field">
          <span>Empresa</span>
          <select name="estabelecimentoId">
            <option value="">Todas</option>
            ${empresas.map((e) => `<option value="${escapeHtml(e.id)}" ${filters.estabelecimentoId === e.id ? 'selected' : ''}>${escapeHtml(e.nome)}</option>`).join('')}
          </select>
        </label>` : ''}
        <div class="nfe-filtro-acao" style="gap: 8px;">
          <button type="submit" class="secondary">Filtrar</button>
          <button type="button" class="secondary" id="nfeFilterClear">Limpar filtros</button>
        </div>
      </form>

      <div id="nfeActionsPanel" class="nfe-actions-panel" hidden></div>

      <div class="panel">
        <div class="table-scroll">
          <table class="table table-actions">
            <thead>
              <tr>
                <th class="nfe-check-col"><input type="checkbox" id="nfeSelectAll" ${todasMarcadas ? 'checked' : ''} title="Selecionar todas desta página" /></th>
                <th>Modelo</th>${cabecalhoOrdenavel('numero')}<th>Série</th>${cabecalhoOrdenavel('data')}${cabecalhoOrdenavel('empresa')}${cabecalhoOrdenavel('cliente')}<th>CPF/CNPJ</th>${cabecalhoOrdenavel('valor')}${cabecalhoOrdenavel('status')}<th>Chave</th>
              </tr>
            </thead>
            <tbody>
              ${emEdicaoVisiveis.map((r) => `
                <tr class="nfe-rascunho-row">
                  <td class="nfe-check-col"></td>
                  <td>NF-e</td>
                  <td><span class="muted">—</span></td>
                  <td><span class="muted">—</span></td>
                  <td>${nfeDiaEHora(r.atualizadoEm, String(r.atualizadoEm || '').slice(0, 10))}</td>
                  <td class="nfe-empresa"><span class="texto-cortado is-curto" title="${escapeHtml(r.empresa || '')}">${escapeHtml(r.empresa || '-')}</span></td>
                  <td><span class="texto-cortado is-medio" title="${escapeHtml(r.cliente || '')}">${escapeHtml(r.cliente || '-')}</span></td>
                  <td>${escapeHtml(nfeFormatDocument(r.documento))}</td>
                  <td class="col-valor">${financeFormatBRL(r.valor)}</td>
                  <td>${nfeStatusBadge('em-edicao')} <span class="muted" title="Salva por ${escapeHtml(r.salvoPor || '')}">${r.pedidoCodigo ? `pedido ${escapeHtml(String(r.pedidoCodigo))}` : 'avulsa'}</span></td>
                  <!-- Sem a coluna Ações (15/10/2026), Continuar e Descartar ficam
                       na célula da Chave, que a nota em edição ainda não tem — no
                       Status alargariam a coluna de todas as linhas. -->
                  <td>
                    <span class="nfe-rascunho-acoes">
                      <button type="button" class="finance-pill finance-pill-sm" data-continuar-rascunho="${escapeHtml(r.chave)}">Continuar</button>
                      <button type="button" class="secondary finance-pill-sm" data-descartar-rascunho="${escapeHtml(r.chave)}">Descartar</button>
                    </span>
                  </td>
                </tr>`).join('')}
              ${result.nfes.length ? result.nfes.map((nfe) => {
                // Fase EI: Cliente e Empresa vão cortados com "…" e o nome
                // inteiro na dica (com o nowrap da tabela, razão social longa
                // empurrava Valor e Status para fora da tela).
                // 15/10/2026, pedido do usuário: sem as colunas "Lançamento
                // financeiro" e "Ações" — cancelar fica no painel de ações (nota
                // marcada) e na ficha da nota, com a mesma regra de prazo.
                return `
                <tr class="cadastro-row-clickable finance-entry-row ${selecionadas.has(nfe.id) ? 'is-selected' : ''}" data-id="${escapeHtml(nfe.id)}">
                  <td class="nfe-check-col"><input type="checkbox" data-select="${escapeHtml(nfe.id)}" ${selecionadas.has(nfe.id) ? 'checked' : ''} /></td>
                  <td>${Number(nfe.modelo) === 65 ? 'NFC-e' : 'NF-e'}</td>
                  <td>${escapeHtml(nfe.number)}</td>
                  <td>${escapeHtml(nfe.series)}</td>
                  <td>${nfeDiaEHora(nfe.emitidaEm, nfe.date)}</td>
                  <td class="nfe-empresa"><span class="texto-cortado is-curto" title="${escapeHtml(nfe.empresa || '')}">${escapeHtml(nfe.empresa || '-')}</span></td>
                  <td><span class="texto-cortado is-medio" title="${escapeHtml(nfe.customer || '')}">${escapeHtml(nfe.customer || '-')}</span></td>
                  <td>${escapeHtml(nfeFormatDocument(nfe.clientDocument))}</td>
                  <td class="col-valor">${financeFormatBRL(nfe.amount)}</td>
                  <td>${nfe.status === 'erro' && nfe.origem === 'fiscal'
                    ? `<button type="button" class="link-button nfe-erro-motivo" data-erro-nfe="${escapeHtml(nfe.id)}" title="Ver o motivo do erro">${nfeStatusBadge(nfe.status)}</button>`
                    : nfeStatusBadge(nfe.status)}${nfe.origem === 'importada' ? ' <span class="finance-badge finance-badge-muted" title="Emitida no sistema anterior e importada como registro">importada</span>' : ''}</td>
                  <!-- A chave inteira (15/10/2026, pedido do usuário); o clique copia. -->
                  <td>${nfe.key
                    ? `<button type="button" class="link-button nfe-chave" data-copiar-chave="${escapeHtml(nfe.key)}" title="Clique para copiar">${chaveEmBlocos(nfe.key)}</button>`
                    : '<span class="muted">-</span>'}</td>
                </tr>
              `;
              }).join('') : (emEdicaoVisiveis.length ? '' : `<tr><td colspan="11" class="muted">Nenhuma NF-e encontrada.</td></tr>`)}
            </tbody>
          </table>
        </div>
        <div class="finance-pagination">
          <button type="button" class="secondary" id="nfePrevPage" ${page <= 1 ? 'disabled' : ''}>Anterior</button>
          <span class="muted">Página ${page} de ${totalPages}</span>
          <button type="button" class="secondary" id="nfeNextPage" ${page >= totalPages ? 'disabled' : ''}>Próxima</button>
          <label class="nfe-por-pagina">Por página
            <select id="nfePorPagina">
              ${POR_PAGINA.map((n) => `<option value="${n}" ${n === limit ? 'selected' : ''}>${n}</option>`).join('')}
            </select>
          </label>
          ${totalPages > 1 ? `
            <form id="nfeIrParaPagina" class="muted" style="display:flex;align-items:center;gap:6px;margin-left:12px;">
              Ir para
              <input type="number" min="1" max="${totalPages}" value="${page}" style="width:70px;" aria-label="Ir para a página" />
              <button type="submit" class="secondary">Ir</button>
            </form>` : ''}
        </div>
      </div>
    `;

    // Continuar: reabre a emissão, que recupera a nota salva (fase EL). A do
    // pedido entra pelo pedido; a avulsa é a da própria pessoa.
    content.querySelectorAll('[data-continuar-rascunho]').forEach((botao) => {
      botao.addEventListener('click', () => {
        const r = rascunhos.find((x) => x.chave === botao.dataset.continuarRascunho);
        if (!r) return;
        if (r.pedidoId) state.nfeFromOrder = { orderId: r.pedidoId, code: r.pedidoCodigo || 0 };
        const modulo = moduloAtual();
        state.activeModule = modulo;
        state.activeSub = 'emitir_nfe_focus';
        if (typeof renderApp === 'function') renderApp();
        loadModule(modulo);
      });
    });
    content.querySelectorAll('[data-descartar-rascunho]').forEach((botao) => {
      botao.addEventListener('click', async () => {
        const r = rascunhos.find((x) => x.chave === botao.dataset.descartarRascunho);
        if (!r) return;
        if (!await confirmModal(`Descartar a nota em edição${r.pedidoCodigo ? ` do pedido ${r.pedidoCodigo}` : ''}? O que foi preenchido nela se perde (nada foi enviado à SEFAZ).`)) return;
        try {
          await api(`/api/fiscal/nfe/rascunho?pedido=${encodeURIComponent(r.pedidoId || '')}`, { method: 'DELETE' });
          showToast('Nota em edição descartada.', 'success');
          await load();
        } catch (erro) {
          showToast(erro.message || 'Não consegui descartar.', 'error');
        }
      });
    });

    document.getElementById('nfeNewBtn')?.addEventListener('click', () => {
      state.activeSub = 'nova_nfe_avulsa';
      loadModule(moduloAtual());
    });

    document.getElementById('nfeFilterForm')?.addEventListener('submit', (event) => {
      event.preventDefault();
      const formData = new FormData(event.target);
      filters.search = formData.get('search') || '';
      filters.status = formData.get('status') || '';
      filters.dateFrom = formData.get('dateFrom') || '';
      filters.dateTo = formData.get('dateTo') || '';
      filters.estabelecimentoId = formData.get('estabelecimentoId') || '';
      filters.modelo = formData.get('modelo') || '';
      filters.valorDe = formData.get('valorDe') || '';
      filters.valorAte = formData.get('valorAte') || '';
      state[estado('Filtros')] = { ...filters };
      page = 1;
      load();
    });

    document.getElementById('nfeFilterClear')?.addEventListener('click', () => {
      Object.assign(filters, FILTROS_VAZIOS);
      state[estado('Filtros')] = { ...filters };
      page = 1;
      load();
    });

    // Mesmo padrão de Vendas: número fora da faixa avisa em vez de buscar.
    document.getElementById('nfeIrParaPagina')?.addEventListener('submit', (event) => {
      event.preventDefault();
      const alvo = Number(event.target.querySelector('input').value);
      if (!Number.isFinite(alvo) || alvo < 1 || alvo > totalPages) {
        showToast(`Informe uma página entre 1 e ${totalPages}.`, 'warning');
        return;
      }
      page = Math.floor(alvo);
      load();
    });

    content.querySelectorAll('[data-copiar-chave]').forEach((btn) => {
      btn.addEventListener('click', (event) => {
        // Copiar não abre a nota: a linha inteira é clicável.
        event.stopPropagation();
        copiarChave(btn.dataset.copiarChave);
      });
    });

    content.querySelectorAll('[data-ordenar]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const campo = btn.dataset.ordenar;
        if (!COLUNAS_ORDENAVEIS[campo]) return;
        // Mesma coluna inverte; coluna nova começa crescente (data, decrescente:
        // a mais recente primeiro, como a lista sempre abriu).
        if (campo === ordem.campo) ordem.direcao = ordem.direcao === 'asc' ? 'desc' : 'asc';
        else { ordem.campo = campo; ordem.direcao = campo === 'data' ? 'desc' : 'asc'; }
        state[estado('Ordem')] = { ...ordem };
        page = 1;
        load();
      });
    });

    document.getElementById('nfePorPagina')?.addEventListener('change', (event) => {
      const n = Number(event.target.value);
      if (!POR_PAGINA.includes(n)) return;
      limit = n;
      state[estado('PorPagina')] = n;
      page = 1;
      load();
    });

    content.querySelectorAll('.finance-entry-row').forEach((row) => {
      row.addEventListener('click', (event) => {
        // Clicar no checkbox seleciona; clicar no resto da linha abre a nota.
        if (event.target.closest('.nfe-check-col')) return;
        // Nota com erro abre o motivo, com "Corrigir nota" (fase EO).
        const daLinha = notasDaPagina.find((n) => n.id === row.dataset.id);
        if (daLinha && daLinha.status === 'erro' && daLinha.origem === 'fiscal') {
          abrirErroDaNota(row.dataset.id);
          return;
        }
        openNfeModal(row.dataset.id);
      });
    });

    // Só o painel e as linhas são redesenhados na seleção — não recarrega a
    // lista, senão o clique no checkbox ficaria lento e perderia o scroll.
    function aplicarSelecaoNaTela() {
      content.querySelectorAll('[data-select]').forEach((cb) => {
        cb.checked = selecionadas.has(cb.dataset.select);
        cb.closest('tr')?.classList.toggle('is-selected', cb.checked);
      });
      const todas = notasDaPagina.length > 0 && notasDaPagina.every((n) => selecionadas.has(n.id));
      const selectAll = document.getElementById('nfeSelectAll');
      if (selectAll) {
        selectAll.checked = todas;
        selectAll.indeterminate = !todas && selecionadas.size > 0;
      }
      renderActionsPanel();
    }

    content.querySelectorAll('[data-select]').forEach((cb) => {
      cb.addEventListener('click', (event) => event.stopPropagation());
      cb.addEventListener('change', () => {
        if (cb.checked) selecionadas.add(cb.dataset.select);
        else selecionadas.delete(cb.dataset.select);
        aplicarSelecaoNaTela();
      });
    });

    document.getElementById('nfeSelectAll')?.addEventListener('change', (event) => {
      if (event.target.checked) notasDaPagina.forEach((n) => selecionadas.add(n.id));
      else selecionadas.clear();
      aplicarSelecaoNaTela();
    });

    renderActionsPanel();

    document.getElementById('nfePrevPage')?.addEventListener('click', () => { if (page > 1) { page -= 1; load(); } });
    document.getElementById('nfeNextPage')?.addEventListener('click', () => {
      if (page < totalPages) { page += 1; load(); }
    });
  }

  async function cancelNfe(id, opcoes = {}) {
    // Cancelar uma nota que está na SEFAZ é um EVENTO fiscal: exige
    // justificativa de 15 caracteres e fica registrado lá para sempre.
    // Cancelar um registro manual é só apagar uma linha do Financeiro. São
    // operações diferentes, em rotas diferentes — descobrir isso pela origem
    // evita mandar uma para a outra.
    const nota = notasDaPagina.find((n) => n.id === id);
    // Fase DX: a importada foi emitida (e, se for o caso, cancelada) no
    // sistema anterior. Aqui ela é registro — não há o que cancelar.
    if (nota && nota.origem === 'importada') {
      showToast('NF-e importada do sistema anterior: só consulta.', 'error');
      return;
    }
    const ehFiscal = nota ? nota.origem === 'fiscal' : false;

    if (!ehFiscal) {
      const confirmed = await confirmModal('Confirma o cancelamento desta NF-e? Parcelas ainda pendentes serão canceladas; parcelas já pagas permanecem no histórico.');
      if (!confirmed) return;
      try {
        await api(`/api/finance/nfe/${id}/cancelar`, { method: 'POST' });
        showToast('NF-e cancelada com sucesso.', 'success');
        closeNfeModal();
        await load();
      } catch (error) {
        showToast(error.message || 'Erro ao cancelar NF-e.', 'error');
      }
      return;
    }

    // A SEFAZ exige de 15 a 255 caracteres na justificativa. O contador do
    // modal cobra isso ENQUANTO se digita — o prompt do navegador só reclamava
    // depois de fechar, levando o texto junto.
    const limpo = await promptModal({
      titulo: opcoes.extemporaneo ? 'Cancelamento extemporâneo de NF-e' : 'Cancelar NF-e na SEFAZ',
      aviso: opcoes.extemporaneo
        ? 'Fora do prazo normal (24h em SC). A SEFAZ pode recusar, e a recusa não é do sistema: depende de autorização específica dela.'
        : '',
      descricao: 'O cancelamento é um evento registrado na SEFAZ e fica no histórico da nota. A justificativa vai junto e não pode ser alterada depois.',
      rotulo: 'Justificativa do cancelamento',
      placeholder: 'Descreva o motivo do cancelamento.',
      minimo: 15,
      maximo: 255,
      confirmar: 'Cancelar NF-e',
      tom: 'danger'
    });
    if (limpo === null) return;
    try {
      await api(`/api/fiscal/nfe/${encodeURIComponent(id)}/cancelar`, {
        method: 'POST',
        // O servidor tem a mesma trava de 24h e recusa sem esta declaração —
        // é ela que diz "quem clicou sabia que o prazo comum acabou".
        body: JSON.stringify({ justificativa: limpo, extemporaneo: opcoes.extemporaneo === true })
      });
      showToast('NF-e cancelada na SEFAZ.', 'success');
      closeNfeModal();
      await load();
    } catch (error) {
      showToast(error.message || 'Erro ao cancelar NF-e.', 'error');
    }
  }

  function closeNfeModal() {
    document.getElementById('nfeModal')?.remove();
  }

  async function openNfeModal(id) {
    const naLista = notasDaPagina.find((n) => n.id === id);
    let nfe;
    try {
      if (naLista && naLista.origem === 'fiscal') {
        // A nota fiscal vive em outra rota e em outro formato. Os itens estão
        // dentro do payload que foi para a SEFAZ — é a única cópia fiel do que
        // foi transmitido, e é ela que deve ser mostrada, não uma remontagem.
        const res = await api(`/api/fiscal/nfe/${encodeURIComponent(id)}`);
        nfe = fiscalParaModal(res.nfe, naLista);
      } else if (naLista && naLista.origem === 'importada') {
        // Fase DX: emitida no sistema anterior, importada como registro.
        const res = await api(`/api/finance/nfe/importada/${encodeURIComponent(id)}`);
        nfe = { ...naLista, ...res.nfe, origem: 'importada' };
      } else {
        const res = await api(`/api/finance/nfe/${id}`);
        nfe = res.nfe;
      }
    } catch (error) {
      showToast(error.message || 'Erro ao carregar NF-e.', 'error');
      return;
    }
    renderNfeModal(nfe);
  }

  // Traduz a nota fiscal para o formato que o modal já desenha, lendo os itens
  // do payload enviado à SEFAZ.
  function fiscalParaModal(fiscal, daLista) {
    const payload = (fiscal && fiscal.payloadEnviado) || {};
    // A condição de pagamento da NF-e avulsa (fase EI): o modal dizia sempre
    // "À vista", e a nota em 3x tinha 3 parcelas no Financeiro. Com duplicatas
    // editadas, são elas que viram parcelas. Sem condição (nota de pedido, ou
    // operação que não gera financeiro) não há o que afirmar: a de pedido
    // segue a condição do pedido, a outra fica "-".
    const condicao = (fiscal && fiscal.condicaoPagamento) || null;
    const parcelado = Boolean(condicao && condicao.tipo === 'parcelado');
    const duplicatas = condicao && Array.isArray(condicao.duplicatas) ? condicao.duplicatas.length : 0;
    return {
      ...daLista,
      ...(fiscal || {}),
      id: daLista.id,
      origem: 'fiscal',
      number: fiscal?.numero || daLista.number || '',
      series: fiscal?.serie || daLista.series || '',
      date: daLista.date,
      emitidaEm: daLista.emitidaEm || '',
      status: daLista.status,
      key: fiscal?.chaveAcesso || '',
      amount: Number(fiscal?.valorTotal || daLista.amount || 0),
      // O nome REAL, não o que foi para a SEFAZ: em homologação o enviado é o
      // texto fixo exigido por ela.
      customer: daLista.customer || '',
      clientDocument: daLista.clientDocument || '',
      clientAddress: payload.logradouro_destinatario || '',
      clientCity: payload.municipio_destinatario || '',
      clientState: payload.uf_destinatario || '',
      clientStateRegistration: payload.inscricao_estadual_destinatario || '',
      taxNotes: payload.informacoes_adicionais_contribuinte || '',
      paymentType: parcelado ? 'parcelado' : 'avista',
      installmentsCount: parcelado ? (duplicatas || Number(condicao.parcelas) || 1) : 1,
      installmentIntervalDays: Number(condicao && condicao.intervaloDias) || 30,
      paymentLabel: condicao ? '' : (daLista.orderId ? 'Conforme o pedido' : '-'),
      // As parcelas vêm da lista, que já as anexa às notas fiscais da página.
      financialEntries: daLista.financialEntries || [],
      items: (payload.items || []).map((item) => ({
        code: item.codigo_produto || '',
        description: item.descricao || '',
        quantity: Number(item.quantidade_comercial || 0),
        unitPrice: Number(item.valor_unitario_comercial || 0),
        total: Number(item.valor_bruto || 0)
      }))
    };
  }

  function renderNfeModal(nfe) {
    closeNfeModal();
    // Mesma regra do botão da linha (fase EI); fora do prazo o motivo aparece
    // também por extenso, porque a dica de botão desligado passa despercebida.
    // A nota manual vem da rota sem `origem`: a da lista completa o que falta.
    const naLista = notasDaPagina.find((n) => n.id === nfe.id);
    const bloqueioCancelar = nfe.status === 'autorizada' && nfe.origem !== 'importada'
      ? motivoParaNaoCancelar({ ...(naLista || {}), ...nfe })
      : '';
    // Cupom é NFC-e no título e no botão (14/10/2026): "NF-e 5748" num cupom
    // confundia quem conferia.
    const nomeDoDocumento = Number(nfe.modelo || (naLista && naLista.modelo)) === 65 ? 'NFC-e' : 'NF-e';
    const overlay = document.createElement('div');
    overlay.id = 'nfeModal';
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal modal-lg modal-nota">
        <div class="finance-modal-head">
          <div>
            <h3>${nomeDoDocumento} ${escapeHtml(nfe.number)} / Série ${escapeHtml(nfe.series)}</h3>
            <p class="muted">${escapeHtml(nfe.customer)} ${nfeStatusBadge(nfe.status)}</p>
          </div>
          <button type="button" class="icon-button" id="nfeModalClose" title="Fechar">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"></path><path d="m6 6 12 12"></path></svg>
          </button>
        </div>

        <div class="finance-modal-info-grid">
          <div><span class="muted">Data de emissão</span><strong>${nfeDiaEHora(nfe.emitidaEm, nfe.date)}</strong></div>
          <div><span class="muted">CPF/CNPJ</span><strong>${escapeHtml(nfeFormatDocument(nfe.clientDocument))}</strong></div>
          <div><span class="muted">Endereço</span><strong>${escapeHtml(nfe.clientAddress || '-')}</strong></div>
          <div><span class="muted">Cidade/UF</span><strong>${escapeHtml(nfe.clientCity || '-')} ${nfe.clientState ? '/ ' + escapeHtml(nfe.clientState) : ''}</strong></div>
          <div><span class="muted">Inscrição estadual</span><strong>${escapeHtml(nfe.clientStateRegistration || '-')}</strong></div>
          <div class="nfe-modal-chave"><span class="muted">Chave de acesso</span><strong>${escapeHtml(nfe.key || '-')}</strong></div>
          <div><span class="muted">Valor total</span><strong>${financeFormatBRL(nfe.amount)}</strong></div>
          <div><span class="muted">Forma de pagamento</span><strong>${escapeHtml(nfe.paymentLabel || (nfe.paymentType === 'parcelado' ? `Parcelado (${nfe.installmentsCount}x)` : 'À vista'))}</strong></div>
        </div>

        <h4>Itens</h4>
        <div class="table-scroll">
          <table class="table">
            <thead><tr><th>Código</th><th>Descrição</th><th>Qtd.</th><th>Valor unit.</th><th>Total</th></tr></thead>
            <tbody>
              ${nfe.items.map((item) => `<tr><td>${escapeHtml(item.code || '-')}</td><td>${escapeHtml(item.description)}</td><td>${item.quantity}</td><td>${financeFormatBRL(item.unitPrice)}</td><td>${financeFormatBRL(item.total)}</td></tr>`).join('')}
            </tbody>
          </table>
        </div>
        ${nfe.taxNotes ? `<p class="muted">Observações fiscais: ${escapeHtml(nfe.taxNotes)}</p>` : ''}

        <h4>Lançamentos financeiros vinculados</h4>
        ${nfe.financialEntries.length ? `
          <div class="finance-due-list">
            ${nfe.financialEntries.map((entry) => `
              <div class="finance-due-item finance-clickable-row" data-view-entry="${escapeHtml(entry.id)}">
                <div>
                  <strong>${escapeHtml(entry.description)}</strong>
                  <div class="muted">Vencimento: ${financeFormatDate(entry.dueDate)}</div>
                </div>
                <div class="finance-due-item-amount">${financeFormatBRL(entry.amount)} ${financeStatusBadge(entry.status)}</div>
              </div>
            `).join('')}
          </div>
        ` : '<p class="muted">Nenhum lançamento vinculado.</p>'}

        ${bloqueioCancelar ? `<p class="muted">${escapeHtml(bloqueioCancelar)}</p>` : ''}
        <div class="finance-modal-actions">
          <button type="button" class="secondary" id="nfeModalPrint">Imprimir</button>
          ${nfe.status === 'autorizada' && nfe.origem !== 'importada' ? `<button type="button" class="btn-danger" id="nfeModalCancel"${bloqueioCancelar ? ` disabled title="${escapeHtml(bloqueioCancelar)}"` : ''}>Cancelar ${nomeDoDocumento}</button>` : ''}
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    overlay.addEventListener('click', (event) => { if (event.target === overlay) closeNfeModal(); });
    document.getElementById('nfeModalClose')?.addEventListener('click', closeNfeModal);
    document.getElementById('nfeModalPrint')?.addEventListener('click', () => nfePrint(nfe));
    document.getElementById('nfeModalCancel')?.addEventListener('click', () => cancelNfe(nfe.id));

    overlay.querySelectorAll('[data-view-entry]').forEach((row) => {
      row.addEventListener('click', () => {
        closeNfeModal();
        state.financeOpenEntryId = row.dataset.viewEntry;
        state.activeSub = 'lancamentos';
        loadModule('finance');
      });
    });
  }

  await load();
  // Veio da emissão (14/10/2026): mostra o resultado da nota que acabou de sair.
  if (state.nfeAposEmissao && state.nfeAposEmissao.id) {
    const resultado = state.nfeAposEmissao;
    delete state.nfeAposEmissao;
    mostrarResultadoDaEmissao(resultado);
  }
  };
}

Object.keys(NOTAS_EMITIDAS_TELAS).forEach((telaChave) => {
  window.MavisSubscreenRegistry.finance[telaChave] = criarTelaDeNotasEmitidas(telaChave);
});
