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
const travados = ['baseIcms', 'valorIcms', 'baseIcmsSt', 'valorIcmsSt', 'baseIpi', 'valorIpi', 'basePis', 'valorPis', 'baseCofins', 'valorCofins', 'valorIbs', 'valorCbs'];
const bloco = tela.slice(tela.indexOf('const CAMPOS_SO_LEITURA = ['), tela.indexOf('];', tela.indexOf('const CAMPOS_SO_LEITURA = [')));
check('base e valor travados em todos os grupos', travados.every((c) => bloco.includes(`'${c}'`)));
check('  e nenhum percentual travado', !/'aliquota|'reducao|'mva/.test(bloco));
check('mudar CST ou percentual refaz a prévia sozinho',
  /evento\.target\.closest\('label'\)\?\.classList\.toggle\('is-editado', editado\(item, campo\)\);\s*\/\/[^\n]*\n[^\n]*\n\s*carregarPrevia\(\);/.test(tela));
check('a lista editada fica marcada como o campo editado', css.includes('.nfe-imposto-campos label.is-editado select'));

console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TUDO OK =====');
process.exit(falhas ? 1 : 0);
