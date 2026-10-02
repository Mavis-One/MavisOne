/**
 * ANÁLISE FISCAL DO CADASTRO DE PRODUTOS (fase DO).
 *
 * Cruza cada produto com as tabelas oficiais (NCM do Siscomex, CEST do
 * Convênio ICMS 142/2018) e com a classificação dele em ST. Devolve alertas
 * por gravidade, cada um com a lista dos produtos.
 *
 * ALTA é o que faz a nota ser recusada ou sair errada: sem NCM, NCM que não
 * existe ou que deixou de valer, CEST que não existe, CEST que não cobre o NCM,
 * produto em ST sem CEST.
 * MÉDIA é o que quase sempre é engano: CEST num produto que não está em ST, e
 * NCM de animal, vegetal ou alimento (capítulos 01 a 24) num cadastro de
 * bicicletas e veículos elétricos — a varredura do sistema anterior achou uma
 * capa de painel com NCM de cavalo vivo, e NCM de alimento é o que dá IBS/CBS
 * reduzido ou zero.
 *
 * Puro: recebe tudo pronto e não conhece banco.
 */

const { cestCobreNcm } = require('./tabelas-fiscais');

const so = (v) => String(v ?? '').replace(/\D/g, '');
const fmtNcm = (n) => (n.length === 8 ? `${n.slice(0, 4)}.${n.slice(4, 6)}.${n.slice(6)}` : n);
const fmtCest = (c) => (c.length === 7 ? `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5)}` : c);

const ALERTAS = {
  NCM_AUSENTE: { gravidade: 'alta', titulo: 'Produto sem NCM' },
  NCM_INEXISTENTE: { gravidade: 'alta', titulo: 'NCM que não existe na tabela vigente' },
  NCM_ENCERRADO: { gravidade: 'alta', titulo: 'NCM que deixou de valer' },
  CEST_INEXISTENTE: { gravidade: 'alta', titulo: 'CEST que não existe no Convênio 142/2018' },
  CEST_NCM_INCOMPATIVEL: { gravidade: 'alta', titulo: 'CEST incompatível com o NCM' },
  ST_SEM_CEST: { gravidade: 'alta', titulo: 'Produto em substituição tributária sem CEST' },
  CEST_SEM_ST: { gravidade: 'media', titulo: 'CEST informado em produto fora da substituição tributária' },
  NCM_ALIMENTO: { gravidade: 'media', titulo: 'NCM de animal, vegetal ou alimento (capítulos 01 a 24)' }
};
const ORDEM = { alta: 0, media: 1, info: 2 };

/**
 *   analisarCadastro({
 *     produtos: [{ id, sku, nome, ncm, cest, emSt, escritural }],
 *     ncm:  Map(codigo -> { descricaoCompleta, dataFim }),
 *     cest: Map(cest   -> { segmentoNome, descricao, ncmPrefixos }),
 *     hoje: 'aaaa-mm-dd'
 *   })
 */
function analisarCadastro({ produtos = [], ncm = new Map(), cest = new Map(), hoje }) {
  const dia = hoje || new Date().toISOString().slice(0, 10);
  const achados = new Map(Object.keys(ALERTAS).map((k) => [k, []]));
  const comAlerta = new Set();
  const anota = (codigo, p, detalhe) => {
    achados.get(codigo).push({ id: p.id, sku: p.sku, nome: p.nome, ncm: fmtNcm(so(p.ncm)), cest: fmtCest(so(p.cest)), detalhe });
    comAlerta.add(p.id);
  };

  let analisados = 0;
  for (const p of produtos) {
    // Produto escritural (o da nota complementar) não é mercadoria: não tem
    // NCM de verdade nem entra em ST.
    if (p.escritural) continue;
    analisados += 1;
    const n = so(p.ncm);
    // "00.000.00" é como o cadastro antigo dizia "sem CEST" (164 produtos em
    // 02/10/2026): é ausência, não um CEST que não existe.
    const c = /^0+$/.test(so(p.cest)) ? '' : so(p.cest);
    const ncmInfo = n.length === 8 ? ncm.get(n) : null;

    if (!n) anota('NCM_AUSENTE', p, '');
    else if (!ncmInfo) anota('NCM_INEXISTENTE', p, n.length === 8 ? '' : `${n.length} dígitos`);
    else if (ncmInfo.dataFim && ncmInfo.dataFim < dia) anota('NCM_ENCERRADO', p, `valeu até ${ncmInfo.dataFim.split('-').reverse().join('/')}`);

    if (n && Number(n.slice(0, 2)) >= 1 && Number(n.slice(0, 2)) <= 24) {
      anota('NCM_ALIMENTO', p, ncmInfo ? ncmInfo.descricaoCompleta : '');
    }

    if (c) {
      const cestInfo = cest.get(c);
      if (!cestInfo) anota('CEST_INEXISTENTE', p, c.length === 7 ? '' : `${c.length} dígitos`);
      else if (ncmInfo && !cestCobreNcm(cestInfo.ncmPrefixos, n)) {
        anota('CEST_NCM_INCOMPATIVEL', p,
          `${fmtCest(c)} (${cestInfo.segmentoNome || 'segmento ' + c.slice(0, 2)}) cobre ${cestInfo.ncmPrefixos.map(fmtNcm).join(', ')}`);
      }
      if (!p.emSt) anota('CEST_SEM_ST', p, cestInfo ? cestInfo.descricao : '');
    } else if (p.emSt) {
      anota('ST_SEM_CEST', p, '');
    }
  }

  const alertas = [...achados.entries()]
    .filter(([, lista]) => lista.length)
    .map(([codigo, produtosDoAlerta]) => ({ codigo, ...ALERTAS[codigo], quantidade: produtosDoAlerta.length, produtos: produtosDoAlerta }))
    .sort((a, b) => ORDEM[a.gravidade] - ORDEM[b.gravidade] || b.quantidade - a.quantidade);

  return { analisados, comAlerta: comAlerta.size, alertas };
}

module.exports = { analisarCadastro, ALERTAS, fmtNcm, fmtCest };
