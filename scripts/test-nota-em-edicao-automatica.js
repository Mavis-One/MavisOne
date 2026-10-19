// A NOTA EM EDIÇÃO SE SALVA SOZINHA (19/10/2026).
//
// Pedido do usuário: "ainda estou tendo problema de dados se manter após eu
// fechar uma aba em questão das NFE". A nota em edição (fase EL) só era gravada
// pelo botão "Salvar nota em edição": quem preenchia e fechava a aba perdia
// tudo. E o estado salvo não levava a nota com erro que se corrigia (fase EO):
// salvar durante a correção fazia o Emitir criar outra nota.
//
// Provado no navegador (servidor local, NF-e avulsa): abrir sem mexer não
// cria nota salva; digitar grava em 2 s ("Salva às 16:57"); digitar e
// recarregar logo em seguida (o mesmo que fechar a aba) guarda pelo keepalive;
// reabrir traz a nota de volta. Nota de teste apagada.
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const ler = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8').replace(/\r\n/g, '\n');
let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};

const tela = ler('public/modules/finance/subs/emitir_nfe_focus.js');

console.log('--- grava sozinha ---');
check('2 s depois de cada mudança no formulário', /esperaDaGravacao = setTimeout\(\(\) => gravarSozinho\(\), 2000\);/.test(tela)
  && /\['input', 'change'\]\.forEach\(\(tipo\) => form\.addEventListener\(tipo, agendarGravacao\)\);/.test(tela));
check('  e a cada 15 s, pelo que mudou por botão', /gravarSozinho\(\);\s*\}, 15000\);/.test(tela));
check('  e na hora em que a aba some, com keepalive', /if \(document\.visibilityState === 'hidden'\) gravarSozinho\(\{ aoSair: true \}\)/.test(tela)
  && /window\.addEventListener\('pagehide', aoSairDaPagina\);/.test(tela) && /method: 'PUT', keepalive: true, body: corpo,/.test(tela));
check('  com o token da sessão (o keepalive não passa pelo api())', /'x-auth-token': \(typeof getSessionToken === 'function' \? getSessionToken\(\) : ''\) \|\| ''/.test(tela));
check('  e respeita o teto de 64 KB do keepalive', /if \(corpo\.length > 60000\) return;/.test(tela));

console.log('\n--- e só quando deve ---');
check('abrir a emissão não cria nota salva (só depois de mexer)', /if \(emissaoEnviada \|\| !pessoaMexeu\) return;/.test(tela) && /function agendarGravacao\(\) \{\s*pessoaMexeu = true;/.test(tela));
check('  nada a gravar se nada mudou', /if \(!texto \|\| texto === ultimoEstadoSalvo\) return;/.test(tela) && /marcarPontoDePartida\(\);/.test(tela));
check('para quando a nota vai para a SEFAZ (e espera a gravação em curso)',
  /clearTimeout\(esperaDaGravacao\);\s*if \(gravacaoEmCurso\) await gravacaoEmCurso;\s*emissaoEnviada = true;\s*try \{\s*const result = await api\('\/api\/fiscal\/nfe\/emitir'/.test(tela));
check('  e volta se não virou nota', /\/\/ Não virou nota: a tela continua, para corrigir \(e a gravar sozinha\)\.\s*emissaoEnviada = false;/.test(tela));
check('só a tela que desenhou o formulário grava (marca data-tela)',
  /data-tela="\$\{idDaTela\}"/.test(tela) && /const formDestaTela = \(\) => document\.querySelector\(`#nfeFocusForm\[data-tela="\$\{idDaTela\}"\]`\);/.test(tela));
check('  e os ouvintes do documento saem com ela', /if \(!formDestaTela\(\)\) \{\s*clearInterval\(vigiaDaGravacao\);\s*document\.removeEventListener\('visibilitychange', aoEsconder\);\s*window\.removeEventListener\('pagehide', aoSairDaPagina\);/.test(tela));
check('descartar não recria na hora', /\/\/ Descartada, ela só volta se a pessoa mexer de novo\.\s*pessoaMexeu = false;/.test(tela));

console.log('\n--- a correção de nota com erro (fase EO) ---');
check('o estado salvo leva a nota que se corrige', /\.\.\.\(corrigindoNfe \? \{ corrigeNfe: corrigindoNfe \} : \{\}\)/.test(tela));
check('a marca "Salva às" no topo', /<span class="muted nfe-salva-em" id="nfeFocusSalvaEm"><\/span>/.test(tela));

console.log(`\n===== ${falhas === 0 ? 'TODOS OS CHECKS PASSARAM' : falhas + ' FALHA(S)'} =====`);
process.exit(falhas ? 1 : 0);
