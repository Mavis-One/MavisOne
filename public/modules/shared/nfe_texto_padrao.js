// Texto padrão das observações adicionais da NF-e.
//
// POR QUE ISTO TEM ARQUIVO PRÓPRIO
// --------------------------------
// É texto de NEGÓCIO, não código: ficha técnica do equipamento, prazo de
// garantia e instruções de uso mudam por decisão da empresa, não por mudança de
// sistema. Enterrado no meio da tela de emissão, alterar uma linha exigiria
// achar o trecho certo em oitocentas linhas de formulário. Aqui o arquivo
// inteiro é o texto.
//
// PARA QUEM FOR EDITAR
// --------------------
// Altere o texto entre as crases abaixo e pronto — a tela lê daqui. Os campos
// que terminam em ":" e ficam vazios (CHASSI, MODELO, COR) são preenchidos à
// mão em cada nota, porque mudam de equipamento para equipamento. Deixá-los
// declarados e vazios é proposital: um campo em branco na hora de emitir é um
// lembrete; um campo ausente é um esquecimento.
//
// ONDE ISTO VAI PARAR NA NOTA
// ---------------------------
// No grupo `infCpl` (informações complementares de interesse do contribuinte)
// da NF-e, que é o bloco de texto livre impresso no DANFE. Ele NÃO é campo
// fiscal: não altera imposto, base de cálculo nem CFOP. O que estiver escrito
// aqui é o que o cliente vai ler no papel — e o que vale numa discussão de
// garantia.
//
// LIMITE: a SEFAZ aceita até 5000 caracteres em infCpl. O texto abaixo usa
// menos de mil, mas a tela avisa se alguém colar um manual inteiro.
// Mesmo empacotamento de sales_status.js: o navegador carrega por <script> e o
// teste faz require() do mesmo arquivo, sem uma segunda cópia do texto.
(function (raiz) {
  const LIMITE_INFCPL = 5000;

  /**
   * A ficha do equipamento. Repete uma vez por unidade quando a nota vem de um
   * pedido com vários — cada equipamento tem chassi, modelo e cor próprios, e
   * uma ficha só para dois serviria a um e mentiria sobre o outro.
   *
   * As chaves entre {} são preenchidas a partir do item do pedido. O que não
   * vier fica em branco — e o campo continua declarado, porque em branco é
   * lembrete e ausente é esquecimento.
   */
  const FICHA = `FABRICANTE: MAVIS
CHASSI: {chassi}
ANO DE FABRICACAO: 2026
CATEGORIA: AUTOPROPELIDO
MODELO: {modelo}
ANO: 2026
COR: {cor}`;

  /** Vale para a nota inteira, não por equipamento — por isso sai uma vez só. */
  const RODAPE = `GARANTIA: 90 DIAS
PARA ACIONAR A GARANTIA, LEVE O EQUIPAMENTO JUNTO COM A NOTA FISCAL À NOSSA ASSISTÊNCIA.
O FRETE É POR CONTA DO CLIENTE E NÃO ESTÁ COBERTO PELA GARANTIA.
CUIDADOS COM A BATERIA:
UTILIZE A BATERIA AO MÁXIMO ANTES DE RECARREGAR
A BATERIA DEVE SER CARREGADA TODA SEMANA; NUNCA DEIXE QUE ELA CHEGUE A ZERO.
DESCONECTE O CARREGADOR ASSIM QUE A BATERIA ESTIVER TOTALMENTE CARREGADA.
CUIDADOS DOS PNEUS:
CALIBRE OS PNEUS TODA SEMANA A 45 LBS.
REVISÕES:
SIGA O PLANO DE REVISÕES RECOMENDADO PARA GARANTIR O BOM FUNCIONAMENTO DO EQUIPAMENTO.`;

  /** Uma ficha com os dados de um equipamento; o que faltar sai em branco. */
  function ficha({ chassi, modelo, cor } = {}) {
    return FICHA
      .replace('{chassi}', String(chassi || '').trim())
      .replace('{modelo}', String(modelo || '').trim())
      .replace('{cor}', String(cor || '').trim())
      // O modelo às vezes vem do nome do produto e às vezes não vem — sem esta
      // limpeza, a linha ficaria "MODELO: " com um espaço solto, e o campo
      // deixaria de casar com a checagem de "ainda em branco".
      .replace(/:[ \t]+$/gm, ':');
  }

  // Nota digitada à mão: uma ficha vazia esperando o operador.
  const PADRAO = `${ficha()}

${RODAPE}`;

  /**
   * Escreve o chassi na linha "CHASSI:" do texto.
   *
   * Trabalha sobre o TEXTO ATUAL, não sobre o modelo: o operador pode ter
   * editado o resto das observações antes de digitar o chassi, e remontar do
   * zero apagaria essas edições sem avisar.
   *
   * Só a primeira ocorrência é trocada. Se alguém colar uma segunda ficha à
   * mão, o campo continua mandando na de cima e não mexe na de baixo — melhor
   * do que sobrescrever as duas com o mesmo número.
   */
  function comChassi(texto, chassi) {
    const valor = String(chassi || '').trim();
    return String(texto || '').replace(
      /^([ \t]*CHASSI[ \t]*:)[ \t]*.*$/im,
      (_linha, rotulo) => (valor ? `${rotulo} ${valor}` : rotulo)
    );
  }

  /** O chassi já escrito no texto — para o campo abrir com o que está lá. */
  function chassiDoTexto(texto) {
    const achado = String(texto || '').match(/^[ \t]*CHASSI[ \t]*:[ \t]*(.*)$/im);
    return achado ? achado[1].trim() : '';
  }

  /**
   * O texto já é (ou saiu de) o padrão?
   *
   * Desde que o PEDIDO passou a nascer com este mesmo texto, a observação que
   * vem dele quase sempre É o padrão — revisado pelo vendedor. Empilhá-la sobre
   * outra cópia imprimiria a garantia e os cuidados DUAS VEZES no DANFE.
   *
   * A checagem é por duas marcas distantes uma da outra: a linha do chassi (no
   * topo) e o bloco da bateria (no fim). Uma marca só daria falso positivo em
   * qualquer observação que mencionasse "garantia"; as duas juntas, não. Na
   * dúvida o resultado é `false`, e o texto entra como observação extra — pior
   * ter uma linha a mais do que perder o que o vendedor escreveu.
   */
  function ehTextoPadrao(texto) {
    const conteudo = String(texto || '');
    return /^[ \t]*CHASSI[ \t]*:/im.test(conteudo) && /CUIDADOS COM A BATERIA/i.test(conteudo);
  }

  /**
   * O texto da nota.
   *
   * `observacaoDoPedido` é o que o vendedor escreveu no pedido e mandou copiar.
   * Quando ele já traz o padrão (o caso normal, porque o pedido nasce com ele),
   * é ELE que vale — foi revisado com o cliente à frente, e o modelo em branco
   * apagaria esse trabalho. Quando é outra coisa, entra por ÚLTIMO e separado:
   * no meio da garantia, o DANFE pareceria prometer a todo cliente algo
   * combinado num caso só.
   */
  function montar({ observacaoDoPedido = '' } = {}) {
    const extra = String(observacaoDoPedido || '').trim();
    if (ehTextoPadrao(extra)) return extra;
    return [PADRAO, extra].filter(Boolean).join('\n\n');
  }

  /**
   * Os campos que ficam em branco esperando o operador.
   *
   * A tela usa esta lista para avisar o que ainda não foi preenchido ANTES de
   * transmitir. Nota autorizada não se corrige — só se cancela (e o prazo é
   * curto) ou se emite carta de correção, que não vale para tudo. Descobrir
   * "CHASSI:" vazio depois da autorização é caro; antes, é um clique.
   */
  const CAMPOS_A_PREENCHER = ['CHASSI', 'MODELO', 'COR'];

  /** Campos declarados no texto que continuam sem valor depois dos dois-pontos. */
  function camposVazios(texto) {
    const conteudo = String(texto || '');
    return CAMPOS_A_PREENCHER.filter((campo) => {
      // Casa "CHASSI:" seguido só de espaços até o fim da linha. Um campo que
      // o usuário apagou do texto não é cobrado — ele decidiu não usá-lo.
      const declarado = new RegExp(`^\\s*${campo}\\s*:`, 'mi');
      const vazio = new RegExp(`^\\s*${campo}\\s*:[ \\t]*$`, 'mi');
      return declarado.test(conteudo) && vazio.test(conteudo);
    });
  }

  function excedeLimite(texto) {
    return String(texto || '').length > LIMITE_INFCPL;
  }

  const api = {
    PADRAO, FICHA, RODAPE, LIMITE_INFCPL, CAMPOS_A_PREENCHER,
    ficha, montar, comChassi, chassiDoTexto, ehTextoPadrao, camposVazios, excedeLimite
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (raiz) raiz.MavisNfeTextoPadrao = api;
})(typeof window !== 'undefined' ? window : null);
