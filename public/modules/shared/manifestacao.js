// MANIFESTAÇÃO DO DESTINATÁRIO — catálogo dos quatro eventos. FONTE ÚNICA.
//
// Mora em public/ porque o navegador carrega por <script> e o server.js faz
// require(). Mesma razão do sales_status.js: aqui a tela e o servidor precisam
// concordar sobre algo que mexe em estoque de verdade.
//
// O QUE É
// -------
// Quando alguém emite uma NF-e contra o seu CNPJ, ela fica na SEFAZ esperando.
// Manifestar é responder o que você tem a dizer sobre ela — e a resposta é um
// evento fiscal, registrado, com efeito jurídico. Não é um "marcar como lido".
//
// A DECISÃO QUE ESTE ARQUIVO CARREGA
// ----------------------------------
// Só a CONFIRMAÇÃO significa "a mercadoria chegou". Os outros três não:
//
//   Ciência          — "vi que essa nota existe". É o que libera o XML completo
//                      na SEFAZ, e é por isso que quase todo mundo começa por
//                      ela. Não afirma nada sobre a mercadoria.
//   Desconhecimento  — "essa nota NÃO é minha". Alguém emitiu contra o seu CNPJ
//                      por engano ou por fraude.
//   Não realizada    — a nota é sua, mas a operação não aconteceu: recusa na
//                      portaria, devolução na entrega, cancelamento combinado.
//
// Dar entrada no estoque em qualquer manifestação lançaria mercadoria de uma
// nota que você acabou de DESCONHECER. Daí `geraEntrada` viver aqui, no
// catálogo, e não num `if` dentro da tela: é a diferença entre uma regra que se
// lê num lugar e uma regra que alguém repete errado no segundo lugar.
//
// O prazo legal para manifestar é de 180 dias da emissão, e a Ciência tem prazo
// menor (10 dias) antes de a SEFAZ cobrar a manifestação definitiva. O sistema
// não bloqueia por prazo — quem bloqueia é a SEFAZ, e inventar aqui um limite
// que ela não aplica faria o usuário achar que perdeu uma nota que ainda dá.
(function (raiz) {
  const CATALOGO = [
    {
      // 210200
      codigo: '210200', value: 'confirmacao', label: 'Confirmação da operação',
      tom: 'success', geraEntrada: true, liberaXml: true,
      descricao: 'A mercadoria chegou e a operação foi realizada. Dá entrada no estoque e gera as contas a pagar da nota.'
    },
    {
      // 210210
      codigo: '210210', value: 'ciencia', label: 'Ciência da operação',
      tom: 'info', geraEntrada: false, liberaXml: true,
      descricao: 'Apenas registra que você viu a nota. Libera o XML completo, mas não afirma que a mercadoria chegou — nada entra no estoque.'
    },
    {
      // 210220
      codigo: '210220', value: 'desconhecimento', label: 'Desconhecimento da operação',
      tom: 'danger', geraEntrada: false, liberaXml: false,
      descricao: 'Esta nota não é sua. Nada entra no estoque, e ela não pode ser lançada como entrada.'
    },
    {
      // 210240
      codigo: '210240', value: 'nao-realizada', label: 'Operação não realizada',
      tom: 'warning', geraEntrada: false, liberaXml: false,
      descricao: 'A nota é sua, mas a operação não aconteceu (recusa, devolução na entrega). Nada entra no estoque.'
    }
  ];

  const porValor = new Map(CATALOGO.map((m) => [m.value, m]));
  const porCodigo = new Map(CATALOGO.map((m) => [m.codigo, m]));

  // Evento desconhecido devolve registro inerte em vez de undefined: uma nota
  // manifestada por outro sistema pode trazer um código que este catálogo não
  // conhece, e a lista não pode cair por causa disso. O inerte é o mais
  // conservador possível — não gera entrada, não libera XML.
  function obter(chave) {
    const texto = String(chave || '');
    return porValor.get(texto) || porCodigo.get(texto) || {
      codigo: texto, value: texto, label: texto || 'Não manifestado',
      tom: 'muted', geraEntrada: false, liberaXml: false, descricao: ''
    };
  }

  const rotulo = (chave) => obter(chave).label;
  const geraEntrada = (chave) => Boolean(obter(chave).geraEntrada);
  const liberaXml = (chave) => Boolean(obter(chave).liberaXml);
  const codigoDe = (chave) => obter(chave).codigo;

  const api = { CATALOGO, obter, rotulo, geraEntrada, liberaXml, codigoDe };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else raiz.MavisManifestacao = api;
})(typeof window !== 'undefined' ? window : globalThis);
