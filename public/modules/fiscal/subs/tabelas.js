window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.fiscal = window.MavisSubscreenRegistry.fiscal || {};

// Consulta das tabelas fiscais oficiais (Fase Q no banco).
//
// Serve para quem está preenchendo uma nota e precisa achar o código certo:
// hoje isso é procurado fora do sistema, e digitar um dígito errado num
// documento fiscal não dá erro na tela — dá problema na apuração, meses depois.
//
// É consulta, não cadastro: os códigos são texto de legislação, então não há
// botão de criar nem de editar. Mudança neles vem de ato normativo, por
// migração, não por tela.
const GRUPOS = [
  { chave: 'cfop', titulo: 'CFOP', ajuda: 'Código Fiscal de Operações e Prestações. O primeiro dígito é o âmbito: 1/2/3 entrada, 5/6/7 saída.' },
  { chave: 'cstIcms', titulo: 'CST ICMS', ajuda: 'Situação tributária do ICMS no regime normal (Lucro Presumido e Lucro Real).' },
  { chave: 'csosn', titulo: 'CSOSN', ajuda: 'Substitui o CST de ICMS quando a empresa é do Simples Nacional.' },
  { chave: 'cstPisCofins', titulo: 'CST PIS/COFINS', ajuda: 'Situação tributária de PIS e COFINS, separada entre saída (débito) e entrada (crédito).' },
  { chave: 'cstIpi', titulo: 'CST IPI', ajuda: 'Situação tributária do IPI.' },
  { chave: 'origem', titulo: 'Origem', ajuda: 'Origem da mercadoria — é o primeiro dígito do CST/CSOSN na NF-e.' }
];

function semAcentoFiscal(texto) {
  return String(texto || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

window.MavisSubscreenRegistry.fiscal.tabelas = async function renderTabelasFiscais(ctx) {
  const { api, content, escapeHtml, state } = ctx;

  let tabelas = { disponivel: false };
  try {
    tabelas = await api('/api/fiscal/tabelas');
  } catch (error) {
    content.innerHTML = `<div class="panel"><h3>Tabelas Fiscais</h3><p class="muted">${escapeHtml(error.message || 'Não foi possível carregar as tabelas fiscais.')}</p></div>`;
    return;
  }

  // Sem a migração Fase Q as listas vêm vazias. Dizer isso é mais útil do que
  // mostrar seis abas em branco.
  if (!tabelas.disponivel) {
    content.innerHTML = `
      <div class="panel workspace-pendente">
        <h3>Tabelas Fiscais</h3>
        <p>As tabelas de referência ainda não existem no banco. Elas são criadas
        pela migração <code>supabase/migrations/fase-q-tabelas-fiscais.sql</code>.</p>
        <p class="muted">Enquanto isso, o CFOP na emissão de NF-e continua como texto livre.</p>
      </div>
    `;
    return;
  }

  const linhas = {
    cfop: (tabelas.cfop || []).map((r) => ({ codigo: r.codigo, descricao: r.descricao, extra: r.tipo === 'ENTRADA' ? 'Entrada' : 'Saída' })),
    cstIcms: (tabelas.cstIcms || []).map((r) => ({ codigo: r.codigo, descricao: r.descricao, extra: '' })),
    csosn: (tabelas.csosn || []).map((r) => ({ codigo: r.codigo, descricao: r.descricao, extra: '' })),
    cstPisCofins: (tabelas.cstPisCofins || []).map((r) => ({ codigo: r.codigo, descricao: r.descricao, extra: r.grupo === 'ENTRADA' ? 'Entrada' : 'Saída' })),
    cstIpi: (tabelas.cstIpi || []).map((r) => ({ codigo: r.codigo, descricao: r.descricao, extra: r.grupo === 'ENTRADA' ? 'Entrada' : 'Saída' })),
    // A API chama esta de origemMercadoria; aqui o grupo é 'origem'.
    origem: (tabelas.origemMercadoria || []).map((r) => ({ codigo: r.codigo, descricao: r.descricao, extra: '' }))
  };

  const grupoAtivo = state.fiscalTabelaAtiva && linhas[state.fiscalTabelaAtiva] ? state.fiscalTabelaAtiva : 'cfop';

  function desenhar() {
    const grupo = GRUPOS.find((g) => g.chave === grupoAtivo);
    const dados = linhas[grupoAtivo] || [];

    content.innerHTML = `
      <div class="workspace">
        <section class="panel workspace-head">
          <p class="muted">${dados.length} código${dados.length === 1 ? '' : 's'} — texto oficial da legislação, somente consulta.</p>
          <input type="search" class="workspace-filter" id="fiscalFiltro"
            placeholder="Filtrar por código ou descrição…" autocomplete="off"
            aria-label="Filtrar códigos fiscais" />
        </section>

        <div class="finance-granularity-group" role="tablist">
          ${GRUPOS.map((g) => `<button type="button" class="finance-pill ${g.chave === grupoAtivo ? 'active' : ''}" data-grupo="${g.chave}">${escapeHtml(g.titulo)} <small>(${(linhas[g.chave] || []).length})</small></button>`).join('')}
        </div>

        <section class="panel">
          <p class="muted">${escapeHtml(grupo.ajuda)}</p>
          <div class="table-scroll">
            <table class="table">
              <thead><tr><th style="width:110px;">Código</th><th>Descrição</th><th style="width:110px;">Aplicação</th></tr></thead>
              <tbody id="fiscalCorpo">
                ${dados.map((l) => `
                  <tr data-busca="${escapeHtml(semAcentoFiscal(`${l.codigo} ${l.descricao}`))}">
                    <td><strong>${escapeHtml(String(l.codigo).trim())}</strong></td>
                    <td>${escapeHtml(l.descricao)}</td>
                    <td class="muted">${escapeHtml(l.extra)}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
          <p class="muted" id="fiscalVazio" hidden>Nenhum código encontrado.</p>
        </section>
      </div>
    `;

    content.querySelectorAll('[data-grupo]').forEach((botao) => {
      botao.addEventListener('click', () => {
        state.fiscalTabelaAtiva = botao.dataset.grupo;
        renderTabelasFiscais(ctx);
      });
    });

    const filtro = content.querySelector('#fiscalFiltro');
    const vazio = content.querySelector('#fiscalVazio');
    filtro?.addEventListener('input', () => {
      const termo = semAcentoFiscal(filtro.value.trim());
      let visiveis = 0;
      content.querySelectorAll('#fiscalCorpo tr').forEach((linha) => {
        const casa = !termo || linha.dataset.busca.includes(termo);
        linha.hidden = !casa;
        if (casa) visiveis++;
      });
      vazio.hidden = visiveis > 0;
    });
  }

  desenhar();
};
