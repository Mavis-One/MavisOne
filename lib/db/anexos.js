/**
 * ANEXOS DE PEDIDO — o binário numa tabela, a ficha no pedido.
 *
 * A separação continua sendo a mesma de sempre, e é ela que faz a coisa
 * funcionar: a FICHA (nome, tamanho, quem enviou) vive em orders.attachments,
 * e o ARQUIVO vive fora dela. Listar pedidos nunca toca em um byte de anexo.
 *
 * O QUE MUDOU NA FASE AM
 * ----------------------
 * O "fora dela" era o Supabase Storage. Com a saída do Supabase, passou a ser a
 * tabela `pedido_anexo` deste mesmo banco. A ficha não mudou de formato: o `id`
 * dela é a chave da linha lá, e é assim que uma acha a outra.
 *
 * O ARQUIVO FICOU MAIS PRIVADO, NÃO MENOS
 * ---------------------------------------
 * Antes o bucket era privado e o servidor buscava os bytes com a chave de
 * serviço para não expor URL. Agora não existe URL nenhuma para expor: o único
 * caminho até o binário é uma consulta feita pelo servidor, depois do portão de
 * permissão. O que antes era uma decisão de configuração (bucket privado, que
 * alguém podia inverter num painel) virou uma propriedade do desenho.
 *
 * E SUMIU O SANEAMENTO DE NOME DE ARQUIVO
 * ---------------------------------------
 * Existia um `nomeTecnico()` que tirava "../" e acento do nome antes de ele
 * virar caminho no bucket. Não existe mais caminho: o nome do arquivo não é
 * usado para endereçar nada, é só um texto numa coluna. Não há o que sanear
 * porque não há travessia possível. O nome original continua preservado, e o
 * download já o entrega codificado (RFC 5987) no Content-Disposition.
 */

const { supabase } = require('./client');

// 10 MB por arquivo. Não é um número mágico: é o que cabe numa proposta em PDF
// com imagens, e o teto existe porque o upload chega em base64 dentro do JSON
// — sem limite, um arquivo grande derruba o servidor por memória antes de
// chegar ao banco.
const LIMITE_BYTES = 10 * 1024 * 1024;

const bytesParaHex = (buffer) => `\\x${buffer.toString('hex')}`;
const hexParaBytes = (texto) => Buffer.from(String(texto).replace(/^\\x/, ''), 'hex');

/**
 * O Content-Type volta cru para o cabeçalho da resposta, e cabeçalho com quebra
 * de linha dentro é injeção. O tipo vem do navegador de quem envia, então não é
 * dado confiável. Peneira estreita de propósito: o que não parecer um MIME
 * simples vira o genérico, que é sempre seguro entregar.
 */
function tipoSeguro(tipo) {
  const limpo = String(tipo || '').trim();
  return /^[a-zA-Z0-9!#$&^_.+-]+\/[a-zA-Z0-9!#$&^_.+-]+$/.test(limpo) ? limpo : 'application/octet-stream';
}

/**
 * Sobe um arquivo e devolve a FICHA para gravar no pedido.
 * @param {string} registroId id do pedido/orçamento
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

  const id = `anx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const tipo = tipoSeguro(arquivo.tipo);
  const enviadoEm = new Date().toISOString();
  // Nome, e não só id: quem enviou tem de continuar legível mesmo depois de o
  // usuário ser desativado ou renomeado.
  const enviadoPor = (user && user.name) || (user && user.username) || '';

  const { error } = await supabase.from('pedido_anexo').insert({
    id,
    registro_id: registroId,
    nome,
    tipo,
    tamanho: bytes.length,
    conteudo: bytesParaHex(bytes),
    enviado_em: enviadoEm,
    enviado_por: enviadoPor
  });
  if (error) throw new Error(`Falha ao enviar "${nome}": ${error.message}`);

  return { id, nome, tamanho: bytes.length, tipo, enviadoEm, enviadoPor };
}

/**
 * Devolve { bytes, tipo } para o servidor entregar. Não devolve URL, porque não
 * existe uma — ver o cabeçalho deste arquivo.
 */
async function baixarAnexo(ficha) {
  const { data, error } = await supabase
    .from('pedido_anexo')
    .select('conteudo, tipo, nome')
    .eq('id', ficha.id)
    .maybeSingle();
  if (error) throw new Error(`Não consegui baixar "${ficha.nome}": ${error.message}`);
  if (!data || !data.conteudo) {
    // Acontece com ficha antiga, de quando o arquivo morava no Storage do
    // Supabase e não veio junto na mudança. Dizer isso é melhor do que
    // entregar zero byte com cara de sucesso.
    throw new Error(`O arquivo "${ficha.nome}" não está neste banco (ficha antiga, de antes da fase AM).`);
  }
  return { bytes: hexParaBytes(data.conteudo), tipo: tipoSeguro(data.tipo || ficha.tipo) };
}

async function removerAnexo(ficha) {
  const { error } = await supabase.from('pedido_anexo').delete().eq('id', ficha.id);
  // Arquivo já ausente não impede tirar a ficha do pedido: o resultado que a
  // pessoa pediu — o anexo sumir da lista — é o mesmo, e travar aqui deixaria
  // uma ficha órfã impossível de remover pela tela.
  if (error) throw new Error(`Não consegui remover "${ficha.nome}": ${error.message}`);
}

module.exports = { LIMITE_BYTES, tipoSeguro, enviarAnexo, baixarAnexo, removerAnexo };
