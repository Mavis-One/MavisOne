#!/usr/bin/env node
/**
 * O BACKUP AUTOMÁTICO ESTÁ MESMO ACONTECENDO?
 *
 *   npm run backup:estado
 *
 * POR QUE ESTE SCRIPT EXISTE
 * --------------------------
 * Porque backup não falha com barulho — falha em silêncio. O container fica de
 * pé, o `docker compose ps` mostra "Up", e a pasta simplesmente parou de
 * crescer há três semanas. Ninguém percebe: o único momento em que se olha
 * para um backup é o momento em que ele já precisava estar lá.
 *
 * Então a pergunta que este script responde não é "o container está rodando",
 * é "existe uma cópia recente do banco em disco". As duas coisas parecem a
 * mesma e não são: um laço preso num erro continua rodando para sempre.
 *
 * O healthcheck do serviço `backup` faz a mesma pergunta de dentro do Docker,
 * e por isso o container aparece "unhealthy" quando os arquivos param. Este
 * script é a versão para humanos: diz de quando é o último, quantos existem, e
 * o que fazer se algo estiver errado.
 *
 * Sai com código 1 quando há problema, para poder virar verificação automática.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const RAIZ = path.join(__dirname, '..');
const PASTA = path.join(RAIZ, 'data', 'backup');
const INTERVALO_HORAS = Number(process.env.BACKUP_INTERVALO_HORAS || 24);
// Vazio nesta máquina, "03" (por exemplo) na VPS. Ver o serviço `backup` no
// docker-compose.yml.
const HORA_MARCADA = (process.env.BACKUP_HORA || '').trim();
// A mesma folga do healthcheck do compose. Se mudar lá, mude aqui: um número
// mais frouxo aqui esconderia justamente o que o healthcheck já está acusando.
// Com hora marcada a folga é maior porque o laço pode legitimamente estar
// esperando a hora chegar — cobrar antes disso seria acusar falha onde não há.
const TOLERANCIA_HORAS = HORA_MARCADA ? 18 : 6;
const LIMITE_HORAS = INTERVALO_HORAS + TOLERANCIA_HORAS;

const horas = (ms) => ms / 1000 / 60 / 60;

function idadeLegivel(ms) {
  const h = horas(ms);
  if (h < 1) return `${Math.round(h * 60)} min`;
  if (h < 48) return `${h.toFixed(1)} h`;
  return `${Math.floor(h / 24)} dias`;
}

/**
 * O estado do container de backup, se o docker estiver por perto.
 *
 * Sem `shell: true`: nada aqui vem do usuário hoje, mas este é o mesmo padrão
 * de backup-banco.js e restaurar-banco.js, onde a senha do banco vai como
 * argumento — manter os três iguais evita que alguém copie o de dentro errado.
 */
function estadoDoContainer(servico) {
  const r = spawnSync('docker', ['compose', 'ps', '--format', 'json', servico], {
    cwd: RAIZ, encoding: 'utf8'
  });
  // Três respostas diferentes, que quem lê a tela precisa distinguir: o docker
  // não respondeu, o container ainda não existe, ou aqui está ele.
  if (r.status !== 0) return { falhouODocker: true };
  const linhas = (r.stdout || '').trim().split('\n').filter(Boolean);
  for (const linha of linhas) {
    try {
      // O compose v2 imprime um objeto por linha; versões mais antigas, um
      // array. Aceita os dois em vez de depender da versão instalada.
      const dado = JSON.parse(linha);
      const itens = Array.isArray(dado) ? dado : [dado];
      const achado = itens.find((i) => i.Service === servico);
      if (achado) return achado;
    } catch { /* linha que não é JSON: ignora */ }
  }
  return { naoExiste: true };
}

function main() {
  let problemas = 0;
  const aviso = (texto) => { console.log(`  !! ${texto}`); problemas++; };

  console.log('--- container de backup ---');
  const container = estadoDoContainer('backup');
  if (container.falhouODocker) {
    console.log('  ?? não consegui perguntar ao docker (ele está de pé? esta é a pasta do projeto?)');
  } else if (container.naoExiste) {
    aviso('o serviço de backup nunca foi criado nesta máquina. Suba com: docker compose up -d');
  } else {
    const saude = container.Health ? ` (${container.Health})` : '';
    console.log(`  ${container.Name}: ${container.State}${saude}`);
    if (container.State !== 'running') aviso('o container de backup NÃO está rodando — suba com: docker compose up -d');
    if (container.Health === 'unhealthy') aviso('o healthcheck está vermelho: faz tempo demais que nenhum arquivo novo aparece. Veja: npm run backup:log');
  }

  console.log('\n--- arquivos em data/backup ---');
  const arquivos = (fs.existsSync(PASTA) ? fs.readdirSync(PASTA) : [])
    .filter((n) => n.endsWith('.sql.gz'))
    .map((n) => {
      const info = fs.statSync(path.join(PASTA, n));
      return { nome: n, bytes: info.size, quando: info.mtime, automatico: n.includes('-auto.') };
    })
    .sort((a, b) => b.quando - a.quando);

  if (!arquivos.length) {
    aviso('NENHUM backup em data/backup. Tire um agora com: npm run backup');
  } else {
    const agora = Date.now();
    const total = arquivos.reduce((s, a) => s + a.bytes, 0);
    console.log(`  ${arquivos.length} arquivo(s), ${(total / 1024 / 1024).toFixed(1)} MB no total`);
    arquivos.slice(0, 5).forEach((a, i) => {
      const marca = a.automatico ? 'auto  ' : 'manual';
      console.log(`  ${i === 0 ? '->' : '  '} ${marca}  ${a.nome}  ${(a.bytes / 1024 / 1024).toFixed(2)} MB  (há ${idadeLegivel(agora - a.quando)})`);
    });
    if (arquivos.length > 5) console.log(`     ... e mais ${arquivos.length - 5}`);

    const idade = horas(agora - arquivos[0].quando);
    if (idade > LIMITE_HORAS) {
      aviso(`o backup mais novo tem ${idadeLegivel(agora - arquivos[0].quando)}, e o esperado é no máximo ${INTERVALO_HORAS}h${HORA_MARCADA ? ` (cópia diária às ${HORA_MARCADA}:00)` : ''}. A automação parou.`);
    }
    // Um monte de backup manual e nenhum automático recente é o retrato de uma
    // automação morta que ninguém notou, porque a pasta continuou crescendo.
    const ultimoAutomatico = arquivos.find((a) => a.automatico);
    if (!ultimoAutomatico) {
      aviso('nenhum arquivo veio da automação (sufixo -auto). Todos foram tirados à mão.');
    } else if (horas(agora - ultimoAutomatico.quando) > LIMITE_HORAS) {
      aviso(`o último backup AUTOMÁTICO tem ${idadeLegivel(agora - ultimoAutomatico.quando)} — os mais novos são todos manuais.`);
    }
  }

  console.log('\n--- cópia fora desta máquina (serviço `envio`) ---');
  const envio = estadoDoContainer('envio');
  if (envio.falhouODocker || envio.naoExiste) {
    // NÃO conta como problema: nesta máquina o envio fica desligado de
    // propósito, e o serviço só existe com o profile `envio` ligado. Quem
    // decide se ele deveria estar de pé é quem sabe em qual máquina está.
    console.log('  desligado. Os backups existem só aqui — se esta máquina se perder, eles se perdem junto.');
    console.log('  Para ligar: COMPOSE_PROFILES=envio e ENVIO_REMOTO no .env (ver deploy/rclone.conf.exemplo).');
  } else {
    const saude = envio.Health ? ` (${envio.Health})` : '';
    console.log(`  ${envio.Name}: ${envio.State}${saude}`);
    if (envio.State !== 'running') aviso('o serviço de envio não está rodando — os backups não estão saindo desta máquina.');
    // A marca só é escrita depois de o `rclone check` passar, então a idade
    // dela é a idade da última cópia CONFERIDA lá fora — não a do último
    // comando que terminou sem erro.
    const marca = spawnSync('docker', ['compose', 'exec', '-T', 'envio', 'cat', '/estado/ultimo-envio'], {
      cwd: RAIZ, encoding: 'utf8'
    });
    if (marca.status === 0 && (marca.stdout || '').trim()) {
      console.log(`  último envio conferido: ${marca.stdout.trim()}`);
    } else if (envio.State === 'running') {
      aviso('o envio está de pé mas nunca conferiu uma cópia lá fora. Veja: docker compose logs envio');
    }
    if (envio.Health === 'unhealthy') aviso('o healthcheck do envio está vermelho: faz tempo demais que nada é conferido no destino.');
  }

  console.log('');
  if (problemas) {
    console.log(`${problemas} problema(s). O que costuma resolver:`);
    console.log('  docker compose up -d          sobe banco e backup');
    console.log('  npm run backup:log            mostra o que o container está dizendo');
    console.log('  npm run backup                tira um backup agora, à mão');
    process.exit(1);
  }
  console.log(HORA_MARCADA
    ? `Tudo certo. Próximo backup automático às ${HORA_MARCADA}:00.`
    : `Tudo certo. Próximo backup automático quando o mais novo passar de ${INTERVALO_HORAS}h.`);
  console.log('Prove que ele volta de verdade:  npm run backup:provar');
}

main();
