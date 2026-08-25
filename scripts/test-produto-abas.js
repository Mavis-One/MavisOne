#!/usr/bin/env node
// Abas do cadastro de produto.
//
// Separar um formulário em abas cria três maneiras de perder trabalho do
// usuário, e nenhuma delas aparece como erro na tela:
//
//   1. painel fora do DOM em vez de oculto — o FormData não vê os campos das
//      abas fechadas e o produto é salvo com metade dos dados em branco;
//   2. campo obrigatório numa aba fechada — o navegador não consegue focar o
//      campo para reclamar, cancela o submit e não desenha nada: o botão
//      Salvar simplesmente não faz nada;
//   3. campo esquecido na mudança de layout — o payload continua lendo
//      formData.get('x'), que passa a devolver null para sempre.
//
// Os três são silenciosos. Por isso viram teste.
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const ler = (p) => fs.readFileSync(path.join(RAIZ, p), 'utf8').replace(/\r\n/g, '\n');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};

const telaSrc = ler('public/modules/stock/subs/new_product.js');
const cssSrc = ler('public/app.css');

console.log('--- nenhum campo se perdeu ao dividir em abas ---');
// O payload é a lista de tudo que o servidor espera receber. Se um campo saiu
// do HTML mas continua sendo lido aqui, formData.get devolve null calado.
const lidosNoPayload = [...telaSrc.matchAll(/formData\.get\('([^']+)'\)/g)].map((m) => m[1]);
const declaradosNoHtml = new Set([...telaSrc.matchAll(/name="([^"]+)"/g)].map((m) => m[1]));
check('o formulário lê pelo menos os campos principais', lidosNoPayload.length >= 15, lidosNoPayload.length + ' campos');
const orfaos = [...new Set(lidosNoPayload)].filter((campo) => !declaradosNoHtml.has(campo));
check('todo campo lido no submit existe no HTML', orfaos.length === 0, orfaos.length ? 'órfãos: ' + orfaos.join(', ') : 'nenhum órfão');

// Os obrigatórios são os que travam o salvar, então precisam estar declarados.
['name', 'sku', 'costPrice', 'salePrice'].forEach((campo) => {
  check(`"${campo}" continua no formulário`, declaradosNoHtml.has(campo));
});

console.log('\n--- as abas fechadas ficam ocultas, não fora do DOM ---');
// hidden mantém o campo no formulário: campo com display:none é enviado, só o
// desabilitado fica de fora. Remover o painel do DOM salvaria em branco tudo
// que o usuário não tivesse aberto.
check('o painel usa o atributo hidden', /class="cadastro-tab-panel" data-tab-panel="\$\{id\}" \$\{abaAtiva === id \? '' : 'hidden'\}/.test(telaSrc));
check('trocar de aba só mexe no hidden', /caixa\.hidden = caixa\.dataset\.tabPanel !== id/.test(telaSrc));
check('e não redesenha o formulário', !/abrirAba[\s\S]{0,400}renderNewProduct|abrirAba[\s\S]{0,200}innerHTML/.test(telaSrc));
check('o motivo está escrito no código', /continuam\s*\n?\s*\/\/?\s*entrando no FormData|entrando no FormData/.test(telaSrc));

console.log('\n--- obrigatório em aba fechada não mata o botão Salvar ---');
check('o formulário escuta invalid', /addEventListener\('invalid'/.test(telaSrc));
// Sem a captura o evento não chega ao formulário: invalid não borbulha.
check('na fase de captura, senão o evento não chega', /addEventListener\('invalid',[\s\S]{0,900}\}, true\)/.test(telaSrc));
check('e abre a aba do campo reprovado', /closest\('\.cadastro-tab-panel'\)[\s\S]{0,120}abrirAba\(caixa\.dataset\.tabPanel\)/.test(telaSrc));
// Sem a trava, cada campo inválido trocaria a aba, escondendo justamente o
// primeiro — que é o que o navegador vai focar.
check('só o primeiro inválido manda na aba', /if \(jaAbriuAbaInvalida\) return;/.test(telaSrc));
check('e a trava rearma para o próximo salvar', /setTimeout\(\(\) => \{ jaAbriuAbaInvalida = false; \}, 0\)/.test(telaSrc));

console.log('\n--- o botão salvar não mora dentro de uma aba ---');
// Dentro de um painel ele sumiria ao trocar de aba, e repetido em cada aba
// sugeriria que salva só aquela parte.
const corpoDoForm = telaSrc.slice(telaSrc.indexOf('<form id="stockProductForm"'), telaSrc.indexOf('</form>'));
const acoes = corpoDoForm.indexOf('finance-actions-row');
const ultimoPainel = corpoDoForm.lastIndexOf("${painel(");
check('as ações vêm depois do último painel', acoes > ultimoPainel && ultimoPainel !== -1);

console.log('\n--- reusa as abas que o sistema já tem ---');
// O cadastro de Pessoas já tinha esse desenho (sublinhado + chevron). Um
// segundo estilo de aba faria as duas telas parecerem sistemas diferentes.
check('usa a classe .cadastro-tab, do cadastro de Pessoas', /class="cadastro-tab /.test(telaSrc));
check('com o mesmo par data-tab/data-tab-panel', /data-tab="\$\{aba\.id\}"/.test(telaSrc) && /data-tab-panel=/.test(telaSrc));
check('marca a ativa com .active, como lá', /classList\.toggle\('active', ativa\)/.test(telaSrc));
check('e traz o chevron da aba ativa', /cadastro-tab-chevron/.test(telaSrc));
// Se alguém redefinir .cadastro-tabs mais abaixo, a regra de baixo vence e a
// tela de Pessoas muda junto, sem ninguém pedir.
check('.cadastro-tabs é definida uma vez só no CSS', (cssSrc.match(/^\.cadastro-tabs\s*\{/gm) || []).length === 1);
check('.cadastro-tab-panel também', (cssSrc.match(/^\.cadastro-tab-panel\s*\{/gm) || []).length === 1);
// display de autor vence o [hidden] do navegador — .cadastro-tab-panel declara
// display:grid, então precisa do par explícito ou o painel nunca fecha.
check('e o painel oculto tem display:none explícito', /\.cadastro-tab-panel\[hidden\]\s*\{\s*display:\s*none/.test(cssSrc));

// A aba da VENDA caiu na outra metade da mesma pegadinha, e ao contrario: ela
// nao era grade nenhuma. O formulario e .form-grid, mas o filho direto dele e a
// aba -- as linhas de campo dentro dela empilhavam sem gap, e as duas primeiras
// linhas da aba Dados ficavam coladas enquanto o resto do sistema respirava.
const cssVenda = ler('public/app.css');
check('a aba da venda também é grade', /\.sales-tab-panel \{[^}]*display: grid/.test(cssVenda));
check('  com o mesmo passo do formulário', /\.sales-tab-panel \{[^}]*gap: 26px/.test(cssVenda));
// Mesma armadilha da .cadastro-tab-panel: sem isto, as seis abas da venda
// aparecem TODAS de uma vez.
check('  e a aba oculta tem display:none explícito', /\.sales-tab-panel\[hidden\]\s*\{\s*display:\s*none/.test(cssVenda));

console.log('\n--- a grade dos campos continua de pé ---');
check('o painel do produto é centrado', /\.produto-form-wrap\s*\{[^}]*margin-inline:\s*auto/.test(cssSrc));
check('e a tela usa esse invólucro', /class="produto-form-wrap"/.test(telaSrc));
check('as linhas têm colunas fixas, não auto-fit', /#stockProductForm \.row \{[\s\S]{0,120}repeat\(4, minmax\(0, 1fr\)\)/.test(cssSrc));
// A altura em si e livre (ela acompanha o tamanho padrao do campo, que muda
// em app.css num lugar so). O que este check cobra e que input e select
// continuem no MESMO seletor com altura fixa -- e dai que vem a igualdade.
// Cravar o numero aqui so faria a suite falhar a cada ajuste de tamanho,
// sem nada ter quebrado na tela.
check('input e select têm a mesma altura',
  /#stockProductForm \.row > label > input,[\s\S]{0,80}> select \{[^}]*height: \d+px/.test(cssSrc));

console.log(`\n===== ${falhas === 0 ? 'TODOS OS CHECKS PASSARAM' : falhas + ' FALHA(S)'} =====`);
process.exit(falhas ? 1 : 0);
