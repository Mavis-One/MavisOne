#!/usr/bin/env node
// EXCLUIR LANÇAMENTOS EM LOTE, PELO VPS (17/11/2026).
//
// Pedido do usuário, depois de ver os 131 títulos em duplicidade de 25/11:
// "pra excluir tudo isso de uma vez pelo vps como eu faço". Rodar no VPS, na
// pasta do sistema, com o sistema no ar:
//
//   node scripts/excluir-lancamentos.js LF32217 LF32221 ...        (só a prévia)
//   node scripts/excluir-lancamentos.js --arquivo ~/codigos.txt     (idem, códigos num arquivo)
//   node scripts/excluir-lancamentos.js --arquivo ~/codigos.txt --enviar --motivo "Duplicado da importação de 14/10"
//   (--usuario admin evita a pergunta do usuário; a senha é sempre perguntada)
//
// Os códigos podem vir separados por espaço, vírgula ou linha — vale colar a
// linha "Códigos sugeridos para excluir: ..." do scripts/titulos-duplicados.js
// inteira dentro do arquivo.
//
// PELA MESMA ROTA DA TELA (DELETE /api/finance/entries), e não por SQL: é ela
// que solta a movimentação do extrato conciliada, guarda o lançamento inteiro
// na trilha de auditoria e devolve o pedido que ficou sem título. Por isso o
// script pede usuário e senha de quem exclui — administrador, ou com a
// permissão de excluir lançamento —, e é esse nome que fica na auditoria.
//
// SEM --enviar NADA É EXCLUÍDO: mostra a prévia (a mesma que a tela mostra) e
// para. Lançamento com baixa ou conciliado no extrato faz o script parar,
// mesmo com --enviar, a não ser que venha --mesmo-com-baixa: num lote de
// duplicados, título com baixa quase sempre é o que devia FICAR.
//
// O login é o da tela: entrar por aqui derruba a sessão desse usuário nas
// outras máquinas (login único). Depois é só entrar de novo no navegador.
'use strict';

require('dotenv').config({ quiet: true });
const fs = require('fs');
const readline = require('readline');
const { consultar, fecharPool } = require('../lib/db/conexao');
const lancamentoCodigo = require('../public/modules/shared/lancamento_codigo');
const { MAXIMO_DO_LOTE } = require('../public/modules/shared/lancamentos_lista');

const argv = process.argv.slice(2);
const opcao = (nome) => {
  const i = argv.indexOf(nome);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : '';
};
const enviar = argv.includes('--enviar');
const mesmoComBaixa = argv.includes('--mesmo-com-baixa');
const motivo = opcao('--motivo').trim();
const arquivo = opcao('--arquivo');
const base = (opcao('--url') || `http://127.0.0.1:${process.env.PORT || 3000}`).replace(/\/+$/, '');

const reais = (v) => Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Os códigos LF do texto, na ordem, sem repetir. */
function codigosDoTexto(texto) {
  const vistos = new Set();
  for (const m of String(texto || '').matchAll(/\bLF\s*0*(\d+)\b/gi)) {
    const n = lancamentoCodigo.numero(m[1]);
    if (n) vistos.add(n);
  }
  return [...vistos];
}

function perguntar(pergunta, { oculto = false } = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (oculto) {
      process.stdout.write(pergunta);
      // A senha não aparece na tela nem fica no histórico do terminal.
      rl._writeToOutput = () => {};
      rl.question('', (resposta) => { rl.close(); process.stdout.write('\n'); resolve(resposta); });
    } else {
      rl.question(pergunta, (resposta) => { rl.close(); resolve(resposta); });
    }
  });
}

async function chamar(caminho, { metodo = 'GET', token = '', corpo } = {}) {
  const r = await fetch(`${base}${caminho}`, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', ...(token ? { 'x-auth-token': token } : {}) },
    body: corpo === undefined ? undefined : JSON.stringify(corpo)
  });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${caminho}: HTTP ${r.status} — ${json.error || 'sem resposta'}`);
  return json;
}

const emLotes = (lista) => {
  const lotes = [];
  for (let i = 0; i < lista.length; i += MAXIMO_DO_LOTE) lotes.push(lista.slice(i, i + MAXIMO_DO_LOTE));
  return lotes;
};

(async () => {
  let token = '';
  try {
    // Os códigos soltos na linha de comando: tudo menos as opções e os valores delas.
    const valoresDeOpcao = new Set(['--motivo', '--arquivo', '--url', '--usuario'].map((o) => argv.indexOf(o)).filter((i) => i >= 0).map((i) => i + 1));
    const soltos = argv.filter((a, i) => !a.startsWith('--') && !valoresDeOpcao.has(i));
    const texto = [...soltos, arquivo ? fs.readFileSync(arquivo, 'utf8') : ''].join(' ');
    const numeros = codigosDoTexto(texto);
    if (!numeros.length) throw new Error('Nenhum código LF informado. Ex.: node scripts/excluir-lancamentos.js --arquivo ~/codigos.txt');
    if (enviar && motivo.length < 10) throw new Error('Com --enviar, informe --motivo "..." (pelo menos 10 caracteres). Ele fica na auditoria.');

    // Código -> id. Só leitura; a exclusão em si vai pela rota.
    const { rows } = await consultar(
      'select id, code::int as code from financial_entries where code = any($1::int[])', [numeros]);
    const idDoNumero = new Map(rows.map((r) => [Number(r.code), r.id]));
    const naoAchados = numeros.filter((n) => !idDoNumero.has(n)).map((n) => lancamentoCodigo.formatar(n));
    const ids = numeros.filter((n) => idDoNumero.has(n)).map((n) => idDoNumero.get(n));
    console.log(`${numeros.length} código(s) informado(s); ${ids.length} encontrado(s).`);
    if (naoAchados.length) console.log(`Não existem (ou já foram excluídos): ${naoAchados.join(', ')}`);
    if (!ids.length) return;

    const usuario = opcao('--usuario').trim() || (await perguntar('Usuário do MavisONE: ')).trim();
    // MAVIS_SENHA só para o teste automatizado; no VPS, a senha é perguntada.
    const senha = process.env.MAVIS_SENHA || await perguntar('Senha: ', { oculto: true });
    token = (await chamar('/api/login', { metodo: 'POST', corpo: { username: usuario, password: senha } })).token;

    // A PRÉVIA — a mesma que a tela mostra antes de excluir.
    const itens = [];
    for (const lote of emLotes(ids)) {
      itens.push(...(await chamar('/api/finance/entries', { metodo: 'DELETE', token, corpo: { ids: lote, previa: true } })).itens);
    }
    console.log('');
    for (const i of itens) {
      const extras = [
        i.baixas ? `${i.baixas} baixa(s) R$ ${reais(i.valorDasBaixas)}` : '',
        i.conciliadas ? `conciliado no extrato (${i.conciliadas})` : '',
        i.vinculo || '',
        i.motivo ? `NÃO SAI: ${i.motivo}` : ''
      ].filter(Boolean).join(' · ');
      console.log(`  ${String(i.codigo).padEnd(8)} R$ ${reais(i.valor).padStart(10)}  ${String(i.descricao || '').slice(0, 70)}${extras ? `  [${extras}]` : ''}`);
    }
    const total = itens.reduce((s, i) => s + Number(i.valor || 0), 0);
    const comBaixa = itens.filter((i) => i.baixas || i.conciliadas);
    console.log(`\n${itens.length} lançamento(s), R$ ${reais(total)} no total; ${comBaixa.length} com baixa ou conciliado.`);

    if (comBaixa.length && !mesmoComBaixa) {
      console.log(`\nPAREI: ${comBaixa.map((i) => i.codigo).join(', ')} tem baixa ou conciliação. Num lote de duplicados, esse costuma ser o que FICA.`);
      console.log('Tire-os da lista, ou rode com --mesmo-com-baixa se tiver certeza (as baixas saem junto e o extrato volta a "Não conciliado").');
      return;
    }
    if (!enviar) {
      console.log('\nNada foi excluído (prévia). Para excluir, rode de novo com --enviar --motivo "...".');
      return;
    }

    let excluidos = 0;
    const ignorados = [];
    for (const lote of emLotes(ids)) {
      const r = await chamar('/api/finance/entries', { metodo: 'DELETE', token, corpo: { ids: lote, motivo } });
      excluidos += (r.processados || []).length;
      ignorados.push(...(r.ignorados || []));
      if (r.resumo) console.log(r.resumo);
    }
    console.log(`\nEXCLUÍDOS: ${excluidos}.`);
    for (const i of ignorados) console.log(`  ficou ${i.codigo}: ${i.motivo}`);
    process.exitCode = ignorados.length ? 1 : 0;
  } catch (erro) {
    console.error(`ERRO: ${erro.message}`);
    process.exitCode = 1;
  } finally {
    if (token) await chamar('/api/logout', { metodo: 'POST', token, corpo: {} }).catch(() => {});
    await fecharPool();
  }
})();
