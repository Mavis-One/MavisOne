// Criptografia em repouso para segredos guardados em colunas bytea (ex.:
// estabelecimento.focus_token_cifrado). AES-256-GCM com chave fixa do .env.
const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

function getKey() {
  const raw = String(process.env.FOCUS_TOKEN_ENCRYPTION_KEY || '').trim();
  if (!raw) {
    const err = new Error('FOCUS_TOKEN_ENCRYPTION_KEY não configurada no .env.');
    err.status = 501;
    throw err;
  }
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error('FOCUS_TOKEN_ENCRYPTION_KEY inválida — precisa decodificar para 32 bytes em base64.');
  }
  return key;
}

// Retorna um literal bytea (\x...) pronto pra gravar via PostgREST/supabase-js.
function encryptToBytea(plainText) {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(String(plainText), 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const packed = Buffer.concat([iv, authTag, ciphertext]);
  return `\\x${packed.toString('hex')}`;
}

// Recebe o literal bytea (\x...) devolvido pelo PostgREST e retorna o texto original.
function decryptFromBytea(byteaLiteral) {
  if (!byteaLiteral) return null;
  const key = getKey();
  const hex = String(byteaLiteral).startsWith('\\x') ? byteaLiteral.slice(2) : byteaLiteral;
  const packed = Buffer.from(hex, 'hex');
  const iv = packed.subarray(0, IV_LENGTH);
  const authTag = packed.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = packed.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

module.exports = { encryptToBytea, decryptFromBytea };
