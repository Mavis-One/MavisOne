#!/usr/bin/env node
/**
 * Gera o hash bcrypt de uma senha, e o SQL para gravá-lo.
 *
 *   node scripts/hash-senha.js
 *   (digite a senha quando ele pedir — ela NÃO aparece na tela)
 *
 * POR QUE ISTO EXISTE
 * -------------------
 * O banco/schema.sql cria o usuário `admin` com um hash escrito lá dentro.
 * Esse hash está versionado no git: qualquer pessoa com acesso ao repositório
 * — hoje, ou em qualquer commit do passado — consegue a senha correspondente em
 * segundos, porque ela é a padrão conhecida do projeto.
 *
 * Enquanto o banco é de teste, isso é um incômodo. No banco NOVO, que vai
 * receber cadastro de cliente de verdade, é uma porta aberta com o endereço
 * publicado. Trocar a senha do admin é a primeira coisa a fazer depois de
 * recriar o banco — antes de cadastrar qualquer coisa.
 *
 * A SENHA NÃO VEM POR ARGUMENTO, E ISSO É DE PROPÓSITO
 * ----------------------------------------------------
 * `node scripts/hash-senha.js minhasenha` deixaria a senha no histórico do
 * shell (~/.bash_history), que é exatamente o tipo de lugar onde senha some de
 * vista e não some do disco. Ela é lida da entrada padrão, sem eco.
 */
const bcrypt = require('bcryptjs');
const readline = require('readline');

function perguntarSenha(pergunta) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    // Silencia o eco: o terminal não mostra o que está sendo digitado, do mesmo
    // jeito que o `sudo` faz. Sem isto a senha fica na tela e no scrollback.
    const escrever = rl._writeToOutput;
    rl._writeToOutput = function (texto) {
      if (texto.includes(pergunta)) return escrever.call(rl, texto);
      escrever.call(rl, '');
    };
    rl.question(pergunta, (resposta) => {
      rl._writeToOutput = escrever;
      rl.output.write('\n');
      rl.close();
      resolve(resposta);
    });
  });
}

(async () => {
  const senha = (await perguntarSenha('Senha nova: ')).trim();

  if (senha.length < 10) {
    console.error('\nXX  Use ao menos 10 caracteres. Esta é a senha que abre o ERP inteiro.\n');
    process.exit(1);
  }

  const hash = bcrypt.hashSync(senha, 10);
  console.log('\nHash gerado. Cole no SQL Editor do Supabase:\n');
  console.log('----------------------------------------------------------------');
  console.log(`update users set password_hash = '${hash}' where username = 'admin';`);
  console.log('----------------------------------------------------------------');
  console.log('\nConfira depois com:  select username, left(password_hash, 12) from users;');
  console.log('O hash muda a cada execução (bcrypt sorteia o sal) — os dois valem.\n');
})();
