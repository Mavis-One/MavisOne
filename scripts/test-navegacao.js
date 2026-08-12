#!/usr/bin/env node
// Barra lateral — abertura por CLIQUE, nome por hover.
//
// O QUE MUDOU E POR QUÊ
// ---------------------
// A barra abria sozinha ao encostar o mouse (`.sidebar:hover`). Quem só
// atravessava a tela para chegar ao conteúdo empurrava o layout de 72px para
// 260px sem ter pedido nada, e o conteúdo pulava embaixo do cursor. Agora o
// hover só mostra o NOME do ícone; abrir é decisão de clique.
//
// As armadilhas que este teste guarda:
//   1. o `:hover` voltar — é uma linha de CSS, e some no meio de 2 mil;
//   2. o estado de aberta viver no DOM: renderApp() reconstrói a <aside> a
//      cada navegação, e a barra fecharia sozinha no primeiro clique;
//   3. o balão ficar dentro da .sidebar, que tem overflow-x: hidden e o
//      cortaria exatamente na borda onde ele precisa aparecer;
//   4. o balão receber o mouse e piscar sem parar;
//   5. os listeners de documento se acumularem a cada render.
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const ler = (p) => fs.readFileSync(path.join(RAIZ, p), 'utf8').replace(/\r\n/g, '\n');

const cssSrc = ler('public/app.css');
const appSrc = ler('public/app.js');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};

console.log('--- o hover não abre mais nada ---');
// Uma linha só de `.sidebar:hover` traria o comportamento antigo de volta.
const hovers = cssSrc.match(/\.sidebar:hover/g) || [];
check('nenhuma regra .sidebar:hover', hovers.length === 0, `${hovers.length} regra(s)`);
check('a barra tem 72px fixos', /\.sidebar \{\n\s*width: 72px;/.test(cssSrc));

console.log('\n--- a barra NÃO expande de jeito nenhum ---');
// Decisão do usuário: a lateral é uma faixa de ícones e ponto. Toda a
// maquinaria de expandir saiu — se voltar, volta de propósito.
check('nenhuma regra .sidebar.expanded', !/\.sidebar\.expanded/.test(cssSrc));
check('nenhum estado de aberta no app', !/sidebarAberta/.test(appSrc));
check('a <aside> não recebe classe condicional', /<aside class="sidebar">/.test(appSrc));
// Transição de largura numa largura que nunca muda é animação que nunca roda.
const blocoSidebar = cssSrc.slice(cssSrc.indexOf('.sidebar {'), cssSrc.indexOf('.sidebar-header {'));
check('sem transição de largura', !/transition:[^;]*width/.test(blocoSidebar));
// Sem expansão não há o que fechar: clique fora e Esc-fecha deixaram de existir.
check('não há mais fechar por clique fora', !/state\.sidebarAberta = false/.test(appSrc));

console.log('\n--- o rótulo continua no HTML, mesmo invisível ---');
// É dele que sai o texto do balão, e é o que o leitor de tela lê. Some da
// vista pelo overflow da barra, não do documento.
check('o <span class="text"> continua sendo desenhado', /<span class="text">\$\{moduleLabels\[module\]\}<\/span>/.test(appSrc));
check('o balão lê o texto dele', /botao\.querySelector\('\.text'\)\?\.textContent/.test(appSrc));

console.log('\n--- o nome do usuário saiu da barra ---');
// Era o único lugar do sistema que mostrava quem estava logado; se voltar,
// que volte de propósito e não por um merge.
check('não desenha mais o nome', !/<p class="muted">\$\{state\.user\?\.name/.test(appSrc));
// As duas regras existiam só para ele — deixá-las seria CSS órfão para sempre.
check('e o CSS dele foi junto', !/\.sidebar \.muted/.test(cssSrc) && !/\.sidebar\.expanded \.muted/.test(cssSrc));
// `.muted` é classe genérica usada no sistema inteiro: só as regras com
// escopo de sidebar podiam sair.
check('o .muted genérico continua', /\.muted \{/.test(cssSrc));

console.log('\n--- fixar módulo não se perdeu com a barra ---');
// A barra era o ÚNICO lugar que fixava um MÓDULO (a Área de Trabalho fixa
// TELAS). Tirar o botão sem repor apagaria a função sem ninguém notar.
const workspaceSrc = ler('public/modules/shared/module_workspace.js');
check('o botão saiu da barra', !/class="sidebar-pin-btn \$\{getDashboardPinSet\(\)\.has\(module\)/.test(appSrc));
check('e foi para a Área de Trabalho', /class="workspace-fixar-modulo/.test(workspaceSrc));
// A chave sem "::tela" é o que distingue módulo fixado de tela fixada na
// mesma lista de favoritos.
check('fixa o módulo, não uma tela', /data-fixar="\$\{escapeHtml\(moduleName\)\}"/.test(workspaceSrc));
// O handler já era genérico por [data-fixar] — o botão novo entra sem código novo.
check('reaproveita o handler existente', /querySelectorAll\('\[data-fixar\]'\)/.test(workspaceSrc));
check('tem estilo próprio', /\.workspace-fixar-modulo/.test(cssSrc));
// A secundária mostra o pin sempre; ela não depende da barra principal.
check('o pin da barra secundária continua visível', /\.secondary-nav-item-row \.sidebar-pin-btn \{[\s\S]{0,260}opacity: 1;/.test(cssSrc));

console.log('\n--- o balão é um só, no body ---');
// Dentro da .sidebar ele seria cortado: ela tem overflow-x: hidden.
check('a sidebar corta o que sai dela', /\.sidebar \{[\s\S]*?overflow-x: hidden;/.test(cssSrc));
check('por isso o balão é fixed', /#navDica \{[\s\S]*?position: fixed;/.test(cssSrc));
check('e vai no body', /document\.body\.appendChild\(dica\)/.test(appSrc));
check('reaproveita o mesmo elemento', /let dica = document\.getElementById\('navDica'\);\s*\n\s*if \(!dica\)/.test(appSrc));
// Sem isto o cursor sairia do ícone para o balão, escondendo-o, o que
// devolveria o mouse ao ícone, que o mostraria de novo — pisca sem parar.
check('o balão não recebe o mouse', /#navDica \{[\s\S]*?pointer-events: none;/.test(cssSrc));

console.log('\n--- o balão cola na barra, não no botão ---');
// O botão é MAIS LARGO que a barra: o rótulo tem white-space: nowrap e o
// estica até ~200px; a .sidebar apenas o corta com overflow-x: hidden. Medir
// a borda direita do botão jogava o balão duzentos pixels adentro do
// conteúdo, longe do ícone que ele descreve.
check('mede a borda da .sidebar', /barra\.getBoundingClientRect\(\)\.right/.test(appSrc));
check('e NÃO a borda do botão', !/dica\.style\.left = `\$\{r\.right/.test(appSrc));
check('com o botão como reserva se a barra sumir', /const borda = barra \? barra\.getBoundingClientRect\(\)\.right : r\.right;/.test(appSrc));
// O rótulo esticar o botão é o motivo de tudo isso — se mudar, o cálculo muda.
check('o rótulo realmente estica o botão', /\.nav-item \.text \{ white-space: nowrap/.test(cssSrc));
// A vertical continua vindo do botão: é a altura dele que alinha com o ícone.
check('a vertical vem do botão', /dica\.style\.top = `\$\{r\.top \+ \(r\.height - dica\.offsetHeight\) \/ 2\}px`/.test(appSrc));

console.log('\n--- o balão aparece na hora certa ---');
check('no mouseenter do ícone', /addEventListener\('mouseenter', \(\) => mostrarDicaDaSidebar\(botao\)\)/.test(appSrc));
check('some no mouseleave', /addEventListener\('mouseleave', esconderDicaDaSidebar\)/.test(appSrc));
// Navegar por Tab numa barra só de ícones sem rótulo é adivinhação.
check('e também no foco por teclado', /addEventListener\('focus', \(\) => mostrarDicaDaSidebar\(botao\)\)/.test(appSrc));
check('some no blur', /addEventListener\('blur', esconderDicaDaSidebar\)/.test(appSrc));
// Rolar move o ícone e deixaria o balão parado no lugar antigo.
check('some ao rolar a barra', /barra\.addEventListener\('scroll', esconderDicaDaSidebar\)/.test(appSrc));
check('no celular o balão some', /#navDica \{ display: none; \}/.test(cssSrc));
// Clicar troca a tela e o ícone sai de baixo do cursor — sem esconder, o
// balão fica pendurado sobre o conteúdo novo.
check('some ao clicar no módulo', /esconderDicaDaSidebar\(\);\s*\n\s*state\.activeModule = module;/.test(appSrc));
// O mouse pode sair da janela sem passar pelo mouseleave e deixar o balão preso.
check('Escape some com o balão', /if \(evento\.key !== 'Escape'\) return;\s*\n\s*esconderDicaDaSidebar\(\);/.test(appSrc));

console.log('\n--- os listeners de documento não se acumulam ---');
// ligarSidebar roda a cada renderApp, e renderApp é chamado dezenas de vezes.
check('registrados uma vez só', /if \(sidebarDocumentoLigado\) return;\s*\n\s*sidebarDocumentoLigado = true;/.test(appSrc));
check('ligarSidebar é chamado no render', /ligarSidebar\(\);/.test(appSrc));
const chamadasRender = (appSrc.match(/renderApp\(\)/g) || []).length;
check('e renderApp roda muitas vezes', chamadasRender > 10, `${chamadasRender} chamadas`);

console.log('\n=== BARRA SUPERIOR ===\n');

console.log('--- caminho acima, título embaixo ---');
// Antes tudo cabia numa linha ("Vendas > Novo Pedido") e o nome da tela
// competia com o do módulo pelo mesmo peso visual.
check('existe a linha de caminho', /class="topbar-crumb"/.test(appSrc));
check('o título mostra a TELA, não o módulo', /<h1>\$\{escapeHtml\(activeSubLabel \|\| moduleLabels\[state\.activeModule\]/.test(appSrc));
check('o caminho mostra módulo / tela', /topbar-crumb">\$\{escapeHtml\(moduleLabels\[state\.activeModule\] \|\| ''\)\}\$\{activeSubLabel \? ' \/ '/.test(appSrc));
// Rótulo de módulo e de tela vêm de dados; sem escape, um nome com aspas
// quebraria a marcação.
check('os dois são escapados', (appSrc.match(/topbar-crumb">\$\{escapeHtml/g) || []).length === 1);
check('estilo do caminho existe', /\.topbar-crumb \{/.test(cssSrc));

console.log('\n--- sino de pendências ---');
check('o botão existe', /id="notifBtn"/.test(appSrc));
check('e a marca', /id="notifDot"/.test(appSrc));
// Mesma fonte do painel Atenção: o número aqui e a lista de lá nunca discordam.
check('lê a mesma rota do painel', /api\('\/api\/dashboard\/atencao'\)/.test(appSrc));
// Um número seria a soma de REGISTROS: 23 produtos abaixo do mínimo teria o
// mesmo peso de duas notas rejeitadas.
check('mostra ponto, não número', !/marca\.textContent\s*=/.test(appSrc));
// Pintar tudo de vermelho faria a cor parar de significar algo.
check('vermelho só para crítico', /classList\.toggle\('is-critico', criticos > 0\)/.test(appSrc));
check('sem pendência, sem marca', /marca\.hidden = total === 0;/.test(appSrc));
// Erro de rede não pode encher a tela de toast a cada navegação.
check('falha em silêncio', /catch \(erro\) \{\s*\n\s*marca\.hidden = true;/.test(appSrc));
// O título do botão é o que dá o número a quem quiser.
check('o título do botão conta quantas', /pendência\(s\)/.test(appSrc));

console.log('\n--- o sino ABRE a lista, não navega ---');
// Levar a uma tela obrigaria a abandonar o que se estava fazendo só para
// descobrir se havia algo a fazer. Mesma razão das janelas de atalho.
check('o clique abre o painel', /notifBtn'\)\?\.addEventListener\('click'[\s\S]{0,400}alternarPainelAtencao\(\)/.test(appSrc));
check('e não navega para o dashboard', !/notifBtn'\)\?\.addEventListener\('click'[\s\S]{0,140}activeModule = 'dashboard'/.test(appSrc));
check('o painel existe', /id = 'notifPainel'/.test(appSrc));
// A topbar é sticky e tem contexto de empilhamento próprio: dentro dela o
// painel seria cortado ou ficaria por baixo do conteúdo.
check('vive no body', /document\.body\.appendChild\(caixa\)/.test(appSrc));
check('e é fixed', /\.notif-painel \{[\s\S]*?position: fixed;/.test(cssSrc));
// Alinhado à direita do sino, mas sem sair da janela.
check('não escapa da janela', /Math\.max\(8, Math\.min\(r\.right - largura, window\.innerWidth - largura - 8\)\)/.test(appSrc));

console.log('\n--- cada linha resolve alguma coisa ---');
// Alerta que não leva a lugar nenhum é uma frase, não uma ferramenta.
check('a linha navega para o módulo/tela do item', /state\.activeModule = item\.modulo;\s*\n\s*state\.activeSub = item\.sub;/.test(appSrc));
check('e fecha o painel ao ir', /fecharPainelAtencao\(\);\s*\n\s*if \(!item\) return;/.test(appSrc));
// Sem texto, painel vazio parece falha de carregamento.
check('painel vazio explica que é boa notícia', /Nada pendente\./.test(appSrc));
check('e tem estilo', /\.notif-vazio/.test(cssSrc));

console.log('\n--- abrir não pode parecer morto ---');
// Esperar a rede para só então desenhar faria o clique parecer sem efeito.
check('desenha do cache antes de buscar', /const tinhaCache = Boolean\(ultimoPainelAtencao\);\s*\n\s*if \(tinhaCache\) desenharPainelAtencao/.test(appSrc));
// Se a pessoa fechou enquanto carregava, não pode reabrir sozinho.
check('não reabre se foi fechado', /if \(document\.getElementById\('notifPainel'\) \|\| !tinhaCache\) desenharPainelAtencao\(painel\)/.test(appSrc));
// Com a lista já na tela, o erro de rede não vale um toast.
check('erro só incomoda quando não há o que mostrar', /if \(!tinhaCache\) showToast/.test(appSrc));

console.log('\n--- fechar ---');
check('clique fora fecha', /if \(evento\.target\.closest\('#notifPainel'\)\) return;\s*\n\s*fecharPainelAtencao\(\);/.test(appSrc));
check('Escape fecha', /esconderDicaDaSidebar\(\);\s*\n\s*fecharPainelAtencao\(\);/.test(appSrc));
// Sem parar a propagação, o próprio clique no sino chegaria ao listener de
// fechar e o painel abriria e sumiria no mesmo gesto.
check('o clique no sino não vaza para o fechar', /notifBtn'\)\?\.addEventListener\('click', \(evento\) => \{\s*\n\s*evento\.stopPropagation\(\);/.test(appSrc));
// O sino também fecha o menu da conta antes de abrir: dois painéis flutuantes
// sobrepostos no mesmo canto deixam o usuário sem saber qual está lendo.
check('e fecha o menu da conta antes', /fecharMenuDaConta\(\);\s*\n\s*alternarPainelAtencao\(\);/.test(appSrc));

console.log('\n--- quem está logado voltou ---');
// Saiu da barra lateral quando ela virou só ícones, e aquele era o único
// lugar do sistema que mostrava a conta em uso.
check('o chip existe', /class="topbar-usuario"/.test(appSrc));
check('com avatar', /class="topbar-avatar"/.test(appSrc));
check('e o nome', /class="topbar-usuario-nome"/.test(appSrc));
check('o nome é escapado', /topbar-usuario-nome">\$\{escapeHtml\(state\.user\?\.name \|\| 'Usuário'\)\}/.test(appSrc));
// Em tela estreita o nome sai e sobra o avatar, que já identifica a conta.
check('some o nome em tela estreita', /\.topbar-usuario-nome \{ display: none; \}/.test(cssSrc));

console.log('\n--- iniciais do avatar ---');
const iniciais = new Function(`${appSrc.slice(appSrc.indexOf('function iniciaisDoUsuario'), appSrc.indexOf('/**\n * Marca do sino'))}\nreturn iniciaisDoUsuario;`)();
// Primeira e ÚLTIMA palavra: sobrenome distingue mais do que a segunda letra
// do nome, e é o que separa dois "Eduardo" na mesma empresa.
check('"Eduardo Haas" -> EH', iniciais('Eduardo Haas') === 'EH', iniciais('Eduardo Haas'));
check('"Maria da Silva Souza" -> MS', iniciais('Maria da Silva Souza') === 'MS', iniciais('Maria da Silva Souza'));
check('nome único usa duas letras', iniciais('Administrador') === 'AD', iniciais('Administrador'));
check('vazio não quebra', iniciais('') === '?' && iniciais(null) === '?');
check('espaços extras não viram inicial', iniciais('  Ana  ') === 'AN', iniciais('  Ana  '));

console.log('\n--- menu da conta: tema, configurações e sair num lugar só ---');
const cssConta = ler('public/app.css');
// Eram três controles soltos disputando espaço com o sino e os atalhos, e
// "Sair" ficava do lado de fora, a um clique de distância do resto.
check('o chip virou botão', /id="contaBtn"/.test(appSrc));
check('o menu existe', /id="contaMenu"/.test(appSrc));
check('com o tema dentro', /id="contaTema"/.test(appSrc));
check('as configurações dentro', /id="contaConfig"/.test(appSrc));
check('e o sair dentro', /class="topbar-conta-item topbar-conta-sair" id="logoutBtn"/.test(appSrc));
// Os botões antigos não podem sobrar na barra: dois caminhos para a mesma ação
// deixam metade sem manutenção.
check('o botão de tema solto sumiu', !/id="themeToggleBtn"/.test(appSrc));
check('o de configurações também', !/id="settingsBtn"/.test(appSrc));

// display de autor vence [hidden] do navegador — foi o defeito que deixou o
// menu de Atalhos aberto para sempre, independente da tela.
check('o hidden do menu é explícito no CSS', /\.topbar-conta-menu\[hidden\] \{ display: none; \}/.test(cssConta));
// renderApp roda dezenas de vezes por sessão: registrar o listener a cada
// chamada empilharia um por render.
check('os listeners de documento entram uma vez só', /if \(!window\.__mavisContaLigada\)/.test(appSrc));
check('fecha ao clicar fora', /if \(!evento\.target\.closest\('\.topbar-conta'\)\) fecharMenuDaConta\(\);/.test(appSrc));
check('e no Esc', /if \(evento\.key === 'Escape'\) fecharMenuDaConta\(\);/.test(appSrc));
// Dois painéis flutuantes sobrepostos no mesmo canto: o usuário não sabe qual
// está lendo.
check('abrir a conta fecha o sino', /fecharPainelAtencao\(\);\s*\n\s*menu\.hidden = !abrindo;/.test(appSrc));

// O ícone sozinho na barra nunca dizia em qual tema estava, só o que
// aconteceria ao clicar.
check('o tema mostra o estado atual', /getTheme\(\) === 'dark' \? 'Escuro' : 'Claro'/.test(appSrc));
check('e tem interruptor', /topbar-conta-switch \$\{getTheme\(\) === 'dark' \? 'ligado' : ''\}/.test(appSrc));
// Sem redesenhar, o menu continuaria dizendo "Claro" depois de virar escuro.
check('trocar o tema redesenha o chip', /if \(state\.user\) state\.user\.theme = nextTheme;\s*\n(\s*\/\/[^\n]*\n)*\s*renderApp\(\);/.test(appSrc));
// Sair é a única ação do menu que descarta o que está aberto.
check('sair tem tom de perigo', /\.topbar-conta-sair \{ color: var\(--danger-text\); \}/.test(cssConta));

console.log(`\n===== ${falhas === 0 ? 'TODOS OS CHECKS PASSARAM' : falhas + ' FALHA(S)'} =====`);
process.exit(falhas ? 1 : 0);
