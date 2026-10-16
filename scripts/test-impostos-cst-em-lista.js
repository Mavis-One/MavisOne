#!/usr/bin/env node
/**
 * ABA IMPOSTOS DA EMISSÃO: CST NA LISTA, SÓ O PERCENTUAL SE DIGITA (14/10/2026).
 *
 * Pedido do usuário: os CST dos itens (CSOSN, ICMS, PIS, COFINS, IBS/CBS) se
 * SELECIONAM, já com o que a regra fiscal carregou, e só os campos de (%) se
 * modificam. Base e valor saem do servidor.
 *
 * Provado no navegador (servidor local, nota avulsa da Plus, 1 item R$ 9.990):
 *   CST ICMS, IPI, PIS, COFINS e IBS/CBS em <select>, vindos da regra (00, 01, 01, 000)
 *   a lista do ICMS segue o regime: CST 00 -> só a tabela de CST
 *   base e valor travados; PIS 0,65% -> 1,65% refez o valor para R$ 164,84
 *   console sem erros
 */
const fs = require('fs');
const path = require('path');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas += 1;
};
const tela = fs.readFileSync(path.join(__dirname, '..', 'public/modules/finance/subs/emitir_nfe_focus.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'public/app.css'), 'utf8');

console.log('--- a aba Impostos ---');
check('as listas vêm das mesmas tabelas das Regras Fiscais', tela.includes("api('/api/fiscal/tabelas').catch(() => null)"));
check('CST de IPI, PIS, COFINS e IBS/CBS em lista',
  tela.includes("const LISTA_DO_CST = { cstIpi: 'cstIpi', cstPis: 'cstPisCofins', cstCofins: 'cstPisCofins', cstIbsCbs: 'cstIbsCbs' };"));
check('o do ICMS separa CSOSN (3 dígitos) de CST (2)',
  tela.includes('<optgroup label="CSOSN (Simples Nacional)">') && tela.includes("grupos = codigo.length === 3 ? csosn : codigo.length === 2 ? cst : csosn + cst;"));
check('código fora da tabela continua aparecendo (não some em silêncio)',
  tela.includes("(codigo && !conhecido ? `<option value=\"${escapeHtml(codigo)}\" selected>"));
check('sem permissão de ler as tabelas, volta a ser texto', tela.includes('if (!tabelasFiscais) return null;'));
// 16/10/2026, pedido do usuário ("permita edição no campo de valor das NF"):
// base e valor deixaram de ser travados — vêm calculados e se digitam. O
// digitado vale na nota (aplicarValoresEditados), e trocar a alíquota ou a base
// devolve o valor ao cálculo (RECALCULA).
const calculados = ['baseIcms', 'valorIcms', 'baseIcmsSt', 'valorIcmsSt', 'baseIpi', 'valorIpi', 'basePis', 'valorPis', 'baseCofins', 'valorCofins', 'valorIbs', 'valorCbs'];
const bloco = tela.slice(tela.indexOf('const CAMPOS_CALCULADOS = ['), tela.indexOf('];', tela.indexOf('const CAMPOS_CALCULADOS = [')));
check('base e valor de todos os grupos: calculados', calculados.every((c) => bloco.includes(`'${c}'`)));
check('  e nenhum campo de imposto fica só leitura', !/readonly tabindex="-1"/.test(tela.slice(tela.indexOf('function campoFiscal('), tela.indexOf('function valorFiscal('))));
check('  trocar a alíquota ou a base devolve o valor ao cálculo',
  /aliquotaIcms: \['baseIcms', 'valorIcms'\]/.test(tela) && /baseIcms: \['valorIcms'\]/.test(tela) && /aliquotaCbs: \['valorCbs'\]/.test(tela)
  && /\(RECALCULA\[campo\] \|\| \[\]\)\.forEach\(\(dependente\) => \{ delete item\.fiscal\[dependente\]; \}\);/.test(tela));
check('mudar CST ou percentual refaz a prévia sozinho',
  /evento\.target\.closest\('label'\)\?\.classList\.toggle\('is-editado', editado\(item, campo\)\);\s*\/\/[^\n]*\n[^\n]*\n\s*carregarPrevia\(\);/.test(tela));
check('a lista editada fica marcada como o campo editado', css.includes('.nfe-imposto-campos label.is-editado select'));
// 14/10/2026: faixas alternadas e campo que não se altera mais escuro, nos dois
// temas (conferido no navegador: claro branco x 86% cinza; escuro #18242f x preto).
check('grupos em faixas alternadas', css.includes('.nfe-imposto-item > .nfe-imposto-grupo:nth-child(even) { background: rgba(var(--text-rgb), 0.05); }'));
check('campo travado mais escuro que o editável',
  css.includes('.nfe-imposto-campos input[readonly] { background: color-mix(in srgb, var(--input-bg) 86%, #000);')
  && css.includes(':root[data-theme="dark"] .nfe-imposto-campos input[readonly] { background: #000; }'));
// 14/10/2026: um item por vez, em abas (provado no navegador com 2 itens: a
// aba troca o item, o ponto marca o item editado, a aba principal não muda).
check('itens em abas na aba Impostos', tela.includes('<div class="nfe-item-abas" role="tablist">')
  && tela.includes('if (index !== abaImpostoDoItem) return \'\';')
  && tela.includes("const abaDoItem = evento.target.closest('[data-imposto-item]');"));
// E os grupos do item (ICMS, IPI...) em abas: só os campos do aberto.
check('grupos do item em abas', tela.includes('<div class="nfe-grupo-abas" role="tablist">') && tela.includes("const abaDoGrupo = evento.target.closest('[data-imposto-grupo]');")
  && tela.includes("const aberto = grupos.find((g) => g.titulo === abaGrupoImposto) || grupos[0];"));
check('  com o visual das abas da nota', css.includes('.nfe-item-aba.active { color: var(--text); font-weight: 700; border-bottom-color: var(--text); }'));
check('  e o editado continua marcado no escuro', css.includes(':root[data-theme="dark"] .nfe-imposto-campos label.is-editado input,'));

console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TUDO OK =====');
process.exit(falhas ? 1 : 0);
