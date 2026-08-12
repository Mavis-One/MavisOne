/**
 * Classes de produto (COR, e amanhã VOLTAGEM, TAMANHO...).
 *
 * DUAS CAMADAS, E A DIFERENÇA IMPORTA
 * -----------------------------------
 *   CATÁLOGO   — a classe e seus valores. Global: a cor "Preto" é a mesma para
 *                todo mundo, e cadastrá-la uma vez basta.
 *   ATRIBUIÇÃO — quais classes e quais valores ESTE produto usa. Nem todo
 *                produto vem em preto.
 *
 * Sem a separação, cadastrar uma cor nova exigiria repetir a linha em cada
 * produto que a usa — e renomear "Vermelho" para "Vermelho Fosco" exigiria
 * varrer o cadastro inteiro.
 *
 * O SALDO POR COR NÃO ESTÁ AQUI. Ele é derivado do razão de movimentos, como
 * já acontece com o saldo por depósito (ver lib/stock-core.js). Guardar saldo
 * numa tabela seria um terceiro número, capaz de discordar dos outros dois.
 */
const { supabase, assertNoError } = require('./client');

function mapClasse(row) {
  if (!row) return null;
  return {
    id: row.id,
    companyId: row.company_id || '',
    name: row.name,
    description: row.description || '',
    active: row.active !== false,
    criadoEm: row.created_at
  };
}

function mapValor(row) {
  if (!row) return null;
  return {
    id: row.id,
    classId: row.class_id,
    name: row.name,
    code: row.code || '',
    metadata: row.metadata || null,
    // Atalho para a tela: a bolinha de cor sai daqui, e ler metadata.hex em
    // cada template espalharia o conhecimento do formato.
    hex: (row.metadata && row.metadata.hex) || '',
    active: row.active !== false
  };
}

// Erro 23505 = violação de índice único (Postgres). A mensagem crua fala em
// "idx_product_class_values_nome", que não diz nada a quem cadastrou uma cor.
function assertSemDuplicata(error, contexto, mensagem) {
  if (error && error.code === '23505') {
    const err = new Error(mensagem);
    err.status = 409;
    throw err;
  }
  assertNoError(error, contexto);
}

// 23503 = violação de FK. Acontece ao tentar excluir classe ou valor em uso —
// e é o comportamento certo (§21.5): histórico não se apaga, se desativa.
function assertSemUso(error, contexto, mensagem) {
  if (error && error.code === '23503') {
    const err = new Error(mensagem);
    err.status = 409;
    throw err;
  }
  assertNoError(error, contexto);
}

// ------------------------------------------------------------------ catálogo

async function listarClasses({ incluirInativas = false } = {}) {
  let query = supabase.from('product_classes').select('*').order('name', { ascending: true });
  if (!incluirInativas) query = query.eq('active', true);
  const { data, error } = await query;
  assertNoError(error, 'listarClasses');
  return (data || []).map(mapClasse);
}

async function criarClasse({ id, name, description, companyId }) {
  const { data, error } = await supabase.from('product_classes').insert({
    id,
    name: String(name || '').trim(),
    description: description || null,
    company_id: companyId || null
  }).select().single();
  assertSemDuplicata(error, 'criarClasse', `Já existe uma classe chamada "${name}".`);
  return mapClasse(data);
}

async function atualizarClasse(id, { name, description, active }) {
  const campos = { updated_at: new Date().toISOString() };
  if (name !== undefined) campos.name = String(name).trim();
  if (description !== undefined) campos.description = description || null;
  if (active !== undefined) campos.active = Boolean(active);
  const { data, error } = await supabase.from('product_classes').update(campos).eq('id', id).select().single();
  assertSemDuplicata(error, 'atualizarClasse', `Já existe uma classe chamada "${name}".`);
  return mapClasse(data);
}

async function excluirClasse(id) {
  const { error } = await supabase.from('product_classes').delete().eq('id', id);
  assertSemUso(error, 'excluirClasse',
    'Esta classe está em uso por produtos ou valores. Desative-a em vez de excluir — o histórico de estoque depende dela.');
}

async function listarValores(classId, { incluirInativos = false } = {}) {
  let query = supabase.from('product_class_values').select('*').order('name', { ascending: true });
  if (classId) query = query.eq('class_id', classId);
  if (!incluirInativos) query = query.eq('active', true);
  const { data, error } = await query;
  assertNoError(error, 'listarValores');
  return (data || []).map(mapValor);
}

async function criarValor({ id, classId, name, code, metadata }) {
  const { data, error } = await supabase.from('product_class_values').insert({
    id,
    class_id: classId,
    name: String(name || '').trim(),
    // Vazio vira NULL: o índice único de código ignora nulos, então dois
    // valores sem código convivem — dois com código '' colidiriam.
    code: String(code || '').trim().toUpperCase() || null,
    metadata: metadata || null
  }).select().single();
  assertSemDuplicata(error, 'criarValor', `Já existe "${name}" nesta classe.`);
  return mapValor(data);
}

async function atualizarValor(id, { name, code, metadata, active }) {
  const campos = { updated_at: new Date().toISOString() };
  if (name !== undefined) campos.name = String(name).trim();
  if (code !== undefined) campos.code = String(code || '').trim().toUpperCase() || null;
  if (metadata !== undefined) campos.metadata = metadata || null;
  if (active !== undefined) campos.active = Boolean(active);
  const { data, error } = await supabase.from('product_class_values').update(campos).eq('id', id).select().single();
  assertSemDuplicata(error, 'atualizarValor', `Já existe "${name}" nesta classe.`);
  return mapValor(data);
}

async function excluirValor(id) {
  const { error } = await supabase.from('product_class_values').delete().eq('id', id);
  assertSemUso(error, 'excluirValor',
    'Este valor está atribuído a algum produto. Desative-o em vez de excluir — movimentos antigos apontam para ele.');
}

// --------------------------------------------------------------- atribuições

/**
 * O que um produto usa: classes ativas e, dentro de cada uma, os valores que
 * ele oferece.
 *
 * Uma consulta por tabela e a junção em memória: são listas curtas (uma classe,
 * meia dúzia de cores), e o join do PostgREST exigiria nomear a constraint —
 * que muda de nome se a migração for recriada.
 */
async function classesDoProduto(productId) {
  const [atribuicoes, valores, catalogo, valoresCatalogo] = await Promise.all([
    supabase.from('product_class_assignments').select('*').eq('product_id', productId).eq('active', true),
    supabase.from('product_class_value_assignments').select('*').eq('product_id', productId).eq('active', true),
    supabase.from('product_classes').select('*'),
    supabase.from('product_class_values').select('*')
  ]);
  assertNoError(atribuicoes.error, 'classesDoProduto/atribuicoes');
  assertNoError(valores.error, 'classesDoProduto/valores');
  assertNoError(catalogo.error, 'classesDoProduto/catalogo');
  assertNoError(valoresCatalogo.error, 'classesDoProduto/valoresCatalogo');

  const classePorId = new Map((catalogo.data || []).map((c) => [c.id, mapClasse(c)]));
  const valorPorId = new Map((valoresCatalogo.data || []).map((v) => [v.id, mapValor(v)]));

  return (atribuicoes.data || []).map((a) => {
    const classe = classePorId.get(a.class_id);
    return {
      classId: a.class_id,
      name: classe ? classe.name : '(classe removida)',
      required: a.required !== false,
      valores: (valores.data || [])
        .filter((v) => v.class_id === a.class_id)
        .map((v) => valorPorId.get(v.class_value_id))
        // Valor desativado no catálogo some da lista de escolha, mas o
        // movimento antigo que aponta para ele continua íntegro.
        .filter((v) => v && v.active)
    };
  });
}

/**
 * Define de uma vez quais classes e valores o produto usa.
 *
 * Apaga e regrava em vez de calcular diferença: a tela manda o estado final, e
 * um diff aqui teria de adivinhar o que foi tirado. As linhas não guardam
 * histórico — quem guarda é o movimento de estoque, que aponta para o VALOR,
 * não para a atribuição.
 */
async function definirClassesDoProduto(productId, classes) {
  const lista = Array.isArray(classes) ? classes : [];

  const apagarValores = await supabase.from('product_class_value_assignments').delete().eq('product_id', productId);
  assertNoError(apagarValores.error, 'definirClassesDoProduto/limparValores');
  const apagarClasses = await supabase.from('product_class_assignments').delete().eq('product_id', productId);
  assertNoError(apagarClasses.error, 'definirClassesDoProduto/limparClasses');

  if (!lista.length) return [];

  const linhasClasse = lista.map((c) => ({
    id: `pca_${productId}_${c.classId}`,
    product_id: productId,
    class_id: c.classId,
    required: c.required !== false
  }));
  const inserirClasses = await supabase.from('product_class_assignments').insert(linhasClasse);
  assertSemDuplicata(inserirClasses.error, 'definirClassesDoProduto/classes',
    'A mesma classe foi enviada duas vezes para este produto.');

  const linhasValor = lista.flatMap((c) => (c.valores || []).map((valorId) => ({
    id: `pcva_${productId}_${valorId}`,
    product_id: productId,
    class_id: c.classId,
    class_value_id: valorId
  })));
  if (linhasValor.length) {
    const inserirValores = await supabase.from('product_class_value_assignments').insert(linhasValor);
    assertSemDuplicata(inserirValores.error, 'definirClassesDoProduto/valores',
      'O mesmo valor foi enviado duas vezes para este produto.');
  }

  return classesDoProduto(productId);
}

/** Produtos que usam alguma classe — usado para não deixar excluir a classe. */
async function produtosQueUsam(classId) {
  const { data, error } = await supabase.from('product_class_assignments')
    .select('product_id').eq('class_id', classId).eq('active', true);
  assertNoError(error, 'produtosQueUsam');
  return (data || []).map((r) => r.product_id);
}

module.exports = {
  listarClasses,
  criarClasse,
  atualizarClasse,
  excluirClasse,
  listarValores,
  criarValor,
  atualizarValor,
  excluirValor,
  classesDoProduto,
  definirClassesDoProduto,
  produtosQueUsam
};
