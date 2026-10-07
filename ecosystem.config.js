// Configuração do PM2 para o VPS.
//
// Uso no servidor:
//   pm2 start ecosystem.config.js     # primeira vez
//   pm2 save                          # grava a lista pra sobreviver a reboot
//   pm2 startup                       # (uma vez) instala o serviço no systemd
//
// Segredos NÃO ficam aqui: o server.js chama dotenv, então continua lendo o
// .env do diretório do projeto no VPS.
module.exports = {
  apps: [
    {
      name: 'mavisone',
      script: 'server.js',
      cwd: __dirname,
      instances: 1,
      // Precisa ser fork, não cluster — mas NÃO mais pelas sessões.
      //
      // O motivo era este: elas viviam em memória, então com mais de um
      // processo o usuário cairia numa instância que não conhece o token dele.
      // Na fase CL a sessão passou para o banco (tabela `sessoes`), e esse
      // impedimento acabou junto — é a mesma mudança que fez reinício e deploy
      // pararem de deslogar todo mundo.
      //
      // O que ainda segura em fork/1 é o LIMITE DE TENTATIVAS DE LOGIN, que
      // continua em memória (lib/limite-tentativas.js): em cluster, cada
      // trabalhador teria o contador dele, e "5 tentativas" passaria a valer 5
      // POR INSTÂNCIA — a proteção contra força bruta afrouxaria na exata
      // proporção do número de processos, sem nada avisando.
      //
      // E DESDE A FASE DI HÁ UM SEGUNDO ITEM NESSA LISTA: o cache do cadastro
      // (lib/db/cadastros.js). As 6.492 pessoas, com 5,6 MB de jsonb, eram
      // relidas a cada requisição — 93,7 ms — e agora ficam em memória,
      // invalidadas por toda escrita deste processo. Em cluster, a escrita de um
      // trabalhador não avisaria os outros, e um cliente cadastrado sumiria da
      // lista de quem caiu noutra instância até o TTL de 30s expirar.
      //
      // É menos grave que o contador de tentativas — degrada em atraso, não em
      // proteção afrouxada — e tem TTL como rede. Mas está anotado aqui, junto,
      // para a conta de "o que sair da memória antes do cluster" ficar completa.
      //
      // Ou seja: para escalar em cluster um dia, o contador é o próximo a sair
      // da memória, e o cache do cadastro vem logo atrás. Até então, 1 instância.
      exec_mode: 'fork',
      autorestart: true,
      max_restarts: 10,
      // Reinicia se passar do teto — evita que um vazamento derrube o VPS.
      //
      // ERA 500M, E 500M ESTAVA ABAIXO DO PICO NORMAL (medido em 06/10/2026,
      // processo novo, banco com os dados reais). A abertura do sistema lê
      // tabelas inteiras (27 mil lançamentos, 25 mil baixas, 14 mil pedidos):
      //
      //   1ª abertura de um processo novo ............ 492-524 MB de RSS
      //   três pessoas abrindo juntas ................ pico 746-850 MB,
      //                                                 8-9 s acima de 500 MB
      //   dez segundos depois, ocioso ................ 40-115 MB
      //
      // Não é vazamento — depois do coletor sobram 22-61 MB de heap —, é o pico
      // de trabalho legítimo. Mas o PM2 confere o RSS a cada 30 s e reinicia
      // quem passou do teto: com 8-9 s acima de 500 MB por rajada, ~1 chance
      // em 3 de matar o processo NO MEIO de requisições (a tela mostra erro, uma
      // gravação fica sem saber se gravou), zerar o cache do cadastro e o
      // limitador de tentativas de login.
      //
      // Com a carona em leitura idêntica (lib/db/conexao.js) o pico de três
      // aberturas juntas cai para 584-638 MB, mas rajadas seguidas sem
      // descanso (abertura, Meu Painel, Lançamentos, relatórios, três vezes)
      // ainda chegaram a 870-886 MB (07/10/2026). 1024M fica acima de todo
      // pico medido, com e sem as correções, com ~15% de folga sobre o maior,
      // e ainda pega vazamento: um processo que vaza cresce sem voltar, e o
      // ocioso normal é 40-115 MB. Não é mais alto porque o Postgres divide a
      // máquina com o Node — o conserto de fundo é ler menos (as rotas que
      // deixam de ler tabela inteira), não subir o teto.
      //
      // DECISÃO DE DEPLOY: a memória do VPS não é conhecida daqui. Antes de
      // subir, conferir `free -m` (o Node + o Postgres têm de caber com o teto)
      // e `pm2 describe mavisone` / `pm2 logs mavisone --lines 5000 --nostream |
      // grep -i memory` (se o PM2 já reiniciou por memória). PM2_MAX_MEMORY no
      // ambiente do `pm2 start` troca o número sem mexer neste arquivo; a linha
      // `[saude]` do log (server.js) mostra o pico real de cada minuto ruim.
      //
      // Numa máquina pequena (1-2 GB), 1024M com o Postgres ao lado NÃO cabe:
      // quem age antes do PM2 é o OOM killer do kernel, e ele pode matar o
      // BANCO em vez do Node — pior que o reinício do PM2 que o teto evita.
      // Nesse caso, subir com PM2_MAX_MEMORY menor (Node + shared_buffers do
      // Postgres + folga do sistema têm de caber no `free -m`) e aceitar o
      // reinício.
      max_memory_restart: process.env.PM2_MAX_MEMORY || '1024M',
      env: {
        NODE_ENV: 'production',
        PORT: 3000
      },
      error_file: 'logs/pm2-error.log',
      out_file: 'logs/pm2-out.log',
      merge_logs: true,
      time: true
    }
  ]
};
