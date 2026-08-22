/**
 * ANEXOS DE PEDIDO — o binário no Supabase Storage, a ficha no pedido.
 *
 * O bucket é PRIVADO, e isso é a decisão que mais importa aqui. Anexo de
 * pedido carrega contrato, proposta e dado de cliente; num bucket público
 * qualquer pessoa que descobrisse a URL leria o arquivo sem login nenhum, e
 * URL de arquivo vaza fácil — vai em e-mail, em print, em log de proxy.
 *
 * Por isso o download NÃO devolve a URL do Storage: o servidor busca os bytes
 * com a chave de serviço e entrega para quem já provou ter sessão. Uma volta a
 * mais que compra a diferença entre "quem está logado" e "quem tem o link".
 */

const { supabase } = require('./client');

const BUCKET = 'pedido-anexos';

// 10 MB por arquivo. Não é um número mágico: é o que cabe numa proposta em PDF
// com imagens, e o teto existe porque o upload chega em base64 dentro do JSON
// — sem limite, um arquivo grande derruba o servidor por memória antes de
// chegar ao Storage.
const LIMITE_BYTES = 10 * 1024 * 1024;

// Nome de arquivo vira parte do caminho no Storage. Sem sanear, "../" e afins
// escapariam da pasta do pedido, e acento/espaço quebram a chave em alguns
// clientes. O nome ORIGINAL é preservado na ficha — este é só o nome técnico.
function nomeTecnico(nome) {
  return String(nome || 'arquivo')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .slice(-80) || 'arquivo';
}

let bucketConferido = false;

// Cria o bucket na primeira vez que alguém anexa algo. É idempotente e evita um
// passo manual escondido: sem isto, o primeiro upload numa instalação nova
// falharia com "Bucket not found", que não diz a ninguém o que fazer.
async function garantirBucket() {
  if (bucketConferido) return;
  const { data, error } = await supabase.storage.getBucket(BUCKET);
  if (data && !error) { bucketConferido = true; return; }
  const { error: erroCriar } = await supabase.storage.createBucket(BUCKET, {
    // PRIVADO. Ver o cabeçalho deste arquivo.
    public: false,
    fileSizeLimit: LIMITE_BYTES
  });
  // "already exists" acontece quando dois uploads chegam juntos na primeira
  // vez: é sucesso, não falha.
  if (erroCriar && !/already exists/i.test(erroCriar.message || '')) {
    throw new Error(`Não consegui preparar o armazenamento de anexos: ${erroCriar.message}`);
  }
  console.warn(`[anexos] Bucket "${BUCKET}" criado no Supabase Storage (privado, ${LIMITE_BYTES} bytes por arquivo).`);
  bucketConferido = true;
}

/**
 * Sobe um arquivo e devolve a FICHA para gravar no pedido.
 * @param {string} registroId id do pedido/orçamento — vira a pasta
 * @param {{nome:string, tipo:string, conteudoBase64:string}} arquivo
 * @param {{id:string, name:string}} user
 */
async function enviarAnexo(registroId, arquivo, user) {
  const nome = String(arquivo.nome || '').trim();
  if (!nome) {
    const err = new Error('Arquivo sem nome.');
    err.status = 400;
    throw err;
  }
  const bruto = String(arquivo.conteudoBase64 || '');
  // Aceita tanto "data:application/pdf;base64,XXXX" quanto o base64 puro: o
  // FileReader do navegador devolve o primeiro formato.
  const base64 = bruto.includes(',') ? bruto.slice(bruto.indexOf(',') + 1) : bruto;
  if (!base64) {
    const err = new Error('Arquivo vazio.');
    err.status = 400;
    throw err;
  }
  const bytes = Buffer.from(base64, 'base64');
  if (!bytes.length) {
    const err = new Error('Não consegui ler o conteúdo do arquivo.');
    err.status = 400;
    throw err;
  }
  if (bytes.length > LIMITE_BYTES) {
    const err = new Error(`"${nome}" tem ${(bytes.length / 1024 / 1024).toFixed(1)} MB e o limite por arquivo é ${LIMITE_BYTES / 1024 / 1024} MB.`);
    err.status = 400;
    throw err;
  }

  await garantirBucket();

  const id = `anx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const caminho = `pedidos/${registroId}/${id}-${nomeTecnico(nome)}`;
  const { error } = await supabase.storage.from(BUCKET).upload(caminho, bytes, {
    contentType: arquivo.tipo || 'application/octet-stream',
    // Sem upsert: o caminho já é único pelo id, e permitir sobrescrita
    // transformaria uma colisão improvável em perda silenciosa de arquivo.
    upsert: false
  });
  if (error) throw new Error(`Falha ao enviar "${nome}": ${error.message}`);

  return {
    id,
    nome,
    tamanho: bytes.length,
    tipo: arquivo.tipo || '',
    caminho,
    enviadoEm: new Date().toISOString(),
    // Nome, e não só id: quem enviou tem de continuar legível mesmo depois de o
    // usuário ser desativado ou renomeado.
    enviadoPor: (user && user.name) || (user && user.username) || ''
  };
}

// Devolve { bytes, tipo } para o servidor entregar. Não devolve URL: ver o
// cabeçalho deste arquivo.
async function baixarAnexo(ficha) {
  const { data, error } = await supabase.storage.from(BUCKET).download(ficha.caminho);
  if (error || !data) throw new Error(`Não consegui baixar "${ficha.nome}": ${(error && error.message) || 'arquivo não encontrado'}`);
  const buffer = Buffer.from(await data.arrayBuffer());
  return { bytes: buffer, tipo: ficha.tipo || data.type || 'application/octet-stream' };
}

async function removerAnexo(ficha) {
  const { error } = await supabase.storage.from(BUCKET).remove([ficha.caminho]);
  // Arquivo já ausente no Storage não impede tirar a ficha do pedido: o
  // resultado que a pessoa pediu — o anexo sumir da lista — é o mesmo, e
  // travar aqui deixaria uma ficha órfã impossível de remover pela tela.
  if (error && !/not found/i.test(error.message || '')) {
    throw new Error(`Não consegui remover "${ficha.nome}": ${error.message}`);
  }
}

module.exports = { BUCKET, LIMITE_BYTES, nomeTecnico, garantirBucket, enviarAnexo, baixarAnexo, removerAnexo };
