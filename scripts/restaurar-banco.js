#!/usr/bin/env node
/**
 * RESTAURAR O BANCO a partir de um backup do npm run backup.
 *
 *   node scripts/restaurar-banco.js data/backup/mavisone-2026-08-31T12-00-00.sql.gz --confirmo
 *
 * ISTO APAGA O BANCO ATUAL. O dump é gerado com --clean --if-exists, ou seja,
 * ele derruba cada objeto antes de recriá-lo. Não existe desfazer.
 *
 * POR QUE EXIGE --confirmo
 * ------------------------
 * Porque o comando é curto, mora no histórico do terminal e a diferença entre
 * restaurar em desenvolvimento e restaurar em produção é uma variável de
 * ambiente que ninguém relê antes de apertar Enter. A trava não protege de
 * quem quer restaurar — protege de quem apertou seta-para-cima duas vezes.
 *
 * O script mostra PARA ONDE vai escrever antes de pedir a confirmação, com a
 * senha escondida. É o único jeito de a pessoa conferir o alvo sem abrir o .env.
 *
 * UM BACKUP QUE NUNCA FOI RESTAURADO NÃO É UM BACKUP, É UM ARQUIVO.
 * scripts/test-backup-restauracao.js faz a volta completa contra o banco de
 * verdade; rode-o depois de mexer aqui.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { spawnSync, spawn } = require('child_process');

const RAIZ = path.join(__dirname, '..');
const SERVICO = process.env.DOCKER_SERVICO_BANCO || 'banco';

function existeNoPath(programa) {
  // Sem shell:true. A DATABASE_URL leva a senha do banco como argumento, e
  // shell:true concatena argumentos sem escapar -- uma senha com & ou | viraria
  // sintaxe do cmd.exe. Ver o bloco equivalente em backup-banco.js.
  const r = spawnSync(programa, ['--version'], { stdio: 'ignore' });
  return r.status === 0;
}

/**
 * A URL do HOST reescrita para valer DENTRO do container.
 *
 * A DATABASE_URL descreve o caminho do host: `localhost` e a porta publicada
 * pelo compose. Lá dentro o Postgres escuta na 5432, e a porta do host não
 * existe. Enquanto as duas eram 5432 a diferença ficava escondida por
 * coincidência; numa máquina com a 5432 já ocupada, ela vira "connection
 * refused" com o banco funcionando. Mesma correção de backup-banco.js.
 */
function urlDentroDoContainer(url) {
  try {
    const u = new URL(url);
    u.hostname = '127.0.0.1';
    u.port = process.env.DOCKER_PORTA_INTERNA || '5432';
    return u.toString();
  } catch {
    return url;
  }
}

/** A URL sem a senha, para poder ser impressa e conferida. */
function alvoLegivel(url) {
  try {
    const u = new URL(url);
    return `${u.username}@${u.hostname}:${u.port || 5432}${u.pathname}`;
  } catch {
    return '(DATABASE_URL em formato não reconhecido)';
  }
}

async function main() {
  const argumentos = process.argv.slice(2);
  const confirmado = argumentos.includes('--confirmo');
  const alvo = argumentos.find((a) => !a.startsWith('--'));

  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL não está definida. Veja .env.example.');
    process.exit(1);
  }
  if (!alvo) {
    console.error('Uso: node scripts/restaurar-banco.js <arquivo.sql.gz> --confirmo');
    console.error('\nBackups disponíveis:');
    const dir = path.join(RAIZ, 'data', 'backup');
    const lista = fs.existsSync(dir) ? fs.readdirSync(dir).filter((n) => n.endsWith('.sql.gz')).sort().reverse() : [];
    if (!lista.length) console.error('  (nenhum — rode npm run backup primeiro)');
    lista.slice(0, 10).forEach((n) => console.error(`  data/backup/${n}`));
    process.exit(1);
  }

  const caminho = path.isAbsolute(alvo) ? alvo : path.join(RAIZ, alvo);
  if (!fs.existsSync(caminho)) {
    console.error(`Arquivo não encontrado: ${caminho}`);
    process.exit(1);
  }

  console.log(`  arquivo: ${path.relative(RAIZ, caminho)} (${(fs.statSync(caminho).size / 1024 / 1024).toFixed(2)} MB)`);
  console.log(`  destino: ${alvoLegivel(url)}`);

  if (!confirmado) {
    console.error('\nISTO APAGA O BANCO ACIMA e o substitui pelo conteúdo do arquivo.');
    console.error('Confira o destino na linha acima. Se for mesmo esse, repita o comando com --confirmo.');
    process.exit(1);
  }

  if (!existeNoPath('psql') && !existeNoPath('docker')) {
    console.error('Não achei psql no PATH nem o docker para usar o do container.');
    process.exit(1);
  }

  const usaLocal = existeNoPath('psql');
  const programa = usaLocal ? 'psql' : 'docker';
  const args = usaLocal
    // ON_ERROR_STOP: sem ele o psql segue depois de um erro e termina com
    // sucesso, deixando um banco restaurado PELA METADE — que é pior do que
    // uma restauração que falhou, porque parece ter dado certo.
    ? [url, '-v', 'ON_ERROR_STOP=1', '--quiet']
    // Dentro do container a URL do host não vale: lá o Postgres escuta na 5432,
    // e a porta publicada no host pode ser outra. Ver urlDentroDoContainer().
    : ['compose', 'exec', '-T', SERVICO, 'psql', urlDentroDoContainer(url), '-v', 'ON_ERROR_STOP=1', '--quiet'];

  console.log(`\n[restaurar] usando ${usaLocal ? 'psql do sistema' : `psql de dentro do container "${SERVICO}"`}`);

  const codigo = await new Promise((resolver) => {
    const filho = spawn(programa, args, { cwd: RAIZ });
    fs.createReadStream(caminho).pipe(zlib.createGunzip()).pipe(filho.stdin);
    filho.stdout.on('data', (p) => process.stdout.write(p));
    filho.stderr.on('data', (p) => process.stderr.write(p));
    filho.on('error', (erro) => { console.error(`[restaurar] não consegui executar ${programa}: ${erro.message}`); resolver(1); });
    filho.on('close', (c) => resolver(c === null ? 1 : c));
  });

  if (codigo !== 0) {
    console.error(`\n[restaurar] FALHOU (código ${codigo}). O banco pode ter ficado incompleto — restaure de novo antes de usar.`);
    process.exit(1);
  }

  console.log('\n[restaurar] ok. Confira com: npm run migracoes');
}

main().catch((erro) => { console.error(erro); process.exit(1); });
