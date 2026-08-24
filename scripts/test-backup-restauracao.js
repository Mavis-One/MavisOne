#!/usr/bin/env node
/**
 * A VOLTA: backup -> apaga -> restaura -> confere.
 *
 *   node scripts/test-backup-restauracao.js
 *
 * NÃO entra em `npm test`: escreve no banco de verdade. Roda à mão depois de
 * mexer no backup ou no restaurador.
 *
 * Um backup que nunca foi restaurado não é um backup — é um arquivo. Este
 * teste é o que transforma um no outro.
 *
 * ELE USA DADOS PRÓPRIOS, criados e apagados aqui, com ids marcados
 * `zz-teste-backup-*`. Nada de apagar linha de verdade para ver se volta.
 *
 * O que ele exercita de propósito:
 *   - o CICLO de chave estrangeira (hr_departments <-> hr_employees), que é o
 *     único caminho do restaurador que a operação normal nunca percorre;
 *   - o GATILHO de status em orders/quotes, que pode recusar uma restauração
 *     por cima de linha mais nova — comportamento correto e surpreendente.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { criarRest } = require('./lib-backup');

const RAIZ = path.join(__dirname, '..');
const MARCA = 'zz-teste-backup';
let falhas = 0;
const check = (ok, t, d) => { console.log(`  ${ok ? 'OK ' : 'XX '} ${t}${d !== undefined ? ' -> ' + d : ''}`); if (!ok) falhas++; };

const rest = criarRest();
const api = async (metodo, caminho, corpo, extra = {}) => {
  const r = await fetch(`${rest.base}/rest/v1/${caminho}`, {
    method: metodo,
    headers: rest.cabecalhos(Object.assign({ Prefer: 'return=representation' }, extra)),
    body: corpo ? JSON.stringify(corpo) : undefined
  });
  const txt = await r.text();
  let json = null; try { json = JSON.parse(txt); } catch (_) { json = txt; }
  return { status: r.status, body: json };
};
const rodar = (args) => execFileSync(process.execPath, args, { cwd: RAIZ, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

(async () => {
  const dep = `${MARCA}-dep`;
  const emp = `${MARCA}-emp`;
  const ord = `${MARCA}-ord`;
  const qte = `${MARCA}-qte`;

  console.log('--- 0. cria dados de teste, incluindo o CICLO de FK ---');
  await api('DELETE', `hr_departments?id=eq.${dep}`);
  await api('DELETE', `hr_employees?id=eq.${emp}`);
  await api('DELETE', `orders?id=eq.${ord}`);
  await api('DELETE', `quotes?id=eq.${qte}`);

  // Passo 1: os dois sem apontar um para o outro (o ciclo não deixa criar de
  // uma vez nem aqui).
  const e1 = await api('POST', 'hr_employees', { id: emp, name: 'PESSOA DE TESTE DO BACKUP' });
  check(e1.status === 201, 'colaborador criado', String(e1.status) + ' ' + JSON.stringify(e1.body).slice(0, 100));
  const d1 = await api('POST', 'hr_departments', { id: dep, name: 'SETOR DE TESTE DO BACKUP', manager_id: emp });
  check(d1.status === 201, 'departamento criado apontando para o colaborador', String(d1.status));
  // Passo 2: fecha o ciclo.
  const e2 = await api('PATCH', `hr_employees?id=eq.${emp}`, { department_id: dep });
  check(e2.status === 200, 'e o colaborador aponta de volta — ciclo fechado', String(e2.status));

  const o1 = await api('POST', 'orders', {
    id: ord, type: 'order', code: 999990, status: 'pedido-faturado', date: '2026-08-24',
    customer: 'CLIENTE DE TESTE DO BACKUP', amount: 123.45, items: [{ name: 'X', quantity: 2, unitPrice: 61.725 }]
  });
  check(o1.status === 201, 'pedido criado (faturado, para testar o gatilho)', String(o1.status));
  const q1 = await api('POST', 'quotes', {
    id: qte, type: 'quote', code: 999991, status: 'orcamento', date: '2026-08-24',
    customer: 'CLIENTE DE TESTE DO BACKUP', amount: 10, items: []
  });
  check(q1.status === 201, 'orçamento criado', String(q1.status));

  console.log('\n--- 1. backup ---');
  const saida = rodar([path.join('scripts', 'backup-supabase.js')]);
  const m = saida.match(/data\/backup\/(\d{8}-\d{6})/);
  check(!!m, 'backup rodou', m ? m[1] : saida.slice(-200));
  const pasta = `data/backup/${m[1]}`;
  const manifesto = JSON.parse(fs.readFileSync(path.join(RAIZ, pasta, 'manifesto.json'), 'utf8'));
  const conta = (t) => (manifesto.tabelas.find((x) => x.nome === t) || {}).linhas;
  check(conta('hr_departments') === 1 && conta('hr_employees') === 1, 'as tabelas do ciclo entraram no backup');
  check(!manifesto.erros.length, 'sem erros de coleta', JSON.stringify(manifesto.erros).slice(0, 120));
  // A ordem tem de pôr quem é referenciado antes de quem referencia.
  const iCat = manifesto.ordemDeInsercao.indexOf('financial_categories');
  const iEnt = manifesto.ordemDeInsercao.indexOf('financial_entries');
  check(iCat >= 0 && iCat < iEnt, 'a ordem respeita a dependência', `categorias ${iCat} < lançamentos ${iEnt}`);

  console.log('\n--- 2. APAGA os dados de teste ---');
  // Ordem inversa: o departamento aponta para o colaborador.
  await api('PATCH', `hr_employees?id=eq.${emp}`, { department_id: null });
  await api('DELETE', `hr_departments?id=eq.${dep}`);
  await api('DELETE', `hr_employees?id=eq.${emp}`);
  await api('DELETE', `orders?id=eq.${ord}`);
  await api('DELETE', `quotes?id=eq.${qte}`);
  const sumiu = await api('GET', `hr_employees?id=eq.${emp}&select=id`);
  check(Array.isArray(sumiu.body) && sumiu.body.length === 0, 'sumiram do banco');

  console.log('\n--- 3. ensaio não escreve nada ---');
  const ensaio = rodar([path.join('scripts', 'restaurar-supabase.js'), pasta]);
  check(/MODO: ENSAIO/.test(ensaio), 'o padrão é ensaio');
  const aindaSumido = await api('GET', `hr_employees?id=eq.${emp}&select=id`);
  check(aindaSumido.body.length === 0, 'e o ensaio de fato não gravou');

  console.log('\n--- 4. restaura de verdade ---');
  let restaurou = '';
  try {
    restaurou = rodar([path.join('scripts', 'restaurar-supabase.js'), pasta, '--executar']);
  } catch (erro) {
    // O script sai com código 1 quando há falha; a saída ainda interessa.
    restaurou = String((erro.stdout || '') + (erro.stderr || ''));
  }
  console.log(restaurou.split('\n').filter((l) => /FALHA|Segunda passada|hr_|linha\(s\)/.test(l)).slice(0, 8).map((l) => '    ' + l.trim()).join('\n'));

  console.log('\n--- 5. tudo voltou? ---');
  const vEmp = (await api('GET', `hr_employees?id=eq.${emp}&select=*`)).body[0];
  const vDep = (await api('GET', `hr_departments?id=eq.${dep}&select=*`)).body[0];
  const vOrd = (await api('GET', `orders?id=eq.${ord}&select=*`)).body[0];
  const vQte = (await api('GET', `quotes?id=eq.${qte}&select=*`)).body[0];
  check(!!vEmp && vEmp.name === 'PESSOA DE TESTE DO BACKUP', 'colaborador voltou', vEmp && vEmp.name);
  check(!!vDep, 'departamento voltou');
  // Este é o ponto do teste: a segunda passada devolveu as pontas do ciclo.
  check(vDep && vDep.manager_id === emp, 'o ciclo foi refeito: departamento -> colaborador', vDep && vDep.manager_id);
  check(vEmp && vEmp.department_id === dep, 'e colaborador -> departamento', vEmp && vEmp.department_id);
  check(!!vOrd && Number(vOrd.amount) === 123.45, 'pedido voltou com o valor exato', vOrd && vOrd.amount);
  check(vOrd && vOrd.status === 'pedido-faturado', 'e com o status', vOrd && vOrd.status);
  // JSONB tem de voltar como objeto, não como texto do objeto.
  check(vOrd && Array.isArray(vOrd.items) && vOrd.items[0] && vOrd.items[0].quantity === 2,
    'o jsonb voltou como estrutura, não como texto', JSON.stringify(vOrd && vOrd.items));
  check(!!vQte && vQte.status === 'orcamento', 'orçamento voltou', vQte && vQte.status);

  console.log('\n--- 6. restaurar duas vezes dá o mesmo resultado ---');
  // Restauração que só funciona uma vez é armadilha: no dia do desastre
  // ninguém acerta de primeira.
  let segunda = '';
  try { segunda = rodar([path.join('scripts', 'restaurar-supabase.js'), pasta, '--executar']); }
  catch (erro) { segunda = String((erro.stdout || '') + (erro.stderr || '')); }
  check(!/FALHA/.test(segunda), 'a segunda restauração não falha', (segunda.match(/.*FALHA.*/) || [''])[0].slice(0, 120));
  const vOrd2 = (await api('GET', `orders?id=eq.${ord}&select=amount`)).body[0];
  check(vOrd2 && Number(vOrd2.amount) === 123.45, 'e o dado continua o mesmo', vOrd2 && vOrd2.amount);

  console.log('\n--- 7. o gatilho de status recusa restauração por cima de linha mais nova ---');
  // Cancela o pedido no banco; o backup ainda o tem como faturado. Restaurar
  // por cima seria cancelado -> faturado, que a fase-AJ proíbe.
  await api('PATCH', `orders?id=eq.${ord}`, { status: 'pedido-cancelado' });
  let porCima = '';
  try { porCima = rodar([path.join('scripts', 'restaurar-supabase.js'), pasta, '--executar', '--tabelas', 'orders']); }
  catch (erro) { porCima = String((erro.stdout || '') + (erro.stderr || '')); }
  const recusou = /Transicao de status invalida/.test(porCima);
  check(recusou, 'o gatilho recusou, e o script RELATOU em vez de contornar',
    (porCima.match(/Transicao de status invalida[^"]*/) || [''])[0].slice(0, 90));
  const depoisDaRecusa = (await api('GET', `orders?id=eq.${ord}&select=status`)).body[0];
  check(depoisDaRecusa && depoisDaRecusa.status === 'pedido-cancelado', 'e o banco ficou como estava', depoisDaRecusa && depoisDaRecusa.status);

  console.log('\n--- 8. limpeza ---');
  await api('PATCH', `hr_employees?id=eq.${emp}`, { department_id: null });
  await api('DELETE', `hr_departments?id=eq.${dep}`);
  await api('DELETE', `hr_employees?id=eq.${emp}`);
  await api('DELETE', `orders?id=eq.${ord}`);
  await api('DELETE', `quotes?id=eq.${qte}`);
  const sobrou = (await api('GET', `orders?id=eq.${ord}&select=id`)).body;
  check(Array.isArray(sobrou) && sobrou.length === 0, 'dados de teste removidos');
  // A pasta do backup do teste some junto: ela tem uma cópia dos dados reais.
  fs.rmSync(path.join(RAIZ, pasta), { recursive: true, force: true });
  check(!fs.existsSync(path.join(RAIZ, pasta)), 'backup do teste removido', pasta);

  console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== A VOLTA FUNCIONA =====');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error('EXPLODIU:', e.message); process.exit(1); });
