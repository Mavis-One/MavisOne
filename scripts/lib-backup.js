// Peças comuns do backup e da restauração.
//
// A LISTA DE TABELAS E A ORDEM DE DEPENDÊNCIA saem do próprio SQL — schema.sql
// e as migrações. Uma lista escrita à mão aqui envelheceria na primeira tabela
// nova, e o jeito de descobrir seria uma restauração falhando por chave
// estrangeira no dia em que ela fosse necessária.
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const DIR_MIGRACOES = path.join(RAIZ, 'supabase', 'migrations');

// Comentário citando "create table" não cria tabela nenhuma. Tirar os
// comentários antes de procurar é o que impede uma "tabela" chamada `em`
// (de "ALTER TABLE em nfe_itens") entrar na lista — já aconteceu neste projeto.
const semComentarios = (sql) => sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*--.*$/gm, '');

function fontesSql() {
  const arquivos = fs.readdirSync(DIR_MIGRACOES)
    .filter((n) => n.endsWith('.sql') && !n.startsWith('PENDENTES'))
    .sort()
    .map((n) => path.join(DIR_MIGRACOES, n));
  return [path.join(RAIZ, 'supabase', 'schema.sql'), ...arquivos];
}

/**
 * Devolve { tabelas, dependencias, colunasFk } lidos do SQL.
 *
 * `dependencias[t]` = conjunto de tabelas que `t` referencia.
 * `colunasFk[t]`    = [{ coluna, alvo }] — precisa para QUEBRAR ciclo: a
 *                     restauração insere a linha com a coluna do ciclo vazia e
 *                     preenche numa segunda passada.
 */
function lerEstrutura() {
  const tabelas = new Set();
  const dependencias = {};
  const colunasFk = {};
  // Colunas que o BANCO gera e recusa receber prontas
  // ("GENERATED ALWAYS AS IDENTITY"). Restaurar uma delas com o valor original
  // devolve 428C9 e a tabela inteira fica de fora do backup restaurado.
  const colunasIdentidade = {};

  const anotarFk = (origem, coluna, alvo) => {
    if (!coluna || origem === alvo) return;
    colunasFk[origem] = colunasFk[origem] || [];
    if (!colunasFk[origem].some((f) => f.coluna === coluna)) colunasFk[origem].push({ coluna, alvo });
  };

  for (const arquivo of fontesSql()) {
    const sql = semComentarios(fs.readFileSync(arquivo, 'utf8'));

    // Cada bloco `create table X ( ... )`: o nome e o corpo, para achar as
    // referências DENTRO dele e saber de quem X depende.
    const blocos = sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?([a-z_][a-z_0-9]*)\s*\(([\s\S]*?)\n\s*\);/gi);
    for (const bloco of blocos) {
      const nome = bloco[1].toLowerCase();
      tabelas.add(nome);
      dependencias[nome] = dependencias[nome] || new Set();
      for (const ref of bloco[2].matchAll(/references\s+([a-z_][a-z_0-9]*)\s*\(/gi)) {
        const alvo = ref[1].toLowerCase();
        // Auto-referência (hierarquia: pai aponta para pai) não é dependência
        // entre tabelas — se fosse, a ordenação nunca fecharia.
        if (alvo !== nome) dependencias[nome].add(alvo);
      }
      // `nome_da_coluna tipo ... references alvo(id)` — a coluna é a primeira
      // palavra da linha.
      for (const linha of bloco[2].split('\n')) {
        const m = linha.match(/^\s*([a-z_][a-z_0-9]*)\s+[a-z]/i);
        if (!m) continue;
        const coluna = m[1].toLowerCase();
        const ref = linha.match(/references\s+([a-z_][a-z_0-9]*)\s*\(/i);
        if (ref) anotarFk(nome, coluna, ref[1].toLowerCase());
        if (/generated\s+always\s+as\s+identity|\bserial\b/i.test(linha)) {
          colunasIdentidade[nome] = colunasIdentidade[nome] || [];
          if (!colunasIdentidade[nome].includes(coluna)) colunasIdentidade[nome].push(coluna);
        }
      }
    }

    // `create table` sem o `);` na mesma forma (uma linha só) ainda conta como
    // tabela, mesmo sem dependência detectada.
    for (const m of sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?([a-z_][a-z_0-9]*)/gi)) {
      const nome = m[1].toLowerCase();
      tabelas.add(nome);
      dependencias[nome] = dependencias[nome] || new Set();
    }

    // FK adicionada depois, por ALTER TABLE.
    for (const m of sql.matchAll(/alter\s+table\s+(?:if\s+exists\s+)?([a-z_][a-z_0-9]*)([\s\S]{0,400}?)references\s+([a-z_][a-z_0-9]*)\s*\(/gi)) {
      const origem = m[1].toLowerCase();
      const alvo = m[3].toLowerCase();
      if (origem !== alvo) {
        dependencias[origem] = dependencias[origem] || new Set();
        dependencias[origem].add(alvo);
        // `add column X ... references Y` ou `add constraint ... foreign key (X)`
        const col = m[2].match(/add\s+column\s+(?:if\s+not\s+exists\s+)?([a-z_][a-z_0-9]*)/i)
          || m[2].match(/foreign\s+key\s*\(\s*([a-z_][a-z_0-9]*)/i);
        if (col) anotarFk(origem, col[1].toLowerCase(), alvo);
      }
    }
  }

  return { tabelas: [...tabelas].sort(), dependencias, colunasFk, colunasIdentidade };
}

/**
 * Ordem de INSERÇÃO: quem é referenciado entra primeiro. Restaurar
 * `financial_entries` antes de `financial_categories` quebra na chave
 * estrangeira, e é o tipo de erro que só aparece na hora em que o backup
 * precisa funcionar.
 *
 * Ciclo entre tabelas (A referencia B e B referencia A) não impede a
 * restauração — só impede ORDENAR. Nesse caso as envolvidas vão para o fim, e
 * a função devolve `ciclos` para quem chama poder avisar em vez de fingir que
 * a ordem está certa.
 */
function ordenarPorDependencia(tabelas, dependencias) {
  const restantes = new Set(tabelas);
  const ordem = [];
  const ciclos = [];

  while (restantes.size) {
    const livres = [...restantes].filter((t) => {
      const deps = dependencias[t] || new Set();
      return [...deps].every((d) => !restantes.has(d));
    });
    if (!livres.length) {
      // Ninguém está livre: o que sobrou se referencia em círculo.
      ciclos.push([...restantes].sort());
      ordem.push(...[...restantes].sort());
      break;
    }
    livres.sort().forEach((t) => { ordem.push(t); restantes.delete(t); });
  }

  return { ordem, ciclos };
}

// Cliente REST cru. Não usa @supabase/supabase-js de propósito: aqui é preciso
// ler o cabeçalho Content-Range (contagem exata) e mandar Prefer próprio, e a
// biblioteca esconde os dois.
function criarRest() {
  const url = process.env.SUPABASE_URL;
  const chave = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !chave) throw new Error('SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY precisam estar no .env.');
  const base = url.replace(/\/$/, '');
  const cabecalhos = (extra = {}) => Object.assign({
    apikey: chave,
    Authorization: 'Bearer ' + chave,
    'content-type': 'application/json'
  }, extra);
  return { base, chave, cabecalhos };
}

module.exports = { lerEstrutura, ordenarPorDependencia, criarRest, semComentarios };
