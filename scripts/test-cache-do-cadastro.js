// AS TRÊS LISTAS DO CADASTRO FICAM EM MEMÓRIA — e o que faz isso ser seguro.
//
// O PROBLEMA, MEDIDO
// ------------------
// `syncCadastroData` lê people + cnpjs + deposits, e é chamada por quase toda
// rota do sistema. O peso está em `people.extra`, um jsonb de ~887 bytes por
// pessoa — 5,6 MB nas 6.492 desta base, 25 chaves cada.
//
//     select * de people (6.492 linhas) ..... 93,7 ms
//
// Pagos de novo a cada requisição, para dado que muda quando alguém cadastra um
// cliente. Guardando as linhas e remapeando: 1,9 ms — 48x.
//
// O QUE NÃO FOI FEITO, E POR QUÊ
// ------------------------------
// A tentativa óbvia é cortar `extra` do select para quem só precisa do nome.
// Sem ela: 30 ms. Medido, e descartado.
//
// `mapPersonRow` faz `...(row.extra || {})`: as 25 chaves ficam no PRIMEIRO
// NÍVEL do objeto, indistinguíveis de coluna real. Cortar `extra` transforma
// cada uma em `undefined` — sem erro e sem aviso. E não dá para saber quem as
// lê: varri lib/, public/ e server.js e 36 chaves têm leitor espalhado por 20
// arquivos, com nomes genéricos (`notes`, `roles`, `paymentMethod`, `country`)
// que aparecem em adquirentes, categorias de venda, equipamentos, origens,
// permissões de usuário e lançamentos financeiros. Nenhuma análise estática
// separa. E `test-sync-obrigatorio.js` não protegeria: ele vigia COLEÇÃO lida
// sem sync, não coluna ausente do recorte.
//
// O cache não tem esse risco: o dado é o mesmo, completo. Só não é buscado de
// novo.
//
// O QUE FOI PROVADO À PARTE, contra o banco real (17 checks):
//
//     1ª leitura 293 ms · 2ª 2 ms · 3ª 2 ms ............ 147x
//     JSON byte a byte igual ao do banco ............... 6.492 pessoas
//     as chaves do extra continuam lá ................. 54 campos, ibgeCityCode
//     mutação numa chamada NÃO vaza para a seguinte
//     cadastrar aparece na hora ....................... 6.492 -> 6.493
//     editar e excluir também
//     4 leituras simultâneas com cache frio ........... 103 ms (uma: 293 ms)
//
// E o efeito nas rotas, mediana de seis:
//
//     Financeiro: lançamentos ..... 106 ms -> 16 ms
//     Compras: painel .............. 139 ms -> 15 ms
//     Vendas: pedidos .............. 154 ms -> 53 ms
//     Estoque: produtos ............ 333 ms -> 149 ms
//     Painel ....................... 296 ms -> 215 ms
//
// SEM BANCO: este teste lê fonte. É o comportamento que foi medido à parte.
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const ler = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');
const { semComentarios } = require('./sem-comentarios');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};

const cadastros = semComentarios(ler('lib/db/cadastros.js'));

console.log('--- o cache existe, com TTL configurável ---');
check('o TTL sai de variável de ambiente',
  /const CADASTRO_CACHE_MS = Number\(process\.env\.DATABASE_CADASTRO_CACHE_MS \|\| 30000\);/.test(cadastros));
check('  e está documentado no .env.example',
  /DATABASE_CADASTRO_CACHE_MS=30000/.test(ler('.env.example')));
// Zero desliga, e a nota do .env.example diz isso. Eu tinha escrito o
// contrário, e a medição me corrigiu: com 0, as leituras voltam a 94-101 ms.
check('  e a nota diz que zero DESLIGA', /Zero DESLIGA o cache/.test(ler('.env.example')));
check('as três leituras passam pelo cache',
  /async function getPeople\(\) \{\s*\n\s*return lerComCache\('people', mapPersonRow\);/.test(cadastros)
  && /async function getCnpjs\(\) \{\s*\n\s*return lerComCache\('cnpjs', mapCnpjRow\);/.test(cadastros)
  && /async function getDeposits\(\) \{\s*\n\s*return lerComCache\('deposits', mapDepositRow\);/.test(cadastros));

console.log('\n--- REMAPEIA, e não devolve o array guardado ---');
// Devolvendo o mesmo array, um `pessoa.nome = x` em qualquer rota entraria no
// cache e apareceria para todas as outras — o tipo de defeito que não se acha
// procurando. Remapear custa 1,9 ms e dá objetos novos a cada chamada.
check('o cache guarda LINHA CRUA e mapeia na saída',
  /return \(await guardado\.linhas\)\.map\(mapear\);/.test(cadastros)
  && /return \(await promessa\)\.map\(mapear\);/.test(cadastros));
check('  e não guarda o resultado já mapeado',
  !/cacheDoCadastro\.set\(tabela, \{ em: Date\.now\(\), dados:/.test(cadastros),
  'objeto compartilhado entre rotas seria mutável por qualquer uma');

console.log('\n--- uma rajada com cache frio = UMA ida ao banco ---');
// A promessa entra no cache ANTES de resolver. Sem isso, a rajada que abre uma
// tela (várias rotas ao mesmo tempo) dispararia vários `select *` de 93 ms.
const posSet = cadastros.indexOf('cacheDoCadastro.set(tabela');
const posAwait = cadastros.indexOf('return (await promessa)');
check('a promessa é guardada antes de ser esperada',
  posSet > -1 && posAwait > posSet, `guarda ${posSet}, espera ${posAwait}`);
check('  e falha NÃO fica guardada',
  /cacheDoCadastro\.delete\(tabela\);\s*\n\s*throw erro;/.test(cadastros),
  'senão o erro se repetiria por 30 segundos');

console.log('\n--- TODA escrita invalida (é isto que faz o cache ser correto) ---');
// Cadastrou um cliente e ele não aparece na lista: é o defeito que este cache
// pode causar, e a única defesa é nenhuma escrita escapar.
//
// "Invalidar" tem dois jeitos desde a rodada de desempenho (out/2026):
//   - pessoa e CNPJ TROCAM A LINHA no que foi guardado, relida do banco
//     (atualizarNoCache). Esquecer a tabela inteira por causa de uma linha
//     fazia a próxima leitura de qualquer rota refazer o `select *` das 6.492
//     pessoas (111 ms frio, 365 ms medidos sob carga);
//   - depósito continua ESQUECENDO (dez linhas, reler não custa nada).
// Este check exigia `esquecerCadastro` nas nove; passou a exigir uma das duas,
// com a TABELA CERTA — a pessoa que atualiza o cache dos CNPJs é o mesmo
// defeito de não atualizar nada. O comportamento da troca é conferido por
// execução na seção mais abaixo.
const ESCRITAS = {
  createPerson: 'people', updatePerson: 'people', deletePerson: 'people',
  createCnpj: 'cnpjs', updateCnpj: 'cnpjs', deleteCnpj: 'cnpjs',
  createDeposit: 'deposits', updateDeposit: 'deposits', deleteDeposit: 'deposits'
};
for (const [fn, tabela] of Object.entries(ESCRITAS)) {
  const ini = cadastros.indexOf(`async function ${fn}(`);
  const corpo = ini > -1 ? cadastros.slice(ini, cadastros.indexOf('\n}', ini)) : '';
  const troca = new RegExp(`atualizarNoCache\\('${tabela}', id\\)`).test(corpo);
  const esquece = new RegExp(`esquecerCadastro\\('${tabela}'\\)`).test(corpo);
  check(`  ${fn.padEnd(14)} ${tabela === 'deposits' ? 'esquece' : 'troca a linha no'} cache de ${tabela}`,
    tabela === 'deposits' ? esquece : troca);
}
const invalidacoes = (cadastros.match(/esquecerCadastro\('(people|cnpjs|deposits)'\)|atualizarNoCache\('(people|cnpjs)', id\)/g) || []).length;
check('são nove invalidações, uma por escrita', invalidacoes === 9, `${invalidacoes}`);
check('a troca relê a linha do banco, e não confia no que a escrita mandou',
  /async \(atuais\) => \{\s*\n\s*const \{ data, error \} = await banco\.from\(tabela\)\.select\('\*'\)\.eq\('id', id\)\.maybeSingle\(\);/.test(cadastros));
// Sem desempate, a ordem entre pessoas do mesmo instante (1.538 nesta base,
// importação em lote) é a física, e muda quando QUALQUER linha é regravada: o
// cache, que deixa a editada onde estava, divergia de uma leitura nova em 62
// posições (prova do revisor). Com o id, a ordem é total e a troca é exata.
check('a tabela inteira é lida em ordem total: created_at desc e, no empate, o id',
  /\.order\('created_at', \{ ascending: false \}\)\s*\n\s*\.order\('id', \{ ascending: true \}\)/.test(cadastros));
check('  e é a MESMA leitura no cache, no empate da linha nova e no socorro da troca',
  (cadastros.match(/lerTabelaInteira\(tabela, '(lerComCache|atualizarNoCache)'\)/g) || []).length === 3
  && !/banco\.from\(tabela\)\.select\('\*'\)\.order\(/.test(cadastros));
check('e o esquecimento é exportado', /esquecerCadastro\s*\n?\s*\};/.test(cadastros)
  || /  esquecerCadastro/.test(cadastros), 'quem escreve por fora precisa poder avisar');

console.log('\n--- e NINGUÉM escreve nessas tabelas por fora ---');
// ESTE é o guarda que importa para o futuro. Uma rota nova que insira ou altere
// essas tabelas pela camada de consulta, sem passar pelas funções deste arquivo,
// deixa o cache velho por até 30s — e o sintoma é "cadastrei e não apareceu":
// intermitente, sem erro, impossível de reproduzir sob demanda.
//
// SEM ESCREVER A CADEIA DE EXEMPLO AQUI, de propósito. scripts/test-sql-compat.js
// varre `scripts/` procurando métodos encadeados num `from(...)` e lê o fonte CRU,
// cometários inclusive — uma cadeia escrita em prosa abre uma janela que varre
// até o próximo `;` e colhe os métodos do código abaixo. Foi o que aconteceu: ele
// acusou um operador `filter` inexistente, que era o `Array.filter` de três
// linhas adiante. O padrão está na constante ESCREVE, que é código de verdade.
//
// Scripts ficam de fora de propósito: rodam em OUTRO processo, com pool e cache
// próprios, e não têm como sujar o cache do servidor.
const FONTES = ['server.js'].concat(
  fs.readdirSync(path.join(RAIZ, 'lib')).filter((f) => f.endsWith('.js')).map((f) => `lib/${f}`),
  fs.readdirSync(path.join(RAIZ, 'lib/db')).filter((f) => f.endsWith('.js')).map((f) => `lib/db/${f}`)
).filter((f) => f !== 'lib/db/cadastros.js');

const ESCREVE = /from\('(people|cnpjs|deposits)'\)\s*\.\s*(insert|update|delete|upsert)|\b(insert into|update|delete from)\s+(people|cnpjs|deposits)\b/i;
const forasteiros = FONTES.filter((f) => ESCREVE.test(ler(f)));
check('nenhum fonte de lib/ ou server.js escreve direto', forasteiros.length === 0,
  forasteiros.length ? forasteiros.join(', ') : `${FONTES.length} conferidos`);

console.log('\n--- e o custo em memória está anotado onde a decisão mora ---');
// O cache só é seguro porque o processo é UM. ecosystem.config.js já explicava
// por que fork/1 (o contador de tentativas de login); agora explica dois.
const eco = ler('ecosystem.config.js');
check('ecosystem.config.js fixa uma instância', /instances: 1,/.test(eco) && /exec_mode: 'fork'/.test(eco));
check('  e diz que o cache do cadastro depende disso',
  /cache do cadastro/.test(eco),
  'em cluster, a escrita de um trabalhador não avisaria os outros');

// ---------------------------------------------------------------------------
// A TROCA DA LINHA, POR EXECUÇÃO (rodada de desempenho, out/2026).
//
// lib/db/cadastros.js roda de verdade contra um banco de mentira em memória,
// que conta quantas vezes a tabela inteira foi lida. Sem banco no ar.
// ---------------------------------------------------------------------------
async function porExecucao() {
  console.log('\n--- a escrita troca a linha no cache, sem reler a tabela ---');
  const tabelas = { people: [], cnpjs: [], deposits: [] };
  const leiturasInteiras = { people: 0, cnpjs: 0, deposits: 0 };
  let falharProximaReleitura = false;
  // Construtor que imita o encadeamento da camada de consulta só no que
  // cadastros.js usa.
  const construtor = (tabela) => {
    const estado = { op: 'select', filtroId: null, valores: null, unico: false, ordens: [] };
    const c = {
      select() { return c; },
      order(coluna, opcoes = {}) { estado.ordens.push({ coluna, asc: opcoes.ascending !== false }); return c; },
      eq(coluna, valor) { estado.filtroId = valor; return c; },
      maybeSingle() { estado.unico = true; return c; },
      insert(linha) { estado.op = 'insert'; estado.valores = linha; return c; },
      update(valores) { estado.op = 'update'; estado.valores = valores; return c; },
      delete() { estado.op = 'delete'; return c; },
      then(ok, falha) {
        return new Promise((resolve) => setImmediate(resolve)).then(() => {
          const linhas = tabelas[tabela];
          if (estado.op === 'insert') {
            linhas.push({ created_at: new Date().toISOString(), ...estado.valores });
            return { data: null, error: null };
          }
          if (estado.op === 'update') {
            const l = linhas.find((x) => x.id === estado.filtroId);
            if (l) {
              Object.assign(l, estado.valores);
              // Como o Postgres: a linha regravada vai para o fim do heap, e a
              // ordem FÍSICA entre empates muda.
              tabelas[tabela] = linhas.filter((x) => x !== l).concat([l]);
            }
            return { data: null, error: null };
          }
          if (estado.op === 'delete') {
            tabelas[tabela] = linhas.filter((x) => x.id !== estado.filtroId);
            return { data: null, error: null };
          }
          if (estado.unico) {
            if (falharProximaReleitura) { falharProximaReleitura = false; return { data: null, error: { message: 'falha simulada' } }; }
            const l = linhas.find((x) => x.id === estado.filtroId);
            return { data: l ? JSON.parse(JSON.stringify(l)) : null, error: null };
          }
          if (tabelas.__falhar && tabelas.__falhar()) return { data: null, error: { message: 'tabela inteira falhou (simulado)' } };
          leiturasInteiras[tabela] += 1;
          // Ordena só pelo que foi pedido; o resto fica na ordem física (sort
          // estável), que é o que o banco faz com o que sobra de empate.
          const ordenadas = JSON.parse(JSON.stringify(linhas)).sort((a, b) => {
            for (const o of estado.ordens) {
              const va = String(a[o.coluna]);
              const vb = String(b[o.coluna]);
              if (va !== vb) return (va < vb ? -1 : 1) * (o.asc ? 1 : -1);
            }
            return 0;
          });
          return { data: ordenadas, error: null };
        }).then(ok, falha);
      }
    };
    return c;
  };
  const falso = {
    from: (tabela) => construtor(tabela),
    rpc: async () => ({ data: 'X', error: null })
  };
  const clienteAbs = require.resolve('../lib/db/client');
  require.cache[clienteAbs] = {
    id: clienteAbs, filename: clienteAbs, loaded: true, children: [], paths: [],
    exports: { banco: falso, createId: (p) => `${p}-${Math.random().toString(16).slice(2)}`, assertNoError: (e, ctx) => { if (e) throw new Error(`${ctx}: ${e.message}`); } }
  };
  const cadAbs = require.resolve('../lib/db/cadastros');
  delete require.cache[cadAbs];
  const cad = require(cadAbs);

  const pessoa = (id, code, criada, nome) => ({
    id, code, type: 'pessoa-fisica', name: nome, trade_name: '', document: '', email: '', phone: '', status: 'ativo',
    city: '', state: '', zip_code: '', extra: { roles: ['Cliente'] }, created_at: criada
  });
  tabelas.people = [
    pessoa('p1', '1', '2026-01-01T10:00:00.000Z', 'Ana'),
    pessoa('p2', '2', '2026-01-02T10:00:00.000Z', 'Bia'),
    pessoa('p3', '3', '2026-01-02T10:00:00.000Z', 'Caio'),
    pessoa('p4', '4', '2026-01-03T10:00:00.000Z', 'Duda')
  ];
  const ids = (lista) => lista.map((p) => p.id).join(',');

  const l1 = await cad.getPeople();
  check('1ª leitura vai ao banco', leiturasInteiras.people === 1, ids(l1));
  await cad.getPeople();
  check('2ª leitura vem do cache', leiturasInteiras.people === 1);

  const nova = await cad.createPerson({ id: 'p5', code: '5', name: 'Eva', type: 'pessoa-fisica', document: '1' });
  const l2 = await cad.getPeople();
  check('cadastrar: a lista seguinte já tem a pessoa nova', l2.some((p) => p.id === 'p5' && p.name === 'Eva'), ids(l2));
  check('  sem reler a tabela inteira', leiturasInteiras.people === 1, String(leiturasInteiras.people));
  check('  na posição de created_at desc (a mais nova primeiro)', l2[0].id === 'p5', ids(l2));
  check('  e o que a escrita devolve é a pessoa gravada', nova && nova.id === 'p5' && nova.name === 'Eva');
  check('  as chaves do extra continuam no primeiro nível, como a leitura faz',
    Array.isArray(l2.find((p) => p.id === 'p4').roles));
  check('  a lista anterior não mudou (o guardado nunca é mutado)', l1.length === 4 && !l1.some((p) => p.id === 'p5'));

  await cad.updatePerson('p3', { name: 'Caio Editado' });
  const l3 = await cad.getPeople();
  check('editar: troca no mesmo lugar', ids(l3) === ids(l2) && l3.find((p) => p.id === 'p3').name === 'Caio Editado', ids(l3));
  check('  sem reler a tabela inteira', leiturasInteiras.people === 1);

  await cad.deletePerson('p2');
  const l4 = await cad.getPeople();
  check('excluir: sai da lista', !l4.some((p) => p.id === 'p2') && l4.length === l3.length - 1, ids(l4));
  check('  sem reler a tabela inteira', leiturasInteiras.people === 1);

  // Duas edições simultâneas na mesma pessoa: a troca relê o banco DEPOIS da
  // anterior, então o que fica é a última gravação — nunca uma versão anterior
  // por cima da mais nova.
  await Promise.all([
    cad.updatePerson('p1', { name: 'Ana v1' }),
    cad.updatePerson('p1', { name: 'Ana v2' })
  ]);
  const noBanco = tabelas.people.find((p) => p.id === 'p1').name;
  const l5 = await cad.getPeople();
  check('duas edições ao mesmo tempo: o cache fica com o que o banco tem', l5.find((p) => p.id === 'p1').name === noBanco, `${noBanco}`);

  // EMPATE DE created_at. O que o cache guarda tem de ser, na ORDEM inclusive,
  // o que uma leitura nova traria agora. "Leitura nova" = a MESMA consulta do
  // arquivo com o cache frio (esquece e lê; a contagem é desfeita porque não
  // é a troca que leu). Comparar com uma ordem escrita aqui provaria pouco: a
  // regressão é justamente a consulta perder o desempate.
  const leituraNova = async () => {
    cad.esquecerCadastro('people');
    const lidas = await cad.getPeople();
    leiturasInteiras.people -= 1;
    return lidas.map((p) => [p.id, p.name]);
  };
  const mesmaOrdem = async (rotulo) => {
    const guardada = (await cad.getPeople()).map((p) => [p.id, p.name]);
    const nova = await leituraNova();
    check(rotulo, JSON.stringify(guardada) === JSON.stringify(nova),
      guardada.map((p) => p[0]).join(',') + ' / banco ' + nova.map((p) => p[0]).join(','));
  };

  // Editar quem empata: o banco regrava a linha no fim do heap (o falso faz o
  // mesmo). Sem o desempate pelo id, a leitura nova a punha depois da parceira
  // de instante e o cache a deixava antes -- o defeito apontado na revisão.
  tabelas.people.push(pessoa('p7', '7', '2026-01-02T10:00:00.000Z', 'Gil'));
  // p7 entrou "por fora": a leitura seguinte, fria, já a traz no lugar.
  cad.esquecerCadastro('people');
  await cad.getPeople();
  const antesEmpate = leiturasInteiras.people;
  await cad.updatePerson('p3', { name: 'Caio de novo' });
  await mesmaOrdem('editar quem empata no instante: a ordem guardada é a de uma leitura nova');
  check('  sem reler a tabela inteira', leiturasInteiras.people === antesEmpate, String(leiturasInteiras.people - antesEmpate));

  // Linha NOVA que empata: a posição dependeria da collation do id no banco,
  // então a troca relê a tabela inteira (uma vez) em vez de adivinhar.
  tabelas.people.push(pessoa('p6', '6', '2026-01-02T10:00:00.000Z', 'Fábio'));
  // (inserida "por fora" só para o teste; agora a escrita de verdade relê p6)
  await cad.updatePerson('p6', { name: 'Fábio' });
  await mesmaOrdem('linha nova que empata no instante: entra onde uma leitura nova a poria');
  check('  relendo a tabela inteira uma vez', leiturasInteiras.people === antesEmpate + 1, String(leiturasInteiras.people - antesEmpate));
  const l6 = await cad.getPeople();
  check('  depois das mais novas e antes das mais antigas',
    ids(l6).indexOf('p6') > ids(l6).indexOf('p4') && ids(l6).indexOf('p6') < ids(l6).indexOf('p1'), ids(l6));

  // Bate com o que o banco devolveria, linha por linha.
  const doBanco = tabelas.people.slice().sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  const iguais = JSON.stringify(l6.map((p) => [p.id, p.name, p.createdAt]).sort())
    === JSON.stringify(doBanco.map((p) => [p.id, p.name, p.created_at]).sort());
  check('o conteúdo guardado é o do banco, linha por linha', iguais);

  // Falhou a releitura da linha: quem espera a lista não recebe o erro de
  // uma troca — recebe a tabela relida inteira, que é o que o esquecimento de
  // antes faria. Pela exclusão, que só relê dentro da troca (a edição relê a
  // pessoa por conta própria também, e a falha simulada cairia nessa outra).
  falharProximaReleitura = true;
  const antes = leiturasInteiras.people;
  await cad.deletePerson('p4');
  const l8 = await cad.getPeople();
  check('releitura da linha que falha: a lista vem da tabela relida, sem erro',
    leiturasInteiras.people === antes + 1 && !l8.some((p) => p.id === 'p4') && l8.length === tabelas.people.length,
    `${leiturasInteiras.people - antes} leitura(s) inteira(s)`);

  // E se até a tabela inteira falhar, nada de errado fica guardado: a
  // leitura seguinte tenta o banco de novo.
  let falharTudo = 1;
  tabelas.__falhar = () => (falharTudo-- > 0);
  falharProximaReleitura = true;
  await cad.deletePerson('p5');
  const erro = await cad.getPeople().then(() => null, (e) => e);
  check('releitura e tabela falhando: o erro chega a quem pediu', Boolean(erro), erro ? erro.message : 'sem erro');
  delete tabelas.__falhar;
  const antes2 = leiturasInteiras.people;
  const l9 = await cad.getPeople();
  check('  e não fica guardado: a seguinte vai ao banco e traz o certo',
    leiturasInteiras.people === antes2 + 1 && !l9.some((p) => p.id === 'p5'), `${leiturasInteiras.people - antes2}`);

  // Sem nada guardado, a escrita não inventa entrada: a leitura vai ao banco.
  cad.esquecerCadastro('cnpjs');
  await cad.createCnpj({ id: 'c1', code: '9', name: 'Empresa', document: '1' });
  const c1 = await cad.getCnpjs();
  check('sem cache guardado, a escrita não cria um: a leitura vai ao banco', leiturasInteiras.cnpjs === 1 && c1.length === 1);
}

porExecucao().then(() => {
  console.log(falhas === 0 ? '\n===== TODOS OS CHECKS PASSARAM =====' : `\n===== ${falhas} FALHA(S) =====`);
  process.exit(falhas === 0 ? 0 : 1);
}).catch((erro) => {
  console.error('O teste quebrou:', erro);
  process.exit(1);
});
