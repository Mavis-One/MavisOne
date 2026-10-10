/**
 * AS ALTERAÇÕES DAS OPERAÇÕES FISCAIS no banco (fase DW, 10/10/2026).
 *
 * O catálogo padrão é constante em lib/operacaoFiscal.js; aqui ficam só as
 * alterações feitas pela tela (tabela `operacao_fiscal_ajuste`), e `carregar()`
 * as aplica por cima do padrão, em memória. A emissão continua lendo o
 * OPERACOES de forma síncrona.
 *
 * Em memória porque o processo é UM (PM2 em fork, ver ecosystem.config.js):
 * gravar aqui recarrega o catálogo na hora. Com mais de um processo, a gravação
 * de um não avisaria os outros — é mais um item da lista do ecosystem para
 * resolver antes de cluster.
 *
 * Se a tabela ainda não existe (migração não rodada), `carregar()` não derruba
 * nada: o catálogo fica no padrão, que é o comportamento de antes desta fase.
 */

const { consultar } = require('./conexao');
const operacaoFiscal = require('../operacaoFiscal');

const COLUNA = {
  rotulo: 'rotulo',
  natureza: 'natureza',
  finalidade: 'finalidade',
  movimentaEstoque: 'movimenta_estoque',
  geraFinanceiro: 'gera_financeiro',
  exigeReferencia: 'exige_referencia',
  permiteQuantidadeZero: 'permite_quantidade_zero',
  permiteValorZero: 'permite_valor_zero',
  exigeIcms: 'exige_icms',
  exigeProdutoEscritural: 'exige_produto_escritural'
};

function mapAjuste(row) {
  const ajuste = { chave: row.chave, atualizadoPorNome: row.atualizado_por_nome || '', atualizadoEm: row.atualizado_em };
  for (const [campo, coluna] of Object.entries(COLUNA)) {
    if (row[coluna] !== null && row[coluna] !== undefined) {
      ajuste[campo] = campo === 'finalidade' ? Number(row[coluna]) : row[coluna];
    }
  }
  return ajuste;
}

async function listarAjustes() {
  const { rows } = await consultar('select * from operacao_fiscal_ajuste order by chave');
  return rows.map(mapAjuste);
}

/** Lê as alterações e aplica no catálogo. Devolve os ajustes lidos. */
async function carregar() {
  try {
    const ajustes = await listarAjustes();
    operacaoFiscal.aplicarAjustes(ajustes);
    return ajustes;
  } catch (erro) {
    console.error('Operações fiscais: alterações não carregadas, valendo o padrão do código:', erro.message);
    operacaoFiscal.aplicarAjustes([]);
    return [];
  }
}

/**
 * Grava a operação INTEIRA como ficou na tela. Campo igual ao padrão vai como
 * nulo: assim, se o padrão do código mudar um dia, o que ninguém alterou
 * acompanha.
 */
async function salvar(chave, campos, usuario) {
  const padrao = operacaoFiscal.PADRAO[chave];
  const valores = Object.keys(COLUNA).map((campo) => {
    const valor = campos[campo] === undefined ? (operacaoFiscal.OPERACOES[chave] || {})[campo] : campos[campo];
    return (valor ?? null) === (padrao[campo] ?? null) ? null : valor;
  });
  const colunas = Object.values(COLUNA);
  await consultar(
    `insert into operacao_fiscal_ajuste (chave, ${colunas.join(', ')}, atualizado_por, atualizado_por_nome, atualizado_em)
     values ($1, ${colunas.map((_, i) => `$${i + 2}`).join(', ')}, $${colunas.length + 2}, $${colunas.length + 3}, now())
     on conflict (chave) do update set
       ${colunas.map((c) => `${c} = excluded.${c}`).join(', ')},
       atualizado_por = excluded.atualizado_por,
       atualizado_por_nome = excluded.atualizado_por_nome,
       atualizado_em = now()`,
    [chave, ...valores, usuario?.id || null, usuario?.name || null]
  );
  await carregar();
}

/** Volta a operação ao padrão do código. */
async function restaurar(chave) {
  await consultar('delete from operacao_fiscal_ajuste where chave = $1', [chave]);
  await carregar();
}

module.exports = { listarAjustes, carregar, salvar, restaurar };
