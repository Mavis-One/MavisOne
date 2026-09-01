#!/usr/bin/env node
/**
 * RESTAURAR o sistema a partir de um backup.
 *
 *   node scripts/restaurar-banco.js data/backup/mavisone-....tar.gz --confirmo
 *
 * ISTO APAGA O BANCO ATUAL E O ESTADO ATUAL. O dump é gerado com
 * --clean --if-exists, ou seja, ele derruba cada objeto antes de recriá-lo, e o
 * data/db.json é substituído. Não existe desfazer — mas existe a cópia de
 * segurança que este script tira do db.json antes de trocá-lo.
 *
 * DOIS FORMATOS, DE PROPÓSITO
 * ---------------------------
 *   .tar.gz  banco.sql + estado.json + manifesto.json — o sistema inteiro.
 *   .sql.gz  só o Postgres. É o formato antigo, e continua sendo restaurável:
 *            um backup que deixa de abrir não é compatibilidade, é perda.
 *
 * Restaurar um .sql.gz é RESTAURAÇÃO PELA METADE e o script diz isso na cara:
 * o Postgres volta para a data do arquivo e o data/db.json continua sendo o de
 * hoje — estoque e Financeiro apontando para pedidos e notas que o banco
 * acabou de esquecer. Às vezes é exatamente o que se quer; nunca é o que se
 * quer por engano.
 *
 * POR QUE EXIGE --confirmo
 * ------------------------
 * Porque o comando é curto, mora no histórico do terminal e a diferença entre
 * restaurar em desenvolvimento e restaurar em produção é uma variável de
 * ambiente que ninguém relê antes de apertar Enter. A trava não protege de
 * quem quer restaurar — protege de quem apertou seta-para-cima duas vezes.
 *
 * POR QUE ELE SE RECUSA A RODAR COM O SISTEMA DE PÉ
 * -------------------------------------------------
 * Toda rota do server.js faz o par loadData() / saveData(). Uma requisição que
 * entrou um segundo antes da restauração já leu o estado velho da memória e vai
 * gravá-lo de volta DEPOIS — apagando o que acabou de ser restaurado, sem erro
 * nenhum na tela. Do lado do Postgres é pior: o pool mantém conexões abertas e
 * os DROP do --clean ficam esperando lock.
 *
 * UM BACKUP QUE NUNCA FOI RESTAURADO NÃO É UM BACKUP, É UM ARQUIVO.
 * scripts/test-backup-restauracao.js faz a volta completa contra o banco de
 * verdade; rode-o depois de mexer aqui.
 */
require('dotenv').config();
const fs = require('fs');
const os = require('os');
const http = require('http');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { spawnSync, spawn } = require('child_process');

const RAIZ = path.join(__dirname, '..');
const PASTA = path.join(RAIZ, 'data', 'backup');
const ESTADO = path.join(RAIZ, 'data', 'db.json');
const SERVICO = process.env.DOCKER_SERVICO_BANCO || 'banco';
const VERSAO_FORMATO_SUPORTADA = 1;

function existeNoPath(programa) {
  // Sem shell:true. A DATABASE_URL leva a senha do banco como argumento, e
  // shell:true concatena argumentos sem escapar -- uma senha com & ou | viraria
  // sintaxe do cmd.exe. Ver o bloco equivalente em backup-banco.js.
  const r = spawnSync(programa, ['--version'], { stdio: 'ignore' });
  return r.status === 0;
}

/** A URL do HOST reescrita para valer DENTRO do container. Ver backup-banco.js. */
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

/** Tar com cwd e nomes relativos — ver a explicação em backup-banco.js. */
function rodarTar(argumentos, cwd, opcoes = {}) {
  return spawnSync('tar', argumentos, { cwd, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, ...opcoes });
}

/**
 * O sistema está no ar? Se estiver, restaurar é jogar fora o trabalho.
 *
 * Pergunta pela porta do app, que é o sinal mais direto: se alguém responde,
 * há um processo com o estado em memória pronto para sobrescrever o que
 * acabamos de gravar.
 */
function sistemaNoAr(porta) {
  return new Promise((resolver) => {
    const req = http.request({ host: '127.0.0.1', port: porta, path: '/', method: 'HEAD', timeout: 1200 }, () => {
      req.destroy();
      resolver(true);
    });
    req.on('error', () => resolver(false));
    req.on('timeout', () => { req.destroy(); resolver(false); });
    req.end();
  });
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function listarDisponiveis() {
  if (!fs.existsSync(PASTA)) return [];
  return fs.readdirSync(PASTA)
    .filter((n) => n.endsWith('.tar.gz') || n.endsWith('.sql.gz'))
    .sort().reverse()
    .map((n) => ({ nome: n, completo: n.endsWith('.tar.gz') }));
}

function uso() {
  console.error('Uso: node scripts/restaurar-banco.js <arquivo.tar.gz|.sql.gz> --confirmo');
  console.error('  --somente-banco   restaura só o Postgres, sem tocar no data/db.json');
  console.error('\nBackups disponíveis:');
  const lista = listarDisponiveis();
  if (!lista.length) console.error('  (nenhum — rode npm run backup primeiro)');
  lista.slice(0, 10).forEach((b) => {
    console.error(`  data/backup/${b.nome}${b.completo ? '' : '   [formato antigo: SÓ o banco]'}`);
  });
}

/** Abre o .tar.gz numa área temporária e confere tudo ANTES de tocar em nada. */
function abrirPacote(caminho) {
  if (!existeNoPath('tar')) {
    throw new Error('não achei o `tar` no PATH, e este backup é um .tar.gz.');
  }
  const montagem = fs.mkdtempSync(path.join(os.tmpdir(), 'mavisone-restaura-'));
  // Copia para dentro da montagem para poder chamar o tar com nome relativo: o
  // GNU tar leria "C:/..." como host remoto. Ver backup-banco.js.
  const local = path.join(montagem, 'artefato.tar.gz');
  fs.copyFileSync(caminho, local);

  const extrair = rodarTar(['-xzf', 'artefato.tar.gz'], montagem);
  if (extrair.status !== 0) {
    throw new Error(`o arquivo não abre: ${String(extrair.stderr || '').trim() || 'tar falhou'}`);
  }

  const manifestoPath = path.join(montagem, 'manifesto.json');
  if (!fs.existsSync(manifestoPath)) {
    throw new Error('o arquivo não tem manifesto.json — não dá para saber o que ele contém nem se está inteiro.');
  }
  const manifesto = JSON.parse(fs.readFileSync(manifestoPath, 'utf8'));
  if (Number(manifesto.versaoFormato) !== VERSAO_FORMATO_SUPORTADA) {
    throw new Error(`formato versão ${manifesto.versaoFormato}; este script só sabe ler a ${VERSAO_FORMATO_SUPORTADA}. Use uma versão mais nova do sistema para restaurar.`);
  }

  // CONFERE CADA MEMBRO CONTRA O MANIFESTO. Um estado.json truncado deixaria o
  // sistema inteiro em erro 500 depois da troca — e o db.json bom já teria ido.
  for (const membro of manifesto.membros || []) {
    const alvo = path.join(montagem, membro.nome);
    if (!fs.existsSync(alvo)) throw new Error(`o manifesto anuncia ${membro.nome}, e ele não está no arquivo.`);
    const conteudo = fs.readFileSync(alvo);
    if (conteudo.length !== membro.bytes) {
      throw new Error(`${membro.nome} tem ${conteudo.length} bytes e o manifesto diz ${membro.bytes} — arquivo corrompido.`);
    }
    if (sha256(conteudo) !== membro.sha256) {
      throw new Error(`${membro.nome} não bate com o sha256 do manifesto — arquivo corrompido.`);
    }
  }

  const temEstado = (manifesto.membros || []).some((m) => m.nome === 'estado.json');
  if (temEstado) {
    // Já validado por sha; o parse aqui é contra o outro tipo de estrago: um
    // JSON íntegro que não é o estado do sistema.
    const estado = JSON.parse(fs.readFileSync(path.join(montagem, 'estado.json'), 'utf8'));
    if (!estado || typeof estado !== 'object' || Array.isArray(estado)) {
      throw new Error('o estado.json não é um objeto — não é o data/db.json.');
    }
  }

  return { montagem, manifesto, temEstado, sqlPath: path.join(montagem, 'banco.sql') };
}

async function rodarSql(lerConteudo) {
  const url = process.env.DATABASE_URL;
  const usaLocal = existeNoPath('psql');
  const programa = usaLocal ? 'psql' : 'docker';
  const args = usaLocal
    // ON_ERROR_STOP: sem ele o psql segue depois de um erro e termina com
    // sucesso, deixando um banco restaurado PELA METADE — que é pior do que
    // uma restauração que falhou, porque parece ter dado certo.
    ? [url, '-v', 'ON_ERROR_STOP=1', '--quiet']
    : ['compose', 'exec', '-T', SERVICO, 'psql', urlDentroDoContainer(url), '-v', 'ON_ERROR_STOP=1', '--quiet'];

  console.log(`[restaurar] usando ${usaLocal ? 'psql do sistema' : `psql de dentro do container "${SERVICO}"`}`);

  return new Promise((resolver) => {
    const filho = spawn(programa, args, { cwd: RAIZ });
    lerConteudo().pipe(filho.stdin);
    filho.stdout.on('data', (p) => process.stdout.write(p));
    filho.stderr.on('data', (p) => process.stderr.write(p));
    filho.on('error', (erro) => { console.error(`[restaurar] não consegui executar ${programa}: ${erro.message}`); resolver(1); });
    filho.on('close', (c) => resolver(c === null ? 1 : c));
  });
}

async function main() {
  const argumentos = process.argv.slice(2);
  const confirmado = argumentos.includes('--confirmo');
  const somenteBanco = argumentos.includes('--somente-banco');
  const alvo = argumentos.find((a) => !a.startsWith('--'));

  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL não está definida. Veja .env.example.');
    process.exit(1);
  }
  if (!alvo) { uso(); process.exit(1); }

  const caminho = path.isAbsolute(alvo) ? alvo : path.join(RAIZ, alvo);
  if (!fs.existsSync(caminho)) {
    console.error(`Arquivo não encontrado: ${caminho}`);
    process.exit(1);
  }

  const ehCompleto = caminho.endsWith('.tar.gz');
  if (!ehCompleto && !caminho.endsWith('.sql.gz')) {
    console.error('Formato não reconhecido. Este script lê .tar.gz (completo) e .sql.gz (só o banco).');
    process.exit(1);
  }

  let pacote = null;
  if (ehCompleto) {
    try {
      pacote = abrirPacote(caminho);
    } catch (erro) {
      console.error(`\n[restaurar] RECUSADO: ${erro.message}`);
      console.error('Nada foi tocado. Escolha outro backup.');
      process.exit(1);
    }
  }

  const vaiTocarNoEstado = ehCompleto && pacote.temEstado && !somenteBanco;

  console.log(`  arquivo: ${path.relative(RAIZ, caminho)} (${(fs.statSync(caminho).size / 1024 / 1024).toFixed(2)} MB)`);
  if (ehCompleto) {
    const m = pacote.manifesto;
    console.log(`  gerado em: ${m.geradoEm}${m.janelaSegundos != null ? ` (banco e estado separados por ${m.janelaSegundos}s)` : ''}`);
    if (!pacote.temEstado) {
      console.log(`  conteúdo: SÓ O BANCO — ${m.estadoAusente || 'este backup não trouxe o estado do app'}`);
    }
  }
  // OS DOIS DESTINOS, sempre. Antes só o Postgres aparecia, e quem confirmava
  // não fazia ideia de que o data/db.json daquela máquina seria substituído.
  console.log(`  destino 1 (banco):  ${alvoLegivel(url)}`);
  console.log(vaiTocarNoEstado
    ? `  destino 2 (estado): ${ESTADO}`
    : `  destino 2 (estado): NÃO SERÁ TOCADO${somenteBanco ? ' (--somente-banco)' : ''}`);

  if (!ehCompleto) {
    console.log('\n  ATENÇÃO — FORMATO ANTIGO, RESTAURAÇÃO PELA METADE.');
    console.log('  Este arquivo tem só o Postgres. O data/db.json (razão de estoque e lançamentos');
    console.log('  do Financeiro) NÃO é tocado e vai continuar sendo o de hoje — apontando para');
    console.log('  pedidos e notas que o banco acabou de esquecer.');
  }

  if (!confirmado) {
    console.error('\nISTO APAGA o que está nos destinos acima e substitui pelo conteúdo do arquivo.');
    console.error('Confira os destinos. Se for mesmo isso, repita o comando com --confirmo.');
    process.exit(1);
  }

  if (!existeNoPath('psql') && !existeNoPath('docker')) {
    console.error('Não achei psql no PATH nem o docker para usar o do container.');
    process.exit(1);
  }

  // O SISTEMA PRECISA ESTAR PARADO. Ver o cabeçalho.
  const porta = Number(process.env.PORT) || 3000;
  if (await sistemaNoAr(porta)) {
    console.error(`\n[restaurar] RECUSADO: tem alguém respondendo na porta ${porta} — o MavisONE está no ar.`);
    console.error('  Restaurar com o sistema de pé é jogar o trabalho fora: uma requisição em voo');
    console.error('  regrava o estado antigo por cima do restaurado, e os DROP do banco ficam');
    console.error('  esperando o lock das conexões abertas.');
    console.error('\n  Pare o sistema e rode de novo:   pm2 stop mavisone     (ou encerre o npm start)');
    process.exit(1);
  }

  // PROVA QUE DÁ PARA ESCREVER O ESTADO ANTES DE MEXER NO BANCO.
  //
  // Sem isto, o psql poderia terminar bem e a gravação do db.json falhar depois
  // (arquivo em uso, disco cheio) — deixando um híbrido: banco do backup, estado
  // de hoje. Pior do que qualquer um dos dois sozinho.
  let copiaDeSeguranca = null;
  if (vaiTocarNoEstado) {
    const teste = `${ESTADO}.escrita-de-teste`;
    try {
      fs.writeFileSync(teste, 'ok');
      fs.rmSync(teste, { force: true });
    } catch (erro) {
      console.error(`\n[restaurar] RECUSADO: não consigo escrever em ${ESTADO} (${erro.message}).`);
      console.error('Nada foi tocado.');
      process.exit(1);
    }
    if (fs.existsSync(ESTADO)) {
      const carimbo = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      copiaDeSeguranca = `${ESTADO}.antes-da-restauracao-${carimbo}`;
      fs.copyFileSync(ESTADO, copiaDeSeguranca);
      console.log(`\n[restaurar] estado atual guardado em ${path.relative(RAIZ, copiaDeSeguranca)}`);
    }
  }

  const codigo = await rodarSql(() => (ehCompleto
    ? fs.createReadStream(pacote.sqlPath)
    : fs.createReadStream(caminho).pipe(zlib.createGunzip())));

  if (codigo !== 0) {
    console.error(`\n[restaurar] FALHOU (código ${codigo}). O banco pode ter ficado incompleto — restaure de novo antes de usar.`);
    if (copiaDeSeguranca) console.error(`O estado NÃO foi trocado; a cópia em ${path.relative(RAIZ, copiaDeSeguranca)} pode ser apagada.`);
    if (pacote) fs.rmSync(pacote.montagem, { recursive: true, force: true });
    process.exit(1);
  }

  if (vaiTocarNoEstado) {
    // Grava num temporário e renomeia, pelo mesmo motivo do saveData: um Ctrl+C
    // no meio da escrita deixaria o db.json pela metade, e aí não há banco nem
    // estado.
    const temporario = `${ESTADO}.novo`;
    fs.copyFileSync(path.join(pacote.montagem, 'estado.json'), temporario);
    fs.renameSync(temporario, ESTADO);
    console.log(`[restaurar] estado do app restaurado em ${path.relative(RAIZ, ESTADO)}`);
  }

  if (pacote) fs.rmSync(pacote.montagem, { recursive: true, force: true });

  console.log('\n[restaurar] ok. Confira com: npm run migracoes');
  if (!vaiTocarNoEstado) {
    console.log('LEMBRE: só o banco foi restaurado. O estoque e o Financeiro continuam como estavam.');
  }
}

main().catch((erro) => { console.error(erro); process.exit(1); });
