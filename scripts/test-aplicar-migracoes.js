#!/usr/bin/env node
// APLICAR MIGRAÇÃO DEIXOU DE SER UM PASSO HUMANO.
//
// Duas coisas paravam o deploy no VPS, e nenhuma das duas era um erro de código:
//
//   1. o docker-compose.override.yml (ajuste daquela máquina, fora do Git)
//      aparecia como alteração não commitada, e o scripts/deploy.sh aborta
//      antes do git pull quando há qualquer coisa não commitada. O deploy não
//      rodava, e a mensagem não dizia que o arquivo nem devia estar sendo
//      vigiado.
//
//   2. o verificador listava o que faltava e mandava "rodar no SQL Editor do
//      Supabase" — um painel web que esta instalação não tem desde agosto de
//      2026, quando o banco virou um Postgres em Docker. O deploy chegava nesse
//      ponto e esperava alguém executar um passo que não existe mais.
//
// Este teste guarda as duas, e o desenho do aplicador que nasceu da segunda.
//
// Roda sem banco: o que depende de banco foi provado à mão num banco
// descartável (ver o commit), e o que dá para garantir sozinho está aqui.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const RAIZ = path.join(__dirname, '..');
const ler = (p) => fs.readFileSync(path.join(RAIZ, p), 'utf8').replace(/\r\n/g, '\n');
const { semComentarios } = require('./sem-comentarios');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`  ${cond ? 'OK ' : 'XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};

// ===========================================================================
console.log('\n--- 1. o override do compose não trava mais o deploy ---');
// ===========================================================================
const ignore = ler('.gitignore');
check('o .gitignore cobre o docker-compose.override.yml', /^docker-compose\.override\.yml$/m.test(ignore));
// O PORQUÊ tem de estar escrito: sem ele, a próxima pessoa que "limpar" o
// .gitignore tira a linha e o deploy volta a abortar sem explicação.
check('  e diz por que, citando o deploy', /deploy\.sh/.test(ignore) && /abortav/i.test(ignore.toLowerCase()));

// A prova de verdade é o git concordando, e não o texto do arquivo: uma regra
// mal escrita (caminho, barra, negação anterior) passaria no teste de texto e
// continuaria deixando o arquivo visível.
const ALVO = path.join(RAIZ, 'docker-compose.override.yml');
const jaExistia = fs.existsSync(ALVO);
try {
  if (!jaExistia) fs.writeFileSync(ALVO, 'services:\n  banco:\n    ports: ["5433:5432"]\n');
  const sujo = execFileSync('git', ['status', '--porcelain'], { cwd: RAIZ, encoding: 'utf8' });
  check('o git realmente ignora o arquivo', !/docker-compose\.override\.yml/.test(sujo),
    sujo.split('\n').filter((l) => /override/.test(l)).join(' | ') || 'não aparece no status');
} catch (erro) {
  check('o git realmente ignora o arquivo', false, `não deu para perguntar ao git: ${erro.message}`);
} finally {
  if (!jaExistia && fs.existsSync(ALVO)) fs.unlinkSync(ALVO);
}

// ===========================================================================
console.log('\n--- 2. o deploy aplica as migrações sozinho ---');
// ===========================================================================
const deploy = ler('scripts/deploy.sh');
check('o deploy chama o aplicador', /npm run --silent migracoes:aplicar/.test(deploy));
// ANTES do restart: o código novo espera colunas que a migração cria. Reiniciar
// primeiro deixaria o app no ar contra um banco velho, e o modo de falhar não é
// erro visível — é gravação em silêncio.
check('  ANTES de reiniciar o PM2',
  deploy.indexOf('migracoes:aplicar') < deploy.indexOf('pm2 reload'));
// `set -euo pipefail` no topo é o que faz a falha do aplicador parar o deploy.
check('  e a falha dele derruba o deploy', /^set -euo pipefail$/m.test(deploy));

// ===========================================================================
console.log('\n--- 3. o verificador manda rodar onde dá para rodar ---');
// ===========================================================================
const verificador = semComentarios(ler('scripts/verificar-migracoes.js'));
check('nada de "SQL Editor" nem de "Supabase" na saída',
  !/SQL Editor/i.test(verificador) && !/Supabase/i.test(verificador));
check('  a instrução é o comando do projeto', /npm run migracoes:aplicar/.test(verificador));
check('  e ele continua derrubando o deploy quando há pendência',
  /process\.exit\(1\)/.test(verificador));

// ===========================================================================
console.log('\n--- 4. a leitura das migrações mora num lugar só ---');
// ===========================================================================
// Três programas precisam das mesmas respostas sobre banco/migrations/. Cada um
// com a sua cópia era o caminho para a correção feita de um lado ficar de fora
// do outro — já aconteceu duas vezes (o regex da fase-v e a ordem das fases).
const migracoes = require('../lib/migracoes');
['scripts/verificar-migracoes.js', 'scripts/aplicar-migracoes.js', 'scripts/gerar-sql-do-zero.js']
  .forEach((arquivo) => {
    check(`  ${path.basename(arquivo)} lê de lib/migracoes`, /require\('\.\.\/lib\/migracoes'\)/.test(ler(arquivo)));
  });

const lidas = migracoes.lerMigracoes();
check('lerMigracoes devolve todos os arquivos', lidas.length === fs.readdirSync(path.join(RAIZ, 'banco/migrations')).filter((n) => n.endsWith('.sql')).length,
  `${lidas.length} arquivo(s)`);

// A ORDEM. 'fase-aa' vem antes de 'fase-h' em qualquer listagem de pasta, e
// aplicar nessa ordem tenta alterar tabela que ainda não foi criada — o mesmo
// erro que o gerador do zero já evitava, agora herdado pelo aplicador.
const fase = (n) => (/^fase-([a-z]+)-/i.exec(n) || [])[1] || '';
const ordem = lidas.map((m) => m.nome);
check('a ordem é a das fases, não a da pasta',
  ordem.findIndex((n) => fase(n) === 'z') < ordem.findIndex((n) => fase(n) === 'aa'),
  `z na ${ordem.findIndex((n) => fase(n) === 'z')}, aa na ${ordem.findIndex((n) => fase(n) === 'aa')}`);
check('  e a ordem crua faria o contrário',
  ordem.slice().sort().findIndex((n) => fase(n) === 'aa') < ordem.slice().sort().findIndex((n) => fase(n) === 'z'));

// O pacote repetiria as partes; a superada foi substituída por outra que já
// está na fila. Nenhum dos dois pode ser executado.
const pacote = lidas.find((m) => m.consolidado);
check('o pacote PENDENTES não é aplicável', Boolean(pacote) && !pacote.aplicavel, pacote && pacote.nome);
const superada = lidas.find((m) => m.superada);
check('a migração superada também não', Boolean(superada) && !superada.aplicavel, superada && superada.nome);
check('  e o resto é', lidas.filter((m) => m.aplicavel).length === lidas.length - 2,
  `${lidas.filter((m) => m.aplicavel).length} aplicável(eis)`);

// ===========================================================================
console.log('\n--- 5. conferir() separa "falta" de "não sei" ---');
// ===========================================================================
// Com sondas de mentira dá para exercitar a classificação inteira sem banco.
(async () => {
  const existeTudo = async () => true;
  const naoExisteNada = async () => false;

  const comBancoCheio = await migracoes.conferir({ existeTabela: existeTudo, existeColuna: existeTudo });
  check('banco com tudo: nenhuma pendente', comBancoCheio.pendentes.length === 0);
  // Migração que só insere dado, só cria índice ou trigger não declara tabela
  // nem coluna. Ela NÃO é "está certa": é "não dá para saber", e some no meio
  // das aplicadas se as duas contarem igual.
  check('  mas as sem estrutura ficam à parte', comBancoCheio.naoConferidas.length > 0,
    `${comBancoCheio.naoConferidas.length} não conferida(s)`);
  check('  e nenhuma delas entra como aplicada',
    !comBancoCheio.aplicadas.some((a) => comBancoCheio.naoConferidas.some((n) => n.nome === a.nome)));

  // O caso realista de "não rodou": as tabelas-base existem (o aplicador recusa
  // banco vazio) e as colunas novas é que faltam.
  const semAsColunas = await migracoes.conferir({ existeTabela: existeTudo, existeColuna: naoExisteNada });
  // A propriedade, e não um número escolhido a dedo: TODA migração que adiciona
  // coluna a uma tabela que já existe tem de sair como pendente. Um limiar
  // ("mais de 30") passaria mesmo se metade delas escapasse.
  const deviamFaltar = lidas
    .filter((m) => m.aplicavel && m.colunas.some((c) => !m.tabelas.includes(c.tabela)))
    .map((m) => m.nome);
  const acusadas = new Set(semAsColunas.pendentes.map((p) => p.nome));
  const escaparam = deviamFaltar.filter((n) => !acusadas.has(n));
  check('tabelas existem, colunas não: nenhuma escapa',
    deviamFaltar.length > 0 && escaparam.length === 0,
    `${deviamFaltar.length} deviam faltar, escaparam ${escaparam.length}${escaparam.length ? ': ' + escaparam.slice(0, 3).join(', ') : ''}`);
  check('  e cada pendente diz o que falta', semAsColunas.pendentes.every((p) => p.faltando.length > 0));

  // BANCO SEM NADA É OUTRA COISA, e o número surpreende: só as que CRIAM tabela
  // saem como pendentes. Uma migração que só adiciona coluna a uma tabela que
  // não existe é pulada — `conferir` não sabe dizer se ela rodou quando nem o
  // alvo está lá, e contá-la como faltando repetiria a tabela inteira que a
  // migração anterior já acusou. Não é um caso real (o aplicador recusa banco
  // vazio, apontando o RECRIAR-DO-ZERO), e está escrito aqui para o número não
  // parecer um defeito para quem vier medir depois.
  const comBancoVazio = await migracoes.conferir({ existeTabela: naoExisteNada, existeColuna: naoExisteNada });
  check('banco sem nada: pendentes são as que CRIAM tabela',
    comBancoVazio.pendentes.length > 0
    && comBancoVazio.pendentes.every((p) => p.tabelas.length > 0),
    `${comBancoVazio.pendentes.length} pendente(s)`);
  check('  o pacote consolidado fica fora das contas dos dois lados',
    ![...comBancoVazio.pendentes, ...comBancoVazio.naoConferidas, ...comBancoVazio.aplicadas]
      .some((m) => m.consolidado));

  // =========================================================================
  console.log('\n--- 6. o aplicador e o livro-caixa ---');
  // =========================================================================
  const aplicador = semComentarios(ler('scripts/aplicar-migracoes.js'));
  check('existe a tabela schema_migracoes', /create table if not exists schema_migracoes/.test(aplicador));
  check('  com o nome do arquivo como chave', /nome text primary key/.test(aplicador));
  // O registro vai no MESMO commit do SQL: migração que falha no meio não pode
  // deixar registro, senão a próxima rodada a pula achando que rodou.
  check('o registro é gravado dentro da transação da migração',
    /await emTransacao\(async \(cliente\) => \{[\s\S]{0,400}cliente\.query\(migracao\.sql\)[\s\S]{0,400}insert into schema_migracoes/.test(aplicador));
  check('  e uma transação por migração', /for \(const migracao of pendentes\)[\s\S]{0,200}await aplicar\(migracao\)/.test(aplicador));

  // A PRIMEIRA RODADA NUM BANCO QUE JÁ EXISTE.
  //
  // Este banco tem 51 migrações aplicadas à mão e nenhum registro delas. Um
  // livro-caixa que nasce vazio e manda "aplicar tudo que não está registrado"
  // rodaria as 51 de novo — e 12 delas inserem dado.
  // Sem medir distância entre trechos: o bloco é comprido porque EXPLICA na
  // tela o que está fazendo, e um limite de caracteres acusaria a explicação
  // crescendo como se fosse a adoção sumindo.
  const blocoPrimeira = aplicador.slice(aplicador.indexOf('if (primeiraRodada)'),
    aplicador.indexOf('const pendentes = todas.filter'));
  check('a primeira rodada ADOTA em vez de aplicar',
    /const primeiraRodada = registradas\.size === 0;/.test(aplicador)
    && blocoPrimeira.includes('await adotar(adotar0)')
    && !blocoPrimeira.includes('await aplicar('));
  check('  adotando pelo que o BANCO responde, e não por suposição em bloco',
    /await conferir\(\{ existeTabela, existeColuna \}\)/.test(aplicador)
    && /todas\.filter\(\(m\) => !pendentesPorNome\.has\(m\.nome\)\)/.test(aplicador));
  // A aposta existe e não pode ficar escondida: as NÃO CONFERIDAS entram como
  // adotadas porque não há como saber, e num banco no ar há meses supor que
  // rodaram é o lado seguro — o outro lado duplica dado.
  check('  e a suposição das não conferidas é dita, uma por uma',
    /naoConferidas\.forEach\(\(m\) => console\.log/.test(aplicador));
  check('o livro-caixa distingue aplicada de adotada',
    /'aplicada'/.test(aplicador) && /'adotada'/.test(aplicador));

  // Migração não cria banco. Aplicar sobre nada falha na primeira que altera
  // tabela, e o erro não diz o que fazer.
  check('banco vazio é recusado, apontando o RECRIAR-DO-ZERO',
    /existeTabela\('users'\)/.test(aplicador) && /RECRIAR-DO-ZERO\.sql/.test(aplicador));
  check('  saindo com erro, para o deploy parar', /process\.exit\(1\)/.test(aplicador));
  // Poder ver o que ele faria antes de deixar fazer.
  check('dá para simular sem tocar no banco',
    /const SIMULAR = process\.argv\.includes\('--simular'\)/.test(aplicador)
    && /if \(SIMULAR\)[\s\S]{0,200}process\.exit\(0\)/.test(aplicador));

  check('e está no package.json',
    /"migracoes:aplicar": "node scripts\/aplicar-migracoes\.js"/.test(ler('package.json')));

  console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TODOS OS CHECKS PASSARAM =====');
  process.exit(falhas ? 1 : 0);
})();
