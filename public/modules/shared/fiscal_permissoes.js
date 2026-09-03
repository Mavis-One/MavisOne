// Permissões do módulo Fiscal — FONTE ÚNICA.
//
// Mora em public/ para o navegador carregar por <script>, e o server.js faz
// require() dele — mesma razão de sales_status.js.
//
// O PROBLEMA QUE ISTO RESOLVE
// ---------------------------
// A tela de Usuários oferecia 15 permissões fiscais. O portão do servidor
// (resolveFiscalPermission) só sabe exigir 10. As outras 5 — criar, editar,
// documentos_recebidos, manifestar, auditoria — podiam ser marcadas, salvas e
// exibidas marcadas, e não faziam nada: nenhuma rota as exige, nenhuma tela as
// consulta. Um administrador podia marcar "Manifestar documentos" acreditando
// ter liberado (ou negado) alguma coisa.
//
// Permissão que não é exigida em lugar nenhum é pior do que permissão
// inexistente: ela faz o leitor da tela acreditar que existe um controle. É o
// mesmo raciocínio do prefixo errado em lib/permissoes.js — "uma regra que não
// casa é pior do que regra nenhuma".
//
// Por isso a lista é uma só, e scripts/test-permissoes-fiscais.js confere que
// TODA permissão daqui é realmente exigida por alguma rota, e que toda
// permissão exigida pelo servidor está aqui. Acrescentar um item sem a rota
// correspondente quebra o teste, de propósito.
//
// FUNCIONALIDADE AUSENTE x PERMISSÃO AUSENTE
// ------------------------------------------
// Documentos recebidos e manifestação do destinatário (DFe) não existiam no
// sistema, e por isso as duas permissões tinham sido removidas daqui: a
// permissão volta junto com a funcionalidade, e antes disso é só uma promessa
// na tela.
//
// A fase AR construiu as duas — a tela "Notas contra CNPJ" consulta a
// Distribuição de DF-e e manifesta o destinatário —, então elas voltaram. São
// SEPARADAS de propósito: consultar o que emitiram contra o nosso CNPJ é
// leitura, e manifestar é um evento fiscal com efeito jurídico. Quem confere as
// notas que chegaram não deveria, pelo mesmo clique, poder declarar à Receita
// que a empresa DESCONHECE uma operação.
(function (raiz) {
  const CATALOGO = [
    { value: 'visualizar', label: 'Visualizar', descricao: 'Ver notas, regras, empresas e tabelas fiscais.' },
    { value: 'emitir', label: 'Emitir NF-e', descricao: 'Transmitir nota para a SEFAZ.' },
    { value: 'cancelar', label: 'Cancelar NF-e', descricao: 'Cancelar nota autorizada dentro do prazo.' },
    { value: 'cce', label: 'Carta de Correção', descricao: 'Emitir CC-e sobre nota autorizada.' },
    { value: 'inutilizar', label: 'Inutilizar numeração', descricao: 'Inutilizar faixa de numeração não usada.' },
    { value: 'configurar', label: 'Configurar empresa/estabelecimento', descricao: 'CNPJ, regime tributário, série, token e webhook.' },
    { value: 'regras', label: 'Regras fiscais', descricao: 'Criar e alterar as regras de tributação.' },
    { value: 'certificado', label: 'Certificado digital', descricao: 'Enviar e substituir o certificado A1.' },
    { value: 'documentos_recebidos', label: 'Documentos recebidos (DF-e)', descricao: 'Consultar na SEFAZ as notas que terceiros emitiram contra o nosso CNPJ.' },
    { value: 'manifestar', label: 'Manifestar documento', descricao: 'Declarar à SEFAZ ciência, confirmação, desconhecimento ou operação não realizada.' },
    { value: 'xml', label: 'Baixar XML', descricao: 'Baixar o XML da nota autorizada.' },
    { value: 'danfe', label: 'Baixar DANFE', descricao: 'Baixar o PDF da DANFE.' }
  ];

  const VALORES = CATALOGO.map((p) => p.value);

  // Módulos que fazem as permissões fiscais valerem. Também compartilhado: a
  // tela mostrava a seção só para 'finance' e 'settings', enquanto o portão do
  // servidor aceitava 'fiscal' junto — quem marcava só o módulo Fiscal não
  // conseguia receber permissão fiscal nenhuma, porque a seção nem aparecia.
  const MODULOS_QUE_HABILITAM = ['fiscal', 'finance', 'settings'];

  function habilitadoPor(modulos) {
    return (Array.isArray(modulos) ? modulos : []).some((m) => MODULOS_QUE_HABILITAM.includes(m));
  }

  // Permissões que já foram oferecidas na tela e nunca chegaram a existir. Ficam
  // nomeadas para que um usuário antigo, salvo com elas marcadas, não as veja
  // reaparecer — e para o teste conseguir provar que sumiram.
  // `documentos_recebidos` e `manifestar` saíram desta lista na fase AR, quando
  // a funcionalidade passou a existir — ver o cabeçalho. As três que restam
  // continuam sem rota que as exija.
  const REMOVIDAS = ['criar', 'editar', 'auditoria'];

  function valida(valor) {
    return VALORES.includes(valor);
  }

  // Limpa o que veio do formulário ou do banco. Usuário gravado antes desta
  // limpeza carrega permissões que não existem mais; devolvê-las para a tela
  // faria as caixas removidas voltarem a aparecer marcadas.
  function sanitizar(lista) {
    if (!Array.isArray(lista)) return [];
    return [...new Set(lista.filter(valida))];
  }

  function rotulo(valor) {
    return (CATALOGO.find((p) => p.value === valor) || {}).label || valor;
  }

  const api = { CATALOGO, VALORES, REMOVIDAS, MODULOS_QUE_HABILITAM, habilitadoPor, valida, sanitizar, rotulo };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (raiz) raiz.MavisFiscalPermissoes = api;
})(typeof window !== 'undefined' ? window : null);
