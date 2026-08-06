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
      // Precisa ser fork, não cluster: as sessões de login vivem em memória
      // (objeto `sessions` no server.js), então com mais de um processo o
      // usuário cairia numa instância que não conhece o token dele.
      exec_mode: 'fork',
      autorestart: true,
      max_restarts: 10,
      // Reinicia se passar de 500MB — evita que um vazamento derrube o VPS.
      max_memory_restart: '500M',
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
