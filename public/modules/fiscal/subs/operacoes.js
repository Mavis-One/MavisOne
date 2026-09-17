window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.fiscal = window.MavisSubscreenRegistry.fiscal || {};

// Consulta do CATÁLOGO DE OPERAÇÕES FISCAIS (lib/operacaoFiscal.js).
//
// POR QUE ESTA TELA EXISTE
// ------------------------
// O catálogo decide três coisas que ninguém enxerga na hora de emitir:
//
//   finalidade         -> o finNFe que vai no XML (1 normal, 2 complementar,
//                         3 ajuste, 4 devolução). Errar isso é a SEFAZ recusar,
//                         ou pior: aceitar um documento que diz outra coisa.
//   movimenta estoque  -> uma NF-e Complementar de ICMS não entrega mercadoria.
//                         Tratá-la como venda baixaria produto que não saiu.
//   gera financeiro    -> transferência entre estabelecimentos próprios não é
//                         receita; bonificação sai do estoque e não vira
//                         recebível.
//
// Até aqui, a única forma de saber o que cada operação faz era abrir o fonte.
// Quem confere um pedido recusado, ou pergunta "por que esta nota não gerou
// conta a receber?", não tem por que ler JavaScript para responder.
//
// É CONSULTA, E NÃO CADASTRO — e isto não é falta de tempo. Cada linha do
// catálogo é um contrato que o código de emissão OBEDECE: `deveMovimentarEstoque`
// e `deveGerarFinanceiro` leem essas bandeiras para decidir se baixam estoque e
// se criam recebível. Uma operação criada por tela seria comportamento fiscal
// definido em tempo de execução, sem ninguém para conferir se a combinação faz
// sentido — "não movimenta estoque" com "exige produto escritural", por
// exemplo. Operação nova entra por código, com o porquê escrito ao lado dela,
// e aparece aqui sozinha (a rota varre o catálogo).
const FINALIDADES = {
  1: { rotulo: 'Normal', ajuda: 'finNFe 1 — documenta uma operação nova.' },
  2: { rotulo: 'Complementar', ajuda: 'finNFe 2 — acrescenta valor a um documento que já existe.' },
  3: { rotulo: 'Ajuste', ajuda: 'finNFe 3 — NF-e de ajuste.' },
  4: { rotulo: 'Devolução', ajuda: 'finNFe 4 — devolve mercadoria de uma nota anterior.' }
};

// As colunas de bandeira, na ordem em que a pergunta aparece na vida real:
// primeiro o que a operação FAZ no sistema, depois o que ela EXIGE de quem
// emite.
const BANDEIRAS = [
  { chave: 'movimentaEstoque', titulo: 'Move estoque', ajuda: 'Baixa (ou devolve) quantidade no depósito.' },
  { chave: 'geraFinanceiro', titulo: 'Gera financeiro', ajuda: 'Cria conta a receber quando a nota é autorizada.' },
  { chave: 'exigeReferencia', titulo: 'Exige nota referenciada', ajuda: 'Sem a chave da nota original a SEFAZ recusa.' },
  { chave: 'exigeIcms', titulo: 'Exige ICMS', ajuda: 'A nota não faz sentido sem valor de ICMS destacado.' },
  { chave: 'permiteQuantidadeZero', titulo: 'Aceita qtd. zero', ajuda: 'O item pode ir sem quantidade — é o caso do complemento.' },
  { chave: 'permiteValorZero', titulo: 'Aceita valor zero', ajuda: 'O item pode ir sem valor unitário.' },
  { chave: 'exigeProdutoEscritural', titulo: 'Exige produto escritural', ajuda: 'Só aceita produto marcado como escritural no Cadastro.' }
];

window.MavisSubscreenRegistry.fiscal.operacoes = async function renderOperacoesFiscais(ctx) {
  const { api, content, escapeHtml } = ctx;

  let operacoes = [];
  try {
    const res = await api('/api/fiscal/operacoes');
    operacoes = res.operacoes || [];
  } catch (error) {
    content.innerHTML = `<div class="panel"><h3>Operações Fiscais</h3><p class="muted">${escapeHtml(error.message || 'Não foi possível carregar as operações fiscais.')}</p></div>`;
    return;
  }

  // Catálogo vazio não acontece hoje (ele é constante no código), mas uma tela
  // que mostra cabeçalho e nenhuma linha faz a pessoa procurar o erro no lugar
  // errado — no cadastro dela, em vez de no sistema.
  if (!operacoes.length) {
    content.innerHTML = `
      <div class="panel workspace-pendente">
        <h3>Operações Fiscais</h3>
        <p>O servidor não devolveu nenhuma operação. O catálogo vive em
        <code>lib/operacaoFiscal.js</code> — se esta tela está vazia, é ali que falta.</p>
      </div>
    `;
    return;
  }

  const sim = '<span class="op-sim" title="Sim">Sim</span>';
  const nao = '<span class="op-nao" title="Não">—</span>';

  const linhas = operacoes.map((op) => {
    const fin = FINALIDADES[op.finalidade] || { rotulo: `finNFe ${op.finalidade}`, ajuda: '' };
    return `
      <tr>
        <td>
          <strong>${escapeHtml(op.rotulo)}</strong>
          <small class="muted">${escapeHtml(op.chave)}</small>
        </td>
        <td title="${escapeHtml(fin.ajuda)}">${escapeHtml(fin.rotulo)}</td>
        ${BANDEIRAS.map((b) => `<td class="op-bandeira">${op[b.chave] ? sim : nao}</td>`).join('')}
      </tr>
    `;
  }).join('');

  content.innerHTML = `
    <div class="panel">
      <div class="cadastro-page-head">
        <div>
          <h3>Operações Fiscais</h3>
          <p class="muted">O que cada tipo de operação faz quando uma nota é emitida por ela.
          É <strong>consulta</strong>: essas bandeiras são obedecidas pelo código de emissão, então
          operação nova entra por código — ver <code>lib/operacaoFiscal.js</code>.</p>
        </div>
      </div>
      <div class="table-scroll">
        <table class="table">
          <thead>
            <tr>
              <th>Operação</th>
              <th>Finalidade</th>
              ${BANDEIRAS.map((b) => `<th class="op-bandeira" title="${escapeHtml(b.ajuda)}">${escapeHtml(b.titulo)}</th>`).join('')}
            </tr>
          </thead>
          <tbody>${linhas}</tbody>
        </table>
      </div>
      <p class="muted">
        <strong>Como ler:</strong> "Move estoque" e "Gera financeiro" são o que a operação faz sozinha,
        e valem <em>mesmo que o produto diga o contrário</em> — é o que impede um complemento de ICMS
        de baixar mercadoria que não saiu. As colunas de "Exige" são o que a emissão cobra de quem
        preenche: faltando, a nota é barrada aqui, antes de consumir numeração na SEFAZ.
      </p>
    </div>
  `;
};
