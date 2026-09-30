#!/usr/bin/env node
// A IMPRESSÃO DO PEDIDO, RENDERIZADA DE VERDADE.
//
// FORA DO `npm test` de propósito: precisa do servidor de pé e faz login. A
// guarda estática mora em scripts/test-impressao-pedido.js.
//
// COMO ELA RODA O CÓDIGO REAL. O template vive dentro de um closure de
// public/app.js com meia dúzia de dependências (`meta`, `items`, `formState`,
// `computeTotals`, `escapeHtml`...). Copiá-lo para cá criaria uma segunda
// versão, que passaria a mentir no dia em que a tela mudasse. Em vez disso o
// arquivo é lido, o trecho do `win.document.write` é RECORTADO dele e executado
// com as dependências de mentira. Se o template sair de lá ou mudar de forma, o
// recorte falha e a prova para — que é o certo.
//
// O QUE ELA CONFERE é o que o modelo de papel pede: cabeçalho com emitente e
// número, DADOS DO CLIENTE, as sete colunas de PRODUTOS E SERVIÇOS, a faixa de
// TOTAIS que FECHA, termos, assinatura e observações. E o caso que hoje é o
// real nesta base: sem estabelecimento cadastrado, o cabeçalho diz onde
// cadastrar em vez de sair vazio.
const fs = require('fs');
const path = require('path');
const http = require('http');

const RAIZ = path.join(__dirname, '..');
const PORTA = Number(process.env.PORTA_PROVA || 3101);
const SRC = fs.readFileSync(path.join(RAIZ, 'public/app.js'), 'utf8').replace(/\r\n/g, '\n');

// Do início do preâmbulo até o fim do `win.document.write(...)`.
const trecho = SRC.match(/const emitente = meta\.emitente \|\| null;[\s\S]*?<\/body><\/html>`\);/);
if (!trecho) {
  console.error('  XX  não achei o template da impressão em public/app.js');
  process.exit(1);
}

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};

const escapeHtml = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const salesFormatBRL = (v) => `R$ ${Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function renderizar({ meta, items, formState, totais, editRecord, cliente, empresa, vendedor, title }) {
  let html = '';
  const win = { document: { write: (t) => { html += t; }, close: () => {} }, focus: () => {}, print: () => {} };
  const rodar = new Function(
    'win', 'meta', 'items', 'formState', 'totais', 'editRecord', 'cliente', 'empresa', 'vendedor',
    'title', 'escapeHtml', 'salesFormatBRL', 'SalesStatus', 'location',
    trecho[0]
  );
  rodar(win, meta, items, formState, totais, editRecord, cliente, empresa, vendedor,
    title, escapeHtml, salesFormatBRL, { rotulo: (s) => String(s || '') }, { origin: 'http://127.0.0.1' });
  return html;
}

function req(method, caminho, body, token) {
  return new Promise((ok, bad) => {
    const d = body ? JSON.stringify(body) : null;
    const r = http.request({
      host: '127.0.0.1', port: PORTA, path: caminho, method,
      headers: Object.assign({ 'content-type': 'application/json' },
        d ? { 'content-length': Buffer.byteLength(d) } : {},
        token ? { 'x-auth-token': token } : {})
    }, (res) => { let s = ''; res.on('data', (c) => { s += c; }); res.on('end', () => ok({ status: res.statusCode, body: s })); });
    r.on('error', bad);
    if (d) r.write(d);
    r.end();
  });
}

const semTags = (h) => String(h).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

(async () => {
  console.log(`--- 1. a rota entrega o que o papel precisa (porta ${PORTA}) ---`);
  const login = await req('POST', '/api/login', { username: 'admin', password: 'admin123' });
  if (login.status !== 200) {
    console.error(`  XX  login respondeu ${login.status} — o servidor está de pé na porta ${PORTA}?`);
    process.exit(1);
  }
  const token = JSON.parse(login.body).token;
  const resposta = await req('GET', '/api/sales/meta', null, token);
  if (resposta.status !== 200) {
    console.error(`  XX  /api/sales/meta respondeu ${resposta.status}: ${resposta.body.slice(0, 200)}`);
    process.exit(1);
  }
  const meta = JSON.parse(resposta.body);
  check('a meta tem o campo `emitente`', 'emitente' in meta, meta.emitente ? 'preenchido' : 'null (sem estabelecimento)');
  check('e nenhum segredo da Focus viaja nele',
    !meta.emitente || (!('focusTokenConfigured' in meta.emitente) && !('focusAmbiente' in meta.emitente)));
  const umProduto = (meta.products || []).find((p) => p.ncm) || (meta.products || [])[0];
  check('os produtos trazem NCM e unidade comercial',
    !!umProduto && 'ncm' in umProduto && 'unidadeComercial' in umProduto,
    umProduto ? `${umProduto.ncm} / ${umProduto.unidadeComercial}` : 'sem produto');
  const umCliente = (meta.directory || [])[0];
  check('o diretório traz telefone (o modelo pede)', !!umCliente && 'phone' in umCliente,
    umCliente ? Object.keys(umCliente).join(', ') : 'vazio');

  // ---------------------------------------------------------------------------
  const produto = umProduto || { id: 'p1', ncm: '40132000', unidadeComercial: 'UN' };
  const items = [{ productId: produto.id, name: 'CAMARA DE AR CANELLO 14 X 2.50', sku: '203', quantity: 2, unitPrice: 100 }];
  const totais = {
    valorProdutos: 200, valorServicos: 0, base: 200, descontoTotal: 20, descontoValor: 20,
    percentualAplicado: 0, freteCobrado: 30, despesasGerais: 5, taxaMontagem: 7, totalAmount: 222
  };
  const cliente = {
    name: 'jaqueline damasceno', phone: '91983467510', document: '13747330916',
    address: 'Rua Major Júlio Ferreira', city: 'Jaraguá do Sul', state: 'SC', zipCode: '89256210'
  };
  const base = {
    meta, items, totais, cliente, empresa: { name: 'FILIAL 06' },
    vendedor: { name: 'BRYAN VINICIUS PIRES DOS ANJOS' },
    editRecord: { code: '15987' }, title: 'Pedido',
    formState: {
      date: '2026-09-28', dueDate: '2026-09-28', status: 'pedido-faturado',
      saleOrigin: 'Venda Direta', customerPoCode: '',
      paymentInfo: { paymentTerm: 'avista' },
      delivery: { shippingMethod: 'DO EMITENTE' },
      salesTerms: 'TERMO DE CIENCIA E RESPONSABILIDADE\nDeclaro estar ciente.',
      note: 'klosh go cinza : troca da camara'
    }
  };

  console.log('\n--- 2. as seções do modelo, na ordem ---');
  const html = renderizar(base);
  const ordem = ['DADOS DO CLIENTE', 'PRODUTOS E SERVIÇOS', 'TOTAIS', 'TERMOS E CONDIÇÕES DA VENDA', 'OBSERVAÇÕES'];
  const posicoes = ordem.map((t) => html.indexOf(t));
  check('as cinco seções existem', posicoes.every((p) => p >= 0),
    ordem.filter((t, i) => posicoes[i] < 0).join(', ') || 'todas');
  check('  e saem na ordem do modelo',
    posicoes.every((p, i) => i === 0 || p > posicoes[i - 1]), posicoes.join(' < '));
  check('o número do pedido está no cabeçalho', /PEDIDO Nº 15987/.test(html));
  check('  com emissão e validade', /Emissão 2026-09-28/.test(html) && /Validade 2026-09-28/.test(html));

  console.log('\n--- 3. as sete colunas de PRODUTOS E SERVIÇOS ---');
  for (const coluna of ['Código', 'NCM', 'Descrição', 'Qtd.', 'Unidade', 'Valor Unitário', 'Valor Total']) {
    check(`  ${coluna}`, html.includes(`<th>${coluna}</th>`));
  }
  check('o NCM do produto aparece na linha', html.includes(String(produto.ncm || '')), String(produto.ncm));
  check('a unidade comercial aparece na linha', html.includes(`>${produto.unidadeComercial}<`), produto.unidadeComercial);
  check('a quantidade sai com quatro casas, como no modelo', /2,0000/.test(html));

  console.log('\n--- 4. os TOTAIS fecham ---');
  // 200 − 20 + 30 + 5 + 7 = 222. O defeito que isto impede é o antigo: parcelas
  // impressas que não somam o total, porque uma delas não era mostrada.
  const soma = totais.base - totais.descontoTotal + totais.freteCobrado + totais.despesasGerais + totais.taxaMontagem;
  check('base − desconto + frete + outros = total final', soma === totais.totalAmount, `${soma} vs ${totais.totalAmount}`);
  check('"Outros" soma despesas gerais e taxa de montagem', html.includes('R$ 12,00'), 'R$ 12,00 (5 + 7)');
  check('o desconto sai com sinal negativo', /-R\$ 20,00/.test(html));
  check('o total final está no papel', html.includes('R$ 222,00'));
  check('não há coluna de Seguro que só saberia dizer zero', !/<th>Seguro<\/th>/.test(html));

  console.log('\n--- 5. o bloco do cliente ---');
  for (const r of ['Cliente:', 'Telefone:', 'Endereço:', 'CPF/CNPJ:', 'Condições:', 'Frete por Conta:', 'Vendedor:']) {
    check(`  ${r}`, html.includes(`<th>${r}</th>`));
  }
  check('o telefone do cliente sai impresso', html.includes('91983467510'));
  check('o endereço junta rua, cidade-UF e CEP',
    /Rua Major Júlio Ferreira, Jaraguá do Sul-SC - 89256210/.test(html));
  check('"À vista" vem do paymentTerm', /À vista/.test(html));
  check('  e "A prazo" também', /A prazo/.test(renderizar({ ...base, formState: { ...base.formState, paymentInfo: { paymentTerm: 'aprazo' } } })));
  check('frete por conta vem da entrega', html.includes('DO EMITENTE'));

  console.log('\n--- 6. termos, assinatura e observações só quando existem ---');
  check('com termos, há linha de assinatura', /Assinatura:/.test(html) && /CPF: <span>/.test(html));
  const semTermos = renderizar({ ...base, formState: { ...base.formState, salesTerms: '', note: '' } });
  check('sem termos, a seção não aparece', !/TERMOS E CONDIÇÕES/.test(semTermos));
  check('  nem a linha de assinatura', !/Assinatura:/.test(semTermos));
  check('sem observação, a seção não aparece', !/OBSERVAÇÕES/.test(semTermos));
  check('a observação sai quando existe', /klosh go cinza/.test(html));
  check('o papel continua dizendo que não tem valor fiscal',
    /Documento interno, sem valor fiscal/.test(html) && /Documento interno, sem valor fiscal/.test(semTermos));

  console.log('\n--- 7. sem estabelecimento cadastrado (o caso real desta base) ---');
  const semEmitente = renderizar({ ...base, meta: { ...meta, emitente: null } });
  check('o cabeçalho não sai vazio', /Cabeçalho sem dados da empresa/.test(semEmitente));
  check('  e diz onde cadastrar', /Configurações › Fiscal/.test(semEmitente));
  const comEmitente = renderizar({
    ...base,
    meta: {
      ...meta,
      emitente: {
        razaoSocial: 'SAL INFINITY ELECTRIC LTDA', cnpj: '46.877.837/0001-14', nomeFantasia: 'SAL INFINITY',
        email: 'contato@salinfinityplus.com.br', telefone: '4732043738',
        logradouro: 'Rua Bernardo Dornbusch', numero: '2054', complemento: '', bairro: 'Vila Lalau',
        municipio: 'Jaraguá do Sul', uf: 'SC', cep: '89256100', unidades: 1
      }
    }
  });
  check('com estabelecimento, o cabeçalho traz razão social e CNPJ',
    /SAL INFINITY ELECTRIC LTDA/.test(comEmitente) && /CNPJ: 46\.877\.837\/0001-14/.test(comEmitente));
  check('  o endereço completo', /Rua Bernardo Dornbusch, 2054, Vila Lalau, 89256100, Jaraguá do Sul-SC/.test(comEmitente));
  check('  e-mail e telefone', /contato@salinfinityplus\.com\.br \/ 4732043738/.test(comEmitente));
  check('  e o aviso de matriz NÃO aparece com uma unidade só', !/Dados da matriz/.test(comEmitente));
  const varias = renderizar({ ...base, meta: { ...meta, emitente: { razaoSocial: 'X', cnpj: '1', nomeFantasia: 'MATRIZ', unidades: 4 } } });
  check('  com várias, o papel diz que são os dados da matriz', /Dados da matriz/.test(varias) && /4 estabelecimentos/.test(varias));

  console.log('\n--- 8. o HTML fecha ---');
  const abre = (html.match(/<tr>/g) || []).length;
  const fecha = (html.match(/<\/tr>/g) || []).length;
  check('as linhas de tabela abrem e fecham na mesma conta', abre === fecha, `${abre} <tr> / ${fecha} </tr>`);
  const td = (html.match(/<t[dh][ >]/g) || []).length;
  const fimTd = (html.match(/<\/t[dh]>/g) || []).length;
  check('as células também', td === fimTd, `${td} abre / ${fimTd} fecha`);
  check('e o documento tem head e body', /<html>[\s\S]*<\/body><\/html>/.test(html));
  check('nada de "undefined" no papel', !/undefined/.test(semTags(html)),
    (semTags(html).match(/\S*undefined\S*/g) || []).slice(0, 3).join(', ') || 'limpo');

  console.log(`\n===== ${falhas === 0 ? 'O PEDIDO SAI NO MODELO' : falhas + ' FALHA(S)'} =====`);
  process.exit(falhas ? 1 : 0);
})();
