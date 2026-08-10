// CRUD dos módulos Frota, RH, PCP e Contratos contra o Supabase REAL.
//
// Fora do "npm test" de propósito: as outras suítes são puras e rodam sem rede
// nem credencial. Esta escreve no banco, então é chamada à parte:
//     npm run modulos
//
// Cria, lê, edita e apaga tudo o que usa — o banco fica como estava.
require('dotenv').config();
const m = require('../lib/db/modulos');
const { supabase } = require('../lib/db/client');

let falhas = 0;
const check = (n, c, d) => { console.log(`${c ? '  OK ' : '  XX '} ${n}${d ? ' -> ' + d : ''}`); if (!c) falhas++; };
const lixo = [];

(async () => {
  try {
    console.log('\n--- 1. todo recurso lista sem erro ---');
    for (const nome of Object.keys(m.RECURSOS)) {
      try {
        const l = await m.listar(nome);
        check(nome, Array.isArray(l), `${l.length} registro(s)`);
      } catch (e) { check(nome, false, e.message); }
    }

    console.log('\n--- 2. ciclo completo num veículo ---');
    const v = await m.criar('fleet/vehicles', { plate: 'ZZT4B56', description: 'ZZ Teste', year: 2020, odometer: 1000, status: 'ativo' });
    lixo.push(['fleet/vehicles', v.id]);
    check('criou e devolveu o registro', Boolean(v && v.id), v?.id);
    check('campo camelCase volta preenchido', v.plate === 'ZZT4B56' && v.year === 2020, `${v.plate}/${v.year}`);

    const lido = await m.obter('fleet/vehicles', v.id);
    check('obter traz o mesmo registro', lido.id === v.id);

    const editado = await m.atualizar('fleet/vehicles', v.id, { odometer: 2500 });
    check('editar aplicou a mudança', Number(editado.odometer) === 2500, String(editado.odometer));
    check('PUT parcial NÃO apagou os outros campos', editado.plate === 'ZZT4B56' && editado.year === 2020, `${editado.plate}/${editado.year}`);

    console.log('\n--- 3. campo vazio: null onde pode, padrão onde não pode ---');
    // Um <input> não preenchido manda ''. Em coluna que aceita nulo isso vira
    // null; em coluna NOT NULL DEFAULT tem que virar o padrão, porque mandar
    // null explícito faz o Postgres recusar (o DEFAULT só vale se a coluna for
    // OMITIDA). Este bloco trava o par descritor/DDL — foi ele que pegou o erro.
    const semNada = await m.criar('fleet/maintenances', { vehicleId: v.id, date: '2026-08-07', cost: '', odometer: '', description: '' });
    lixo.push(['fleet/maintenances', semNada.id]);
    check('numérico que aceita nulo virou null', semNada.odometer === null, String(semNada.odometer));
    check('texto que aceita nulo virou null', semNada.description === null, String(semNada.description));
    check('custo (NOT NULL DEFAULT 0) virou 0', Number(semNada.cost) === 0, String(semNada.cost));

    console.log('\n--- 4. o banco recusa o que tem que recusar ---');
    let recusou = false;
    try { await m.criar('fleet/vehicles', { plate: 'zzt4b56' }); } catch (e) { recusou = true; }
    check('placa repetida em outra caixa é recusada', recusou);
    recusou = false;
    try { await m.criar('contracts/contracts', { title: 'ZZ', billingCycle: 'quinzenal' }); } catch (e) { recusou = true; }
    check('ciclo de cobrança inválido é recusado', recusou);
    recusou = false;
    try { await m.criar('fleet/maintenances', { vehicleId: 'nao-existe', date: '2026-08-07' }); } catch (e) { recusou = true; }
    check('manutenção de veículo inexistente é recusada', recusou);

    console.log('\n--- 5. booleano e data em contratos ---');
    const c = await m.criar('contracts/contracts', { title: 'ZZ Contrato', partyKind: 'cliente', value: 990.5, billingCycle: 'mensal', autoRenew: true, startDate: '2026-01-01', endDate: '' });
    lixo.push(['contracts/contracts', c.id]);
    check('booleano gravado como true', c.autoRenew === true, String(c.autoRenew));
    check('data preenchida mantida', String(c.startDate).slice(0, 10) === '2026-01-01', String(c.startDate));
    check('data vazia virou null', c.endDate === null, String(c.endDate));
    check('valor decimal preservado', Number(c.value) === 990.5, String(c.value));

    console.log('\n--- 6. recurso inexistente falha alto ---');
    let erro = null;
    try { await m.listar('fleet/inventado'); } catch (e) { erro = e.message; }
    check('recurso desconhecido lança erro', /desconhecido/.test(erro || ''), erro);

    console.log('\n--- 7. todo recurso declara lista, item e ordem ---');
    // Faltar um destes só apareceria na tela, como resposta sem a chave que o
    // JavaScript esperava.
    const incompletos = Object.entries(m.RECURSOS)
      .filter(([, d]) => !d.tabela || !d.prefixo || !d.ordem || !d.lista || !d.item)
      .map(([nome]) => nome);
    check('todos os 12 recursos completos', incompletos.length === 0, incompletos.join(', ') || `${Object.keys(m.RECURSOS).length} recursos`);

    console.log('\n--- 8. CRM: o token nunca sai do servidor ---');
    // A tela precisa saber SE existe credencial, nunca QUAL é. Devolver o
    // segredo a cada carregamento o deixaria no histórico do navegador e em
    // qualquer log de rede pelo caminho.
    const crm = require('../lib/db/crm');
    const antes = await crm.getConexao();
    check('resposta não tem campo de token', !('apiToken' in antes) && !('api_token' in antes), Object.keys(antes).join(','));
    check('diz apenas SE existe token', 'temToken' in antes);

    await crm.salvarConexao({ baseUrl: 'https://zz.invalido/api', apiToken: 'zz-segredo', active: true });
    const salvo = await crm.getConexao();
    check('token guardado sem aparecer na resposta', salvo.temToken === true && !JSON.stringify(salvo).includes('zz-segredo'));

    // Abrir a tela e salvar outro campo não pode apagar a credencial.
    await crm.salvarConexao({ baseUrl: 'https://zz.invalido/api2', apiToken: '', active: true });
    check('salvar sem preencher preserva o token', (await crm.getConexao()).temToken === true);

    const teste = await crm.testarConexao();
    check('teste com endereço inválido não lança', teste.ok === false && typeof teste.error === 'string');
    check('falha NÃO apaga o último sucesso', (await crm.getConexao()).lastOkAt === antes.lastOkAt);
    await supabase.from('crm_connection').delete().eq('id', 1);

    console.log('\n--- 9. exclusão ---');
    await m.remover('fleet/vehicles', v.id);
    check('veículo excluído', (await m.obter('fleet/vehicles', v.id)) === null);
    check('manutenção foi junto (cascade)', (await m.obter('fleet/maintenances', semNada.id)) === null);
  } catch (e) {
    falhas++;
    console.log('  XX  ERRO:', e.message);
  } finally {
    console.log('\n--- limpando ---');
    for (const [rec, id] of lixo.reverse()) {
      try { await m.remover(rec, id); } catch (_) { /* já removido pelo cascade */ }
    }
    const sobra = async (t) => ((await supabase.from(t).select('id')).data || []).length;
    console.log(`  restaram: veículos ${await sobra('fleet_vehicles')}, contratos ${await sobra('contracts')}, manutenções ${await sobra('fleet_maintenances')}`);
    console.log(falhas === 0 ? '\n===== TODOS OS CHECKS PASSARAM =====\n' : `\n===== ${falhas} CHECK(S) FALHARAM =====\n`);
    process.exit(falhas === 0 ? 0 : 1);
  }
})();
