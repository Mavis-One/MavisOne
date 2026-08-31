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

/**
 * NADA AQUI RODA COM `shell: true`, E O MOTIVO É A SENHA.
 *
 * A DATABASE_URL vai como argumento para o pg_dump, e ela carrega a senha do
 * banco dentro. Com shell:true o Node NÃO escapa os argumentos — ele concatena
 * tudo numa linha de comando e entrega ao cmd.exe. Uma senha com `&`, `|` ou
 * `"` deixaria de ser senha e viraria sintaxe: no melhor caso o backup falha
 * com um erro incompreensível, no pior o que vem depois do `&` é executado.
 *
 * Sem shell, o Node passa os argumentos direto para o processo, um a um, e o
 * conteúdo da senha deixa de ser interpretável. No Windows o CreateProcess já
 * procura no PATH e completa o `.exe` sozinho, então não se perde nada — foi
 * conferido rodando contra um pg_dump de verdade.
 */
function existeNoPath(programa) {
  const r = spawnSync(programa, ['--version'], { stdio: 'ignore' });
  return r.status === 0;
}

/**
 * A MESMA URL NÃO SERVE NOS DOIS LADOS — e essa suposição já custou um backup.
 *
 * A DATABASE_URL do .env descreve o caminho do HOST até o banco: `localhost` e
 * a porta PUBLICADA pelo compose. Dentro do container nada disso vale — lá o
 * Postgres escuta na 5432, e a porta publicada no host não existe.
 *
 * Enquanto a porta do host era 5432 a diferença ficava escondida, porque os
 * dois números batiam por coincidência. Numa máquina onde a 5432 já estava
 * ocupada (por um PostgreSQL nativo, por exemplo), o compose passou a publicar
 * na 5433 e o pg_dump de dentro do container foi procurar a 5433 lá dentro:
 * "connection refused", com o banco funcionando perfeitamente.
 *
 * Então a URL é reescrita: mesmo usuário, mesma senha, mesmo banco, mas host e
 * porta trocados pelos de dentro.
 */
function urlDentroDoContainer(url) {
  try {
    const u = new URL(url);
    u.hostname = '127.0.0.1';
    u.port = process.env.DOCKER_PORTA_INTERNA || '5432';
    return u.toString();
  } catch {
    // URL em formato exótico (libpq aceita mais coisa que a classe URL). Devolve
    // como veio: melhor tentar e falhar com a mensagem do pg_dump do que
    // inventar uma string.
    return url;
  }
}

/**
 * Decide COMO rodar o pg_dump e devolve { programa, argumentos, descricao }.
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
    argumentos: ['compose', 'exec', '-T', SERVICO, ferramenta, urlDentroDoContainer(url), ...argumentosDaFerramenta],
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

  /**
   * ESPERA AS DUAS COISAS: o processo TERMINAR e o arquivo TERMINAR de escrever.
   *
   * A primeira versão resolvia no 'close' do arquivo e lia `filho.exitCode` ali.
   * Não funciona: o stdout do filho acaba antes de o processo ser encerrado,
   * então o exitCode ainda era `null` — que o código lia como falha. Pior, o
   * stderr do pg_dump nem chegava a ser impresso, e o backup falhava
   * anunciando NADA. Foi exatamente o que aconteceu ao rodar via
   * `docker compose exec`, onde há mais latência entre uma coisa e outra.
   *
   * Agora o código de saída vem do evento 'close' do PROCESSO, que é o único
   * lugar onde ele existe de verdade, e a escrita é aguardada em separado para
   * o arquivo não ser medido antes de estar fechado.
   */
  const codigo = await new Promise((resolver) => {
    const filho = spawn(programa, argumentos, { cwd: RAIZ });
    const saida = fs.createWriteStream(parcial);
    const gzip = zlib.createGzip({ level: 9 });
    filho.stdout.pipe(gzip).pipe(saida);
    // O stderr do pg_dump é onde moram os erros de verdade; sem repassar, uma
    // falha de conexão viraria um arquivo vazio e um sucesso aparente.
    filho.stderr.on('data', (pedaco) => process.stderr.write(pedaco));

    let codigoDoProcesso = null;
    let arquivoFechado = false;
    const talvezResolver = () => {
      if (codigoDoProcesso !== null && arquivoFechado) resolver(codigoDoProcesso);
    };
    filho.on('error', (erro) => { console.error(`[backup] não consegui executar ${programa}: ${erro.message}`); resolver(1); });
    filho.on('close', (c) => { codigoDoProcesso = c === null ? 1 : c; talvezResolver(); });
    saida.on('close', () => { arquivoFechado = true; talvezResolver(); });
    saida.on('error', (erro) => { console.error(`[backup] falha ao gravar o arquivo: ${erro.message}`); resolver(1); });
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
