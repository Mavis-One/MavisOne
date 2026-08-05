// Criptografia em repouso para segredos guardados em colunas bytea (ex.:
// estabelecimento.focus_token_cifrado, open_finance_connections.credenciais_cifradas).
// AES-256-GCM. Cada domínio usa sua própria chave (env var própria) — um
// vazamento da chave da Focus NFe não compromete as credenciais bancárias
// do Open Finance, e vice-versa — mas o código de cifra/decifra é o mesmo.
const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const DEFAULT_KEY_ENV_VAR = 'FOCUS_TOKEN_ENCRYPTION_KEY';

function getKey(keyEnvVar) {
  const envVar = keyEnvVar || DEFAULT_KEY_ENV_VAR;
  const raw = String(process.env[envVar] || '').trim();
  if (!raw) {
    const err = new Error(`${envVar} não configurada no .env.`);
    err.status = 501;
    throw err;
  }
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error(`${envVar} inválida — precisa decodificar para 32 bytes em base64.`);
  }
  return key;
}

// Retorna um literal bytea (\x...) pronto pra gravar via PostgREST/supabase-js.
function encryptToBytea(plainText, keyEnvVar) {
  const key = getKey(keyEnvVar);
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(String(plainText), 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const packed = Buffer.concat([iv, authTag, ciphertext]);
  return `\\x${packed.toString('hex')}`;
}

// Recebe o literal bytea (\x...) devolvido pelo PostgREST e retorna o texto original.
function decryptFromBytea(byteaLiteral, keyEnvVar) {
  if (!byteaLiteral) return null;
  const key = getKey(keyEnvVar);
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
