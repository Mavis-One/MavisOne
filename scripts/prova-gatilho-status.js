#!/usr/bin/env node
// O GATILHO DE STATUS, testado POR FORA do servidor.
//
// NAO entra em `npm test`: escreve no banco de verdade. Roda a mao depois de
// aplicar a fase-AJ, ou quando a lista de transicoes mudar:
//
//   node scripts/prova-gatilho-status.js
//
// Existe porque a suite estatica NAO alcanca isto. Ela comparava os 24 pares
// dos dois lados e dava verde enquanto a funcao no banco respondia true para
// "xxx -> yyy" -- os pares estavam certos, so nao eram consultados.
// Semantica de resolucao de nome no Postgres so aparece rodando contra o banco.
//
// Escreve direto no BANCO, sem passar por rota nenhuma da aplicacao. E
// exatamente o caminho que so o banco fecha: script de correcao, UPDATE no
// psql, integracao futura. Antes isso era um POST no PostgREST; desde a saida
// do Supabase e SQL, pela mesma camada que o sistema usa -- o que torna a prova
// ainda mais direta, porque nao ha intermediario nenhum entre este script e o
// gatilho.
require('dotenv').config();
const { banco } = require('../lib/db/client');

let falhas = 0;
const check = (ok, t, d) => { console.log(`  ${ok ? 'OK ' : 'XX '} ${t}${d !== undefined ? ' -> ' + d : ''}`); if (!ok) falhas++; };

// Mantem a forma { status, body } das 11 chamadas abaixo. Os codigos HTTP
// viraram traducao do resultado do SQL: o que importa para a prova e a
// DISTINCAO entre passou e o banco recusou, e a mensagem do gatilho -- as duas
// coisas continuam inteiras.
const rest = async (metodo, caminho, corpo) => {
  const [tabela, consulta = ''] = caminho.split('?');
  const id = (consulta.match(/id=eq\.([^&]+)/) || [])[1];
  const colunas = (consulta.match(/select=([^&]+)/) || [])[1] || '*';

  let resultado;
  if (metodo === 'POST') resultado = await banco.from(tabela).insert(corpo).select();
  else if (metodo === 'PATCH') resultado = await banco.from(tabela).update(corpo).eq('id', id).select();
  else if (metodo === 'GET') resultado = await banco.from(tabela).select(colunas).eq('id', id);
  else if (metodo === 'DELETE') resultado = await banco.from(tabela).delete().eq('id', id);
  else throw new Error('metodo nao previsto nesta prova: ' + metodo);

  if (resultado.error) {
    // P0001 e o raise da trigger -- a recusa que esta prova procura. Qualquer
    // outro erro tambem e >= 400, e a mensagem vai junto no corpo.
    return { status: resultado.error.code === 'P0001' ? 400 : 409, body: resultado.error };
  }
  if (metodo === 'POST') return { status: 201, body: resultado.data };
  if (metodo === 'DELETE') return { status: 204, body: null };
  return { status: 200, body: resultado.data };
};

(async () => {
  const id = 'ord-prova-gatilho-' + Date.now();

  console.log('--- 0. INSERT continua livre ---');
  // Linha nova nao vem de lugar nenhum: barrar o INSERT impediria criar pedido.
  const criou = await rest('POST', 'orders', {
    id, type: 'order', code: 999998, status: 'pedido', date: '2026-08-24',
    customer: 'PROVA DO GATILHO', amount: 10, items: []
  });
  check(criou.status === 201, 'pedido de prova criado com status "pedido"', String(criou.status) + ' ' + JSON.stringify(criou.body).slice(0, 120));
  if (criou.status !== 201) { process.exit(1); }

  console.log('\n--- 1. transição VÁLIDA passa (o sistema não pode travar) ---');
  const valida = await rest('PATCH', `orders?id=eq.${id}`, { status: 'pedido-faturado' });
  check(valida.status === 200, 'pedido -> pedido-faturado', String(valida.status) + ' ' + JSON.stringify(valida.body).slice(0, 100));

  console.log('\n--- 2. UPDATE que não mexe no status passa ---');
  // Sem esta saida no gatilho, TODO update de qualquer campo pagaria a consulta
  // -- e um erro ali travaria a edicao inteira do pedido.
  const outroCampo = await rest('PATCH', `orders?id=eq.${id}`, { customer: 'PROVA DO GATILHO (editado)' });
  check(outroCampo.status === 200, 'editar outro campo do pedido faturado', String(outroCampo.status));

  console.log('\n--- 3. transição INVÁLIDA é recusada PELO BANCO ---');
  const invalida = await rest('PATCH', `orders?id=eq.${id}`, { status: 'orcamento' });
  check(invalida.status >= 400, 'faturado -> orcamento é recusado', String(invalida.status));
  check(/Transicao de status invalida/.test(JSON.stringify(invalida.body)), 'com a mensagem do gatilho',
    (invalida.body && invalida.body.message) || JSON.stringify(invalida.body).slice(0, 140));

  const voltar = await rest('PATCH', `orders?id=eq.${id}`, { status: 'pedido' });
  check(voltar.status >= 400, 'faturado -> pedido também é recusado', String(voltar.status));

  const lixo = await rest('PATCH', `orders?id=eq.${id}`, { status: 'qualquer-coisa' });
  check(lixo.status >= 400, 'status inventado é recusado', String(lixo.status));

  console.log('\n--- 4. o registro NÃO mudou ---');
  const agora = await rest('GET', `orders?id=eq.${id}&select=status,customer`);
  const linha = (agora.body || [])[0] || {};
  check(linha.status === 'pedido-faturado', 'continua faturado', linha.status);
  check(/editado/.test(linha.customer || ''), 'e a edição legítima do passo 2 ficou', linha.customer);

  console.log('\n--- 5. o mesmo vale para quotes ---');
  const idQ = 'qte-prova-gatilho-' + Date.now();
  const q = await rest('POST', 'quotes', {
    id: idQ, type: 'quote', code: 999997, status: 'orcamento-reprovado', date: '2026-08-24',
    customer: 'PROVA DO GATILHO', amount: 10, items: []
  });
  check(q.status === 201, 'orçamento reprovado criado', String(q.status));
  // Reabrir um reprovado e criar outro documento, nao ressuscitar este.
  const reabrir = await rest('PATCH', `quotes?id=eq.${idQ}`, { status: 'orcamento' });
  check(reabrir.status >= 400, 'reprovado não volta para orçamento', String(reabrir.status));

  console.log('\n--- 6. limpeza ---');
  const d1 = await rest('DELETE', `orders?id=eq.${id}`);
  const d2 = await rest('DELETE', `quotes?id=eq.${idQ}`);
  check(d1.status < 300 && d2.status < 300, 'registros de prova removidos', `${d1.status}/${d2.status}`);

  console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== O GATILHO GUARDA =====');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error('EXPLODIU:', e.message); process.exit(1); });
