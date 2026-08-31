/**
 * A CONSULTA ENCADEADA — o dialeto do supabase-js, virando SQL.
 *
 * Este é o coração da saída do Supabase. Os 15 módulos de lib/db e os scripts
 * continuam escrevendo exatamente o que sempre escreveram:
 *
 *     supabase.from('orders').select('*').eq('seller_id', id).order('created_at')
 *
 * e o que sai daqui é:
 *
 *     SELECT * FROM "orders" WHERE "seller_id" = $1 ORDER BY "created_at" ASC
 *
 * POR QUE MANTER O DIALETO EM VEZ DE REESCREVER OS 230 PONTOS DE CHAMADA
 * ---------------------------------------------------------------------
 * Porque a troca de banco e a reescrita de 15 módulos são dois riscos
 * diferentes, e juntá-los faz com que nenhum erro tenha dono: um relatório que
 * saísse errado depois poderia ser do Postgres novo ou da consulta reescrita, e
 * não haveria como saber sem refazer as duas coisas. Trocando só a fundação, a
 * pergunta vira uma só — "a camada gera o SQL certo?" — e essa pergunta tem
 * resposta em teste (scripts/test-sql-compat.js), sem banco no ar.
 *
 * MONTAR E EXECUTAR SÃO SEPARADOS, DE PROPÓSITO
 * --------------------------------------------
 * montarSql() é uma função PURA: recebe o estado da consulta e o catálogo, e
 * devolve texto e parâmetros. Não abre conexão, não toca em rede. É o mesmo
 * motivo de lib/permissoes.js e lib/relatorios-escopo.js serem puros — dá para
 * provar o comportamento inteiro num teste que roda em milissegundos, e não
 * abrindo tela e conferindo com o olho.
 *
 * O QUE ESTA CAMADA NÃO FAZ, E NÃO DEVE PASSAR A FAZER
 * ---------------------------------------------------
 * Não é um ORM e não é um clone completo do PostgREST. Ela cobre o que o
 * sistema usa — conferido chamada por chamada — e RECUSA COM ERRO CLARO o que
 * não cobre. Um operador silenciosamente ignorado devolveria linha demais, que
 * num sistema com escopo por vendedor significa um vendedor vendo a venda do
 * outro. Falhar alto é a única opção segura aqui.
 */

const { consultar } = require('./conexao');
const { obterCatalogo, ehColunaJson, chavePrimaria, ligacao } = require('./catalogo');

// ---------------------------------------------------------------------------
// Identificadores
// ---------------------------------------------------------------------------

/**
 * Nome de tabela ou coluna, entre aspas.
 *
 * A validação não é decoração: `.order(def.ordem)` recebe o nome vindo de uma
 * definição de módulo, e nome de coluna NÃO pode ser parâmetro em SQL — ele
 * entra no texto do comando. Sem esta peneira, uma definição malformada (ou um
 * dia um nome vindo da requisição) escreveria SQL. Com ela, o pior caso é um
 * erro legível na hora do desenvolvimento.
 */
function citar(nome) {
  const limpo = String(nome == null ? '' : nome).trim();
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(limpo)) {
    throw new Error(`Identificador inválido para SQL: ${JSON.stringify(nome)}`);
  }
  return `"${limpo}"`;
}

/** Acumula os parâmetros e devolve $1, $2, ... na ordem em que foram pedidos. */
class Ligador {
  constructor() { this.valores = []; }
  ligar(valor) {
    this.valores.push(valor);
    return `$${this.valores.length}`;
  }
}

// ---------------------------------------------------------------------------
// Valores
// ---------------------------------------------------------------------------

/**
 * Prepara um valor para virar parâmetro, sabendo em que coluna ele vai cair.
 *
 * O único ajuste é o json/jsonb, e ele é obrigatório: o driver `pg` converte um
 * array JavaScript em array literal do Postgres ("{1,2}"), o que é certo para
 * uma coluna text[] e ERRADO para uma coluna jsonb. Como o sistema tem as duas
 * coisas (users.allowed_modules é text[], users.dashboard_pins é jsonb), quem
 * decide tem que ser o tipo real da coluna — não o formato do valor.
 */
function prepararValor(valor, tabela, coluna, catalogo) {
  if (valor === undefined) return undefined;
  if (valor === null) return null;
  if (ehColunaJson(catalogo, tabela, coluna) && typeof valor === 'object') {
    return JSON.stringify(valor);
  }
  return valor;
}

/**
 * Tira as chaves com valor `undefined`.
 *
 * O supabase-js serializava o objeto em JSON antes de mandar, e JSON.stringify
 * simplesmente ignora undefined. Quem escreveu `{ resumo: entrada.resumo || undefined }`
 * contava com isso para dizer "não mexe nesta coluna". Mandando undefined para
 * o driver, ele viraria NULL e APAGARIA o valor que estava lá.
 */
function semIndefinidos(objeto) {
  const saida = {};
  for (const [chave, valor] of Object.entries(objeto || {})) {
    if (valor !== undefined) saida[chave] = valor;
  }
  return saida;
}

// ---------------------------------------------------------------------------
// A lista de colunas do SELECT
// ---------------------------------------------------------------------------

/**
 * Quebra "a, b, nfe(x, y), c" em ["a", "b", "nfe(x, y)", "c"].
 * Split por vírgula não serve: a vírgula de dentro dos parênteses não separa
 * coluna, separa campo do relacionamento embutido.
 */
function dividirNoTopo(texto) {
  const partes = [];
  let atual = '';
  let profundidade = 0;
  for (const letra of String(texto)) {
    if (letra === '(') profundidade += 1;
    if (letra === ')') profundidade -= 1;
    if (letra === ',' && profundidade === 0) { partes.push(atual); atual = ''; continue; }
    atual += letra;
  }
  partes.push(atual);
  return partes.map((p) => p.trim()).filter(Boolean);
}

/**
 * Monta o relacionamento embutido — o `select('*, nfe(...)')` do PostgREST.
 *
 * Existe UM no sistema (nfe_eventos → nfe, em lib/db/fiscal.js), mas os dois
 * sentidos estão implementados porque a diferença entre eles é o que o chamador
 * recebe: objeto ou lista. Adivinhar errado devolveria a forma errada, e o
 * `.map()` de quem chama quebraria longe daqui.
 *
 *   muitos-para-um  nfe_eventos tem nfe_id  →  objeto (ou null)
 *   um-para-muitos  a outra tabela é que aponta para esta  →  lista (nunca null)
 */
function montarEmbutido(item, tabela, catalogo, aliasBase) {
  const abre = item.indexOf('(');
  const destino = item.slice(0, abre).trim();
  const campos = dividirNoTopo(item.slice(abre + 1, item.lastIndexOf(')')));
  if (!campos.length) throw new Error(`Relacionamento "${destino}" sem colunas em select().`);

  const paraFora = ligacao(catalogo, tabela, destino);
  const paraDentro = ligacao(catalogo, destino, tabela);
  if (!paraFora && !paraDentro) {
    throw new Error(
      `Não existe chave estrangeira entre "${tabela}" e "${destino}", então o select embutido ` +
      `"${item}" não tem como ser montado. Confira o nome da tabela ou crie a FK.`
    );
  }

  const alvo = citar(destino);
  const objeto = `json_build_object(${campos.map((c) => `'${c.replace(/'/g, "''")}', ${alvo}.${citar(c)}`).join(', ')})`;

  if (paraFora) {
    const condicao = `${alvo}.${citar(paraFora.colunaDestino)} = ${aliasBase}.${citar(paraFora.coluna)}`;
    return `(select ${objeto} from ${alvo} where ${condicao}) as ${citar(destino)}`;
  }
  // um-para-muitos: lista, e lista vazia em vez de null — é o que o PostgREST
  // devolve, e poupa quem chama de checar null antes de iterar.
  const condicao = `${alvo}.${citar(paraDentro.coluna)} = ${aliasBase}.${citar(paraDentro.colunaDestino)}`;
  return `(select coalesce(json_agg(${objeto}), '[]'::json) from ${alvo} where ${condicao}) as ${citar(destino)}`;
}

function montarColunas(colunas, tabela, catalogo, aliasBase) {
  const itens = dividirNoTopo(colunas || '*');
  if (!itens.length) return `${aliasBase}.*`;
  return itens.map((item) => {
    if (item === '*') return `${aliasBase}.*`;
    if (item.includes('(')) return montarEmbutido(item, tabela, catalogo, aliasBase);
    return `${aliasBase}.${citar(item)}`;
  }).join(', ');
}

// ---------------------------------------------------------------------------
// O WHERE
// ---------------------------------------------------------------------------

const COMPARADORES = { eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=', like: 'like', ilike: 'ilike' };

function montarCondicao(filtro, ligador, prefixo) {
  const coluna = `${prefixo}${citar(filtro.coluna)}`;
  const negar = (sql) => (filtro.negado ? `not (${sql})` : sql);

  if (filtro.operador === 'is') {
    if (filtro.valor === null) return filtro.negado ? `${coluna} is not null` : `${coluna} is null`;
    if (typeof filtro.valor === 'boolean') return negar(`${coluna} is ${filtro.valor ? 'true' : 'false'}`);
    throw new Error(`is() só aceita null, true ou false — recebeu ${JSON.stringify(filtro.valor)}.`);
  }

  if (filtro.operador === 'in') {
    const lista = Array.isArray(filtro.valor) ? filtro.valor : [filtro.valor];
    // Lista vazia é o caso que mais importa acertar: "nenhum vendedor
    // permitido" tem que devolver ZERO linhas. Um IN () é erro de sintaxe em
    // SQL, e um IN esquecido devolveria a tabela inteira — que aqui significa
    // um vendedor vendo a venda de todo mundo. `= any('{}')` é sempre falso.
    if (!lista.length) return filtro.negado ? 'true' : 'false';
    return negar(`${coluna} = any(${ligador.ligar(lista)})`);
  }

  const comparador = COMPARADORES[filtro.operador];
  if (!comparador) throw new Error(`Operador não suportado nesta camada: ${filtro.operador}`);
  // Comparar com null usando "=" nunca é verdade em SQL. O PostgREST traduzia
  // eq.null para IS NULL, então a tradução aqui é a mesma.
  if (filtro.valor === null) return filtro.negado ? `${coluna} is not null` : `${coluna} is null`;
  return negar(`${coluna} ${comparador} ${ligador.ligar(filtro.valor)}`);
}

function montarOnde(filtros, ligador, prefixo) {
  if (!filtros.length) return '';
  return ` where ${filtros.map((f) => montarCondicao(f, ligador, prefixo)).join(' and ')}`;
}

function montarOrdem(ordens, prefixo) {
  if (!ordens.length) return '';
  const partes = ordens.map((o) => {
    const direcao = o.ascendente === false ? 'desc' : 'asc';
    // O PostgREST manda nulls por último no ascendente e primeiro no
    // descendente só quando pedido; sem pedido, segue o padrão do Postgres.
    const nulos = o.nullsFirst === undefined ? '' : (o.nullsFirst ? ' nulls first' : ' nulls last');
    return `${prefixo}${citar(o.coluna)} ${direcao}${nulos}`;
  });
  return ` order by ${partes.join(', ')}`;
}

// ---------------------------------------------------------------------------
// A montagem — pura, sem banco
// ---------------------------------------------------------------------------

const ALIAS = '"t"';

/**
 * Recebe o estado da consulta e devolve { texto, valores } prontos para o
 * driver. Função pura: é ela que os testes exercitam.
 */
function montarSql(estado, catalogo) {
  const tabela = citar(estado.tabela);
  const ligador = new Ligador();

  if (estado.modo === 'select') {
    const colunas = montarColunas(estado.colunas, estado.tabela, catalogo, ALIAS);
    let texto = `select ${colunas} from ${tabela} as ${ALIAS}`;
    texto += montarOnde(estado.filtros, ligador, `${ALIAS}.`);
    texto += montarOrdem(estado.ordens, `${ALIAS}.`);
    if (estado.limite != null) texto += ` limit ${Number(estado.limite)}`;
    if (estado.deslocamento) texto += ` offset ${Number(estado.deslocamento)}`;
    return { texto, valores: ligador.valores };
  }

  if (estado.modo === 'delete') {
    exigirFiltro(estado);
    let texto = `delete from ${tabela} as ${ALIAS}`;
    texto += montarOnde(estado.filtros, ligador, `${ALIAS}.`);
    texto += montarRetorno(estado, catalogo);
    return { texto, valores: ligador.valores };
  }

  if (estado.modo === 'update') {
    exigirFiltro(estado);
    const valores = semIndefinidos(estado.valores);
    const colunas = Object.keys(valores);
    if (!colunas.length) throw new Error(`update() em "${estado.tabela}" sem nenhuma coluna para gravar.`);
    const atribuicoes = colunas.map((c) => `${citar(c)} = ${ligador.ligar(prepararValor(valores[c], estado.tabela, c, catalogo))}`);
    let texto = `update ${tabela} as ${ALIAS} set ${atribuicoes.join(', ')}`;
    texto += montarOnde(estado.filtros, ligador, `${ALIAS}.`);
    texto += montarRetorno(estado, catalogo);
    return { texto, valores: ligador.valores };
  }

  if (estado.modo === 'insert' || estado.modo === 'upsert') {
    const linhas = (Array.isArray(estado.valores) ? estado.valores : [estado.valores]).map(semIndefinidos);
    if (!linhas.length) throw new Error(`insert() em "${estado.tabela}" sem nenhuma linha.`);
    // A união das chaves, não as chaves da primeira linha: se uma linha trouxer
    // uma coluna que a outra não tem, ignorar em silêncio perderia o dado.
    const colunas = [...new Set(linhas.flatMap((l) => Object.keys(l)))];
    if (!colunas.length) throw new Error(`insert() em "${estado.tabela}" sem nenhuma coluna.`);

    const grupos = linhas.map((linha) => {
      const campos = colunas.map((c) => {
        // Coluna ausente NESTA linha vira DEFAULT, não NULL: NULL apagaria o
        // valor padrão da coluna (um created_at default now(), por exemplo).
        if (!(c in linha)) return 'default';
        return ligador.ligar(prepararValor(linha[c], estado.tabela, c, catalogo));
      });
      return `(${campos.join(', ')})`;
    });

    let texto = `insert into ${tabela} as ${ALIAS} (${colunas.map(citar).join(', ')}) values ${grupos.join(', ')}`;
    if (estado.modo === 'upsert') texto += montarConflito(estado, colunas, catalogo);
    texto += montarRetorno(estado, catalogo);
    return { texto, valores: ligador.valores };
  }

  throw new Error(`Modo de consulta desconhecido: ${estado.modo}`);
}

/**
 * UPDATE e DELETE sem WHERE são recusados.
 *
 * O PostgREST recusa por padrão, e é a trava que impede um `.eq()` esquecido de
 * apagar a tabela inteira. Foi conferido que nenhuma das 50 chamadas de
 * update/delete do sistema roda sem filtro, então esta trava não muda
 * comportamento nenhum — ela só continua existindo depois da mudança de banco.
 */
function exigirFiltro(estado) {
  if (!estado.filtros.length) {
    throw new Error(
      `${estado.modo}() em "${estado.tabela}" sem nenhum filtro atingiria a tabela inteira e foi recusado. ` +
      'Se a intenção for mesmo essa, escreva o SQL à mão.'
    );
  }
}

function montarConflito(estado, colunas, catalogo) {
  const alvo = estado.onConflict
    ? String(estado.onConflict).split(',').map((c) => c.trim()).filter(Boolean)
    : chavePrimaria(catalogo, estado.tabela);
  if (!alvo.length) {
    throw new Error(
      `upsert() em "${estado.tabela}" precisa saber qual é o conflito, e a tabela não tem chave primária ` +
      'no catálogo. Passe { onConflict: "coluna" }.'
    );
  }
  // As colunas do próprio conflito ficam de fora do SET: gravar nelas o mesmo
  // valor é ruído, e em chave composta o Postgres recusa.
  const atualizaveis = colunas.filter((c) => !alvo.includes(c));
  if (!atualizaveis.length) return ` on conflict (${alvo.map(citar).join(', ')}) do nothing`;
  const set = atualizaveis.map((c) => `${citar(c)} = excluded.${citar(c)}`).join(', ');
  return ` on conflict (${alvo.map(citar).join(', ')}) do update set ${set}`;
}

function montarRetorno(estado, catalogo) {
  if (!estado.retornar) return '';
  return ` returning ${montarColunas(estado.retornar, estado.tabela, catalogo, ALIAS)}`;
}

// ---------------------------------------------------------------------------
// A consulta encadeada
// ---------------------------------------------------------------------------

/**
 * O erro no formato que o resto do sistema já trata.
 *
 * O `code` é o SQLSTATE do Postgres — 23505 (única violada), 23503 (FK),
 * 42P01 (tabela não existe), 42703 (coluna não existe), P0001 (raise da
 * trigger). São EXATAMENTE os códigos que lib/db/classes.js, fiscal.js,
 * estoque.js e rbac.js já conferem, porque o PostgREST repassava o do Postgres.
 * Ou seja: esse tratamento continua valendo sem uma linha alterada.
 */
function comoErro(erro) {
  return {
    code: erro.code || null,
    message: erro.message || String(erro),
    details: erro.detail || null,
    hint: erro.hint || null
  };
}

function erroDeCardinalidade(quantidade) {
  return {
    code: 'PGRST116',
    message: quantidade === 0
      ? 'A consulta não devolveu nenhuma linha, e single() exige exatamente uma.'
      : `A consulta devolveu ${quantidade} linhas, e single() exige exatamente uma.`,
    details: `Results contain ${quantidade} rows`,
    hint: null
  };
}

class Consulta {
  constructor(tabela) {
    this.estado = {
      tabela,
      modo: 'select',
      colunas: '*',
      contarExato: false,
      valores: null,
      onConflict: null,
      retornar: null,
      filtros: [],
      ordens: [],
      limite: null,
      deslocamento: null,
      unico: null
    };
  }

  // --- o que a consulta faz ---

  select(colunas = '*', opcoes = {}) {
    // Depois de um insert/update/upsert/delete, select() NÃO troca o comando:
    // ele vira o RETURNING. É assim no supabase-js, e é o que 20+ chamadas do
    // sistema usam para receber a linha gravada de volta.
    if (this.estado.modo !== 'select') {
      this.estado.retornar = colunas || '*';
      return this;
    }
    this.estado.colunas = colunas || '*';
    if (opcoes && opcoes.count === 'exact') this.estado.contarExato = true;
    else if (opcoes && opcoes.count) throw new Error(`count: "${opcoes.count}" não é suportado — use 'exact'.`);
    return this;
  }

  insert(valores) { this.estado.modo = 'insert'; this.estado.valores = valores; return this; }
  update(valores) { this.estado.modo = 'update'; this.estado.valores = valores; return this; }
  delete() { this.estado.modo = 'delete'; return this; }

  upsert(valores, opcoes = {}) {
    this.estado.modo = 'upsert';
    this.estado.valores = valores;
    this.estado.onConflict = opcoes && opcoes.onConflict ? opcoes.onConflict : null;
    return this;
  }

  // --- filtros ---

  filtrar(coluna, operador, valor, negado = false) {
    this.estado.filtros.push({ coluna, operador, valor, negado });
    return this;
  }

  eq(coluna, valor) { return this.filtrar(coluna, 'eq', valor); }
  neq(coluna, valor) { return this.filtrar(coluna, 'neq', valor); }
  gt(coluna, valor) { return this.filtrar(coluna, 'gt', valor); }
  gte(coluna, valor) { return this.filtrar(coluna, 'gte', valor); }
  lt(coluna, valor) { return this.filtrar(coluna, 'lt', valor); }
  lte(coluna, valor) { return this.filtrar(coluna, 'lte', valor); }
  like(coluna, valor) { return this.filtrar(coluna, 'like', valor); }
  ilike(coluna, valor) { return this.filtrar(coluna, 'ilike', valor); }
  in(coluna, valores) { return this.filtrar(coluna, 'in', valores); }
  is(coluna, valor) { return this.filtrar(coluna, 'is', valor); }
  not(coluna, operador, valor) { return this.filtrar(coluna, operador, valor, true); }

  // --- forma do resultado ---

  order(coluna, opcoes = {}) {
    this.estado.ordens.push({
      coluna,
      ascendente: opcoes.ascending !== false,
      nullsFirst: opcoes.nullsFirst
    });
    return this;
  }

  limit(quantidade) { this.estado.limite = quantidade; return this; }

  range(de, ate) {
    // O range do PostgREST é inclusivo nas duas pontas: range(0, 9) são 10
    // linhas. Traduzir para limit/offset erra por um se somar direto.
    this.estado.deslocamento = Number(de) || 0;
    this.estado.limite = Math.max(0, (Number(ate) || 0) - (Number(de) || 0) + 1);
    return this;
  }

  single() { this.estado.unico = 'single'; return this; }
  maybeSingle() { this.estado.unico = 'maybeSingle'; return this; }

  // --- execução ---

  async executar() {
    const estado = this.estado;
    try {
      const catalogo = await obterCatalogo();

      // Escrita sem select() devolve data: null, como o supabase-js. Não é
      // detalhe: 34 delete e 25 insert do sistema dependem disso para não
      // pagarem o custo de trazer a linha de volta.
      const querDados = estado.modo === 'select' || Boolean(estado.retornar);

      const { texto, valores } = montarSql(estado, catalogo);
      const resultado = await consultar(texto, valores);
      const linhas = resultado.rows || [];

      let contagem = null;
      if (estado.contarExato) {
        // A contagem ignora limit/offset de propósito: quem pagina precisa
        // saber o total, não o tamanho da página.
        const semPagina = { ...estado, colunas: '*', ordens: [], limite: null, deslocamento: null };
        const ligador = new Ligador();
        const onde = montarOnde(semPagina.filtros, ligador, `${ALIAS}.`);
        const total = await consultar(`select count(*)::int as total from ${citar(estado.tabela)} as ${ALIAS}${onde}`, ligador.valores);
        contagem = total.rows[0] ? total.rows[0].total : 0;
      }

      if (estado.unico) {
        if (linhas.length === 1) return { data: linhas[0], error: null, count: contagem };
        if (linhas.length === 0 && estado.unico === 'maybeSingle') return { data: null, error: null, count: contagem };
        return { data: null, error: erroDeCardinalidade(linhas.length), count: contagem };
      }

      return { data: querDados ? linhas : null, error: null, count: contagem };
    } catch (erro) {
      // O supabase-js NUNCA lançava: devolvia { data, error }. Todo o
      // tratamento do sistema (assertNoError e os ifs de código de erro) foi
      // escrito contando com isso. Lançar aqui furaria o tratamento de todos
      // eles de uma vez.
      return { data: null, error: comoErro(erro), count: null };
    }
  }

  // Torna a consulta "aguardável": `await supabase.from(...).select()` funciona
  // sem um .executar() explícito, que é como as 230 chamadas já são escritas.
  then(aoResolver, aoRejeitar) {
    return this.executar().then(aoResolver, aoRejeitar);
  }
  catch(aoRejeitar) { return this.executar().catch(aoRejeitar); }
  finally(aoFinalizar) { return this.executar().finally(aoFinalizar); }
}

module.exports = { Consulta, montarSql, citar, dividirNoTopo, semIndefinidos };
