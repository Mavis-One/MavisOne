#!/usr/bin/env node
/**
 * BACKUP DO SISTEMA — o Postgres e o estado do app, num arquivo só.
 *
 *   npm run backup
 *
 * O QUE MUDOU, E POR QUE ISTO É MELHOR DO QUE O QUE HAVIA
 * ------------------------------------------------------
 * O backup antigo (backup-supabase.js) exportava tabela por tabela pelo
 * PostgREST, porque a máquina de desenvolvimento não tinha pg_dump nem Postgres
 * instalado. Ele trazia DADOS e não trazia estrutura: função, gatilho, índice,
 * sequência e comentário ficavam de fora.
 *
 * Com o banco em Docker, a ferramenta certa está a um comando de distância: o
 * pg_dump que vem DENTRO do container. Ele resolve ordenação, ciclos, colunas
 * de identidade e estrutura sem nenhuma linha da nossa parte.
 *
 * E O QUE NÃO ESTÁ NO POSTGRES?
 * -----------------------------
 * Este era o buraco, e ele era silencioso. `pg_dump` copia o Postgres — e parte
 * do sistema não mora nele: o razão de ESTOQUE (stockMovements,
 * stockTransfers) e os lançamentos do Financeiro vivem em data/db.json, e não
 * existe tabela stock_movements no banco. O backup se anunciava como "o sistema
 * inteiro" e copiava o Postgres inteiro, que é outra coisa.
 *
 * O artefato agora é um .tar.gz com as duas metades dentro:
 *
 *     banco.sql       a saída do pg_dump
 *     estado.json     cópia do data/db.json
 *     manifesto.json  o que é cada membro, de quando, e o sha256 de cada um
 *
 * UM arquivo, de propósito. Dois seriam duas coisas para restaurar no mesmo
 * ponto no tempo, e a segunda é sempre a que alguém esquece — foi exatamente o
 * que aconteceu quando os anexos moravam fora do banco (fase AM).
 *
 * Os .sql.gz antigos continuam restauráveis. Um backup que deixa de abrir não é
 * compatibilidade, é perda.
 *
 * O QUE ESTE ARQUIVO NÃO RESOLVE
 * ------------------------------
 * As duas metades são tiradas em momentos DIFERENTES — poucos segundos, mas
 * diferentes. Uma venda finalizada nesse intervalo pode ter o movimento de
 * estoque no estado.json e a nota no banco.sql, ou o contrário. O manifesto
 * grava os dois instantes e a janela entre eles justamente para que quem
 * restaura saiba o tamanho do que herdou. Fechar a janela de verdade exigiria
 * congelar o sistema durante a cópia, que é caro demais para o que protege.
 */
require('dotenv').config();
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync, spawn } = require('child_process');

const RAIZ = path.join(__dirname, '..');
const DESTINO = path.join(RAIZ, 'data', 'backup');
// O mesmo caminho que o server.js fixa em DATA_FILE. Se ele mudar de lugar lá,
// muda aqui — e o test-backup-restauracao.js acusa, porque a marca não voltaria.
const ESTADO = path.join(RAIZ, 'data', 'db.json');
const SERVICO = process.env.DOCKER_SERVICO_BANCO || 'banco';

// Versão do formato do artefato. O restaurador recusa o que não souber ler, em
// vez de tentar e deixar o sistema pela metade.
const VERSAO_FORMATO = 1;
const MEMBRO_BANCO = 'banco.sql';
const MEMBRO_ESTADO = 'estado.json';
const MEMBRO_MANIFESTO = 'manifesto.json';

// pg_dump termina o arquivo com esta linha (o `\unrestrict` do PG 17 vem depois
// dela, então não adianta olhar só a última). Sem esta conferência, um dump
// interrompido no meio — lock, container reiniciado, disco cheio — sai grande,
// bem formado até onde chegou, e é promovido a backup bom.
const MARCA_FIM_DO_DUMP = '-- PostgreSQL database dump complete';

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

/** Decide COMO rodar o pg_dump e devolve { programa, argumentos, descricao }. */
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

/**
 * TAR COM `cwd` E NOMES RELATIVOS — nunca com caminho absoluto.
 *
 * O GNU tar interpreta `C:/pasta/arquivo.tar.gz` como `host:caminho`, a sintaxe
 * de tar remoto, e falha com "Cannot connect to C: resolve failed" — uma
 * mensagem sobre REDE para um problema que não tem nada de rede. Isso derrubaria
 * o backup em toda máquina Windows.
 *
 * Passando `cwd` e nomes relativos, nenhuma letra de unidade chega ao tar.
 * Conferido contra o GNU tar 1.35 (Git Bash) e o bsdtar 3.8.4 (Windows): os
 * dois criam, listam e extraem, e leem o arquivo um do outro. O busybox do
 * container também — é formato padrão.
 */
function rodarTar(argumentos, cwd) {
  return spawnSync('tar', argumentos, { cwd, encoding: 'utf8' });
}

function sha256(caminho) {
  return crypto.createHash('sha256').update(fs.readFileSync(caminho)).digest('hex');
}

/** O dump, num arquivo de verdade — não num pipe. */
async function gerarDump(destinoSql) {
  const { programa, argumentos, descricao } = comoRodar('pg_dump', [
    // Os papéis do servidor de origem não existem no destino, e sem isto a
    // restauração falha em toda linha de GRANT/OWNER TO.
    '--no-owner', '--no-privileges',
    // O restaurador deste repositório recria por cima de um banco que já
    // existe; sem o --clean, cada objeto colidiria com o que já está lá.
    '--clean', '--if-exists'
  ]);
  console.log(`[backup] usando ${descricao}`);

  /**
   * ESPERA AS DUAS COISAS: o processo TERMINAR e o arquivo TERMINAR de escrever.
   *
   * A primeira versão resolvia no 'close' do arquivo e lia `filho.exitCode` ali.
   * Não funciona: o stdout do filho acaba antes de o processo ser encerrado,
   * então o exitCode ainda era `null` — que o código lia como falha. Pior, o
   * stderr do pg_dump nem chegava a ser impresso, e o backup falhava
   * anunciando NADA.
   */
  const codigo = await new Promise((resolver) => {
    const filho = spawn(programa, argumentos, { cwd: RAIZ });
    const saida = fs.createWriteStream(destinoSql);
    filho.stdout.pipe(saida);
    filho.stderr.on('data', (pedaco) => process.stderr.write(pedaco));

    let codigoDoProcesso = null;
    let arquivoFechado = false;
    const talvezResolver = () => {
      if (codigoDoProcesso !== null && arquivoFechado) resolver(codigoDoProcesso);
    };
    filho.on('error', (erro) => { console.error(`[backup] não consegui executar ${programa}: ${erro.message}`); resolver(1); });
    filho.on('close', (c) => { codigoDoProcesso = c === null ? 1 : c; talvezResolver(); });
    saida.on('close', () => { arquivoFechado = true; talvezResolver(); });
    saida.on('error', (erro) => { console.error(`[backup] falha ao gravar o dump: ${erro.message}`); resolver(1); });
  });

  if (codigo !== 0) throw new Error(`pg_dump terminou com código ${codigo}.`);

  const bytes = fs.statSync(destinoSql).size;
  if (bytes < 1024) throw new Error(`o dump saiu com ${bytes} bytes, o que não é um banco.`);

  // O marcador de fim fica nas ÚLTIMAS linhas, não na última: o PG 17 escreve
  // um `\unrestrict` depois dele.
  const fim = fs.readFileSync(destinoSql, 'utf8').slice(-4096);
  if (!fim.includes(MARCA_FIM_DO_DUMP)) {
    throw new Error('o dump não termina com a marca de conclusão do pg_dump — saiu truncado.');
  }
  return bytes;
}

/**
 * O ESTADO PRECISA SER COPIADO SEM PEGAR O ARQUIVO PELA METADE.
 *
 * O server.js grava o db.json com temporário + rename (atômico), então o leitor
 * enxerga sempre um arquivo inteiro. A conferência abaixo continua valendo por
 * dois motivos: um servidor mais antigo, ainda rodando, pode estar usando o
 * writeFileSync direto de antes; e um JSON inválido por qualquer outro motivo
 * não pode entrar num artefato que se anuncia como restaurável.
 */
function copiarEstado(destinoJson) {
  if (!fs.existsSync(ESTADO)) {
    return { ausente: true, motivo: `não existe ${path.relative(RAIZ, ESTADO)} nesta máquina` };
  }
  let ultimoErro = '';
  for (let tentativa = 1; tentativa <= 3; tentativa++) {
    const antes = fs.statSync(ESTADO);
    fs.copyFileSync(ESTADO, destinoJson);
    const depois = fs.statSync(ESTADO);
    // Mudou embaixo da cópia? Refaz — a cópia pode ser de dois momentos.
    if (antes.mtimeMs !== depois.mtimeMs || antes.size !== depois.size) {
      ultimoErro = 'o arquivo mudou durante a cópia';
      continue;
    }
    try {
      const conteudo = JSON.parse(fs.readFileSync(destinoJson, 'utf8'));
      if (!conteudo || typeof conteudo !== 'object') throw new Error('não é um objeto');
      return { ausente: false, bytes: fs.statSync(destinoJson).size, colecoes: Object.keys(conteudo).length };
    } catch (erro) {
      ultimoErro = `não é JSON válido (${erro.message})`;
    }
  }
  throw new Error(`não consegui copiar o estado em 3 tentativas: ${ultimoErro}.`);
}

async function main() {
  if (!existeNoPath('pg_dump') && !existeNoPath('docker')) {
    console.error('Não achei pg_dump no PATH nem o docker para usar o do container.');
    console.error('Instale o Docker Desktop e suba o banco com: docker compose up -d');
    process.exit(1);
  }
  if (!existeNoPath('tar')) {
    console.error('Não achei o `tar` no PATH — é ele que empacota o banco e o estado num arquivo só.');
    console.error('No Windows 10+ ele vem em C:\\Windows\\System32\\tar.exe; no Linux, no pacote tar.');
    process.exit(1);
  }

  fs.mkdirSync(DESTINO, { recursive: true });
  const carimbo = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const arquivo = path.join(DESTINO, `mavisone-${carimbo}.tar.gz`);

  // ÁREA DE MONTAGEM ÚNICA POR EXECUÇÃO, e fora de data/backup.
  //
  // Nome fixo faria a execução de hoje herdar o banco.sql que a de ontem
  // deixou pela metade ao ser interrompida. E dentro de data/backup os arquivos
  // soltos entrariam no alcance da poda e do envio para fora da máquina.
  const montagem = fs.mkdtempSync(path.join(os.tmpdir(), 'mavisone-backup-'));
  const limpar = () => { try { fs.rmSync(montagem, { recursive: true, force: true }); } catch { /* já foi */ } };

  try {
    console.log(`[backup] gerando ${path.relative(RAIZ, arquivo)}`);

    const inicioDump = new Date().toISOString();
    const bytesBanco = await gerarDump(path.join(montagem, MEMBRO_BANCO));

    const momentoEstado = new Date().toISOString();
    const estado = copiarEstado(path.join(montagem, MEMBRO_ESTADO));
    if (estado.ausente) console.log(`[backup] AVISO: sem estado do app — ${estado.motivo}`);

    const membros = [MEMBRO_BANCO, ...(estado.ausente ? [] : [MEMBRO_ESTADO])];
    const manifesto = {
      versaoFormato: VERSAO_FORMATO,
      geradoPor: 'scripts/backup-banco.js',
      geradoEm: new Date().toISOString(),
      // Os dois instantes e a janela entre eles: quem restaura precisa saber
      // que as metades não são do mesmo segundo. Ver o cabeçalho.
      dumpIniciadoEm: inicioDump,
      estadoCopiadoEm: estado.ausente ? null : momentoEstado,
      janelaSegundos: estado.ausente ? null : Math.round((Date.parse(momentoEstado) - Date.parse(inicioDump)) / 1000),
      estadoAusente: estado.ausente ? estado.motivo : null,
      membros: membros.map((nome) => ({
        nome,
        bytes: fs.statSync(path.join(montagem, nome)).size,
        sha256: sha256(path.join(montagem, nome))
      }))
    };
    fs.writeFileSync(path.join(montagem, MEMBRO_MANIFESTO), JSON.stringify(manifesto, null, 2));

    const pacote = 'artefato.tar.gz';
    const empacotar = rodarTar(['-czf', pacote, ...membros, MEMBRO_MANIFESTO], montagem);
    if (empacotar.status !== 0) throw new Error(`tar falhou: ${String(empacotar.stderr || '').trim()}`);

    // LER DE VOLTA ANTES DE PROMOVER A BACKUP BOM.
    //
    // Um .tar.gz truncado (disco cheio, processo morto no meio do gzip) passa
    // folgado em qualquer teste de tamanho. Listar o conteúdo descomprime tudo
    // e valida o CRC do gzip de quebra — é o teste mais barato que prova que o
    // arquivo abre.
    const conferir = rodarTar(['-tzf', pacote], montagem);
    if (conferir.status !== 0) throw new Error('o arquivo gerado não abre para leitura.');
    // O bsdtar do Windows termina as linhas com \r; sem aparar, nenhum nome bate.
    const dentro = String(conferir.stdout || '').split('\n').map((l) => l.trim().replace(/^\.\//, '')).filter(Boolean);
    const esperados = [...membros, MEMBRO_MANIFESTO];
    const faltando = esperados.filter((n) => !dentro.includes(n));
    if (faltando.length) throw new Error(`o arquivo saiu sem: ${faltando.join(', ')}.`);

    // Só agora vai para o destino. O `.parcial` e o rename final acontecem no
    // MESMO sistema de arquivos, que é o que torna a troca de nome atômica —
    // um artefato só ganha nome de backup depois de estar inteiro.
    const parcial = `${arquivo}.parcial`;
    fs.copyFileSync(path.join(montagem, pacote), parcial);
    fs.renameSync(parcial, arquivo);

    const mb = (fs.statSync(arquivo).size / 1024 / 1024).toFixed(2);
    console.log(`\n[backup] ok — ${mb} MB`);
    console.log(`  banco.sql    ${(bytesBanco / 1024 / 1024).toFixed(2)} MB`);
    console.log(estado.ausente
      ? `  estado.json  AUSENTE (${estado.motivo})`
      : `  estado.json  ${(estado.bytes / 1024).toFixed(1)} KB — ${estado.colecoes} coleções (estoque, financeiro e o resto do db.json)`);
    console.log(`\nRestaure com:  node scripts/restaurar-banco.js ${path.relative(RAIZ, arquivo).replace(/\\/g, '/')}`);
  } catch (erro) {
    fs.rmSync(`${arquivo}.parcial`, { force: true });
    console.error(`\n[backup] FALHOU — nada foi gravado. ${erro.message}`);
    limpar();
    process.exit(1);
  }
  limpar();
}

main().catch((erro) => { console.error(erro); process.exit(1); });
