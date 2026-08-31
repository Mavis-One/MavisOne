#!/usr/bin/env node
/**
 * BACKUP DO BANCO — pg_dump de verdade, estrutura e dados.
 *
 *   npm run backup
 *
 * O QUE MUDOU, E POR QUE ISTO É MELHOR DO QUE O QUE HAVIA
 * ------------------------------------------------------
 * O backup antigo (backup-supabase.js) exportava tabela por tabela pelo
 * PostgREST, porque a máquina de desenvolvimento não tinha pg_dump nem Postgres
 * instalado. Ele trazia DADOS e não trazia estrutura: função, gatilho, índice,
 * sequência e comentário ficavam de fora, e a restauração dependia de o
 * schema.sql estar aplicado antes. Também precisava reordenar as tabelas por
 * dependência à mão e quebrar ciclos de chave estrangeira numa segunda passada
 * — código difícil que só existia por falta da ferramenta certa.
 *
 * Com o banco em Docker, a ferramenta certa está a um comando de distância: o
 * pg_dump que vem DENTRO do container. Ele resolve ordenação, ciclos, colunas
 * de identidade e estrutura sem nenhuma linha da nossa parte.
 *
 * E OS ANEXOS?
 * ------------
 * Vêm juntos. Desde a fase AM o binário dos anexos é a tabela `pedido_anexo`,
 * então o dump cobre o sistema inteiro num arquivo só. Antes eram duas coisas
 * (dados + arquivos do Storage) que precisavam ser restauradas no mesmo ponto
 * no tempo, e a que se esquece é sempre a segunda.
 *
 * ONDE ELE ACHA O pg_dump
 * -----------------------
 * Primeiro no PATH, se você tiver o cliente do Postgres instalado. Se não
 * tiver, usa o do container — que é o caso normal aqui, e tem a vantagem de a
 * versão do pg_dump bater com a do servidor por construção. pg_dump mais VELHO
 * que o servidor recusa a conexão.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { spawnSync, spawn } = require('child_process');

const RAIZ = path.join(__dirname, '..');
const DESTINO = path.join(RAIZ, 'data', 'backup');
const SERVICO = process.env.DOCKER_SERVICO_BANCO || 'banco';

function urlDoBanco() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL não está definida. Veja .env.example.');
    process.exit(1);
  }
  return url;
}

function existeNoPath(programa) {
  const r = spawnSync(programa, ['--version'], { stdio: 'ignore', shell: process.platform === 'win32' });
  return r.status === 0;
}

/**
 * Decide COMO rodar o pg_dump e devolve { programa, argumentos, descricao }.
 *
 * Dentro do container, "localhost:5432" é o próprio Postgres — então a mesma
 * DATABASE_URL do .env funciona nos dois caminhos, sem reescrever a string.
 */
function comoRodar(ferramenta, argumentosDaFerramenta) {
  const url = urlDoBanco();
  if (existeNoPath(ferramenta)) {
    return {
      programa: ferramenta,
      argumentos: [url, ...argumentosDaFerramenta],
      descricao: `${ferramenta} do sistema`
    };
  }
  return {
    programa: 'docker',
    // -T porque não há terminal: sem isso o docker tenta alocar TTY e o
    // conteúdo binário do dump chega corrompido na saída.
    argumentos: ['compose', 'exec', '-T', SERVICO, ferramenta, url, ...argumentosDaFerramenta],
    descricao: `${ferramenta} de dentro do container "${SERVICO}"`
  };
}

async function main() {
  if (!existeNoPath('pg_dump') && !existeNoPath('docker')) {
    console.error('Não achei pg_dump no PATH nem o docker para usar o do container.');
    console.error('Instale o Docker Desktop e suba o banco com: docker compose up -d');
    process.exit(1);
  }

  fs.mkdirSync(DESTINO, { recursive: true });
  const carimbo = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const arquivo = path.join(DESTINO, `mavisone-${carimbo}.sql.gz`);
  // Grava com sufixo e só renomeia no fim: um dump interrompido no meio ficaria
  // com nome de backup bom, e ninguém descobre até precisar dele.
  const parcial = `${arquivo}.parcial`;

  const { programa, argumentos, descricao } = comoRodar('pg_dump', [
    // Os papéis do servidor de origem não existem no destino, e sem isto a
    // restauração falha em toda linha de GRANT/OWNER TO.
    '--no-owner', '--no-privileges',
    // O restaurador deste repositório recria por cima de um banco que já
    // existe; sem o --clean, cada objeto colidiria com o que já está lá.
    '--clean', '--if-exists'
  ]);

  console.log(`[backup] usando ${descricao}`);
  console.log(`[backup] gerando ${path.relative(RAIZ, arquivo)}`);

  const codigo = await new Promise((resolver) => {
    const filho = spawn(programa, argumentos, { cwd: RAIZ, shell: process.platform === 'win32' });
    const saida = fs.createWriteStream(parcial);
    const gzip = zlib.createGzip({ level: 9 });
    filho.stdout.pipe(gzip).pipe(saida);
    // O stderr do pg_dump é onde moram os erros de verdade; sem repassar, uma
    // falha de conexão viraria um arquivo vazio e um sucesso aparente.
    filho.stderr.on('data', (pedaco) => process.stderr.write(pedaco));
    filho.on('error', (erro) => { console.error(`[backup] não consegui executar ${programa}: ${erro.message}`); resolver(1); });
    saida.on('close', () => resolver(filho.exitCode === null ? 1 : filho.exitCode));
  });

  if (codigo !== 0) {
    fs.rmSync(parcial, { force: true });
    console.error(`\n[backup] FALHOU (código ${codigo}) — nada foi gravado.`);
    process.exit(1);
  }

  const tamanho = fs.statSync(parcial).size;
  if (tamanho < 1024) {
    fs.rmSync(parcial, { force: true });
    console.error(`\n[backup] o dump saiu com ${tamanho} bytes, o que não é um banco. Nada foi gravado.`);
    process.exit(1);
  }

  fs.renameSync(parcial, arquivo);
  console.log(`\n[backup] ok — ${(tamanho / 1024 / 1024).toFixed(2)} MB`);
  console.log(`\nRestaure com:  node scripts/restaurar-banco.js ${path.relative(RAIZ, arquivo).replace(/\\/g, '/')}`);
}

main().catch((erro) => { console.error(erro); process.exit(1); });
