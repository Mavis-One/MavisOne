// A LISTA DE PESSOAS DE CADASTROS — filtro, ordem e página, fonte única.
//
// POR QUE ISTO SAIU DA TELA
// -------------------------
// A tela legada de Cadastros › Pessoas filtrava, ordenava e cortava em páginas
// de 100 NO NAVEGADOR, depois de baixar as 6.492 pessoas com as 54 chaves de
// cada uma. E baixava de novo a cada clique — virar página, ordenar, abrir os
// filtros, Buscar, Limpar, abrir uma edição, cada erro de validação:
//
//     /api/cadastros/pessoas ..... 7.425 KB cru  ·  695 KB gzip  ·  por clique
//     uma página de 100 ...........   32 KB cru  ·    6 KB gzip
//
// Em localhost isso some (o comentário antigo da tela dizia "o que doía era o
// DOM, não a rede", medido em 156 ms). No VPS são 0,2 a 0,6 s de rede por
// clique, mais ~22 ms de JSON.parse de 7,4 MB no navegador.
//
// Para o servidor mandar só a página, ele precisa filtrar e ordenar — e as
// regras são da tela, com decisões que não se adivinham (o papel coringa
// legado 'on', vazio sempre no fim nos dois sentidos, número que compara só os
// dígitos, colação pt-BR, desempate pelo código). Escritas nos dois lados,
// concordariam até o dia em que alguém corrigisse um lado só, e o sintoma seria
// um cadastro que "some" ao virar a página.
//
// Então moram aqui, e os dois as chamam: a tela por
// `window.MavisListaDeCadastros` e o server.js por `require`. O código abaixo
// é o que estava em public/app.js (renderUnifiedList), MOVIDO sem mudar regra
// — inclusive os nomes `listFilters` e `merged`, para quem procurar a regra
// pelo nome antigo achar.
//
// A DATA É A DE QUEM OLHA
// -----------------------
// "Data inicial 05/10" quer dizer 05/10 00:00 NO FUSO DE QUEM DIGITOU, e era
// assim que a tela comparava (`new Date('2026-10-05T00:00:00')`, hora local do
// navegador). O servidor do VPS não está nesse fuso. Por isso a tela converte
// os dois limites em instante (limitesDeData, rodando no navegador) e manda o
// instante; o servidor só compara.
//
// UMA RESSALVA HONESTA SOBRE A COLAÇÃO — a mesma de ordem_de_produtos.js: o
// `Intl.Collator('pt-BR')` passa a rodar no Node, com o ICU dele. Para nomes em
// português a ordem é a mesma; se um dia uma lista parecer fora de ordem por um
// acento, é aqui que se olha.
(function (raiz) {
  const POR_PAGINA = 100;

  // Cada coluna é comparada pelo que ela É, e não como texto solto:
  //   número  — 'código' é texto no banco, mas 100 vem depois de 99;
  //   data    — createdAt é ISO, então texto já ordena certo;
  //   texto   — comparação pt-BR, sem diferenciar acento nem maiúscula,
  //             para que "Álvaro" fique junto de "Alvaro" e não no fim.
  const COLUNAS_ORDENAVEIS = {
    code: { rotulo: 'Código', tipo: 'numero' },
    cadastroTipo: { rotulo: 'Tipo', tipo: 'texto' },
    name: { rotulo: 'Nome / Razão social', tipo: 'texto' },
    tradeName: { rotulo: 'Fantasia', tipo: 'texto' },
    document: { rotulo: 'Documento', tipo: 'numero' },
    email: { rotulo: 'E-mail', tipo: 'texto' },
    phone: { rotulo: 'Telefone', tipo: 'numero' },
    status: { rotulo: 'Status', tipo: 'texto' },
    createdAt: { rotulo: 'Cadastrado em', tipo: 'data' }
  };

  // Os papéis que os filtros "Exibir X" escondem (todos marcados por padrão).
  const PAPEIS_EXIBIDOS = [
    ['showClients', 'Cliente'], ['showSuppliers', 'Fornecedor'], ['showTechnicians', 'Técnico'],
    ['showCollaborators', 'Colaborador'], ['showTransporters', 'Transportadora'], ['showSellers', 'Vendedor'],
    ['showLeaders', 'Líder'], ['showManagers', 'Gerente'], ['showRepresented', 'Representada'],
    ['showCredenciadoras', 'Credenciadora'], ['showManufacturers', 'Fabricante']
  ];

  function sanitizeDigits(value) {
    return String(value || '').replace(/\D/g, '');
  }

  function normalize(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLocaleLowerCase('pt-BR')
      .trim();
  }

  /**
   * Os filtros da tela, com os padrões de sempre — o estado guardado pode vir
   * vazio, incompleto ou de uma versão anterior da tela.
   *
   * `createdAt` descendente é a ordem padrão porque era o comportamento de
   * sempre — quem nunca clicar em cabeçalho nenhum vê a lista exatamente como
   * via antes: o cadastro mais novo em cima. A página mora junto dos filtros
   * de propósito: os dois descrevem o mesmo recorte, e trocar um sem cuidar do
   * outro é o que produz "página 40 de 2".
   */
  function normalizarFiltros(guardados) {
    const g = guardados || {};
    return {
      show: Boolean(g.show),
      type: g.type || 'all',
      status: g.status || 'all',
      query: g.query || '',
      nameFantasy: g.nameFantasy || '',
      corporateName: g.corporateName || '',
      uniqueCode: g.uniqueCode || '',
      email: g.email || '',
      categoryRole: g.categoryRole || 'all',
      document: g.document || '',
      city: g.city || '',
      zipCode: g.zipCode || '',
      uf: g.uf || '',
      group: g.group || '',
      defaultCarrier: g.defaultCarrier || '',
      showClients: g.showClients ?? true,
      showSuppliers: g.showSuppliers ?? true,
      showTechnicians: g.showTechnicians ?? true,
      showCollaborators: g.showCollaborators ?? true,
      showTransporters: g.showTransporters ?? true,
      showSellers: g.showSellers ?? true,
      showLeaders: g.showLeaders ?? true,
      showManagers: g.showManagers ?? true,
      showRepresented: g.showRepresented ?? true,
      showCredenciadoras: g.showCredenciadoras ?? true,
      showManufacturers: g.showManufacturers ?? true,
      onlyInactive: g.onlyInactive ?? false,
      dateStart: g.dateStart || '',
      dateEnd: g.dateEnd || '',
      pagina: Number(g.pagina) || 1,
      ordemCampo: g.ordemCampo || 'createdAt',
      ordemDirecao: g.ordemDirecao === 'asc' ? 'asc' : 'desc'
    };
  }

  /**
   * Os dois limites de data como INSTANTE (ISO), no fuso de quem chama — é
   * para rodar no NAVEGADOR. Limite vazio ou inválido vira ''.
   */
  function limitesDeData(dateStart, dateEnd) {
    const instante = (texto) => {
      const d = new Date(texto);
      return Number.isNaN(d.getTime()) ? '' : d.toISOString();
    };
    return {
      inicio: dateStart ? instante(`${dateStart}T00:00:00`) : '',
      fim: dateEnd ? instante(`${dateEnd}T23:59:59`) : ''
    };
  }

  /** Pessoas e CNPJs num formato só, com os campos que a lista lê. */
  function projetar(people, cnpjs) {
    return [
      ...(people || []).map((person) => ({
        kind: 'people',
        id: person.id,
        code: person.code || '',
        cadastroTipo: person.type === 'pessoa-juridica' ? 'Pessoa jurídica' : 'Pessoa física',
        name: person.name || '',
        tradeName: person.tradeName || '',
        document: person.document || '',
        registrationStatus: person.registrationStatus || '',
        email: person.email || '',
        phone: person.phone || '',
        status: person.status || 'ativo',
        city: person.city || '',
        zipCode: person.zipCode || '',
        state: person.state || '',
        group: person.group || '',
        defaultCarrier: person.defaultCarrier || '',
        roles: Array.isArray(person.roles) ? person.roles : [],
        createdAt: person.createdAt || ''
      })),
      ...(cnpjs || []).map((company) => ({
        kind: 'cnpj',
        id: company.id,
        code: company.code || '',
        cadastroTipo: 'CNPJ',
        name: company.name || '',
        tradeName: company.tradeName || '',
        document: company.document || '',
        registrationStatus: company.registrationStatus || '',
        email: company.email || '',
        phone: company.phone || '',
        status: company.status || 'ativo',
        city: company.city || '',
        zipCode: company.zipCode || '',
        state: company.state || '',
        group: company.group || '',
        defaultCarrier: company.defaultCarrier || '',
        roles: Array.isArray(company.roles) ? company.roles : [],
        createdAt: company.createdAt || ''
      }))
    ];
  }

  /**
   * As linhas que passam nos filtros. `limites` são os instantes de
   * limitesDeData (ver A DATA É A DE QUEM OLHA, no topo).
   *
   * `memo` (opcional, um Map) guarda o texto de busca já normalizado de cada
   * linha, pela própria linha: a busca normaliza 12 campos de cada uma das
   * 6.492 linhas (~70 ms medidos, no event loop do servidor), e o resultado só
   * muda quando a linha muda. A chave é o conteúdo dos campos, não só o id —
   * linha editada não casa com o que foi guardado e é normalizada de novo.
   * Função pura guardada pela entrada: não tem como devolver texto velho.
   */
  function filtrar(merged, listFilters, limites, memo) {
    const query = normalize(listFilters.query).trim();
    const includesText = (fieldValue, filterValue) => normalize(fieldValue).includes(normalize(filterValue).trim());
    const roleVisibleMap = PAPEIS_EXIBIDOS.map(([chave, role]) => ({ role, enabled: listFilters[chave] }));
    const inicio = limites && limites.inicio ? new Date(limites.inicio) : null;
    const fim = limites && limites.fim ? new Date(limites.fim) : null;

    const textoDeBusca = (row) => {
      const campos = [
        row.code,
        row.name,
        row.tradeName,
        row.document,
        row.email,
        row.phone,
        row.cadastroTipo,
        row.registrationStatus,
        row.city,
        row.state,
        row.group,
        row.id
      ];
      if (!memo) return campos.map(normalize);
      const chave = campos.map((c) => String(c ?? '')).join('\u0000');
      const guardado = memo.get(row.id);
      if (guardado && guardado.chave === chave) return guardado.normalizados;
      const normalizados = campos.map(normalize);
      memo.set(row.id, { chave, normalizados });
      return normalizados;
    };

    const passaram = merged.filter((row) => {
      const normalizedRoles = (Array.isArray(row.roles) ? row.roles : []).map(normalize).filter(Boolean);
      const hasLegacyWildcardRole = normalizedRoles.includes('on');
      const hasRole = (roleName) => hasLegacyWildcardRole || normalizedRoles.includes(normalize(roleName));

      if (listFilters.type === 'people' && row.kind !== 'people') return false;
      if (listFilters.type === 'cnpj' && row.kind !== 'cnpj') return false;
      if (listFilters.status !== 'all' && normalize(row.status) !== normalize(listFilters.status)) return false;
      if (listFilters.onlyInactive && normalize(row.status) !== 'inativo') return false;

      if (listFilters.nameFantasy && !includesText(`${row.name} ${row.tradeName}`, listFilters.nameFantasy)) return false;
      if (listFilters.corporateName && !includesText(row.name, listFilters.corporateName)) return false;
      if (listFilters.uniqueCode && !includesText(row.code, listFilters.uniqueCode)) return false;
      if (listFilters.email && !includesText(row.email, listFilters.email)) return false;
      if (listFilters.document && !includesText(sanitizeDigits(row.document), sanitizeDigits(listFilters.document))) return false;
      if (listFilters.city && !includesText(row.city, listFilters.city)) return false;
      if (listFilters.zipCode && !includesText(sanitizeDigits(row.zipCode), sanitizeDigits(listFilters.zipCode))) return false;
      if (listFilters.uf && !includesText(row.state, listFilters.uf)) return false;
      if (listFilters.group && !includesText(row.group, listFilters.group)) return false;
      if (listFilters.defaultCarrier && !includesText(row.defaultCarrier, listFilters.defaultCarrier)) return false;

      if (listFilters.categoryRole !== 'all') {
        if (!hasRole(listFilters.categoryRole)) return false;
      }

      if (listFilters.dateStart && inicio && !Number.isNaN(inicio.getTime())) {
        const created = new Date(row.createdAt || '');
        if (!Number.isNaN(created.getTime()) && created < inicio) return false;
      }
      if (listFilters.dateEnd && fim && !Number.isNaN(fim.getTime())) {
        const created = new Date(row.createdAt || '');
        if (!Number.isNaN(created.getTime()) && created > fim) return false;
      }

      const hiddenRoles = roleVisibleMap.filter((entry) => !entry.enabled).map((entry) => entry.role);
      if (hiddenRoles.length && !hasLegacyWildcardRole && hiddenRoles.some((hidden) => hasRole(hidden))) {
        return false;
      }

      if (!query) return true;
      return textoDeBusca(row).some((field) => field.includes(query));
    });

    // O memo vive no processo do servidor (um só, PM2) e é chaveado pelo id:
    // cadastro excluído deixaria a entrada lá até o processo reiniciar. Mais
    // entradas que linhas só acontece depois de exclusão, e aí os ids que não
    // estão mais na lista saem — uma passada, só quando sobra, e depois da
    // busca, que é quem acrescenta. Tirar entrada nunca muda o resultado: a
    // linha seria normalizada de novo.
    if (memo && memo.size > merged.length) {
      const vivos = new Set(merged.map((row) => row.id));
      for (const id of memo.keys()) if (!vivos.has(id)) memo.delete(id);
    }

    return passaram;
  }

  /** A coluna e a direção da ordem, com o padrão de sempre. */
  function ordemDosFiltros(listFilters) {
    return {
      campoDaOrdem: COLUNAS_ORDENAVEIS[listFilters.ordemCampo] ? listFilters.ordemCampo : 'createdAt',
      direcaoDaOrdem: listFilters.ordemDirecao === 'asc' ? 'asc' : 'desc'
    };
  }

  // A ORDEM VALE SOBRE A LISTA INTEIRA, e não sobre a página visível.
  //
  // É o ponto que decide se a ordenação serve para alguma coisa. Ordenar só as
  // 100 linhas da tela reembaralharia cada página por conta própria: a página 2
  // começaria de novo no "A", e o maior valor da lista poderia estar em
  // qualquer página. Por isso o `sort` vem depois do filtro e antes do corte.
  //
  // Ordena NO LUGAR a lista recebida (a que filtrar acabou de criar).
  function ordenar(merged, listFilters) {
    const { campoDaOrdem, direcaoDaOrdem } = ordemDosFiltros(listFilters);
    const comparadorDePtBr = new Intl.Collator('pt-BR', { sensitivity: 'base', numeric: true });

    merged.sort((a, b) => {
      const tipo = COLUNAS_ORDENAVEIS[campoDaOrdem].tipo;
      const va = a[campoDaOrdem];
      const vb = b[campoDaOrdem];
      const vazioA = va === null || va === undefined || String(va).trim() === '';
      const vazioB = vb === null || vb === undefined || String(vb).trim() === '';
      // VAZIO VAI SEMPRE PARA O FIM, nos dois sentidos. Inverter junto com a
      // direção encheria o topo de traços ao pedir "maior primeiro" — e quem
      // ordena por e-mail quer ver os e-mails, não quem não tem.
      if (vazioA && vazioB) return 0;
      if (vazioA) return 1;
      if (vazioB) return -1;

      let resultado;
      if (tipo === 'numero') {
        // 'código' e 'documento' são texto no banco; comparados como texto, o
        // 100 cairia entre o 10 e o 11. Só os dígitos importam.
        const na = Number(String(va).replace(/\D/g, '')) || 0;
        const nb = Number(String(vb).replace(/\D/g, '')) || 0;
        resultado = na - nb;
      } else if (tipo === 'data') {
        resultado = String(va).localeCompare(String(vb));
      } else {
        resultado = comparadorDePtBr.compare(String(va), String(vb));
      }
      // Empate resolvido pelo código: sem isso, duas pessoas com o mesmo nome
      // trocariam de lugar entre um render e outro, e a lista pareceria se
      // mexer sozinha. O código é único (sequência do banco), então a ordem é
      // total — a mesma página sempre traz as mesmas linhas.
      if (resultado === 0) resultado = (Number(a.code) || 0) - (Number(b.code) || 0);
      return direcaoDaOrdem === 'asc' ? resultado : -resultado;
    });
    return merged;
  }

  // A LISTA SAI EM PÁGINAS DE 100. O corte é DEPOIS do filtro e da ordenação:
  // a página 1 tem de ser a primeira centena do que a pessoa pediu, e não a
  // primeira centena do banco filtrada em seguida.
  function paginar(merged, listFilters) {
    const totalRegistros = merged.length;
    const totalPaginas = Math.max(1, Math.ceil(totalRegistros / POR_PAGINA));
    // Preso entre 1 e o total: um filtro que reduz a lista enquanto a pessoa
    // está na página 40 não pode deixá-la olhando para o vazio.
    const paginaAtual = Math.min(Math.max(1, listFilters.pagina), totalPaginas);
    const primeiroDaPagina = (paginaAtual - 1) * POR_PAGINA;
    const visiveis = merged.slice(primeiroDaPagina, primeiroDaPagina + POR_PAGINA);
    return { visiveis, totalRegistros, totalPaginas, paginaAtual, primeiroDaPagina };
  }

  /** Tudo junto, na ordem que importa: projetar, filtrar, ordenar, cortar. */
  function montarPagina(people, cnpjs, guardados, limites, memo) {
    const listFilters = normalizarFiltros(guardados);
    const merged = ordenar(filtrar(projetar(people, cnpjs), listFilters, limites, memo), listFilters);
    return paginar(merged, listFilters);
  }

  const api = {
    POR_PAGINA, COLUNAS_ORDENAVEIS, normalize, sanitizeDigits, normalizarFiltros, limitesDeData,
    projetar, filtrar, ordemDosFiltros, ordenar, paginar, montarPagina
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else raiz.MavisListaDeCadastros = api;
})(typeof window !== 'undefined' ? window : globalThis);
