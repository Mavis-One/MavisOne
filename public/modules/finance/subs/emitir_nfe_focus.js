window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.finance = window.MavisSubscreenRegistry.finance || {};

// Formas de pagamento do layout 4.0 da NF-e. Os códigos são os oficiais — o
// mesmo conjunto que lib/nfePayloadBuilder.js aceita; qualquer outro vira '99'
// lá, então oferecer só estes evita a nota sair com "Outros" sem ninguém saber.
const NFE_FORMAS_PAGAMENTO = [
  { value: '01', label: '01 — Dinheiro' },
  { value: '02', label: '02 — Cheque' },
  { value: '03', label: '03 — Cartão de crédito' },
  { value: '04', label: '04 — Cartão de débito' },
  { value: '05', label: '05 — Crédito loja' },
  { value: '15', label: '15 — Boleto bancário' },
  { value: '16', label: '16 — Depósito bancário' },
  { value: '17', label: '17 — PIX' },
  { value: '18', label: '18 — Transferência bancária' },
  { value: '90', label: '90 — Sem pagamento' },
  { value: '99', label: '99 — Outros' }
];

const NFE_FOCUS_TIPO_OPERACAO_OPTIONS = [
  // `natureza` é o natOp sugerido — o mesmo de lib/operacaoFiscal.js, que veio
  // das regras do sistema anterior. Sem ele, vale o rótulo.
  { value: 'VENDA', label: 'Venda', natureza: 'VENDA DE MERCADORIA ADQUIRIDA OU RECEBIDA DE TERCEIROS' },
  { value: 'TRANSFERENCIA', label: 'Transferência', natureza: 'TRANSFERENCIA DE MERCADORIA' },
  { value: 'REMESSA', label: 'Remessa' },
  { value: 'RETORNO', label: 'Retorno' },
  { value: 'DEVOLUCAO', label: 'Devolução' },
  { value: 'BONIFICACAO', label: 'Bonificação' },
  // Complemento de ICMS não é venda: não entrega mercadoria, não baixa estoque
  // e não gera recebível. A tela muda de forma ao escolhê-lo.
  { value: 'COMPLEMENTO_ICMS', label: 'Complemento de ICMS' }
];

// Espelho, no navegador, do catálogo de lib/operacaoFiscal.js. Só o que a TELA
// precisa saber para se comportar; quem valida de verdade é o servidor — o
// front some numa aba fechada, o servidor não.
const NFE_FOCUS_COMPLEMENTO = 'COMPLEMENTO_ICMS';

const NFE_FOCUS_STATUS_BADGE = {
  RASCUNHO: 'finance-badge-muted',
  PROCESSANDO: 'finance-badge-info',
  AUTORIZADO: 'finance-badge-success',
  ERRO: 'finance-badge-danger',
  CANCELADO: 'finance-badge-muted',
  DENEGADO: 'finance-badge-danger',
  INUTILIZADO: 'finance-badge-muted'
};

window.MavisSubscreenRegistry.finance.emitir_nfe_focus = async function renderEmitirNfeFocus(ctx) {
  const { content, api, showToast, escapeHtml, state } = ctx;

  let estabelecimentos = [];
  let selectedEstabelecimentoId = '';
  // Emitente travado pela empresa do pedido (14/10/2026); vazio = livre.
  let emitenteDoPedido = '';
  let meta = { directory: [] };
  let selectedClienteId = '';
  let itens = [{ produtoId: '', descricao: '', codigoProduto: '', ncm: '', quantidade: 1, valorUnitario: 0, unidadeComercial: 'UN', origem: 0 }];
  let notasRecentes = [];
  let ultimoResultado = null;

  // Operação escolhida. É ela que decide a FORMA da tela: no complemento de
  // ICMS não há mercadoria a listar nem pagamento a informar — há uma nota
  // original a referenciar e um imposto a destacar.
  let tipoOperacao = 'VENDA';
  const ehComplemento = () => tipoOperacao === NFE_FOCUS_COMPLEMENTO;
  const complemento = { chave: '', numero: '', serie: '', baseIcms: 0, aliquota: 0, valorIcms: 0, informacoes: '' };
  // Editado à mão? Então parar de sobrescrever com o texto sugerido.
  let informacoesEditadas = false;

  // Observações adicionais da nota comum (infCpl). Nasce com o texto padrão da
  // empresa — ficha técnica, garantia e cuidados —, que mora em
  // modules/shared/nfe_texto_padrao.js para ser editável sem mexer nesta tela.
  //
  // Guardado aqui fora do HTML porque renderForm() redesenha o formulário
  // inteiro a cada troca de aba: sem isto, escrever o chassi e ir conferir os
  // itens apagaria o que foi escrito.
  const TextoPadrao = window.MavisNfeTextoPadrao;
  // Fase AO: cada CNPJ pode ter a própria mensagem padrão, definida em
  // Configurações > Empresa. Ficha técnica e garantia são compromisso comercial
  // de quem ASSINA a nota — com mais de uma empresa no sistema, um texto único
  // faria a nota de uma prometer a garantia da outra.
  let empresasPorId = new Map();
  let travadoEmHomologacao = false;

  // O ambiente que a nota VAI usar, e não o que está salvo no estabelecimento:
  // a trava do servidor rebaixa produção em silêncio.
  function ambienteEfetivoDaTela() {
    if (travadoEmHomologacao) return 'homologacao';
    const estab = estabelecimentos.find((e) => e.id === selectedEstabelecimentoId);
    return String((estab && estab.focusAmbiente) || 'homologacao').toLowerCase();
  }

  // Quantos caracteres sobram DE VERDADE para as observações.
  //
  // Em homologação a SEFAZ exige um aviso de teste no MESMO campo, com o nome
  // do destinatário dentro — o servidor o acrescenta na montagem. Contar só o
  // que o usuário digitou aprovava 5000 caracteres e mandava 5081 para a
  // SEFAZ. O nome vem do CAMPO, e não do objeto: quem está digitando o
  // destinatário agora muda o orçamento agora.
  function orcamentoDasObservacoes() {
    if (!TextoPadrao || !TextoPadrao.orcamentoDoRodape) return 5000;
    const campoNome = document.querySelector('[name="destNome"]');
    return TextoPadrao.orcamentoDoRodape({
      ambiente: ambienteEfetivoDaTela(),
      destinatarioNome: (campoNome && campoNome.value) || destinatario.nome,
      linhaDoPedido: linhaDoPedidoNoRodape()
    });
  }

  // O número do pedido entra na frente do rodapé, no servidor (15/10/2026).
  function linhaDoPedidoNoRodape() {
    if (!TextoPadrao || !TextoPadrao.linhaDoPedido) return '';
    const campoTexto = document.querySelector('[name="complementoInformacoes"]');
    const codigoDoPedido = doPedido && doPedido.code ? String(doPedido.code) : '';
    return TextoPadrao.linhaDoPedido(codigoDoPedido, campoTexto ? campoTexto.value : observacoes);
  }

  // Por que cabe menos que o limite: um contador que para em 4919 sem
  // explicação parece defeito.
  function motivoDoOrcamentoMenor() {
    const homologacao = String(ambienteEfetivoDaTela() || '').toLowerCase() === 'homologacao';
    if (linhaDoPedidoNoRodape()) {
      return homologacao ? 'o número do pedido e, em homologação, o aviso de teste ocupam o resto' : 'o número do pedido ocupa o resto';
    }
    return 'em homologação o aviso de teste ocupa o resto';
  }

  function textoPadraoDoEmitente() {
    const estab = estabelecimentos.find((e) => e.id === selectedEstabelecimentoId);
    const daEmpresa = estab ? (empresasPorId.get(estab.empresaId) || '').trim() : '';
    // Vazio na empresa = usa o padrão do sistema. É o comportamento de antes da
    // fase AO, e é o que vale para quem nunca preencher o campo.
    return daEmpresa || (TextoPadrao ? TextoPadrao.PADRAO : '');
  }
  // A observação que veio do pedido, guardada à parte: ela tem de sobreviver à
  // troca de emitente, que só substitui a BASE do texto.
  let notaDoPedido = '';
  function padraoAtual() {
    if (!TextoPadrao) return '';
    return TextoPadrao.montar({ observacaoDoPedido: notaDoPedido, base: textoPadraoDoEmitente() });
  }
  let observacoes = TextoPadrao ? TextoPadrao.PADRAO : '';


  const destinatario = { nome: '', documento: '', contribuinte: false, inscricaoEstadual: '', cep: '', logradouro: '', numero: '', complemento: '', bairro: '', municipio: '', uf: '', codigoMunicipio: '' };

  // "Gerar NF-e" a partir de um pedido cai aqui. Antes caía na tela de
  // registro manual, que nunca chegava à SEFAZ — o pedido aparecia faturado e
  // a nota não existia para o fisco.
  //
  // O pedido é consumido (delete) para não reaparecer na próxima abertura da
  // tela: seria a nota errada, com os itens de um pedido antigo.
  const doPedido = state.nfeFromOrder || null;
  if (doPedido) delete state.nfeFromOrder;
  // Fase EF: a categoria de venda do pedido diz a operação (Transferência,
  // Remessa, Bonificação...). A pessoa ainda pode trocar na tela.
  if (doPedido && doPedido.tipoOperacao && NFE_FOCUS_TIPO_OPERACAO_OPTIONS.some((o) => o.value === doPedido.tipoOperacao)) {
    tipoOperacao = doPedido.tipoOperacao;
  }
  let orderIdOrigem = doPedido ? doPedido.orderId || '' : '';
  // A TRAVA DE PAGAMENTO (fase ES, 19/10/2026): ao abrir pelo pedido, a tela já
  // diz se a NF-e pode sair. Quem recusa de verdade é o servidor, na emissão.
  let liberacaoDoPedido = null;
  const htmlDaTrava = () => {
    const l = liberacaoDoPedido && liberacaoDoPedido.liberacao;
    if (!l || !l.aplica || l.liberado) return '';
    return `<p class="form-error nfe-trava-pagamento">${escapeHtml(liberacaoDoPedido.mensagem || '')}</p>`;
  };
  if (orderIdOrigem) {
    api(`/api/sales/records/${encodeURIComponent(orderIdOrigem)}/liberacao-nfe`).then((resposta) => {
      liberacaoDoPedido = resposta;
      const alvo = document.getElementById('nfeTravaPagamento');
      if (alvo) alvo.innerHTML = htmlDaTrava();
    }).catch(() => {});
  }
  // "EMITIR MESMO ASSIM" (fase ES): só para quem pode (administrador ou a chave
  // na ficha do usuário), com o motivo — venda a prazo é o caso. O motivo vai à
  // auditoria. Devolve a nota emitida, ou null.
  async function emitirMesmoAssim(corpo, erro) {
    const dados = erro.dados || {};
    if (!dados.podeEmitirSemPagamento) {
      if (window.MavisErroNfe) window.MavisErroNfe.mostrar({ titulo: 'Pagamento não confirmado', motivos: [erro.message], podeCorrigir: false });
      else showToast(erro.message, 'error');
      return null;
    }
    const motivo = await promptModal({
      titulo: 'Pagamento não confirmado',
      aviso: erro.message,
      rotulo: 'Motivo para emitir mesmo assim',
      placeholder: 'Ex.: venda a prazo no boleto',
      minimo: 5,
      maximo: 300,
      confirmar: 'Emitir mesmo assim',
      tom: 'danger'
    });
    if (!motivo) return null;
    try {
      const result = await api('/api/fiscal/nfe/emitir', {
        method: 'POST', body: JSON.stringify({ ...corpo, emitirSemPagamento: true, motivoSemPagamento: motivo })
      });
      return result.nfe || null;
    } catch (erroForcado) {
      if (window.MavisErroNfe) window.MavisErroNfe.mostrar({ titulo: 'A NF-e não foi emitida', motivos: [erroForcado.message || 'Erro ao emitir NF-e.'], podeCorrigir: false });
      else showToast(erroForcado.message || 'Erro ao emitir NF-e.', 'error');
      return null;
    }
  }
  // FASE BQ: desconto, frete cobrado e despesas do PEDIDO. Zero na nota
  // avulsa, que não tem pedido por trás. O servidor já sabia recebê-los (o
  // montador do payload tem os três campos); era esta tela que não os mandava,
  // e a nota saía pelo valor BRUTO dos itens.
  // `let` desde 13/10/2026: a aba Totais deixa editar os quatro.
  let desconto = doPedido ? Number(doPedido.desconto || 0) : 0;
  // AS LINHAS DE PAGAMENTO DO PEDIDO, já traduzidas para tPag lá na tela de
  // Vendas (fase BU). Vazio na nota avulsa, que não tem pedido por trás — lá
  // continua valendo o select de forma única.
  const pagamentosDoPedido = Array.isArray(doPedido && doPedido.pagamentosDaNota)
    ? doPedido.pagamentosDaNota.filter((linha) => Number(linha.valor || 0) > 0)
    : [];
  let frete = doPedido ? Number(doPedido.frete || 0) : 0;
  // FASE CY: modFrete responde QUEM CONTRATOU o transporte, e essa resposta está
  // no "Meio de Envio" da aba Entrega do pedido — não no valor do frete. Aqui
  // ia `modalidadeFrete: 0` fixo sempre que havia frete, e o servidor não
  // mandava nada: entrega própria declarava frete contratado, e entrega com o
  // frete absorvido pela loja declarava que não houve transporte.
  //
  // `undefined` quando o meio não responde ("Outro") ou quando é nota avulsa —
  // e aí o palpite do builder (`frete > 0 ? 0 : 9`) volta a valer.
  const modalidadeDoFrete = window.MavisModalidadeFrete.paraNota(doPedido && doPedido.meioDeEnvio);
  let outrasDespesas = doPedido ? Number(doPedido.outrasDespesas || 0) : 0;
  // Seguro: o pedido não tem o campo; só a aba Totais o preenche.
  let seguro = 0;
  // A ABA TRANSPORTE (13/10/2026). Fora do HTML, como o resto: renderForm
  // redesenha a tela inteira. `modalidadeEscolhida` undefined = o pedido não
  // respondeu e ninguém escolheu; aí vale o palpite do montador.
  let modalidadeEscolhida = modalidadeDoFrete;
  let transportadoraId = '';
  const transporte = {
    transportador: { documento: '', nome: '', inscricaoEstadual: '', endereco: '', municipio: '', uf: '' },
    veiculo: { placa: '', uf: '', rntc: '' },
    volumes: []
  };
  // A COBRANÇA (fatura e duplicatas, 13/10/2026). Enquanto ninguém mexe, as
  // duplicatas seguem as parcelas (do pedido ou do parcelamento da avulsa);
  // editou uma vez, ficam como estão até "Refazer pelas parcelas".
  let cobrancaEditada = false;
  const cobranca = {
    numeroFatura: doPedido && doPedido.code ? String(doPedido.code) : '',
    valorDesconto: 0,
    duplicatas: []
  };
  // A PRÉVIA DA ABA IMPOSTOS (13/10/2026): o que o servidor montaria, com as
  // regras fiscais e o que foi editado. Ver carregarPrevia.
  let previa = null;
  let previaErro = '';
  // O que falta para a prévia sair (emitente, item, destinatário): aviso
  // discreto, não erro. Ver carregarPrevia.
  let previaAguardando = '';
  let previaCarregando = false;
  // As listas de CST/CSOSN das Regras Fiscais (/api/fiscal/tabelas), para a aba
  // Impostos escolher o código em vez de digitar. Sem permissão de ler as
  // tabelas, o campo volta a ser texto.
  let tabelasFiscais = null;
  // A aba Impostos mostra UM item por vez, em abas (14/10/2026, pedido do
  // usuário: "os impostos em abas para cada item, assim como as informações da
  // NF-e"). Este é o item aberto.
  let abaImpostoDoItem = 0;
  // E dentro do item, um grupo por vez (ICMS, IPI...), também em abas.
  let abaGrupoImposto = 'Classificação';

  // AS TRÊS CARGAS SAEM JUNTAS (fase DS). Eram três idas e voltas em fila —
  // estabelecimentos, depois empresas, depois o meta — e nenhuma depende da
  // outra. No VPS, cada uma é a latência da rede inteira.
  //
  // O META VEM NO RECORTE DA EMISSÃO (`diretorio=nfe&produtos=nfe`): do
  // destinatário, documento, UF, município e IE; dos produtos, o que monta a
  // linha do item. NUNCA `diretorio=resumido` aqui — sem documento e IE o
  // destinatário sairia em branco. 2.818 KB -> 1.947 KB (569 -> 414 KB no fio).
  const [resEstab, resEmpresas, resMeta, resOperacoes] = await Promise.allSettled([
    api('/api/fiscal/estabelecimentos'),
    api('/api/fiscal/empresas'),
    api('/api/finance/meta?diretorio=nfe&produtos=nfe'),
    api('/api/fiscal/operacoes')
  ]);
  // Fase DW: nome e natureza das operações são editáveis em Fiscal › Operações
  // Fiscais. A lista acima é só o ponto de partida; o que o servidor devolve
  // vale. Falhar aqui não impede a emissão — fica a lista escrita.
  if (resOperacoes.status === 'fulfilled') {
    const doServidor = new Map((resOperacoes.value.operacoes || []).map((o) => [o.chave, o]));
    NFE_FOCUS_TIPO_OPERACAO_OPTIONS.forEach((opcao) => {
      const op = doServidor.get(opcao.value);
      if (!op) return;
      opcao.label = op.rotulo || opcao.label;
      opcao.natureza = op.natureza || undefined;
    });
  }
  if (resEstab.status === 'fulfilled') {
    const res = resEstab.value;
    estabelecimentos = (res.estabelecimentos || []).filter((e) => e.ativo && e.emiteNfe);
    // A trava rebaixa produção para homologação no servidor. Sem saber dela, o
    // contador de observações daria o orçamento cheio numa nota que vai levar o
    // aviso de teste no rodapé — ver orcamentoDasObservacoes.
    travadoEmHomologacao = Boolean(res.travadoEmHomologacao);
    // Só a mensagem padrão de cada empresa. Falhar aqui não pode impedir a
    // emissão: sem a lista, o texto do sistema continua valendo. (Lida só
    // quando os estabelecimentos vieram, como quando ela era pedida depois.)
    empresasPorId = resEmpresas.status === 'fulfilled'
      ? new Map((resEmpresas.value.empresas || []).map((emp) => [emp.id, emp.observacaoPadraoNfe || '']))
      : new Map();
  } else {
    const error = resEstab.reason;
    showToast('Não foi possível carregar os estabelecimentos: ' + (error.message || error), 'error');
  }

  if (resMeta.status === 'fulfilled') {
    meta = resMeta.value;
  }
  // senão, segue com diretório vazio — busca de cliente cadastrado fica indisponível

  // Preenche a tela com o pedido. Feito DEPOIS do meta: é dele que sai o
  // endereço do cliente, e sem ele o destinatário sairia só com o nome.
  if (doPedido) {
    selectedClienteId = doPedido.clientSupplierId || '';
    const cliente = meta.directory.find((c) => c.id === selectedClienteId);
    destinatario.nome = cliente?.name || doPedido.clientName || '';
    destinatario.documento = cliente?.document || '';
    // A IE do cadastro entra só quando é de contribuinte: "ISENTO" fica fora
    // do campo, e o checkbox nasce desmarcado.
    destinatario.inscricaoEstadual = window.MavisInscricaoEstadual.paraNota(cliente?.stateRegistration) || '';
    destinatario.uf = cliente?.state || '';
    destinatario.municipio = cliente?.city || '';
    // Contribuinte se tem inscrição estadual — e ISENTO não é inscrição. É o
    // que decide indicador_ie e, com ele, se a operação tem DIFAL. Regra única
    // em shared/inscricao_estadual.js, a mesma do servidor.
    destinatario.contribuinte = window.MavisInscricaoEstadual.ehContribuinte(cliente?.stateRegistration);
    // O ENDEREÇO DO CADASTRO (14/10/2026): a nota do pedido abria sem CEP, rua,
    // número e bairro — os campos nem recebiam valor. Vem do diretório da
    // emissão (enderecoDaPessoa no servidor).
    const end = (cliente && cliente.endereco) || {};
    destinatario.cep = end.cep || '';
    destinatario.logradouro = end.logradouro || '';
    destinatario.numero = end.numero || '';
    destinatario.complemento = end.complemento || '';
    destinatario.bairro = end.bairro || '';
    if (end.municipio) destinatario.municipio = end.municipio;
    if (end.uf) destinatario.uf = end.uf;
    destinatario.codigoMunicipio = end.codigoMunicipio || '';
    if (Array.isArray(doPedido.items) && doPedido.items.length) {
      itens = doPedido.items.map((item) => ({
        produtoId: item.produtoId || item.productId || '',
        descricao: item.description || '',
        codigoProduto: item.code || '',
        // NCM e origem vêm do CADASTRO do produto, no servidor. Deixar em
        // branco aqui é intencional: preencher com palpite faria a nota sair
        // com classificação diferente da do produto.
        ncm: '',
        quantidade: Number(item.quantity || 0),
        valorUnitario: Number(item.unitPrice || 0),
        unidadeComercial: item.unit || 'UN',
        origem: 0
      }));
    }
    // `taxNotes` é o texto que o vendedor escreveu no pedido e confirmou copiar
    // para a nota. Ele era perguntado e depois DESCARTADO — esta tela não lia o
    // campo. Perguntar e ignorar é pior do que não perguntar.
    // O texto em si é montado logo abaixo, por padraoAtual(), já com a base
    // do emitente: montar sem ela empilhava o termo da empresa sobre a
    // observação do pedido, que já nasce com ele (13/10/2026).
    if (TextoPadrao) notaDoPedido = doPedido.taxNotes || '';
    // O EMITENTE É A EMPRESA DO PEDIDO, pelo CNPJ (13/10/2026). Sem isto a
    // tela abria sem emitente, e o termo do CNPJ não entrava na nota. Sem
    // estabelecimento com o mesmo CNPJ, continua a escolha manual de sempre.
    const cnpjDoPedido = String(doPedido.empresaCnpj || '').replace(/\D/g, '');
    const doMesmoCnpj = cnpjDoPedido && estabelecimentos.find((e) => String(e.cnpj || '').replace(/\D/g, '') === cnpjDoPedido);
    if (doMesmoCnpj) selectedEstabelecimentoId = doMesmoCnpj.id;
    // 14/10/2026, pedido do usuário: a nota do pedido sai da empresa do pedido
    // — o emitente fica travado nela (o servidor recusa outro). Empresa sem
    // estabelecimento emissor: avisa já, em vez de só na hora de emitir.
    emitenteDoPedido = doMesmoCnpj ? doMesmoCnpj.id : '';
    if (cnpjDoPedido && !doMesmoCnpj) {
      showToast(`A empresa do pedido (CNPJ ${cnpjDoPedido}) não está cadastrada como estabelecimento emissor de NF-e (Configurações › Empresa).`, 'error', 9000);
    }
    // A transportadora do pedido abre a aba Transporte preenchida.
    if (doPedido.carrierId) escolherTransportadora(doPedido.carrierId);
  }

  // O que o botão "Restaurar texto padrão" devolve. Vindo de um pedido, é o
  // texto COM as fichas preenchidas — restaurar o modelo em branco obrigaria a
  // redigitar chassi e cor que o pedido já tinha.
  // Depois de saber qual estabelecimento está selecionado: sem isto, a tela
  // nasceria com o texto do sistema mesmo quando o CNPJ tem o seu.
  observacoes = padraoAtual();
  const observacoesIniciais = observacoes;

  // Um lugar só para ler o destinatário: a nota comum e a complementar usam os
  // mesmos campos, e duas leituras divergiriam na primeira mudança de rótulo.
  function lerDestinatario(formData) {
    return {
      nome: formData.get('destNome'),
      documento: formData.get('destDocumento'),
      contribuinte: formData.get('destContribuinte') === 'on',
      inscricaoEstadual: formData.get('destIe'),
      cep: (formData.get('destCep') || '').replace(/\D/g, ''),
      logradouro: formData.get('destLogradouro'),
      numero: formData.get('destNumero'),
      complemento: formData.get('destComplemento'),
      bairro: formData.get('destBairro'),
      municipio: formData.get('destMunicipio'),
      uf: formData.get('destUf'),
      codigoMunicipio: formData.get('destCodigoMunicipio')
    };
  }

  function itemTotal(item) {
    return Math.round(Number(item.quantidade || 0) * Number(item.valorUnitario || 0) * 100) / 100;
  }

  // O TOTAL DO ITEM DIGITADO (19/10/2026, pedido do usuário: "o campo de valor
  // total possa ser alterado"). O unitário sai dele, com até 10 casas — o
  // máximo do vUnCom —, para quantidade × unitário dar o total ao centavo
  // (a SEFAZ confere vProd contra essa conta). A tela mostra o unitário com
  // duas casas; a nota leva todas.
  function unitarioDoTotal(total, quantidade) {
    const q = Number(quantidade || 0);
    if (!(q > 0)) return null;
    return Math.round((Number(total || 0) / q) * 1e10) / 1e10;
  }

  // O total dos ITENS, sem o que vem do pedido.
  function totalDosItens() {
    return itens.reduce((sum, item) => sum + itemTotal(item), 0);
  }

  // O VALOR DA NOTA. Some frete e despesas, subtrai desconto — a mesma conta
  // que o montador do payload faz do outro lado. Antes daqui a tela anunciava
  // "Valor total" somando só as linhas de item, e a nota saía por esse número.
  // A soma das linhas de pagamento que vieram do pedido.
  function somaDosPagamentos() {
    return Math.round(pagamentosDoPedido.reduce((soma, l) => soma + Number(l.valor || 0), 0) * 100) / 100;
  }

  function grandTotal() {
    return Math.round((totalDosItens() + frete + seguro + outrasDespesas - desconto) * 100) / 100;
  }

  async function loadNotasRecentes() {
    if (!selectedEstabelecimentoId) { notasRecentes = []; return; }
    try {
      // `limite=10` (fase DS): o servidor devolve só as dez, sem os jsonb. Antes
      // vinham TODAS as notas do emitente com payload e resposta da Focus —
      // milhares de notas, megabytes — a cada troca de emitente e a cada
      // emissão, para a tela cortar em dez.
      const res = await api(`/api/fiscal/nfe?estabelecimentoId=${encodeURIComponent(selectedEstabelecimentoId)}&limite=10`);
      notasRecentes = (res.records || []).slice(0, 10);
    } catch (error) {
      notasRecentes = [];
    }
  }

  // OS DOIS <select> GIGANTES VIRARAM O CAMPO DE BUSCA DO SISTEMA (fase DS).
  //
  // O destinatário desenhava as 6.493 pessoas como <option>, refeitas A CADA
  // TECLA da busca; e cada linha de item desenhava os 5.561 produtos — com 5
  // linhas, 28 mil nós no DOM. Medido no Chrome com os dados reais: adicionar
  // o 5º item travava 1,2 s, escolher um produto 1,3 s, cada tecla na busca de
  // cliente 100 ms. É o defeito que a fase CH tirou de nove telas
  // (shared/campo_de_busca.js); esta ficou de fora.
  //
  // As opções são montadas UMA vez, com o mesmo texto do <option> de antes —
  // buscar pelo documento continua achando o cliente, e o produto sem NCM
  // continua avisando no rótulo.
  //
  // O "Nenhum (preencher manualmente abaixo)" do <select> não vira opção:
  // escolhê-lo não mexia em campo nenhum (o ouvinte saía sem achar cadastro), e
  // é o que o campo vazio já diz.
  // `let` e montadas por função: o cadastro feito em outra aba refaz as listas
  // com a tela aberta (ver o aoMudar no fim da tela).
  let opcoesDoCliente = [];
  let opcoesDeProduto = [];
  let opcoesDeProdutoComAvulso = [];
  function montarOpcoes() {
    opcoesDoCliente = (meta.directory || [])
      .map((c) => ({ value: c.id, label: `${c.name}${c.document ? ` (${c.document})` : ''}` }));
    opcoesDeProduto = (meta.produtos || []).map((p) => ({
      value: p.id,
      label: `${p.name}${p.sku ? ` (${p.sku})` : ''}${p.ncm ? '' : ' — SEM NCM'}`
    }));
    opcoesDeProdutoComAvulso = [ITEM_AVULSO].concat(opcoesDeProduto);
  }

  // Um produto cadastrado traz a própria classificação fiscal. Escolher pela
  // lista preenche a linha e trava NCM e origem: são atributos da mercadoria,
  // e digitá-los por emissão faria o mesmo produto sair com classificações
  // diferentes em notas diferentes. "Item avulso" continua liberando os campos
  // — serviço e mercadoria sem cadastro ainda precisam ser digitados.
  //
  // "Item avulso" fica FORA da lista que desenha o campo (que então abre vazio,
  // com o placeholder dizendo o que é) e DENTRO da lista que se busca: quem
  // digita "avulso" acha a opção e volta a linha para item avulso.
  const ITEM_AVULSO = { value: '', label: 'Item avulso' };
  montarOpcoes();

  function renderItemsRows() {
    return itens.map((item, index) => `
      <tr data-row="${index}">
        <td style="min-width:220px;">
          ${renderSearchableSelect({
    id: `nfeFocusProduto${index}`,
    name: `nfeFocusProduto${index}`,
    options: opcoesDeProduto,
    selectedValue: item.produtoId,
    placeholder: 'Item avulso — buscar produto'
  })}
        </td>
        <td><input data-field="descricao" data-index="${index}" value="${escapeHtml(item.descricao)}" required placeholder="Descrição" style="min-width:160px;" /></td>
        <td><input data-field="codigoProduto" data-index="${index}" value="${escapeHtml(item.codigoProduto)}" placeholder="Código" style="width:90px;" ${item.produtoId ? 'readonly tabindex="-1" title="Código do cadastro do produto — não pode ser alterado."' : ''} /></td>
        <td><input data-field="ncm" data-index="${index}" value="${escapeHtml(item.ncm)}" required maxlength="8" inputmode="numeric" placeholder="8 dígitos" style="width:90px;" ${item.produtoId ? 'readonly title="Vem do cadastro do produto — altere em Estoque → Produtos."' : ''} /></td>
        <td><input type="number" step="0.01" min="0" data-field="quantidade" data-index="${index}" value="${item.quantidade}" style="width:80px;" /></td>
        <td><input type="number" step="0.01" min="0" data-field="valorUnitario" data-index="${index}" value="${item.valorUnitario}" style="width:100px;" /></td>
        <td><input data-field="unidadeComercial" data-index="${index}" value="${escapeHtml(item.unidadeComercial)}" style="width:70px;" /></td>
        <!-- ICMS % e cBenef POR ITEM saíram daqui em 13/10/2026: estão no bloco
             Impostos, junto com o resto dos valores fiscais editáveis. -->
        <td><input type="number" step="0.01" min="0" data-field="valorTotal" data-index="${index}" value="${itemTotal(item)}" style="width:110px;" /></td>
        <td><button type="button" class="icon-button" data-remove-item="${index}" title="Remover item" ${itens.length <= 1 ? 'disabled' : ''}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"></path><path d="M8 6v12a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2V6"></path></svg>
        </button></td>
      </tr>
    `).join('');
  }

  function renderResultado() {
    if (!ultimoResultado) return '';
    const badge = NFE_FOCUS_STATUS_BADGE[ultimoResultado.status] || 'finance-badge-muted';
    return `
      <div class="panel">
        <h3>Resultado da última emissão</h3>
        <p><span class="finance-badge ${badge}">${escapeHtml(ultimoResultado.status)}</span> Referência: ${escapeHtml(ultimoResultado.referencia)}</p>
        ${ultimoResultado.chaveAcesso ? `<p>Chave de acesso: <code>${escapeHtml(ultimoResultado.chaveAcesso)}</code></p>` : ''}
        ${ultimoResultado.mensagemSefaz ? `<p class="muted">${escapeHtml(ultimoResultado.mensagemSefaz)}</p>` : ''}
        ${ultimoResultado.urlDanfe ? `<p><a href="${escapeHtml(ultimoResultado.urlDanfe)}" target="_blank" rel="noopener">Ver DANFE</a></p>` : ''}
      </div>
    `;
  }

  function renderNotasRecentes() {
    if (!selectedEstabelecimentoId) return '';
    return `
      <div class="panel">
        <h3>Últimas NF-e deste estabelecimento</h3>
        ${notasRecentes.length ? `
          <div class="table-scroll">
          <table class="table">
            <thead><tr><th>Referência</th><th>Status</th><th>Número</th><th>Valor</th><th>Data</th></tr></thead>
            <tbody>
              ${notasRecentes.map((nfe) => `
                <tr>
                  <td>${escapeHtml(nfe.referencia)}</td>
                  <td><span class="finance-badge ${NFE_FOCUS_STATUS_BADGE[nfe.status] || 'finance-badge-muted'}">${escapeHtml(nfe.status)}</span></td>
                  <td>${escapeHtml(nfe.numero || '—')}</td>
                  <td>${financeFormatBRL(Number(nfe.valorTotal || 0))}</td>
                  <td>${financeFormatDate(String(nfe.dataEmissao || '').slice(0, 10))}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
          </div>
        ` : '<p class="muted">Nenhuma NF-e emitida ainda por este estabelecimento.</p>'}
      </div>
    `;
  }

  // ---------------------------------------------------- nota em edição (fase EL)
  //
  // "Salvar nota em edição" (pedido do usuário, 14/10/2026): o estado da tela
  // vai para o servidor e volta ao reabrir a emissão do mesmo pedido (ou a
  // avulsa da mesma pessoa). Emitida e aceita, o servidor o apaga.
  let rascunhoSalvoEm = '';

  function camposDoFormulario() {
    const form = document.getElementById('nfeFocusForm');
    const campos = {};
    [...(form ? form.elements : [])].forEach((el) => {
      if (!el.name || ['submit', 'button', 'file'].includes(el.type)) return;
      if (el.type === 'checkbox') campos[el.name] = el.checked;
      else if (el.type === 'radio') { if (el.checked) campos[el.name] = el.value; }
      else campos[el.name] = el.value;
    });
    return campos;
  }

  function estadoDaTela() {
    return {
      versao: 1,
      campos: camposDoFormulario(),
      selectedEstabelecimentoId, selectedClienteId, tipoOperacao,
      itens, complemento, informacoesEditadas, notaDoPedido, observacoes,
      desconto, frete, outrasDespesas, seguro,
      modalidadeEscolhida: modalidadeEscolhida === undefined ? null : modalidadeEscolhida,
      transportadoraId, transporte, cobrancaEditada, cobranca
    };
  }

  /** Põe o estado salvo nas variáveis da tela; devolve os campos do formulário. */
  function aplicarEstadoSalvo(d) {
    if (!d || typeof d !== 'object') return null;
    if (d.selectedEstabelecimentoId) selectedEstabelecimentoId = emitenteDoPedido || d.selectedEstabelecimentoId;
    if (d.selectedClienteId !== undefined) selectedClienteId = d.selectedClienteId;
    if (d.tipoOperacao) tipoOperacao = d.tipoOperacao;
    if (Array.isArray(d.itens) && d.itens.length) itens = d.itens;
    if (d.complemento) Object.assign(complemento, d.complemento);
    informacoesEditadas = Boolean(d.informacoesEditadas);
    if (typeof d.notaDoPedido === 'string') notaDoPedido = d.notaDoPedido;
    if (typeof d.observacoes === 'string') observacoes = d.observacoes;
    if (d.desconto !== undefined) desconto = Number(d.desconto || 0);
    if (d.frete !== undefined) frete = Number(d.frete || 0);
    if (d.outrasDespesas !== undefined) outrasDespesas = Number(d.outrasDespesas || 0);
    if (d.seguro !== undefined) seguro = Number(d.seguro || 0);
    if (d.modalidadeEscolhida !== undefined) modalidadeEscolhida = d.modalidadeEscolhida === null ? undefined : d.modalidadeEscolhida;
    if (d.transportadoraId !== undefined) transportadoraId = d.transportadoraId;
    if (d.transporte) {
      Object.assign(transporte.transportador, d.transporte.transportador || {});
      Object.assign(transporte.veiculo, d.transporte.veiculo || {});
      transporte.volumes = Array.isArray(d.transporte.volumes) ? d.transporte.volumes : [];
    }
    cobrancaEditada = Boolean(d.cobrancaEditada);
    if (d.cobranca) {
      Object.assign(cobranca, d.cobranca);
      cobranca.duplicatas = Array.isArray(d.cobranca.duplicatas) ? d.cobranca.duplicatas : [];
    }
    return d.campos || {};
  }

  function preencherCamposSalvos(campos) {
    const form = document.getElementById('nfeFocusForm');
    if (!form) return;
    Object.entries(campos || {}).forEach(([nome, valor]) => {
      form.querySelectorAll(`[name="${CSS.escape(nome)}"]`).forEach((el) => {
        if (el.type === 'checkbox') el.checked = Boolean(valor);
        else if (el.type === 'radio') el.checked = el.value === valor;
        else el.value = valor;
      });
    });
  }

  async function salvarNotaEmEdicao(botao) {
    if (botao?.disabled) return;
    if (botao) botao.disabled = true;
    try {
      const resposta = await api(`/api/fiscal/nfe/rascunho?pedido=${encodeURIComponent(orderIdOrigem || '')}`, {
        method: 'PUT', body: JSON.stringify({ dados: estadoDaTela() })
      });
      const primeiraVez = !rascunhoSalvoEm;
      rascunhoSalvoEm = (resposta.rascunho && resposta.rascunho.atualizadoEm) || new Date().toISOString();
      showToast('Nota em edição salva. Ela volta assim quando esta emissão for aberta de novo.', 'success');
      // O "Descartar" aparece sem redesenhar a tela (redesenhar perderia a aba aberta).
      if (primeiraVez && botao && !document.getElementById('nfeFocusDescartarRascunho')) {
        botao.parentElement.insertAdjacentHTML('afterbegin', '<button type="button" class="secondary" id="nfeFocusDescartarRascunho">Descartar nota salva</button>');
        document.getElementById('nfeFocusDescartarRascunho')?.addEventListener('click', (e) => descartarNotaSalva(e.currentTarget));
      }
    } catch (erro) {
      showToast(erro.message || 'Não consegui salvar a nota em edição.', 'error');
    } finally {
      if (botao) botao.disabled = false;
    }
  }

  // VISUALIZAR A NF ANTES DE EMITIR (14/10/2026): a DANFE de pré-visualização
  // da Focus, montada com o que está na tela (a mesma montagem da emissão). Sem
  // valor fiscal: nada vai à SEFAZ e nenhum número é consumido.
  async function visualizarNota(botao) {
    if (botao?.disabled) return;
    if (!selectedEstabelecimentoId) {
      showToast('Escolha o estabelecimento emitente no bloco Emitente.', 'warning');
      return;
    }
    const form = document.getElementById('nfeFocusForm');
    if (!form) return;
    const formData = new FormData(form);
    const chave = String(formData.get('devolucaoChave') || '').replace(/\D/g, '');
    const referencias = formData.get('tipoOperacao') === 'DEVOLUCAO' && chave.length === 44 ? [{ chaveAcesso: chave }] : undefined;
    // A janela abre já, no clique: aberta depois da resposta, o navegador a
    // trataria como pop-up e bloquearia.
    const janela = window.open('', '_blank');
    if (!janela) {
      showToast('O navegador bloqueou a janela da pré-visualização. Libere os pop-ups deste site e tente de novo.', 'warning');
      return;
    }
    janela.opener = null;
    try { janela.document.body.innerHTML = '<p style="font-family:sans-serif;padding:24px">Gerando a pré-visualização…</p>'; } catch (_) { /* sem acesso */ }
    if (botao) botao.disabled = true;
    try {
      const resposta = await fetch('/api/fiscal/nfe/danfe-previa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-auth-token': (typeof getSessionToken === 'function' ? getSessionToken() : '') || '' },
        body: JSON.stringify(montarCorpoDaNota(formData, referencias))
      });
      if (!resposta.ok) {
        const corpo = await resposta.json().catch(() => ({}));
        throw new Error(corpo.error || `Não foi possível gerar a pré-visualização (HTTP ${resposta.status}).`);
      }
      await window.MavisDanfe.mostrar(janela, await resposta.blob(), 'DANFE (pré-visualização)');
    } catch (erro) {
      try { janela.close(); } catch (_) { /* já fechada */ }
      showToast(erro.message || 'Não foi possível gerar a pré-visualização.', 'error');
    } finally {
      if (botao) botao.disabled = false;
    }
  }

  async function descartarNotaSalva(botao) {
    if (botao?.disabled) return;
    if (botao) botao.disabled = true;
    try {
      await api(`/api/fiscal/nfe/rascunho?pedido=${encodeURIComponent(orderIdOrigem || '')}`, { method: 'DELETE' });
      rascunhoSalvoEm = '';
      botao?.remove();
      showToast('Nota salva descartada. O que está na tela continua aqui até você sair.', 'success');
    } catch (erro) {
      if (botao) botao.disabled = false;
      showToast(erro.message || 'Não consegui descartar a nota salva.', 'error');
    }
  }

  function renderForm() {
    const today = new Date().toISOString().slice(0, 10);
    content.innerHTML = `
      <div class="panel">
        <div class="cadastro-page-head">
          <div>
            <h3>Emitir NF-e (Focus NFe)</h3>
          </div>
          ${estabelecimentos.length ? `
          <!-- 14/10/2026, pedido do usuário: "Salvar" no canto superior direito,
               verde, e "Visualizar NF" para ver a DANFE antes de emitir.
               15/10/2026: "retire o botão emitir NF de todas as abas e deixe
               apenas um geral no canto superior direito" — fora do <form>, ligado
               a ele pelo atributo form (o envio e a validação são os mesmos). -->
          <div class="cadastro-list-actions nfe-acoes-topo">
            ${rascunhoSalvoEm ? '<button type="button" class="secondary" id="nfeFocusDescartarRascunho">Descartar nota salva</button>' : ''}
            ${ehComplemento() ? '' : '<button type="button" class="secondary" id="nfeFocusVisualizar">Visualizar NF</button>'}
            <button type="button" id="nfeFocusSalvarRascunho">Salvar nota em edição</button>
            <button type="submit" form="nfeFocusForm" id="nfeFocusSubmitBtn">Emitir NF-e</button>
          </div>` : ''}
        </div>

        <div id="nfeTravaPagamento">${htmlDaTrava()}</div>

        ${!estabelecimentos.length ? `
          <p class="form-error">Nenhum estabelecimento habilitado para emitir NF-e. Cadastre um em Configurações → Integrações → Empresas e estabelecimentos.</p>
        ` : `
        <!-- UMA PÁGINA SÓ, EM BLOCOS (15/10/2026, pedido do usuário: "faça a
             mesma coisa que você fez com a edição de produtos na tela de emissão
             de NF"). Eram oito abas; agora os blocos vêm um embaixo do outro, na
             ordem delas, e Impostos, Totais, Transporte e Pagamento se refazem
             sozinhos quando itens, destinatário ou totais mudam (ver
             agendarBlocosDependentes). -->
        <form id="nfeFocusForm" class="form-grid nfe-em-blocos">
          <section class="nfe-bloco" data-bloco="emitente">
            <h4 class="nfe-bloco-titulo">Emitente</h4>
            <div class="row">
              <label>Estabelecimento emitente
                <select id="nfeFocusEstabSelect" required ${emitenteDoPedido ? 'disabled title="Empresa do pedido — para emitir por outra, troque a empresa no pedido."' : ''}>
                  <option value="">Selecione</option>
                  ${estabelecimentos.map((e) => `<option value="${e.id}" ${e.id === selectedEstabelecimentoId ? 'selected' : ''}>${escapeHtml(e.nomeFantasia || e.razaoSocial)} — ${escapeHtml(fiscalFormatCnpjSimples(e.cnpj))}</option>`).join('')}
                </select>
              </label>
              <label>Tipo de operação (define a tributação)
                <select name="tipoOperacao">
                  ${NFE_FOCUS_TIPO_OPERACAO_OPTIONS.map((o) => `<option value="${o.value}" ${o.value === tipoOperacao ? 'selected' : ''}>${o.label}</option>`).join('')}
                </select>
              </label>
            </div>
            ${tipoOperacao === 'DEVOLUCAO' ? `
            <label>Chave de acesso da NF-e devolvida *
              <input name="devolucaoChave" required inputmode="numeric" maxlength="44" placeholder="44 dígitos" />
            </label>` : ''}
            <label>Natureza da operação<input name="naturezaOperacao" required value="${escapeHtml((NFE_FOCUS_TIPO_OPERACAO_OPTIONS.find((o) => o.value === tipoOperacao) || {}).natureza || (NFE_FOCUS_TIPO_OPERACAO_OPTIONS.find((o) => o.value === tipoOperacao) || {}).label || '')}" /></label>
            <label>Data de emissão<input type="date" name="dataEmissao" required value="${today}" /></label>
          </section>

          <section class="nfe-bloco" data-bloco="destinatario">
            <h4 class="nfe-bloco-titulo">Destinatário</h4>
            <label>Buscar cliente cadastrado
              ${/* Um campo só no lugar do par "busca + <select>" (fase DS). Abre
                   vazio a cada desenho, como o <select> abria em "Nenhum": os
                   campos abaixo é que guardam o destinatário. */''}
              ${renderSearchableSelect({
    id: 'nfeFocusCliente',
    name: 'nfeFocusCliente',
    options: opcoesDoCliente,
    selectedValue: '',
    placeholder: 'Buscar por nome ou documento — vazio: preencher manualmente abaixo'
  })}
            </label>
            <div class="row">
              <label>Nome / Razão social<input name="destNome" required value="${escapeHtml(destinatario.nome)}" /></label>
              <label>CPF/CNPJ<input name="destDocumento" required data-documento value="${escapeHtml(destinatario.documento)}" /></label>
              <label><input type="checkbox" name="destContribuinte" ${destinatario.contribuinte ? 'checked' : ''} /> Contribuinte de ICMS</label>
            </div>
            <label>Inscrição estadual (se contribuinte)<input name="destIe" value="${escapeHtml(destinatario.inscricaoEstadual)}" /></label>
            <div class="row">
              <label>CEP<input name="destCep" id="nfeFocusCep" maxlength="9" placeholder="00000-000" value="${escapeHtml(destinatario.cep)}" /></label>
              <div style="align-self:end;"><button type="button" class="secondary" id="nfeFocusBuscarCep">Buscar CEP</button></div>
            </div>
            <div class="row">
              <label>Logradouro<input name="destLogradouro" required value="${escapeHtml(destinatario.logradouro)}" /></label>
              <label>Número<input name="destNumero" required value="${escapeHtml(destinatario.numero)}" /></label>
              <label>Complemento<input name="destComplemento" value="${escapeHtml(destinatario.complemento)}" /></label>
            </div>
            <div class="row">
              <label>Bairro<input name="destBairro" required value="${escapeHtml(destinatario.bairro)}" /></label>
              <label>Município<input name="destMunicipio" required value="${escapeHtml(destinatario.municipio)}" /></label>
              <label>UF<input name="destUf" maxlength="2" required value="${escapeHtml(destinatario.uf)}" /></label>
            </div>
            <input type="hidden" name="destCodigoMunicipio" value="${escapeHtml(destinatario.codigoMunicipio)}" />
          </section>

          ${ehComplemento() ? `
          <section class="nfe-bloco" data-bloco="complemento">
            <h4 class="nfe-bloco-titulo">Complemento de ICMS</h4>
            <div class="cadastro-section">
              <div class="cadastro-section-header"><h4>NF-e original</h4></div>
              <div class="cadastro-section-body">
                <label>Chave de acesso da NF-e original *
                  <input name="complementoChave" required inputmode="numeric" maxlength="44"
                    value="${escapeHtml(complemento.chave)}" placeholder="44 dígitos" />
                </label>
                <div class="row">
                  <label>Número<input name="complementoNumero" value="${escapeHtml(complemento.numero)}" /></label>
                  <label>Série<input name="complementoSerie" value="${escapeHtml(complemento.serie)}" /></label>
                </div>
              </div>
            </div>

            <div class="cadastro-section">
              <div class="cadastro-section-header"><h4>ICMS a complementar</h4></div>
              <div class="cadastro-section-body">
                <div class="row">
                  <label>Base de cálculo do ICMS (R$) *
                    <input name="complementoBase" type="number" step="0.01" min="0" required value="${complemento.baseIcms || ''}" />
                  </label>
                  <label>Alíquota (%) *
                    <input name="complementoAliquota" type="number" step="0.0001" min="0" max="100" required value="${complemento.aliquota || ''}" />
                  </label>
                  <label>Valor do ICMS (R$) *
                    <input name="complementoValor" type="number" step="0.01" min="0" required value="${complemento.valorIcms || ''}" />
                  </label>
                </div>
              </div>
            </div>

            <div class="cadastro-section">
              <div class="cadastro-section-header"><h4>Informações complementares</h4></div>
              <div class="cadastro-section-body">
                <label>Texto *
                  <textarea name="complementoInformacoes" rows="3" required>${escapeHtml(complemento.informacoes)}</textarea>
                </label>
              </div>
            </div>
          </section>
          ` : ''}

          ${ehComplemento() ? '' : `
            <!-- Bloco Itens. Quando era aba, a ABERTURA do painel dela sumiu, e
                 a tag de fechamento la embaixo ficou sem par e fechou o
                 div.panel ANTES da hora. Efeito medido em 17/08/2026: Pagamento
                 e Observacoes caiam para FORA do form, e o FormData nao
                 enxergava mais nem a forma de pagamento nem as observacoes — a
                 nota saia com o padrao sem ninguem pedir. As tags de cada bloco
                 seguem conferidas (scripts/test-emissao-blocos.js). -->
            <section class="nfe-bloco" data-bloco="itens">
            <h4 class="nfe-bloco-titulo">Itens</h4>
            <div class="table-scroll">
              <table class="table">
                <thead><tr><th>Produto</th><th>Descrição</th><th>Código</th><th>NCM</th><th>Qtd.</th><th>Valor unit.</th><th>Unid.</th><th>Total</th><th></th></tr></thead>
                <tbody id="nfeFocusItemsBody">${renderItemsRows()}</tbody>
              </table>
            </div>
            <div style="margin: 10px 0;"><button type="button" class="secondary" id="nfeFocusAddItemBtn">+ Adicionar item</button></div>
            <p class="finance-negative" style="font-size: 1.1rem;">Valor total: <strong id="nfeFocusGrandTotal">${financeFormatBRL(grandTotal())}</strong></p>
          </section>

          <!-- Impostos e Totais (13/10/2026): desenhados por renderImpostos e
               renderTotais a partir da PRÉVIA do servidor, refeita quando a nota
               muda (agendarBlocosDependentes). -->
          <section class="nfe-bloco" data-bloco="impostos">
            <h4 class="nfe-bloco-titulo">Impostos</h4>
            <div id="nfeFocusImpostos"></div>
          </section>

          <section class="nfe-bloco" data-bloco="transporte">
            <h4 class="nfe-bloco-titulo">Transporte</h4>
            <div id="nfeFocusTransporte"></div>
          </section>

          <section class="nfe-bloco" data-bloco="pagamento">
            <h4 class="nfe-bloco-titulo">Pagamento</h4>
            ${pagamentosDoPedido.length ? `
            <div class="cadastro-section">
              <div class="cadastro-section-header"><h4>Pagamentos da venda</h4></div>
              <div class="cadastro-section-body">
                <table class="data-table">
                  <thead><tr><th>Forma</th><th>Código SEFAZ</th><th>Cartão</th><th class="num">Valor</th></tr></thead>
                  <tbody>
                    ${pagamentosDoPedido.map((linha) => `<tr>
                      <td>${escapeHtml(linha.rotulo || NFE_FORMAS_PAGAMENTO.find((f) => f.value === linha.forma)?.label || linha.forma)}</td>
                      <td>${escapeHtml(linha.forma)}</td>
                      <td>${linha.integracao ? [
                        linha.credenciadora ? escapeHtml(linha.credenciadora) : '<span class="finance-negative">sem credenciadora</span>',
                        linha.bandeira ? escapeHtml(window.MavisBandeiraCartao.nome(linha.bandeira) || linha.bandeira) : '',
                        String(linha.integracao) === '1' ? 'integrado' : 'não integrado',
                        linha.autorizacao ? `NSU ${escapeHtml(linha.autorizacao)}` : ''
                      ].filter(Boolean).join(' · ') : '<span class="muted">—</span>'}</td>
                      <td class="num">${financeFormatBRL(linha.valor)}</td>
                    </tr>`).join('')}
                  </tbody>
                  <tfoot><tr>
                    <th colspan="3">Soma dos pagamentos</th>
                    <th class="num ${somaDosPagamentos() === grandTotal() ? '' : 'finance-negative'}">
                      ${financeFormatBRL(somaDosPagamentos())}</th>
                  </tr></tfoot>
                </table>
                ${somaDosPagamentos() === grandTotal() ? '' : `<p class="form-error">
                  Os pagamentos somam ${financeFormatBRL(somaDosPagamentos())} e a nota tem
                  ${financeFormatBRL(grandTotal())}. A SEFAZ recusa assim — corrija os pagamentos do pedido.
                </p>`}
              </div>
            </div>
            ` : ''}
            <div class="row">
              ${pagamentosDoPedido.length ? '' : `<label>Forma de pagamento
                <select name="formaPagamento">
                  ${NFE_FORMAS_PAGAMENTO.map((f) => `<option value="${f.value}" ${f.value === '99' ? 'selected' : ''}>${escapeHtml(f.label)}</option>`).join('')}
                </select>
              </label>`}
              <label>Condição
                <select name="paymentType" id="nfeFocusPaymentType">
                  <option value="avista" selected>À vista</option>
                  <option value="parcelado">Parcelado</option>
                </select>
              </label>
            </div>
            <div class="row hidden" id="nfeFocusInstallmentFields">
              <label>Número de parcelas<input type="number" name="installmentsCount" min="2" max="60" step="1" value="2" /></label>
              <label>Intervalo entre parcelas (dias)<input type="number" name="installmentIntervalDays" min="1" value="30" /></label>
            </div>
            <div id="nfeFocusCobranca"></div>
          </section>

          <section class="nfe-bloco" data-bloco="totais">
            <h4 class="nfe-bloco-titulo">Totais</h4>
            <div id="nfeFocusTotais"></div>
          </section>

          <section class="nfe-bloco" data-bloco="observacoes">
            <h4 class="nfe-bloco-titulo">Observações</h4>
            <!-- Campo dedicado para o chassi: é o único dado da ficha que muda
                 a cada nota, e procurá-lo no meio de vinte linhas de texto a
                 cada emissão é onde o erro de digitação aparece. O que se
                 escreve aqui vai para a linha "CHASSI:" logo abaixo. -->
            <label class="nfe-obs-chassi">Chassi
              <input type="text" id="nfeFocusChassi" maxlength="25" autocomplete="off"
                     spellcheck="false" placeholder="Digite o chassi do equipamento"
                     value="${escapeHtml(TextoPadrao ? TextoPadrao.chassiDoTexto(observacoes) : '')}" />
            </label>

            <label>Observações adicionais
              <textarea name="observacoesAdicionais" id="nfeFocusObservacoes" rows="18"
                        spellcheck="false">${escapeHtml(observacoes)}</textarea>
            </label>
            <div class="nfe-obs-rodape">
              <!-- Contador à vista: o limite da SEFAZ para este campo é 5000
                   caracteres, e estourar não dá erro de digitação — dá rejeição
                   depois de transmitir. -->
              <span id="nfeFocusObsContador" class="muted"></span>
              <button type="button" class="secondary finance-pill-sm" id="nfeFocusObsRestaurar">Restaurar texto padrão</button>
            </div>
            <p class="muted" id="nfeFocusObsPendentes"></p>
          </section>
          `}
        </form>
        `}
      </div>

      ${renderResultado()}
      ${renderNotasRecentes()}
    `;

    attachHandlers();
    // Máscara e validação de CPF/CNPJ, iguais às do Cadastro de Pessoas.
    window.MavisDocumento?.ligarTodos(content);

    // Consulta do CNPJ do destinatário na Receita. Aqui ela paga mais do que
    // em qualquer outra tela: endereço errado numa NF-e é rejeição da SEFAZ ou
    // nota autorizada com dado divergente do cadastro nacional.
    const campoDoc = content.querySelector('[name="destDocumento"]');
    if (campoDoc) {
      const form = () => document.getElementById('nfeFocusForm');
      const preencher = (nome, valor) => {
        const campo = form()?.querySelector(`[name="${nome}"]`);
        // Só o que está vazio: quem escolheu um cliente cadastrado já trouxe
        // os dados dele, e a Receita costuma estar mais desatualizada.
        if (campo && !String(campo.value || '').trim() && valor) campo.value = valor;
      };
      window.MavisDocumento.ligarConsultaCnpj(campoDoc, {
        api,
        showToast,
        devePreencherSozinho: () => !String(form()?.querySelector('[name="destNome"]')?.value || '').trim(),
        aoEncontrar: (dados) => {
          preencher('destNome', dados.razaoSocial || dados.nomeFantasia);
          preencher('destCep', dados.cep);
          preencher('destLogradouro', dados.logradouro);
          preencher('destNumero', dados.numero);
          preencher('destComplemento', dados.complemento);
          preencher('destBairro', dados.bairro);
          preencher('destMunicipio', dados.municipio);
          preencher('destUf', dados.uf);
          // O código IBGE do município é campo da nota: preencher errado é
          // rejeição na hora de transmitir. Só entra quando a Receita mandou
          // o código IBGE de verdade — o "Buscar CEP" continua sendo a outra
          // forma de obtê-lo.
          preencher('destCodigoMunicipio', dados.codigoMunicipioIbge);
          // Quem tem CNPJ é presumidamente contribuinte. A IE vem quando a
          // consulta trouxe (CNPJ.ws, 15/10/2026); senão fica para preencher à mão.
          preencher('destIe', dados.inscricaoEstadual);
          const contribuinte = form()?.querySelector('[name="destContribuinte"]');
          if (contribuinte && !contribuinte.checked) contribuinte.checked = true;
        }
      });
    }
  }

  function refreshItemsTable() {
    const tbody = document.getElementById('nfeFocusItemsBody');
    if (tbody) tbody.innerHTML = renderItemsRows();
    attachItemsHandlers();
    refreshGrandTotal();
  }

  function refreshGrandTotal() {
    const el = document.getElementById('nfeFocusGrandTotal');
    if (el) el.textContent = financeFormatBRL(grandTotal());
    agendarBlocosDependentes();
  }

  // OS BLOCOS QUE DEPENDEM DO RESTO (15/10/2026, página em blocos). Em abas,
  // Impostos e Totais refaziam a prévia ao abrir, Transporte a modalidade e
  // Pagamento as duplicatas. À vista o tempo todo, eles se refazem quando
  // itens, destinatário ou totais mudam — com uma espera curta, para digitar
  // uma quantidade não pedir uma prévia ao servidor a cada tecla.
  let esperaDosDependentes = null;
  function agendarBlocosDependentes() {
    clearTimeout(esperaDosDependentes);
    esperaDosDependentes = setTimeout(() => {
      if (!document.getElementById('nfeFocusForm') || ehComplemento()) return;
      carregarPrevia();
      renderTransporte();
      atualizarCobrancaSugerida();
    }, 700);
  }

  function attachItemsHandlers() {
    // `[data-field]`: o campo de busca do produto também tem <input> (o texto e
    // o escondido), sem data-index — sem o filtro, digitar nele virava
    // itens[NaN] e erro.
    document.querySelectorAll('#nfeFocusItemsBody input[data-field]').forEach((input) => {
      input.addEventListener('input', () => {
        const index = Number(input.dataset.index);
        const field = input.dataset.field;
        const campoDaLinha = (nome) => document.querySelector(`#nfeFocusItemsBody input[data-field="${nome}"][data-index="${index}"]`);
        // Total digitado: muda o unitário, não a quantidade. Sem quantidade
        // não há unitário a tirar dele, e o total volta a ser quantidade × unitário.
        if (field === 'valorTotal') {
          const unitario = unitarioDoTotal(input.value, itens[index].quantidade);
          if (unitario !== null) {
            itens[index].valorUnitario = unitario;
            const campoUnitario = campoDaLinha('valorUnitario');
            if (campoUnitario) campoUnitario.value = unitario;
          }
          refreshGrandTotal();
          return;
        }
        itens[index][field] = field === 'quantidade' || field === 'valorUnitario' ? Number(input.value || 0) : input.value;
        const campoTotal = campoDaLinha('valorTotal');
        if (campoTotal) campoTotal.value = itemTotal(itens[index]);
        refreshGrandTotal();
      });
    });
    // Ao sair do total, ele mostra o que a nota vai levar (sem quantidade, o
    // digitado não vale).
    document.querySelectorAll('#nfeFocusItemsBody input[data-field="valorTotal"]').forEach((input) => {
      input.addEventListener('change', () => {
        const item = itens[Number(input.dataset.index)];
        if (item) input.value = itemTotal(item);
      });
    });
    // Escolher o produto preenche a linha a partir do cadastro. Redesenha a
    // tabela porque o NCM passa a ser somente-leitura — e volta a ser editável
    // se a linha virar item avulso.
    itens.forEach((_, index) => {
      if (typeof attachSearchableSelect !== 'function') return;
      attachSearchableSelect({
        id: `nfeFocusProduto${index}`,
        options: opcoesDeProdutoComAvulso,
        onSelect: (valor) => escolherProduto(index, valor)
      });
      // Digitar e sair sem escolher NÃO troca o produto da linha (é o que o
      // <select> fazia: só a escolha mudava). Então o campo volta a mostrar o
      // produto que a linha tem — senão a tela diria uma coisa e a nota levaria
      // outra.
      const campo = document.getElementById(`nfeFocusProduto${index}Input`);
      const escondido = document.getElementById(`nfeFocusProduto${index}Value`);
      segurarEnter(campo);
      campo?.addEventListener('blur', () => {
        setTimeout(() => {
          const atual = itens[index] ? String(itens[index].produtoId || '') : '';
          if (!escondido || escondido.value === atual) return;
          escondido.value = atual;
          const opcao = opcoesDeProduto.find((o) => String(o.value) === atual);
          campo.value = opcao ? opcao.label : '';
        }, 200);
      });
    });
    // ENTER NA BUSCA NÃO EMITE A NOTA. O produto era um <select>, e Enter num
    // <select> não envia o formulário; num campo de texto envia — e o envio
    // deste formulário é "Emitir NF-e". Quem procura um produto e aperta Enter
    // para escolher não pode transmitir um documento fiscal sem querer.
    function segurarEnter(campo) {
      campo?.addEventListener('keydown', (evento) => {
        if (evento.key === 'Enter') evento.preventDefault();
      });
    }

    // O corpo do antigo `change` do <select>, com o valor escolhido no lugar de
    // `select.value`.
    function escolherProduto(index, valor) {
      const produto = (meta.produtos || []).find((p) => p.id === valor);
      if (!produto) {
        itens[index] = { ...itens[index], produtoId: '' };
        refreshItemsTable();
        return;
      }
      itens[index] = {
        ...itens[index],
        produtoId: produto.id,
        descricao: produto.name,
        codigoProduto: produto.sku || '',
        ncm: produto.ncm || '',
        // Preço do cadastro é ponto de partida: desconto e negociação
        // mudam por venda, então o campo continua editável.
        valorUnitario: Number(produto.salePrice || itens[index].valorUnitario || 0),
        unidadeComercial: produto.unidadeComercial || 'UN',
        origem: produto.origem === null || produto.origem === undefined ? 0 : Number(produto.origem)
      };
      if (!produto.ncm) {
        showToast(`"${produto.name}" está sem NCM no cadastro — preencha em Estoque → Produtos, senão a emissão será recusada.`, 'warning', 7000);
      }
      refreshItemsTable();
    }

    document.querySelectorAll('[data-remove-item]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const index = Number(btn.dataset.removeItem);
        if (itens.length <= 1) return;
        itens.splice(index, 1);
        refreshItemsTable();
      });
    });
  }

  // ----------------------------------------------------- abas Impostos e Totais
  //
  // Pedido do usuário (13/10/2026): ver os impostos de cada item antes de
  // transmitir e poder EDITAR qualquer valor fiscal, mesmo com as regras
  // fiscais preenchendo. O que se digita fica em `item.fiscal` e vai no corpo
  // da nota; o servidor monta a prévia com isso (POST /api/fiscal/nfe/previa)
  // e a tela mostra o que ele montou — nenhum imposto é calculado aqui.
  const GRUPOS_FISCAIS = [
    // CEST ao lado do NCM (15/10/2026, pedido do usuário): vem do cadastro do
    // produto pela prévia e pode ser digitado aqui, como o NCM.
    { titulo: 'Classificação', campos: [['cfop', 'CFOP'], ['ncm', 'NCM'], ['cest', 'CEST'], ['origem', 'Origem'], ['codigoBeneficioFiscal', 'cBenef']] },
    // O CST / CSOSN mora no ICMS (15/10/2026, pedido do usuário: "coloque o
    // cst da primeira tela na aba do ICMS"), primeiro, como o CST de IPI, PIS
    // e COFINS nos grupos deles.
    { titulo: 'ICMS', campos: [['cstIcms', 'CST / CSOSN'], ['baseIcms', 'Base'], ['aliquotaIcms', 'Alíquota %'], ['valorIcms', 'Valor'], ['reducaoBcIcms', 'Redução BC %']] },
    { titulo: 'ICMS-ST', campos: [['baseIcmsSt', 'Base'], ['aliquotaIcmsSt', 'Alíquota %'], ['valorIcmsSt', 'Valor'], ['mvaSt', 'MVA %']] },
    // CST 60 / CSOSN 500 (14/10/2026): o ST retido na compra. Vem da última
    // nota de entrada do produto; base e valores aqui são do ITEM e podem ser
    // digitados (não saem de base × alíquota). Só aparece nesses dois códigos.
    { titulo: 'ICMS-ST retido', soComStRetido: true, campos: [['baseIcmsStRetido', 'Base retida'], ['aliquotaIcmsStRetido', 'pST %'], ['valorIcmsSubstituto', 'ICMS do substituto'], ['valorIcmsStRetido', 'ICMS-ST retido']] },
    { titulo: 'IPI', campos: [['cstIpi', 'CST'], ['baseIpi', 'Base'], ['aliquotaIpi', 'Alíquota %'], ['valorIpi', 'Valor']] },
    { titulo: 'PIS', campos: [['cstPis', 'CST'], ['basePis', 'Base'], ['aliquotaPis', 'Alíquota %'], ['valorPis', 'Valor']] },
    { titulo: 'COFINS', campos: [['cstCofins', 'CST'], ['baseCofins', 'Base'], ['aliquotaCofins', 'Alíquota %'], ['valorCofins', 'Valor']] },
    // Reforma tributária. Os valores são só leitura: saem da base (valor do
    // item) vezes a alíquota, e é a alíquota que se edita.
    { titulo: 'IBS/CBS', campos: [['cstIbsCbs', 'CST'], ['classTrib', 'cClassTrib'], ['aliquotaIbsUf', 'IBS UF %'], ['aliquotaIbsMun', 'IBS Mun. %'], ['aliquotaCbs', 'CBS %'], ['valorIbs', 'IBS (valor)'], ['valorCbs', 'CBS (valor)']] }
  ];
  const CAMPOS_DE_TEXTO = ['cfop', 'ncm', 'cest', 'cstIcms', 'codigoBeneficioFiscal', 'cstIpi', 'cstPis', 'cstCofins', 'cstIbsCbs', 'classTrib'];
  // Pedido do usuário (14/10/2026): os CST se ESCOLHEM na lista. Base e valor
  // saem do servidor (base do item × alíquota), já com o que a regra fiscal
  // carregou — e, desde 16/10/2026 (pedido do usuário: "permita edição no
  // campo de valor das NF"), também se DIGITAM: o digitado vale na nota
  // (aplicarValoresEditados, no servidor). Ficam fora da alteração em massa,
  // que poria o mesmo valor em todos os itens.
  const CAMPOS_CALCULADOS = [
    'baseIcms', 'valorIcms', 'baseIcmsSt', 'valorIcmsSt', 'baseIpi', 'valorIpi',
    'basePis', 'valorPis', 'baseCofins', 'valorCofins', 'valorIbs', 'valorCbs'
  ];
  // Trocar a alíquota (ou a base) devolve o valor ao cálculo: o valor digitado
  // antes era para a alíquota antiga, e ficaria valendo calado.
  const RECALCULA = {
    aliquotaIcms: ['baseIcms', 'valorIcms'],
    reducaoBcIcms: ['baseIcms', 'valorIcms'],
    baseIcms: ['valorIcms'],
    aliquotaIcmsSt: ['baseIcmsSt', 'valorIcmsSt'],
    mvaSt: ['baseIcmsSt', 'valorIcmsSt'],
    baseIcmsSt: ['valorIcmsSt'],
    aliquotaIpi: ['baseIpi', 'valorIpi'],
    baseIpi: ['valorIpi'],
    aliquotaPis: ['basePis', 'valorPis'],
    basePis: ['valorPis'],
    aliquotaCofins: ['baseCofins', 'valorCofins'],
    baseCofins: ['valorCofins'],
    aliquotaIbsUf: ['valorIbs'],
    aliquotaIbsMun: ['valorIbs'],
    aliquotaCbs: ['valorCbs']
  };
  const LISTA_DO_CST = { cstIpi: 'cstIpi', cstPis: 'cstPisCofins', cstCofins: 'cstPisCofins', cstIbsCbs: 'cstIbsCbs' };

  /** As opções do CST, com o código atual garantido mesmo fora da tabela. */
  function opcoesDoCst(campo, atual) {
    if (!tabelasFiscais) return null;
    const codigo = String(atual || '').trim();
    const opcoes = (linhas) => (linhas || []).map((l) => {
      const c = String(l.codigo).trim();
      const desc = String(l.descricao || '').split(' · ').pop();
      return `<option value="${escapeHtml(c)}" ${c === codigo ? 'selected' : ''}>${escapeHtml(c)} — ${escapeHtml(desc)}</option>`;
    }).join('');
    let grupos;
    if (campo === 'cstIcms') {
      // Três dígitos é CSOSN (Simples Nacional), dois é CST: a lista segue o
      // regime do que a regra fiscal carregou. Sem código ainda, as duas.
      const csosn = `<optgroup label="CSOSN (Simples Nacional)">${opcoes(tabelasFiscais.csosn)}</optgroup>`;
      const cst = `<optgroup label="CST (Regime Normal)">${opcoes(tabelasFiscais.cstIcms)}</optgroup>`;
      grupos = codigo.length === 3 ? csosn : codigo.length === 2 ? cst : csosn + cst;
      if (!(tabelasFiscais.csosn || []).length && !(tabelasFiscais.cstIcms || []).length) return null;
    } else {
      const linhas = tabelasFiscais[LISTA_DO_CST[campo]] || [];
      if (!linhas.length) return null;
      grupos = opcoes(linhas);
    }
    const conhecido = new RegExp(`value="${codigo.replace(/[^0-9A-Za-z]/g, '')}"`).test(grupos);
    return `<option value="" ${codigo ? '' : 'selected'}>—</option>`
      + (codigo && !conhecido ? `<option value="${escapeHtml(codigo)}" selected>${escapeHtml(codigo)}</option>` : '')
      + grupos;
  }

  // cClassTrib NA LISTA DO CST (14/10/2026, como no Viper): o código começa
  // pelo CST do IBS/CBS, então a lista mostra só os daquele CST, com a
  // descrição. A tabela do sistema é parcial: CST sem nenhum código nela deixa
  // o campo digitável, para a emissão não travar por falta de carga.
  function codigosDoClassTrib(cst) {
    const prefixo = String(cst || '').replace(/\D/g, '');
    if (!tabelasFiscais || prefixo.length !== 3) return [];
    // TODOS os do CST (14/10/2026, pedido do usuário: "mostre todos"). Os que a
    // tabela oficial não libera para NF-e/NFC-e vêm depois e marcados (ver
    // opcoesDoClassTrib) — a SEFAZ tende a recusá-los numa NF-e.
    return (tabelasFiscais.classificacaoTributaria || [])
      .filter((l) => String(l.codigo).trim().startsWith(prefixo))
      .sort((a, b) => Number(a.vale_nfe === false) - Number(b.vale_nfe === false)
        || String(a.codigo).localeCompare(String(b.codigo)));
  }

  function opcoesDoClassTrib(cst, atual) {
    const linhas = codigosDoClassTrib(cst);
    if (!linhas.length) return null;
    const codigo = String(atual || '').trim();
    const lista = linhas.map((l) => {
      const c = String(l.codigo).trim();
      const desc = String(l.descricao || '').split(' · ').pop();
      // Fora de NF-e/NFC-e pela tabela oficial: aparece (pedido do usuário), marcado.
      const fora = l.vale_nfe === false ? ' (fora de NF-e)' : '';
      return `<option value="${escapeHtml(c)}" ${c === codigo ? 'selected' : ''}>${escapeHtml(c)} — ${escapeHtml(desc)}${fora}</option>`;
    }).join('');
    const conhecido = linhas.some((l) => String(l.codigo).trim() === codigo);
    return `<option value="" ${codigo ? '' : 'selected'}>—</option>`
      + (codigo && !conhecido ? `<option value="${escapeHtml(codigo)}" selected>${escapeHtml(codigo)}</option>` : '')
      + lista;
  }

  function campoFiscal(item, linha, index, campo) {
    const valor = String(valorFiscal(item, linha, campo));
    if (campo === 'classTrib') {
      const opcoesClass = opcoesDoClassTrib(valorFiscal(item, linha, 'cstIbsCbs'), valor);
      if (opcoesClass) return `<select data-fiscal-index="${index}" data-fiscal-campo="classTrib">${opcoesClass}</select>`;
    }
    const ehCst = campo === 'cstIcms' || campo in LISTA_DO_CST;
    const opcoes = ehCst ? opcoesDoCst(campo, valor) : null;
    if (opcoes) {
      return `<select data-fiscal-index="${index}" data-fiscal-campo="${campo}">${opcoes}</select>`;
    }
    return `<input data-fiscal-index="${index}" data-fiscal-campo="${campo}"
                   ${CAMPOS_DE_TEXTO.includes(campo) ? '' : 'type="number" step="0.01"'}
                   value="${escapeHtml(valor)}" />`;
  }

  /** O que o campo mostra: o editado, senão o que a prévia montou. */
  function valorFiscal(item, linha, campo) {
    const ed = item.fiscal || {};
    if (campo === 'cstIcms') {
      if (ed.csosn !== undefined) return ed.csosn;
      if (ed.cstIcms !== undefined) return ed.cstIcms;
    } else if (ed[campo] !== undefined) {
      return ed[campo];
    }
    const v = linha ? linha[campo] : null;
    return v === null || v === undefined ? '' : v;
  }

  function editado(item, campo) {
    const ed = item.fiscal || {};
    return campo === 'cstIcms' ? (ed.cstIcms !== undefined || ed.csosn !== undefined) : ed[campo] !== undefined;
  }

  // OS BLOCOS SE REDESENHAM SOZINHOS (15/10/2026, página em blocos) e, com o
  // cursor dentro de um deles, quem digitava perdia o campo. Guarda qual era —
  // pelos atributos data-*, name e id, que identificam o campo — e o devolve,
  // com a posição do cursor, depois do redesenho. O campo novo vale quando
  // TODOS os atributos dele estão no antigo: marcas que outro código põe
  // depois de o campo aparecer (data-dinheiro-ativo, dos campos de dinheiro)
  // só o antigo tem, e não podem impedir o reencontro.
  function guardarFoco(caixa) {
    const atributosDoCampo = (el) => [...el.attributes]
      .filter((a) => a.name.startsWith('data-') || a.name === 'name' || a.name === 'id')
      .map((a) => [a.name, a.value]);
    const ativo = document.activeElement;
    if (!ativo || !caixa || !caixa.contains(ativo) || !/^(INPUT|SELECT|TEXTAREA)$/.test(ativo.tagName)) return () => {};
    const doAntigo = new Map(atributosDoCampo(ativo));
    if (!doAntigo.size) return () => {};
    const ehOMesmo = (el) => {
      const doNovo = atributosDoCampo(el);
      return el.tagName === ativo.tagName && doNovo.length > 0
        && doNovo.every(([nome, valor]) => doAntigo.get(nome) === valor);
    };
    let inicio = null;
    let fim = null;
    try { inicio = ativo.selectionStart; fim = ativo.selectionEnd; } catch (_) { /* campo sem seleção */ }
    return () => {
      if (caixa.contains(document.activeElement)) return;
      const alvo = [...caixa.querySelectorAll('input, select, textarea')].find(ehOMesmo);
      if (!alvo) return;
      alvo.focus();
      if (inicio !== null && inicio !== undefined) {
        try { alvo.setSelectionRange(inicio, fim); } catch (_) { /* number e select não têm */ }
      }
    };
  }

  function renderImpostos() {
    const caixa = document.getElementById('nfeFocusImpostos');
    if (!caixa) return;
    const devolverFoco = guardarFoco(caixa);
    try {
      desenharImpostos(caixa);
    } finally {
      devolverFoco();
    }
  }

  function desenharImpostos(caixa) {
    if (previaCarregando && !previa) { caixa.innerHTML = '<p class="muted">Calculando os impostos…</p>'; return; }
    const topo = `
      <div class="nfe-impostos-topo">
        <button type="button" class="secondary" data-previa-recalcular>Recalcular</button>
        <button type="button" class="secondary" data-fiscal-massa>Alterar em massa</button>
        ${previaCarregando ? '<span class="muted">Calculando…</span>' : ''}
      </div>`;
    if (previaAguardando) {
      caixa.innerHTML = `${topo}<p class="muted">${escapeHtml(previaAguardando)}</p>`;
      return;
    }
    if (previaErro) {
      caixa.innerHTML = `${topo}<p class="form-error">${escapeHtml(previaErro)}</p>`;
      return;
    }
    if (!previa) { caixa.innerHTML = topo; return; }
    if (abaImpostoDoItem >= itens.length) abaImpostoDoItem = Math.max(0, itens.length - 1);
    // As abas dos itens: o número, o começo do nome e um ponto quando algo do
    // item foi editado à mão (o nome inteiro fica no title).
    const abas = itens.length > 1 ? `
      <div class="nfe-item-abas" role="tablist">
        ${itens.map((item, index) => {
          const nome = String(item.descricao || (previa.itens[index] && previa.itens[index].descricao) || '');
          const editadoAqui = item.fiscal && Object.keys(item.fiscal).length;
          return `<button type="button" class="nfe-item-aba ${index === abaImpostoDoItem ? 'active' : ''}" role="tab"
                    aria-selected="${index === abaImpostoDoItem}" data-imposto-item="${index}" title="${escapeHtml(nome)}">
                    Item ${index + 1}<span class="nfe-item-aba-nome">${escapeHtml(nome.length > 24 ? nome.slice(0, 24) + '…' : nome)}</span>${editadoAqui ? '<span class="nfe-item-aba-editado" aria-label="editado"></span>' : ''}
                  </button>`;
        }).join('')}
      </div>` : '';
    caixa.innerHTML = topo + abas + itens.map((item, index) => {
      if (index !== abaImpostoDoItem) return '';
      const linha = previa.itens[index] || null;
      const algumEditado = item.fiscal && Object.keys(item.fiscal).length;
      return `
        <section class="nfe-imposto-item">
          <div class="nfe-imposto-cabeca">
            <strong>Item ${index + 1} — ${escapeHtml(item.descricao || (linha && linha.descricao) || '')}</strong>
            <span class="muted">${financeFormatBRL(itemTotal(item))}</span>
            ${algumEditado ? `<button type="button" class="secondary finance-pill-sm" data-fiscal-limpar="${index}">Usar o da regra</button>` : ''}
          </div>
          ${(() => {
            const grupos = GRUPOS_FISCAIS.filter((grupo) => !grupo.soComStRetido || ['60', '500'].includes(String(valorFiscal(item, linha, 'cstIcms')).trim()));
            // Grupo que este item não tem (ICMS-ST retido fora do CST 60): o primeiro.
            const aberto = grupos.find((g) => g.titulo === abaGrupoImposto) || grupos[0];
            return `<div class="nfe-grupo-abas" role="tablist">
              ${grupos.map((g) => `<button type="button" class="nfe-grupo-aba ${g === aberto ? 'active' : ''}" role="tab"
                aria-selected="${g === aberto}" data-imposto-grupo="${escapeHtml(g.titulo)}">${g.titulo}${g.campos.some(([campo]) => editado(item, campo)) ? '<span class="nfe-item-aba-editado" aria-label="editado"></span>' : ''}</button>`).join('')}
            </div>` + [aberto].map((grupo) => `
            <div class="nfe-imposto-grupo">
              <span class="nfe-imposto-titulo">${grupo.titulo}</span>
              <div class="nfe-imposto-campos">
                ${grupo.campos.map(([campo, rotulo]) => `
                  <label class="${editado(item, campo) ? 'is-editado' : ''}">${rotulo}
                    ${campoFiscal(item, linha, index, campo)}
                  </label>`).join('')}
              </div>
            </div>`).join('');
          })()}
        </section>`;
    }).join('');
  }

  function renderTotais() {
    const caixa = document.getElementById('nfeFocusTotais');
    if (!caixa) return;
    const devolverFoco = guardarFoco(caixa);
    const t = previa && previa.totais;
    const linha = (rotulo, valor, forte) => `<tr><th>${rotulo}</th><td class="num">${forte ? '<strong>' : ''}${valor === undefined ? '—' : financeFormatBRL(valor)}${forte ? '</strong>' : ''}</td></tr>`;
    caixa.innerHTML = `
      <div class="row">
        <label>Frete (R$)<input type="number" step="0.01" min="0" data-total-campo="frete" value="${frete || ''}" /></label>
        <label>Seguro (R$)<input type="number" step="0.01" min="0" data-total-campo="seguro" value="${seguro || ''}" /></label>
        <label>Desconto (R$)<input type="number" step="0.01" min="0" data-total-campo="desconto" value="${desconto || ''}" /></label>
        <label>Outras despesas (R$)<input type="number" step="0.01" min="0" data-total-campo="outrasDespesas" value="${outrasDespesas || ''}" /></label>
      </div>
      <div class="nfe-impostos-topo">
        <button type="button" class="secondary" data-previa-recalcular>Recalcular</button>
        ${previaCarregando ? '<span class="muted">Calculando…</span>' : ''}
      </div>
      ${previaAguardando ? `<p class="muted">${escapeHtml(previaAguardando)}</p>` : ''}
      ${previaErro ? `<p class="form-error">${escapeHtml(previaErro)}</p>` : ''}
      <table class="data-table nfe-totais">
        <tbody>
          ${linha('Produtos', t ? t.produtos : undefined)}
          ${linha('Frete', t ? t.frete : undefined)}
          ${linha('Seguro', t ? t.seguro : undefined)}
          ${linha('Desconto', t ? t.desconto : undefined)}
          ${linha('Outras despesas', t ? t.outrasDespesas : undefined)}
          ${linha('Base do ICMS', t ? t.baseIcms : undefined)}
          ${linha('ICMS', t ? t.icms : undefined)}
          ${linha('Base do ICMS-ST', t ? t.baseIcmsSt : undefined)}
          ${linha('ICMS-ST', t ? t.icmsSt : undefined)}
          ${linha('IPI', t ? t.ipi : undefined)}
          ${linha('PIS', t ? t.pis : undefined)}
          ${linha('COFINS', t ? t.cofins : undefined)}
          ${linha('IBS', t ? t.ibs : undefined)}
          ${linha('CBS', t ? t.cbs : undefined)}
          ${linha('Total da nota', t ? t.total : undefined, true)}
        </tbody>
      </table>`;
    devolverFoco();
  }

  // Cada pedido de prévia ganha um número: com os blocos se refazendo sozinhos,
  // a resposta de um pedido antigo não sobrescreve a de um mais novo.
  let pedidoDePrevia = 0;
  async function carregarPrevia() {
    const form = document.getElementById('nfeFocusForm');
    if (!form) return;
    const este = ++pedidoDePrevia;
    // NOTA AINDA INCOMPLETA não é erro (15/10/2026): com os blocos à vista, a
    // falta do emitente, do item ou do destinatário aparecia em vermelho numa
    // nota recém-aberta. Sem eles o servidor nem calcula; o bloco diz o que
    // falta, discreto, e a prévia sai quando chegarem.
    const destino = new FormData(form);
    const falta = !selectedEstabelecimentoId
      ? 'Escolha o emitente para calcular os impostos.'
      : (!itens.some((item) => Number(item.quantidade) > 0 && Number(item.valorUnitario) > 0)
        ? 'Inclua um item com quantidade e valor para calcular os impostos.'
        : (['destNome', 'destDocumento', 'destUf'].some((campo) => !String(destino.get(campo) || '').trim())
          ? 'Preencha nome, documento e UF do destinatário para calcular os impostos.'
          : ''));
    if (falta) {
      previa = null;
      previaErro = '';
      previaAguardando = falta;
      previaCarregando = false;
      renderImpostos(); renderTotais();
      return;
    }
    previaAguardando = '';
    const formData = new FormData(form);
    const chave = String(formData.get('devolucaoChave') || '').replace(/\D/g, '');
    const referencias = formData.get('tipoOperacao') === 'DEVOLUCAO' && chave.length === 44 ? [{ chaveAcesso: chave }] : undefined;
    previaCarregando = true;
    renderImpostos(); renderTotais();
    try {
      const [resposta, tabelas] = await Promise.all([
        api('/api/fiscal/nfe/previa', { method: 'POST', body: JSON.stringify(montarCorpoDaNota(formData, referencias)) }),
        tabelasFiscais ? tabelasFiscais : api('/api/fiscal/tabelas').catch(() => null)
      ]);
      if (este !== pedidoDePrevia) return;
      previa = resposta;
      if (tabelas && tabelas.disponivel !== false) tabelasFiscais = tabelas;
      previaErro = '';
    } catch (erro) {
      if (este !== pedidoDePrevia) return;
      previaErro = erro.message || 'Não consegui calcular os impostos.';
    } finally {
      if (este === pedidoDePrevia) {
        previaCarregando = false;
        renderImpostos(); renderTotais();
      }
    }
  }

  /**
   * Grava UM valor fiscal num item, como a pessoa digitou. Única regra para o
   * campo do item e para a alteração em massa (14/10/2026): CST com 3 dígitos
   * é CSOSN; trocar o CST do IBS/CBS leva o cClassTrib junto; vazio volta ao
   * da regra fiscal.
   */
  function gravarCampoFiscal(item, linhaPrevia, campo, bruto) {
    item.fiscal = item.fiscal || {};
    const valor = String(bruto === undefined || bruto === null ? '' : bruto).trim();
    if (campo === 'cstIbsCbs') {
      // O cClassTrib começa pelo CST: trocar o CST leva o cClassTrib para o
      // primeiro código dele (se o atual não for daquele CST).
      const atual = String(valorFiscal(item, linhaPrevia, 'classTrib') || '');
      const doCst = codigosDoClassTrib(valor);
      if (valor && doCst.length && !atual.startsWith(valor)) item.fiscal.classTrib = String(doCst[0].codigo).trim();
      // CST sem código na tabela: o digitado de outro CST não fica valendo.
      else if (valor && !doCst.length && String(item.fiscal.classTrib || '') && !String(item.fiscal.classTrib).startsWith(valor)) delete item.fiscal.classTrib;
    }
    // A alíquota (ou a base) nova devolve ao cálculo o valor digitado antes.
    (RECALCULA[campo] || []).forEach((dependente) => { delete item.fiscal[dependente]; });
    if (campo === 'cstIcms') {
      // Três dígitos é CSOSN (Simples Nacional); dois é CST.
      delete item.fiscal.cstIcms; delete item.fiscal.csosn;
      if (valor) item.fiscal[valor.length === 3 ? 'csosn' : 'cstIcms'] = valor;
    } else if (valor === '') {
      delete item.fiscal[campo];
    } else {
      item.fiscal[campo] = CAMPOS_DE_TEXTO.includes(campo) ? valor : Number(valor);
    }
  }

  // ALTERAÇÃO EM MASSA (14/10/2026, pedido do usuário: "faça um botão para
  // alteração em massa de dados fiscais e impostos"). Os mesmos campos da aba,
  // menos base e valor (saem do servidor) e o ST retido (é de cada item, da
  // nota de entrada). Campo vazio não mexe; só os itens marcados mudam.
  const GRUPOS_EM_MASSA = GRUPOS_FISCAIS
    .filter((g) => !g.soComStRetido)
    .map((g) => ({ titulo: g.titulo, campos: g.campos.filter(([campo]) => !CAMPOS_CALCULADOS.includes(campo)) }))
    .filter((g) => g.campos.length);

  function campoEmMassa(campo, cstIbsCbsEscolhido) {
    if (campo === 'classTrib') {
      const opcoesClass = cstIbsCbsEscolhido ? opcoesDoClassTrib(cstIbsCbsEscolhido, '') : null;
      if (opcoesClass) return `<select data-massa-campo="classTrib">${opcoesClass.replace('>—</option>', '>— manter —</option>')}</select>`;
      return '<input data-massa-campo="classTrib" placeholder="manter" />';
    }
    const ehCst = campo === 'cstIcms' || campo in LISTA_DO_CST;
    const opcoes = ehCst ? opcoesDoCst(campo, '') : null;
    if (opcoes) return `<select data-massa-campo="${campo}">${opcoes.replace('>—</option>', '>— manter —</option>')}</select>`;
    return `<input data-massa-campo="${campo}" ${CAMPOS_DE_TEXTO.includes(campo) ? '' : 'type="number" step="0.01"'} placeholder="manter" />`;
  }

  function abrirAlteracaoEmMassa() {
    document.getElementById('nfeMassaModal')?.remove();
    const overlay = document.createElement('div');
    overlay.id = 'nfeMassaModal';
    overlay.className = 'modal-overlay';
    const nomeDoItem = (item, index) => String(item.descricao || (previa && previa.itens[index] && previa.itens[index].descricao) || '');
    overlay.innerHTML = `
      <div class="modal nfe-massa-modal" role="dialog" aria-modal="true" aria-labelledby="nfeMassaTitulo">
        <div class="modal-body">
          <h4 class="prompt-titulo" id="nfeMassaTitulo">Alterar impostos em massa</h4>
          <fieldset class="nfe-massa-itens">
            <legend>Itens</legend>
            <label class="nfe-massa-todos"><input type="checkbox" data-massa-todos checked /> Todos (${itens.length})</label>
            ${itens.map((item, index) => `
              <label><input type="checkbox" data-massa-item="${index}" checked /> Item ${index + 1} — ${escapeHtml(nomeDoItem(item, index))}</label>`).join('')}
          </fieldset>
          ${GRUPOS_EM_MASSA.map((g) => `
            <div class="nfe-imposto-grupo">
              <span class="nfe-imposto-titulo">${g.titulo}</span>
              <div class="nfe-imposto-campos">
                ${g.campos.map(([campo, rotulo]) => `<label>${rotulo}<span data-massa-caixa="${campo}">${campoEmMassa(campo, '')}</span></label>`).join('')}
              </div>
            </div>`).join('')}
        </div>
        <div class="modal-actions">
          <button type="button" class="btn btn-muted" data-massa-acao="cancelar">Cancelar</button>
          <button type="button" class="btn btn-muted" data-massa-acao="regra">Usar o da regra nos marcados</button>
          <button type="button" class="btn btn-primary" data-massa-acao="aplicar">Aplicar</button>
        </div>
      </div>`;
    const fechar = () => { overlay.remove(); document.removeEventListener('keydown', aoTeclar); };
    const aoTeclar = (e) => { if (e.key === 'Escape') fechar(); };
    document.addEventListener('keydown', aoTeclar);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) fechar(); });
    const marcados = () => [...overlay.querySelectorAll('[data-massa-item]')].filter((c) => c.checked).map((c) => Number(c.dataset.massaItem));
    overlay.querySelector('[data-massa-todos]').addEventListener('change', (e) => {
      overlay.querySelectorAll('[data-massa-item]').forEach((c) => { c.checked = e.target.checked; });
    });
    overlay.querySelectorAll('[data-massa-item]').forEach((c) => c.addEventListener('change', () => {
      const todos = overlay.querySelectorAll('[data-massa-item]');
      overlay.querySelector('[data-massa-todos]').checked = [...todos].every((x) => x.checked);
    }));
    // O cClassTrib segue o CST do IBS/CBS escolhido aqui, como no item.
    overlay.addEventListener('change', (e) => {
      if (e.target.dataset.massaCampo !== 'cstIbsCbs') return;
      const caixa = overlay.querySelector('[data-massa-caixa="classTrib"]');
      if (caixa) caixa.innerHTML = campoEmMassa('classTrib', String(e.target.value || '').trim());
    });
    overlay.querySelector('[data-massa-acao=cancelar]').addEventListener('click', fechar);
    overlay.querySelector('[data-massa-acao=regra]').addEventListener('click', () => {
      const lista = marcados();
      if (!lista.length) { showToast('Marque ao menos um item.', 'warning'); return; }
      lista.forEach((i) => { if (itens[i]) itens[i].fiscal = {}; });
      fechar();
      showToast(`${lista.length} item(ns) voltaram ao que a regra fiscal dá.`, 'success');
      carregarPrevia();
    });
    overlay.querySelector('[data-massa-acao=aplicar]').addEventListener('click', () => {
      const lista = marcados();
      if (!lista.length) { showToast('Marque ao menos um item.', 'warning'); return; }
      // A ordem importa: o CST do IBS/CBS antes do cClassTrib, senão a troca de
      // CST desfaria o cClassTrib escolhido aqui.
      const preenchidos = [...overlay.querySelectorAll('[data-massa-campo]')]
        .map((el) => [el.dataset.massaCampo, String(el.value || '').trim()])
        .filter(([, v]) => v !== '')
        .sort(([a], [b]) => (a === 'classTrib') - (b === 'classTrib'));
      if (!preenchidos.length) { showToast('Preencha ao menos um campo para aplicar.', 'warning'); return; }
      lista.forEach((i) => {
        const item = itens[i];
        if (!item) return;
        const linha = previa && previa.itens ? previa.itens[i] : null;
        preenchidos.forEach(([campo, valor]) => gravarCampoFiscal(item, linha, campo, valor));
      });
      fechar();
      showToast(`${preenchidos.length} campo(s) aplicado(s) em ${lista.length} item(ns).`, 'success');
      carregarPrevia();
    });
    document.body.appendChild(overlay);
    overlay.querySelector('[data-massa-campo]')?.focus();
  }

  function ligarImpostosETotais() {
    const impostos = document.getElementById('nfeFocusImpostos');
    const totais = document.getElementById('nfeFocusTotais');
    [impostos, totais].forEach((caixa) => caixa && caixa.addEventListener('click', (evento) => {
      const abaDoItem = evento.target.closest('[data-imposto-item]');
      const abaDoGrupo = evento.target.closest('[data-imposto-grupo]');
      if (abaDoGrupo) {
        abaGrupoImposto = abaDoGrupo.dataset.impostoGrupo;
        renderImpostos();
        return;
      }
      if (abaDoItem) {
        // Trocar de item só redesenha: a prévia já tem todos.
        abaImpostoDoItem = Number(abaDoItem.dataset.impostoItem) || 0;
        renderImpostos();
        return;
      }
      if (evento.target.closest('[data-fiscal-massa]')) {
        abrirAlteracaoEmMassa();
        return;
      }
      const botao = evento.target.closest('[data-previa-recalcular], [data-fiscal-limpar]');
      if (!botao) return;
      if (botao.dataset.fiscalLimpar !== undefined) itens[Number(botao.dataset.fiscalLimpar)].fiscal = {};
      carregarPrevia();
    }));
    impostos && impostos.addEventListener('change', (evento) => {
      const campo = evento.target.dataset.fiscalCampo;
      if (!campo) return;
      const indice = Number(evento.target.dataset.fiscalIndex);
      const item = itens[indice];
      if (!item) return;
      gravarCampoFiscal(item, previa && previa.itens ? previa.itens[indice] : null, campo, evento.target.value);
      evento.target.closest('label')?.classList.toggle('is-editado', editado(item, campo));
      // Refaz a prévia: mostra o que o CST ou o percentual novo dão, e o total
      // da nota com a base e o valor digitados (eles valem no servidor).
      carregarPrevia();
    });
    // A cada tecla, como os itens (16/10/2026): só na saída do campo, o "Valor
    // total" ficava com o frete antigo enquanto se digitava o novo.
    totais && totais.addEventListener('input', (evento) => {
      const campo = evento.target.dataset.totalCampo;
      if (!campo) return;
      const valor = Math.max(0, Number(evento.target.value || 0));
      if (campo === 'frete') frete = valor;
      if (campo === 'seguro') seguro = valor;
      if (campo === 'desconto') desconto = valor;
      if (campo === 'outrasDespesas') outrasDespesas = valor;
      // Atualiza o total à vista e refaz prévia, modalidade do frete e
      // duplicatas (os blocos estão todos na página).
      refreshGrandTotal();
    });
  }

  // ------------------------------------------------------------ aba Transporte
  //
  // Grupo transp da NF-e (13/10/2026): modalidade, transportadora, veículo e
  // volumes. Nomes da Focus conferidos em campos.focusnfe.com.br; quem os
  // monta é grupoTransporte, no servidor.
  const MODALIDADES_FRETE = [
    [0, '0 — Contratação por conta do remetente (CIF)'],
    [1, '1 — Contratação por conta do destinatário (FOB)'],
    [2, '2 — Contratação por conta de terceiros'],
    [3, '3 — Transporte próprio por conta do remetente'],
    [4, '4 — Transporte próprio por conta do destinatário'],
    [9, '9 — Sem ocorrência de transporte']
  ];
  const CAMPOS_TRANSPORTADOR = [
    ['documento', 'CPF/CNPJ'], ['nome', 'Nome / Razão social'], ['inscricaoEstadual', 'Inscrição estadual'],
    ['endereco', 'Endereço'], ['municipio', 'Município'], ['uf', 'UF']
  ];
  const CAMPOS_VOLUME = [
    ['quantidade', 'Qtd.', 'type="number" step="1" min="0"'], ['especie', 'Espécie', ''], ['marca', 'Marca', ''],
    ['numero', 'Numeração', ''], ['pesoLiquido', 'Peso líq. (kg)', 'type="number" step="0.001" min="0"'],
    ['pesoBruto', 'Peso bruto (kg)', 'type="number" step="0.001" min="0"']
  ];

  // Declarada com `function` de propósito: a carga do pedido a chama antes
  // desta linha. Só lê `meta` e `transporte`, que já existem lá.
  function escolherTransportadora(id) {
    transportadoraId = id || '';
    const t = (meta.transportadoras || []).find((c) => c.id === id);
    if (!t) return;
    Object.assign(transporte.transportador, {
      documento: t.document || '',
      nome: t.name || '',
      inscricaoEstadual: window.MavisInscricaoEstadual.paraNota(t.stateRegistration) || '',
      endereco: t.endereco || '',
      municipio: t.city || '',
      uf: t.state || ''
    });
  }

  /** O grupo que vai no corpo, ou null quando nada foi preenchido. */
  function transporteDaNota() {
    const preenchidos = (obj) => Object.fromEntries(Object.entries(obj).filter(([, v]) => String(v ?? '').trim()));
    const tr = preenchidos(transporte.transportador);
    const ve = preenchidos(transporte.veiculo);
    const volumes = transporte.volumes.filter((vol) => Object.keys(preenchidos(vol)).length);
    if (!Object.keys(tr).length && !Object.keys(ve).length && !volumes.length) return null;
    return {
      ...(Object.keys(tr).length ? { transportador: tr } : {}),
      ...(Object.keys(ve).length ? { veiculo: ve } : {}),
      ...(volumes.length ? { volumes } : {})
    };
  }

  function renderTransporte() {
    const caixa = document.getElementById('nfeFocusTransporte');
    if (!caixa) return;
    const devolverFoco = guardarFoco(caixa);
    const modalidade = modalidadeEscolhida === undefined ? (frete > 0 ? 0 : 9) : modalidadeEscolhida;
    const transportadoras = meta.transportadoras || [];
    const campo = (rotulo, attrs, valor) => `<label>${rotulo}<input ${attrs} value="${escapeHtml(String(valor ?? ''))}" /></label>`;
    caixa.innerHTML = `
      <div class="row">
        <label>Modalidade do frete
          <select data-transporte-modalidade>
            ${MODALIDADES_FRETE.map(([v, rotulo]) => `<option value="${v}" ${v === modalidade ? 'selected' : ''}>${rotulo}</option>`).join('')}
          </select>
        </label>
        <label>Transportadora
          <select data-transporte-cadastro>
            <option value="">Preencher manualmente</option>
            ${transportadoras.map((t) => `<option value="${escapeHtml(t.id)}" ${t.id === transportadoraId ? 'selected' : ''}>${escapeHtml(t.name)}</option>`).join('')}
          </select>
        </label>
      </div>
      <div class="cadastro-section">
        <div class="cadastro-section-header"><h4>Transportador</h4></div>
        <div class="cadastro-section-body nfe-transporte-campos">
          ${CAMPOS_TRANSPORTADOR.map(([nome, rotulo]) => campo(rotulo, `data-transportador="${nome}"${nome === 'uf' ? ' maxlength="2"' : ''}`, transporte.transportador[nome])).join('')}
        </div>
      </div>
      <div class="cadastro-section">
        <div class="cadastro-section-header"><h4>Veículo</h4></div>
        <div class="cadastro-section-body nfe-transporte-campos">
          ${campo('Placa', 'data-veiculo="placa" maxlength="8"', transporte.veiculo.placa)}
          ${campo('UF', 'data-veiculo="uf" maxlength="2"', transporte.veiculo.uf)}
          ${campo('RNTC (ANTT)', 'data-veiculo="rntc" maxlength="20"', transporte.veiculo.rntc)}
        </div>
      </div>
      <div class="cadastro-section">
        <div class="cadastro-section-header"><h4>Volumes</h4></div>
        <div class="cadastro-section-body">
          <div class="table-scroll">
            <table class="data-table nfe-volumes">
              <thead><tr>${CAMPOS_VOLUME.map(([, rotulo]) => `<th>${rotulo}</th>`).join('')}<th></th></tr></thead>
              <tbody>
                ${transporte.volumes.map((vol, i) => `<tr>
                  ${CAMPOS_VOLUME.map(([nome, , attrs]) => `<td><input ${attrs} data-volume-index="${i}" data-volume-campo="${nome}" value="${escapeHtml(String(vol[nome] ?? ''))}" /></td>`).join('')}
                  <td><button type="button" class="secondary" data-volume-remover="${i}">Remover</button></td>
                </tr>`).join('')}
              </tbody>
            </table>
          </div>
          <div style="margin-top: 8px;"><button type="button" class="secondary" data-volume-adicionar>+ Adicionar volume</button></div>
        </div>
      </div>`;
    devolverFoco();
  }

  function ligarTransporte() {
    const caixa = document.getElementById('nfeFocusTransporte');
    if (!caixa) return;
    caixa.addEventListener('change', (evento) => {
      const alvo = evento.target;
      if (alvo.matches('[data-transporte-modalidade]')) modalidadeEscolhida = Number(alvo.value);
      if (alvo.matches('[data-transporte-cadastro]')) {
        if (alvo.value) escolherTransportadora(alvo.value);
        else transportadoraId = '';
        renderTransporte();
      }
    });
    caixa.addEventListener('input', (evento) => {
      const alvo = evento.target;
      if (alvo.dataset.transportador) transporte.transportador[alvo.dataset.transportador] = alvo.value;
      if (alvo.dataset.veiculo) transporte.veiculo[alvo.dataset.veiculo] = alvo.value;
      if (alvo.dataset.volumeCampo) {
        const vol = transporte.volumes[Number(alvo.dataset.volumeIndex)];
        if (vol) vol[alvo.dataset.volumeCampo] = alvo.value;
      }
    });
    caixa.addEventListener('click', (evento) => {
      const alvo = evento.target;
      if (alvo.matches('[data-volume-adicionar]')) {
        transporte.volumes.push({ quantidade: '', especie: '', marca: '', numero: '', pesoLiquido: '', pesoBruto: '' });
        renderTransporte();
      } else if (alvo.dataset.volumeRemover !== undefined) {
        transporte.volumes.splice(Number(alvo.dataset.volumeRemover), 1);
        renderTransporte();
      }
    });
  }

  // ------------------------------------------- cobrança (aba Pagamento)
  //
  // Grupo cobr da NF-e: fatura e duplicatas. O número de cada duplicata
  // ("001", "002"...) quem dá é o servidor (grupoCobranca); aqui só vencimento
  // e valor. Na nota avulsa, as mesmas parcelas viram o contas a receber.
  const FORMAS_DE_CARTAO = ['03', '04'];

  function hojeLocal() {
    const agora = new Date();
    return new Date(agora.getTime() - agora.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  }

  function somarDias(iso, dias) {
    const d = new Date(`${iso}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + dias);
    return d.toISOString().slice(0, 10);
  }

  /**
   * As duplicatas que as parcelas pedem. Do pedido: as linhas a PRAZO
   * (vencimento depois de hoje), menos cartão — o cartão quem paga é a
   * credenciadora, não o cliente. Da avulsa: o parcelamento escolhido, na
   * mesma divisão do contas a receber (centavos na última).
   */
  function duplicatasSugeridas() {
    const hoje = hojeLocal();
    if (pagamentosDoPedido.length) {
      return pagamentosDoPedido
        .filter((linha) => String(linha.vencimento || '') > hoje && !FORMAS_DE_CARTAO.includes(linha.forma))
        .map((linha) => ({ vencimento: linha.vencimento, valor: Number(linha.valor || 0) }));
    }
    const form = document.getElementById('nfeFocusForm');
    if (!form || (form.querySelector('[name="paymentType"]') || {}).value !== 'parcelado') return [];
    const quantas = Math.min(60, Math.max(2, Math.round(Number(form.querySelector('[name="installmentsCount"]')?.value || 2))));
    const intervalo = Math.max(1, Number(form.querySelector('[name="installmentIntervalDays"]')?.value || 30));
    const total = grandTotal();
    const parte = Math.floor((total / quantas) * 100) / 100;
    return Array.from({ length: quantas }, (_, i) => ({
      vencimento: somarDias(hoje, intervalo * (i + 1)),
      valor: i === quantas - 1 ? Math.round((total - parte * (quantas - 1)) * 100) / 100 : parte
    }));
  }

  function atualizarCobrancaSugerida() {
    if (!cobrancaEditada) cobranca.duplicatas = duplicatasSugeridas();
    renderCobranca();
  }

  function somaDasDuplicatas() {
    return Math.round(cobranca.duplicatas.reduce((soma, d) => soma + Number(d.valor || 0), 0) * 100) / 100;
  }

  /** O grupo que vai no corpo, ou null quando não há parcela. */
  function cobrancaDaNota() {
    const duplicatas = cobranca.duplicatas.filter((d) => Number(d.valor || 0) > 0);
    if (!duplicatas.length) return null;
    return {
      numeroFatura: cobranca.numeroFatura,
      valorDesconto: Number(cobranca.valorDesconto || 0),
      duplicatas: duplicatas.map((d) => ({ vencimento: d.vencimento, valor: Number(d.valor) }))
    };
  }

  function renderCobranca() {
    const caixa = document.getElementById('nfeFocusCobranca');
    if (!caixa) return;
    const devolverFoco = guardarFoco(caixa);
    const liquido = somaDasDuplicatas();
    const descontoFatura = Number(cobranca.valorDesconto || 0);
    caixa.innerHTML = `
      <div class="cadastro-section">
        <div class="cadastro-section-header"><h4>Cobrança (fatura e duplicatas)</h4></div>
        <div class="cadastro-section-body">
          <div class="nfe-transporte-campos">
            <label>Nº da fatura<input data-cobranca="numeroFatura" maxlength="60" value="${escapeHtml(cobranca.numeroFatura)}" /></label>
            <label>Desconto da fatura (R$)<input type="number" step="0.01" min="0" data-cobranca="valorDesconto" value="${descontoFatura || ''}" /></label>
            <label>Valor original<input readonly value="${financeFormatBRL(liquido + descontoFatura)}" /></label>
            <label>Valor líquido<input readonly value="${financeFormatBRL(liquido)}" /></label>
          </div>
          <div class="table-scroll">
            <table class="data-table nfe-duplicatas">
              <thead><tr><th>Nº</th><th>Vencimento</th><th>Valor (R$)</th><th></th></tr></thead>
              <tbody>
                ${cobranca.duplicatas.map((d, i) => `<tr>
                  <td>${String(i + 1).padStart(3, '0')}</td>
                  <td><input type="date" data-duplicata-index="${i}" data-duplicata-campo="vencimento" value="${escapeHtml(d.vencimento || '')}" /></td>
                  <td><input type="number" step="0.01" min="0" data-duplicata-index="${i}" data-duplicata-campo="valor" value="${d.valor === '' || d.valor === undefined ? '' : Number(d.valor)}" /></td>
                  <td><button type="button" class="secondary" data-duplicata-remover="${i}">Remover</button></td>
                </tr>`).join('')}
              </tbody>
            </table>
          </div>
          <div class="nfe-impostos-topo" style="margin-top: 8px;">
            <button type="button" class="secondary" data-duplicata-adicionar>+ Adicionar parcela</button>
            ${cobrancaEditada ? '<button type="button" class="secondary" data-duplicata-refazer>Refazer pelas parcelas</button>' : ''}
          </div>
          ${liquido > grandTotal() + 0.01 ? `<p class="form-error">As duplicatas somam ${financeFormatBRL(liquido)} e a nota tem ${financeFormatBRL(grandTotal())}.</p>` : ''}
        </div>
      </div>`;
    devolverFoco();
  }

  function ligarCobranca() {
    const caixa = document.getElementById('nfeFocusCobranca');
    if (!caixa) return;
    caixa.addEventListener('change', (evento) => {
      const alvo = evento.target;
      if (alvo.dataset.cobranca) {
        cobranca[alvo.dataset.cobranca] = alvo.dataset.cobranca === 'valorDesconto' ? Math.max(0, Number(alvo.value || 0)) : alvo.value;
        renderCobranca();
        return;
      }
      if (!alvo.dataset.duplicataCampo) return;
      const dup = cobranca.duplicatas[Number(alvo.dataset.duplicataIndex)];
      if (!dup) return;
      dup[alvo.dataset.duplicataCampo] = alvo.dataset.duplicataCampo === 'valor' ? Number(alvo.value || 0) : alvo.value;
      cobrancaEditada = true;
      renderCobranca();
    });
    caixa.addEventListener('click', (evento) => {
      const alvo = evento.target;
      if (alvo.matches('[data-duplicata-adicionar]')) {
        const ultima = cobranca.duplicatas[cobranca.duplicatas.length - 1];
        const resto = Math.max(0, Math.round((grandTotal() - somaDasDuplicatas()) * 100) / 100);
        cobranca.duplicatas.push({ vencimento: somarDias(ultima && ultima.vencimento ? ultima.vencimento : hojeLocal(), 30), valor: resto });
        cobrancaEditada = true;
      } else if (alvo.dataset.duplicataRemover !== undefined) {
        cobranca.duplicatas.splice(Number(alvo.dataset.duplicataRemover), 1);
        cobrancaEditada = true;
      } else if (alvo.matches('[data-duplicata-refazer]')) {
        cobrancaEditada = false;
        cobranca.duplicatas = duplicatasSugeridas();
      } else {
        return;
      }
      renderCobranca();
    });
  }

  // O CORPO DA NOTA, num lugar só (13/10/2026): o envio e a PRÉVIA da aba
  // Impostos mandam exatamente o mesmo — senão a prévia mostraria uma nota e o
  // botão transmitiria outra.
  function montarCorpoDaNota(formData, referenciasDevolucao) {
    return {
      estabelecimentoId: selectedEstabelecimentoId,
      tipoOperacao: formData.get('tipoOperacao'),
      ...(referenciasDevolucao ? { referencias: referenciasDevolucao } : {}),
      naturezaOperacao: formData.get('naturezaOperacao'),
      dataEmissao: formData.get('dataEmissao') ? new Date(formData.get('dataEmissao')).toISOString() : undefined,
      destinatario: {
        nome: formData.get('destNome'),
        documento: formData.get('destDocumento'),
        contribuinte: formData.get('destContribuinte') === 'on',
        inscricaoEstadual: formData.get('destIe'),
        cep: (formData.get('destCep') || '').replace(/\D/g, ''),
        logradouro: formData.get('destLogradouro'),
        numero: formData.get('destNumero'),
        complemento: formData.get('destComplemento'),
        bairro: formData.get('destBairro'),
        municipio: formData.get('destMunicipio'),
        uf: formData.get('destUf'),
        codigoMunicipio: formData.get('destCodigoMunicipio')
      },
      itens: itens.map((item) => ({
        // O servidor relê a classificação fiscal pelo produtoId e ignora o
        // que veio digitado — o que vai aqui é só o ponto de partida da tela.
        produtoId: item.produtoId || '',
        descricao: item.descricao,
        codigoProduto: item.codigoProduto,
        ncm: String(item.ncm || '').replace(/\D/g, ''),
        quantidade: Number(item.quantidade || 0),
        valorUnitario: Number(item.valorUnitario || 0),
        unidadeComercial: item.unidadeComercial || 'UN',
        origem: Number(item.origem || 0),
        // Só vai quando foi digitada. Mandar 0 para "não informado" faria o
        // servidor entender alíquota zero e emitir sem ICMS.
        ...(String(item.aliquotaIcms ?? '').trim() === '' ? {} : { aliquotaIcms: Number(item.aliquotaIcms) }),
        // Mesma regra: em branco não vai, para o motor cair no da regra
        // fiscal em vez de receber string vazia como "sem benefício".
        ...(String(item.codigoBeneficioFiscal ?? '').trim() === ''
          ? {}
          : { codigoBeneficioFiscal: String(item.codigoBeneficioFiscal).trim() }),
        // O que foi editado na aba Impostos (13/10/2026). Vence a regra fiscal
        // no servidor (lib/nfePayloadBuilder.js, regraComEdicao).
        ...(item.fiscal && Object.keys(item.fiscal).length ? { fiscal: { ...item.fiscal } } : {})
      })),
      // Grupo obrigatório do layout 4.0 — nota sem ele é rejeitada. Uma
      // parcela única com o total: o parcelamento é condição comercial e
      // vira contas a receber, não N formas de pagamento na nota.
      // AS LINHAS DO PEDIDO, quando há pedido. O select de forma única só
      // vale para a nota avulsa, que não tem pagamentos lançados em lugar
      // nenhum. Mandar "99 Outros" pelo total de uma venda paga em cartão e
      // dinheiro fecha o valor e mente sobre o meio de pagamento.
      // O CARTÃO VAI JUNTO (fase BW): methodId, bandeira, integração e
      // autorização. O CNPJ da credenciadora NÃO — quem o resolve é o
      // servidor, pelo methodId, no momento da emissão.
      pagamentos: pagamentosDoPedido.length
        ? pagamentosDoPedido.map((linha) => ({
          forma: linha.forma,
          valor: linha.valor,
          methodId: linha.methodId || '',
          ...(linha.integracao ? {
            bandeira: linha.bandeira || '',
            integracao: linha.integracao,
            autorizacao: linha.autorizacao || ''
          } : {})
        }))
        : [{ forma: formData.get('formaPagamento') || '99', valor: grandTotal() }],
      // Desconto, frete e despesas do pedido de origem (fase BQ). Sem eles a
      // nota sai pelo bruto dos itens e diverge da conta a receber.
      ...(desconto ? { desconto } : {}),
      ...(seguro ? { seguro } : {}),
      ...(frete ? { frete } : {}),
      // Fora do `...(frete ? ...)` de propósito: transporte próprio sem
      // cobrança tem vFrete zero e modFrete 3, e amarrar a modalidade ao
      // valor era metade do defeito da fase CY.
      ...(modalidadeEscolhida === undefined ? {} : { modalidadeFrete: modalidadeEscolhida }),
      ...(transporteDaNota() ? { transporte: transporteDaNota() } : {}),
      ...(cobrancaDaNota() ? { cobranca: cobrancaDaNota() } : {}),
      ...(outrasDespesas ? { outrasDespesas } : {}),
      // Com pedido de origem, o servidor NÃO gera contas a receber: quem
      // gerou foi o pedido, e um segundo recebível pelo mesmo valor só
      // apareceria quando a conciliação não fechasse.
      orderId: orderIdOrigem || undefined,
      // Sem pedido de origem, é isto que manda o servidor gerar o contas a
      // receber quando a SEFAZ autorizar.
      paymentType: formData.get('paymentType') || 'avista',
      installmentsCount: Number(formData.get('installmentsCount') || 1),
      installmentIntervalDays: Number(formData.get('installmentIntervalDays') || 30),
      // Vai para infCpl e sai impresso no DANFE. `observacoes` e não
      // formData: a aba pode estar fechada na hora do envio, e o valor do
      // campo já está guardado fora do HTML.
      informacoesAdicionais: observacoes
    };
  }

  function attachHandlers() {
    ligarImpostosETotais();
    ligarTransporte();
    renderTransporte();
    ligarCobranca();
    atualizarCobrancaSugerida();
    renderImpostos();
    renderTotais();
    // Com os blocos todos à vista, a prévia sai já no desenho (era ao abrir a
    // aba Impostos ou Totais). Depois, agendarBlocosDependentes a refaz.
    if (!ehComplemento()) carregarPrevia();
    // Destinatário (UF, contribuinte, IE) muda o imposto: refaz os dependentes.
    content.querySelector('[data-bloco="destinatario"]')?.addEventListener('change', agendarBlocosDependentes);

    // O BOTAO DE EMITIR MORRIA EM SILENCIO.
    //
    // Quando a tela era em abas, sete campos obrigatorios (nome, documento e o
    // endereco do destinatario) viviam numa aba escondida, e o navegador nao
    // conseguia mostrar a mensagem em campo invisivel: clicar em "Emitir NF-e"
    // nao produzia NADA (medido em 17/08/2026). Em blocos o campo esta na
    // pagina, mas o botao fica no topo e o campo pode estar longe dele.
    //
    // O evento `invalid` dispara para cada campo reprovado, na fase de captura,
    // ANTES de o navegador escolher de qual reclamar: aqui o bloco do campo vem
    // para a tela a tempo de a mensagem nativa aparecer sobre ele.
    let jaAbriuAbaInvalida = false;
    document.getElementById('nfeFocusForm')?.addEventListener('invalid', (evento) => {
      // So o primeiro interessa: e dele que o navegador vai reclamar.
      if (jaAbriuAbaInvalida) return;
      jaAbriuAbaInvalida = true;
      // O lote inteiro e sincrono; voltar ao laco de eventos rearma para a
      // proxima tentativa de emitir.
      setTimeout(() => { jaAbriuAbaInvalida = false; }, 0);
      const bloco = evento.target.closest('.nfe-bloco');
      bloco?.scrollIntoView({ block: 'start', behavior: 'smooth' });

      // E AVISA, sempre. A bolha nativa nem sempre aparece: os campos da tabela
      // de itens sao identificados por data-field e nao tem atributo name, e o
      // Chrome desiste deles com "An invalid form control with name='' is not
      // focusable" — no console, onde ninguem olha. Um toast dizendo o bloco
      // fecha o buraco, porque quem clicou em Emitir precisa saber por que a
      // nota nao saiu.
      const aba = bloco ? bloco.querySelector('.nfe-bloco-titulo')?.textContent : null;
      showToast(aba
        ? `Falta preencher em "${aba}" para emitir.`
        : 'Há campos obrigatórios em branco.', 'error');
      // Focar depois de rolar: e o que da ao navegador a chance de desenhar a
      // mensagem em cima do campo certo.
      if (typeof evento.target.focus === 'function') {
        setTimeout(() => { try { evento.target.focus(); } catch (_) { /* ignora */ } }, 0);
      }
    }, true);


    document.getElementById('nfeFocusEstabSelect')?.addEventListener('change', async (event) => {
      const anterior = padraoAtual();
      selectedEstabelecimentoId = event.target.value;
      // Trocar de emitente troca a mensagem padrão — mas SÓ se ela ainda era a
      // do emitente anterior. Sobrescrever um texto escrito à mão porque a
      // pessoa corrigiu o CNPJ apagaria o trabalho dela sem aviso. A observação
      // que veio do pedido continua no fim do texto: quem troca é a base.
      if (observacoes === anterior) observacoes = padraoAtual();
      await loadNotasRecentes();
      renderForm();
    });

    // A busca e a escolha do cliente num campo só (fase DS). O corpo do
    // `onSelect` é o do antigo `change` do <select>, linha por linha.
    if (typeof attachSearchableSelect === 'function') {
      attachSearchableSelect({ id: 'nfeFocusCliente', options: opcoesDoCliente, onSelect: escolherCliente });
    }
    // Mesmo motivo do campo de produto (ver segurarEnter): buscar não emite.
    document.getElementById('nfeFocusClienteInput')?.addEventListener('keydown', (evento) => {
      if (evento.key === 'Enter') evento.preventDefault();
    });

    function escolherCliente(id) {
      selectedClienteId = id;
      const found = meta.directory.find((c) => c.id === id);
      if (!found) return;
      const form = document.getElementById('nfeFocusForm');
      if (!form) return;
      form.querySelector('[name="destNome"]').value = found.name || '';
      form.querySelector('[name="destDocumento"]').value = found.document || '';
      form.querySelector('[name="destUf"]').value = found.state || '';
      form.querySelector('[name="destMunicipio"]').value = found.city || '';
      // Mesma regra da carga do pedido: IE só de contribuinte, e o checkbox
      // acompanha — antes ele ficava como estava, e a nota saía com IE de
      // não contribuinte, ou sem IE de contribuinte.
      form.querySelector('[name="destIe"]').value = window.MavisInscricaoEstadual.paraNota(found.stateRegistration) || '';
      form.querySelector('[name="destContribuinte"]').checked = window.MavisInscricaoEstadual.ehContribuinte(found.stateRegistration);
      // O ENDEREÇO DO CADASTRO (14/10/2026): CEP, rua, número, complemento,
      // bairro e IBGE vêm junto. Destinatário novo troca o endereço inteiro.
      // Cadastro com CEP e sem rua: a busca do CEP completa o resto.
      const e = found.endereco || {};
      const por = (nome, valor) => { const campo = form.querySelector(`[name="${nome}"]`); if (campo) campo.value = valor || ''; };
      por('destCep', e.cep);
      por('destLogradouro', e.logradouro);
      por('destNumero', e.numero);
      por('destComplemento', e.complemento);
      por('destBairro', e.bairro);
      if (e.municipio) por('destMunicipio', e.municipio);
      if (e.uf) por('destUf', e.uf);
      por('destCodigoMunicipio', e.codigoMunicipio);
      const cep = String(e.cep || '').replace(/\D/g, '');
      if (cep.length === 8 && !e.logradouro) buscarCep({ automatico: true });
      else ultimoCepConsultado = cep;
    }

    // O CEP PREENCHE O ENDEREÇO SOZINHO (14/10/2026). Só o botão consultava:
    // quem trocava o CEP do cadastro por outro (digitado ou colado) ficava com
    // o endereço antigo na nota. Com 8 dígitos novos, busca e SOBRESCREVE —
    // aqui o CEP novo é justamente a correção do endereço. O CEP que veio do
    // cadastro não dispara nada ao abrir a tela.
    let ultimoCepConsultado = (document.querySelector('#nfeFocusForm [name="destCep"]')?.value || '').replace(/\D/g, '');
    async function buscarCep({ automatico = false } = {}) {
      const form = document.getElementById('nfeFocusForm');
      const cepInput = form.querySelector('[name="destCep"]');
      const cepDigits = (cepInput.value || '').replace(/\D/g, '');
      if (cepDigits.length !== 8) {
        if (!automatico) showToast('Informe um CEP com 8 dígitos.', 'warning');
        return;
      }
      ultimoCepConsultado = cepDigits;
      try {
        const res = await api(`/api/cep/${cepDigits}`);
        const addr = res.address;
        form.querySelector('[name="destLogradouro"]').value = addr.street || '';
        form.querySelector('[name="destBairro"]').value = addr.neighborhood || '';
        form.querySelector('[name="destMunicipio"]').value = addr.city || '';
        form.querySelector('[name="destUf"]').value = addr.state || '';
        form.querySelector('[name="destCodigoMunicipio"]').value = addr.ibgeCityCode || '';
        // O número e o complemento ficam com a pessoa: o CEP não os tem.
        form.querySelector('[name="destNumero"]')?.focus();
        showToast('Endereço encontrado.', 'success');
      } catch (error) {
        ultimoCepConsultado = '';
        showToast(error.message || 'CEP não encontrado.', 'error');
      }
    }
    document.getElementById('nfeFocusBuscarCep')?.addEventListener('click', () => buscarCep());
    document.querySelector('#nfeFocusForm [name="destCep"]')?.addEventListener('input', (evento) => {
      const digitos = String(evento.target.value || '').replace(/\D/g, '');
      if (digitos.length === 8 && digitos !== ultimoCepConsultado) buscarCep({ automatico: true });
    });
    // Cadastro com CEP e sem rua (nota vinda do pedido): a busca completa.
    if (ultimoCepConsultado.length === 8 && !String(document.querySelector('#nfeFocusForm [name="destLogradouro"]')?.value || '').trim()) {
      buscarCep({ automatico: true });
    }

    attachItemsHandlers();

    document.getElementById('nfeFocusAddItemBtn')?.addEventListener('click', () => {
      itens.push({ produtoId: '', descricao: '', codigoProduto: '', ncm: '', quantidade: 1, valorUnitario: 0, unidadeComercial: 'UN', origem: 0, aliquotaIcms: '', codigoBeneficioFiscal: '' });
      refreshItemsTable();
    });

    // Os campos de parcela só existem quando "Parcelado" está escolhido —
    // pedir número de parcelas para uma venda à vista é ruído.
    document.getElementById('nfeFocusPaymentType')?.addEventListener('change', (evento) => {
      document.getElementById('nfeFocusInstallmentFields')
        ?.classList.toggle('hidden', evento.target.value !== 'parcelado');
      atualizarCobrancaSugerida();
    });
    // Número de parcelas e intervalo refazem as duplicatas enquanto ninguém as editou.
    document.getElementById('nfeFocusInstallmentFields')?.addEventListener('change', atualizarCobrancaSugerida);

    // Trocar de operação redesenha a tela: no complemento não há aba de itens
    // nem de pagamento, e há uma de nota original. Esconder por CSS deixaria
    // campos `required` invisíveis travando o submit sem dizer onde.
    document.querySelector('[name="tipoOperacao"]')?.addEventListener('change', (evento) => {
      tipoOperacao = evento.target.value;
      renderForm();
    });

    // ICMS = base × alíquota, recalculado a cada digitação — mas o campo do
    // valor continua editável: o complemento pode ser uma diferença apurada,
    // que não sai de uma multiplicação simples.
    const recalcularIcms = () => {
      const form = document.getElementById('nfeFocusForm');
      if (!form) return;
      const base = Number(form.querySelector('[name="complementoBase"]')?.value || 0);
      const aliquota = Number(form.querySelector('[name="complementoAliquota"]')?.value || 0);
      const campoValor = form.querySelector('[name="complementoValor"]');
      if (!campoValor) return;
      complemento.baseIcms = base;
      complemento.aliquota = aliquota;
      const calculado = Math.round(((base * aliquota) / 100 + Number.EPSILON) * 100) / 100;
      complemento.valorIcms = calculado;
      campoValor.value = calculado ? calculado.toFixed(2) : '';
    };
    document.querySelector('[name="complementoBase"]')?.addEventListener('input', recalcularIcms);
    document.querySelector('[name="complementoAliquota"]')?.addEventListener('input', recalcularIcms);
    document.querySelector('[name="complementoValor"]')?.addEventListener('input', (evento) => {
      complemento.valorIcms = Number(evento.target.value || 0);
    });

    // Texto sugerido das informações complementares, montado a partir da nota
    // original. Para de se atualizar assim que o usuário escreve algo — o que
    // ele digitou vale mais do que a sugestão.
    const atualizarTextoComplemento = () => {
      const form = document.getElementById('nfeFocusForm');
      const campo = form?.querySelector('[name="complementoInformacoes"]');
      if (!campo || informacoesEditadas) return;
      const chave = (form.querySelector('[name="complementoChave"]')?.value || '').replace(/\D/g, '');
      const numero = form.querySelector('[name="complementoNumero"]')?.value || '';
      const serie = form.querySelector('[name="complementoSerie"]')?.value || '';
      const partes = [];
      if (numero) partes.push(`Nº ${numero}`);
      if (serie) partes.push(`SÉRIE ${serie}`);
      if (chave) partes.push(`CHAVE DE ACESSO ${chave}`);
      campo.value = `NF-E COMPLEMENTAR DE ICMS REFERENTE À NF-E${partes.length ? ' ' + partes.join(', ') : ''}. `
        + 'COMPLEMENTO DO VALOR DO ICMS NÃO DESTACADO NA NF-E ORIGINAL.';
      complemento.informacoes = campo.value;
    };
    ['complementoChave', 'complementoNumero', 'complementoSerie'].forEach((nome) => {
      document.querySelector(`[name="${nome}"]`)?.addEventListener('input', (evento) => {
        complemento[nome.replace('complemento', '').toLowerCase()] = evento.target.value;
        atualizarTextoComplemento();
      });
    });
    document.querySelector('[name="complementoInformacoes"]')?.addEventListener('input', (evento) => {
      informacoesEditadas = true;
      complemento.informacoes = evento.target.value;
    });

    // --- Observações adicionais da nota comum -------------------------------
    // Contador e lista de pendências atualizados a cada tecla: descobrir
    // "CHASSI:" em branco ou 5001 caracteres só na resposta da SEFAZ é caro —
    // nota autorizada não se corrige, se cancela dentro do prazo.
    const campoObs = document.getElementById('nfeFocusObservacoes');
    const atualizarAvisosObs = () => {
      if (!campoObs || !TextoPadrao) return;
      const texto = campoObs.value;
      const contador = document.getElementById('nfeFocusObsContador');
      const pendentes = document.getElementById('nfeFocusObsPendentes');
      if (contador) {
        const orcamento = orcamentoDasObservacoes();
        // Quando o orçamento é menor que o limite, dizer POR QUÊ: um contador
        // que para em 4919 sem explicação parece defeito.
        const porque = orcamento < TextoPadrao.LIMITE_INFCPL
          ? ` (a SEFAZ aceita ${TextoPadrao.LIMITE_INFCPL}; ${motivoDoOrcamentoMenor()})`
          : '';
        contador.textContent = `${texto.length} de ${orcamento} caracteres${porque}`;
        contador.classList.toggle('finance-negative', texto.length > orcamento);
      }
      if (pendentes) {
        const vazios = TextoPadrao.camposVazios(texto);
        pendentes.textContent = vazios.length
          ? `Ainda em branco: ${vazios.join(', ')}. Dá para emitir assim, mas o DANFE sai com o campo vazio.`
          : '';
        pendentes.classList.toggle('finance-negative', vazios.length > 0);
      }
    };
    campoObs?.addEventListener('input', () => {
      observacoes = campoObs.value;
      atualizarAvisosObs();
      // O texto pode ter sido editado à mão: o campo de cima segue o que está
      // escrito, senão os dois passariam a dizer coisas diferentes.
      const campoChassi = document.getElementById('nfeFocusChassi');
      if (campoChassi && TextoPadrao) campoChassi.value = TextoPadrao.chassiDoTexto(observacoes);
    });
    atualizarAvisosObs();

    // O nome do destinatário entra no aviso de teste de homologação, então
    // digitá-lo MUDA quantos caracteres sobram para as observações. Sem este
    // ouvinte o contador só acertaria depois de a pessoa voltar à aba de
    // Observações e digitar alguma coisa. Trocar de emitente não precisa de
    // ouvinte: aquele caminho já chama renderForm().
    document.querySelector('[name="destNome"]')?.addEventListener('input', atualizarAvisosObs);

    // O campo escreve na linha "CHASSI:" do texto, sem tocar no resto — o
    // operador pode ter editado as observações antes, e remontar do modelo
    // apagaria essas edições sem avisar.
    document.getElementById('nfeFocusChassi')?.addEventListener('input', (evento) => {
      if (!campoObs || !TextoPadrao) return;
      observacoes = TextoPadrao.comChassi(campoObs.value, evento.target.value);
      campoObs.value = observacoes;
      atualizarAvisosObs();
    });

    document.getElementById('nfeFocusObsRestaurar')?.addEventListener('click', () => {
      if (!campoObs) return;
      observacoes = observacoesIniciais;
      campoObs.value = observacoes;
      atualizarAvisosObs();
      showToast(orderIdOrigem ? 'Texto restaurado com os dados do pedido.' : 'Texto padrão restaurado.', 'success');
    });
    if (ehComplemento()) atualizarTextoComplemento();

    document.getElementById('nfeFocusSalvarRascunho')?.addEventListener('click', (e) => salvarNotaEmEdicao(e.currentTarget));
    document.getElementById('nfeFocusVisualizar')?.addEventListener('click', (e) => visualizarNota(e.currentTarget));
    document.getElementById('nfeFocusDescartarRascunho')?.addEventListener('click', (e) => descartarNotaSalva(e.currentTarget));

    document.getElementById('nfeFocusForm')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!selectedEstabelecimentoId) {
        showToast('Selecione o estabelecimento emitente.', 'warning');
        return;
      }
      const submitBtn = document.getElementById('nfeFocusSubmitBtn');
      if (submitBtn?.disabled) return;
      if (submitBtn) submitBtn.disabled = true;

      const formData = new FormData(event.target);

      // A NOTA COMPLEMENTAR TEM OUTRA FORMA.
      //
      // Um único item escritural, quantidade e valor zerados, o ICMS carregado
      // por fora e a chave da original referenciada. Nada de itens da tabela,
      // nada de pagamento: não há mercadoria nem recebível.
      if (ehComplemento()) {
        const chave = String(formData.get('complementoChave') || '').replace(/\D/g, '');
        const valorIcms = Number(formData.get('complementoValor') || 0);
        // Barrado aqui só para poupar a viagem: quem realmente valida é o
        // servidor, que a aba fechada não some.
        if (chave.length !== 44) {
          showToast('Informe a chave de acesso da NF-e original (44 dígitos).', 'error');
          if (submitBtn) submitBtn.disabled = false;
          return;
        }
        if (!(valorIcms > 0)) {
          showToast('Informe o valor do ICMS a complementar.', 'error');
          if (submitBtn) submitBtn.disabled = false;
          return;
        }
        const corpo = {
          estabelecimentoId: selectedEstabelecimentoId,
          tipoOperacao: NFE_FOCUS_COMPLEMENTO,
          naturezaOperacao: formData.get('naturezaOperacao') || 'Complemento de ICMS',
          dataEmissao: formData.get('dataEmissao') ? new Date(formData.get('dataEmissao')).toISOString() : undefined,
          destinatario: lerDestinatario(formData),
          referencias: [{ chaveAcesso: chave }],
          // O servidor resolve o produto escritural pelo SKU e recusa se ele
          // não for escritural — não dá para mandar uma mercadoria disfarçada.
          itens: [{
            produtoEscritural: 'CFOP5.949',
            quantidade: 0,
            valorUnitario: 0,
            baseIcms: Number(formData.get('complementoBase') || 0),
            aliquotaIcms: Number(formData.get('complementoAliquota') || 0),
            valorIcms
          }],
          informacoesAdicionais: formData.get('complementoInformacoes') || '',
          // A nota com erro que esta corrige: o servidor a reenvia no mesmo
          // registro, em vez de criar outra (15/10/2026).
          corrigeNfeId: corrigindoNfe ? corrigindoNfe.id : undefined
        };
        try {
          const result = await api('/api/fiscal/nfe/emitir', { method: 'POST', body: JSON.stringify(corpo) });
          ultimoResultado = result.nfe;
          showToast(`NF-e complementar ${result.nfe.status === 'AUTORIZADO' ? 'autorizada' : String(result.nfe.status).toLowerCase()}.`,
            result.nfe.status === 'ERRO' ? 'error' : 'success');
        } catch (error) {
          showToast(error.message || 'Erro ao emitir a NF-e complementar.', 'error');
        } finally {
          if (submitBtn) submitBtn.disabled = false;
          await loadNotasRecentes();
          renderForm();
        }
        return;
      }

      // Estourar o limite de infCpl não dá erro de digitação — dá REJEIÇÃO
      // depois de transmitir, com a numeração já consumida. Barra aqui.
      //
      // Contra o ORÇAMENTO, e não contra o limite bruto: em homologação o aviso
      // de teste ocupa parte do campo. O servidor confere a string final, que é
      // a palavra final; isto aqui existe para o erro aparecer antes do clique.
      // A SEFAZ confere vPag contra vNF. Barrar aqui poupa a viagem; o
      // servidor confere de novo, e é ele a palavra final.
      if (pagamentosDoPedido.length && somaDosPagamentos() !== grandTotal()) {
        showToast(
          `Os pagamentos do pedido somam ${financeFormatBRL(somaDosPagamentos())} e a nota tem `
          + `${financeFormatBRL(grandTotal())}. Corrija os pagamentos do pedido antes de emitir.`,
          'error'
        );
        if (submitBtn) submitBtn.disabled = false;
        return;
      }
      const orcamentoObs = TextoPadrao ? orcamentoDasObservacoes() : Infinity;
      if (observacoes.length > orcamentoObs) {
        const extra = orcamentoObs < TextoPadrao.LIMITE_INFCPL
          ? ` (a SEFAZ aceita ${TextoPadrao.LIMITE_INFCPL}; ${motivoDoOrcamentoMenor()})`
          : '';
        showToast(`As observações têm ${observacoes.length} caracteres; cabem ${orcamentoObs}${extra}.`, 'error');
        if (submitBtn) submitBtn.disabled = false;
        return;
      }

      // DEVOLUÇÃO REFERENCIA A NOTA DEVOLVIDA. O servidor exige a chave
      // (operacaoFiscal: exigeReferencia), e até 02/10/2026 a tela não a
      // pedia nem mandava — toda devolução emitida por aqui seria recusada.
      let referenciasDevolucao;
      if (formData.get('tipoOperacao') === 'DEVOLUCAO') {
        const chave = String(formData.get('devolucaoChave') || '').replace(/\D/g, '');
        if (chave.length !== 44) {
          showToast('Informe a chave de acesso da NF-e devolvida (44 dígitos).', 'error');
          if (submitBtn) submitBtn.disabled = false;
          return;
        }
        referenciasDevolucao = [{ chaveAcesso: chave }];
      }

      const body = montarCorpoDaNota(formData, referenciasDevolucao);
      // Fase EO: o estado da tela vai junto e fica na nota. Dando erro, é ele
      // que "Corrigir nota" (NF-e Emitidas) devolve a esta tela.
      body.estadoDaTela = estadoDaTela();
      // Corrigindo uma nota com erro: o servidor reenvia ESTA nota, no mesmo
      // registro, e não cria outra (15/10/2026, pedido do usuário: "não
      // duplique as NF, só mude o status da mesma nota que está errônea").
      if (corrigindoNfe) body.corrigeNfeId = corrigindoNfe.id;

      // EMITIU, VAI PARA NF-e EMITIDAS (14/10/2026, pedido do usuário: "a
      // página recarrega já nas NF-e emitidas e já mostra erro ou aprovação").
      // A lista mostra o resultado (autorizada, motivo do erro com "Corrigir
      // nota", ou acompanha o processamento). Só fica aqui o que não virou nota
      // (recusa da montagem, antes de ir à Focus): o motivo em popup.
      let notaEmitida = null;
      try {
        const result = await api('/api/fiscal/nfe/emitir', { method: 'POST', body: JSON.stringify(body) });
        notaEmitida = result.nfe || null;
        ultimoResultado = notaEmitida;
      } catch (error) {
        if (error.dados && error.dados.travaDePagamento) {
          notaEmitida = await emitirMesmoAssim(body, error);
          ultimoResultado = notaEmitida || ultimoResultado;
        } else if (window.MavisErroNfe) {
          window.MavisErroNfe.mostrar({ titulo: 'A NF-e não foi emitida', motivos: [error.message || 'Erro ao emitir NF-e.'], podeCorrigir: false });
        } else {
          showToast(error.message || 'Erro ao emitir NF-e.', 'error');
        }
      }
      if (notaEmitida && notaEmitida.id) {
        state.nfeAposEmissao = { id: notaEmitida.id, status: notaEmitida.status, numero: notaEmitida.numero || '' };
        state.activeSub = 'nfe_emitidas';
        if (typeof renderApp === 'function') renderApp();
        loadModule(state.activeModule);
        return;
      }
      // Não virou nota: a tela continua, para corrigir.
      await loadNotasRecentes();
      ultimoResultado = notasRecentes[0] || ultimoResultado;
      renderForm();
      if (submitBtn) submitBtn.disabled = false;
    });
  }

  // Emitente já escolhido pela empresa do pedido: as últimas notas dele
  // aparecem de saída, como apareceriam se a pessoa o escolhesse na mão.
  // A NOTA EM EDIÇÃO SALVA (fase EL): volta como estava antes do primeiro
  // desenho — o estado da tela primeiro, os campos do formulário depois.
  let camposDoRascunho = null;
  // A nota com erro que esta emissão corrige (fase EO), quando veio de lá.
  let corrigindoNfe = null;
  try {
    const resposta = await api(`/api/fiscal/nfe/rascunho?pedido=${encodeURIComponent(orderIdOrigem || '')}`);
    if (resposta && resposta.rascunho && resposta.rascunho.dados) {
      camposDoRascunho = aplicarEstadoSalvo(resposta.rascunho.dados);
      corrigindoNfe = resposta.rascunho.dados.corrigeNfe || null;
      rascunhoSalvoEm = resposta.rascunho.atualizadoEm || '';
    }
  } catch (_) {
    // Sem permissão ou sem a tabela ainda: a tela abre como sempre abriu.
  }
  if (selectedEstabelecimentoId) await loadNotasRecentes();
  renderForm();
  if (camposDoRascunho) {
    preencherCamposSalvos(camposDoRascunho);
    showToast(corrigindoNfe
      ? `Corrigindo a NF-e com erro (${corrigindoNfe.referencia || 'sem referência'}). Emitir reenvia esta mesma nota.`
      : `Nota em edição recuperada (salva em ${new Date(rascunhoSalvoEm).toLocaleString('pt-BR')}).`, 'info', corrigindoNfe ? 8000 : undefined);
  }
  // CADASTROU EM OUTRA ABA, APARECE AQUI (15/10/2026, ver modules/shared/
  // dados_ao_vivo.js): destinatário, produto e transportadora vêm de novo, e a
  // tela volta como estava — pelo mesmo caminho da nota em edição salva, no
  // mesmo ponto da rolagem (desde 15/10/2026 é uma página só, sem aba a voltar).
  window.MavisDados?.aoMudar(async () => {
    const novo = await api('/api/finance/meta?diretorio=nfe&produtos=nfe');
    if (!document.getElementById('nfeFocusForm')) return;
    const rolagem = window.scrollY;
    const campos = aplicarEstadoSalvo(estadoDaTela());
    meta = novo;
    montarOpcoes();
    renderForm();
    preencherCamposSalvos(campos);
    window.scrollTo(0, rolagem);
  });
};

// "Nova NF-e Avulsa" É ESTA TELA.
//
// Avulsa quer dizer nota emitida SEM pedido de origem — e é exatamente o que
// esta tela faz: destinatário e itens preenchidos na hora, sem depender de
// venda nenhuma. Existiu uma segunda tela com esse nome (finance/subs/
// nova_nfe_avulsa.js) que gravava um registro local e nunca chegava à SEFAZ;
// quem a usasse acharia que emitiu. Duas telas com o mesmo propósito, e a do
// nome certo era a que não emitia.
//
// O apelido abaixo passou a valer primeiro, e o arquivo virou código morto:
// carregava em toda visita, registrava a si mesmo e era sobrescrito uma linha
// depois — ninguém nunca via aquela tela. Apagado em 14/08/2026 (está no
// histórico do git). O apelido continua porque é por "nova_nfe_avulsa" que o
// menu e a Área de Trabalho chamam esta tela.
//
// Apelido, e não cópia: uma cópia divergiria na primeira correção feita só de
// um lado.
window.MavisSubscreenRegistry.finance.nova_nfe_avulsa =
  window.MavisSubscreenRegistry.finance.emitir_nfe_focus;

function fiscalFormatCnpjSimples(digits) {
  const clean = String(digits || '').replace(/\D/g, '');
  if (clean.length !== 14) return digits || '';
  return clean.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
}
