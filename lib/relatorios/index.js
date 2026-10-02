/**
 * O CATÁLOGO DE RELATÓRIOS: os grupos, na ordem do menu do Viper, e os
 * relatórios de cada um (um arquivo por grupo).
 *
 * `modulo` é o módulo que a pessoa precisa ter para ver o grupo: relatório não
 * pode mostrar o que a tela do módulo não mostraria. Administrador vê todos.
 *
 * O que o Viper tem e aqui não entra é o que este sistema não faz: PDV,
 * cheques, boletos, marketplace, consignado, NFS-e, CT-e, lote e validade,
 * tabela de preço, expedição e romaneio, ordem de serviço, mapa de produtos
 * controlados, seguro e lembrete de frota, e comissão e chassi (fora de escopo
 * por decisão do usuário). Relatório sem nada por trás seria tela vazia para
 * sempre.
 *
 * O Personalizado do Viper (o usuário monta o relatório) não mora aqui: o
 * relatório dele é dado gravado, não definição no código — ver
 * lib/relatorios/personalizado.js.
 */

const GRUPOS = [
  { key: 'financeiro', titulo: 'Financeiro', modulo: 'finance' },
  { key: 'vendas', titulo: 'Vendas', modulo: 'sales' },
  { key: 'compras', titulo: 'Compras', modulo: 'purchases' },
  { key: 'crm', titulo: 'CRM', modulo: 'cadastros' },
  { key: 'pcp', titulo: 'PCP', modulo: 'pcp' },
  { key: 'estoque', titulo: 'Estoque', modulo: 'stock' },
  { key: 'fiscal', titulo: 'Fiscal', modulo: 'fiscal' },
  { key: 'servicos', titulo: 'Serviços', modulo: 'cadastros' },
  { key: 'agendamentos', titulo: 'Agendamentos', modulo: 'cadastros' },
  { key: 'rh', titulo: 'RH', modulo: 'hr' },
  { key: 'contratos', titulo: 'Contratos', modulo: 'contracts' },
  { key: 'frota', titulo: 'Frota de Veículos', modulo: 'fleet' }
];

const { CAMPOS_RESERVADOS } = require('./motor');

const FILTROS_CONHECIDOS = new Set(['periodo', 'ano', 'data', 'dias', 'deposito', 'conta', 'vendedor', 'filial', 'estabelecimento']);
// 'codigo' é o número que IDENTIFICA (pedido, lançamento, OP): sai como foi
// gravado, sem ponto de milhar ("15507", e não "15.507") e sem total.
const TIPOS_CONHECIDOS = new Set(['texto', 'codigo', 'data', 'moeda', 'numero', 'quantidade', 'percentual', 'inteiro']);

const RELATORIOS = GRUPOS.flatMap((g) => require(`./${g.key}`));

// Defeito de definição tem de aparecer na subida do servidor, e não quando
// alguém clicar no relatório.
(function conferir() {
  const chaves = new Set();
  for (const r of RELATORIOS) {
    if (!r.key || chaves.has(r.key)) throw new Error(`Relatório sem chave ou repetido: ${r.key}`);
    chaves.add(r.key);
    if (!GRUPOS.some((g) => g.key === r.grupo)) throw new Error(`Relatório ${r.key} com grupo desconhecido: ${r.grupo}`);
    if (r.especial) continue;
    if (typeof r.executar !== 'function') throw new Error(`Relatório ${r.key} sem executar()`);
    for (const f of r.filtros || []) if (!FILTROS_CONHECIDOS.has(f)) throw new Error(`Relatório ${r.key}: filtro desconhecido ${f}`);
    for (const c of r.colunas || []) if (!TIPOS_CONHECIDOS.has(c.tipo)) throw new Error(`Relatório ${r.key}: coluna ${c.campo} com tipo ${c.tipo}`);
    for (const e of r.escolhas || []) {
      if (!e.campo || CAMPOS_RESERVADOS.has(e.campo)) throw new Error(`Relatório ${r.key}: escolha com campo inválido ${e.campo}`);
      if (!Array.isArray(e.itens) || !e.itens.length) throw new Error(`Relatório ${r.key}: escolha ${e.campo} sem itens`);
    }
  }
}());

function grupoDe(chave) {
  return GRUPOS.find((g) => g.key === chave) || null;
}

function relatorio(chave) {
  return RELATORIOS.find((r) => r.key === chave) || null;
}

/** O usuário pode ver o grupo? `ehAdministrador` vem de fora (RBAC no banco). */
function podeVerGrupo(usuario, grupo, ehAdministrador) {
  if (!usuario || !grupo) return false;
  return Boolean(ehAdministrador) || (usuario.allowedModules || []).includes(grupo.modulo);
}

/** O que a tela precisa para desenhar o menu de cada grupo — sem as funções. */
function catalogoVisivel(usuario, ehAdministrador) {
  return GRUPOS
    .filter((g) => podeVerGrupo(usuario, g, ehAdministrador))
    .map((g) => ({
      key: g.key,
      titulo: g.titulo,
      relatorios: RELATORIOS.filter((r) => r.grupo === g.key).map((r) => ({
        key: r.key,
        titulo: r.titulo,
        especial: r.especial || null,
        filtros: r.filtros || [],
        escolhas: (r.escolhas || []).map(({ campo, rotulo, itens }) => ({ campo, rotulo, itens })),
        periodoPadrao: r.periodoPadrao || null,
        diasPadrao: r.diasPadrao || null
      }))
    }));
}

module.exports = { GRUPOS, RELATORIOS, grupoDe, relatorio, podeVerGrupo, catalogoVisivel };
