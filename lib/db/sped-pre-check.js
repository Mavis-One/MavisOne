// O PRÉ-CHECK DO SPED: o que falta para gerar a EFD de uma competência.
//
// A PERGUNTA QUE ESTA TELA RESPONDE
// ---------------------------------
// "Se o arquivo fosse gerado hoje, o que estaria faltando?" Hoje ela só tem uma
// forma de ser respondida: gerar, mandar para o contador, e esperar o PVA
// recusar. O prazo da EFD é o dia 20 do mês seguinte, e descobrir no dia 19 que
// 661 participantes estão sem código de município não é a mesma coisa que
// descobrir no dia 1.
//
// A lista de registros vem de `lib/sped-registros.js`, levantada do arquivo que
// o SISTEMA ATUAL gerou para agosto de 2026. Não é a minha ideia do que a EFD
// precisa: é o que a escrituração desta empresa efetivamente usa.
//
// A REGRA QUE FAZ ESTA TELA NÃO MENTIR
// ------------------------------------
// Toda conferência devolve DOIS números: quantas linhas ela olhou (`avaliados`)
// e quantas estão com problema (`pendentes`). E `avaliados = 0` NÃO é verde.
//
// Isso importa mais que parece. "0 itens sem CFOP" é uma frase verdadeira e
// inútil quando não há item nenhum — e é exatamente o estado de hoje, com 0
// documentos fiscais. Uma tela que pintasse isso de verde diria que está tudo
// pronto para gerar um arquivo vazio. Então o terceiro estado existe, tem nome
// (`semBase`) e aparece diferente: "não havia o que conferir".
//
// O MESMO VALE PARA REGISTRO SEM FONTE. `0100` (o contabilista), `0450`, `C110`,
// `C190` e todo o Bloco E não saem de lugar nenhum deste sistema. Isso não é
// pendência de cadastro — é trabalho que não está em nenhuma fase do plano,
// porque ninguém sabia que existia até o arquivo de verdade ser lido.
const { consultar } = require('./conexao');
const sped = require('../sped-registros');

/** Primeiro e último dia da competência 'aaaa-mm'. */
function janelaDaCompetencia(competencia) {
  const texto = String(competencia || '').slice(0, 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(texto)) {
    const erro = new Error(`Competência inválida: "${competencia}". Use aaaa-mm.`);
    erro.status = 400;
    throw erro;
  }
  const [ano, mes] = texto.split('-').map(Number);
  // Dia 0 do mês SEGUINTE é o último dia deste — evita a tabela de 28/29/30/31
  // e o fevereiro bissexto. `Date.UTC` porque o parser do projeto devolve data
  // como string justamente para não deslocar por fuso.
  const ultimo = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  return {
    competencia: texto,
    de: `${texto}-01`,
    ate: `${texto}-${String(ultimo).padStart(2, '0')}`
  };
}

/**
 * Monta uma conferência.
 *
 * `gravidade` tem três valores e eles significam coisas diferentes:
 *   impede      o arquivo não sai, ou sai e o PVA recusa
 *   atencao     o arquivo sai, e pode sair com conteúdo errado
 *   semFonte    o dado não existe neste sistema — é desenvolvimento, não cadastro
 */
function conferencia({ reg, id, gravidade, titulo, avaliados, pendentes, texto, onde, exemplos }) {
  return {
    reg,
    id,
    gravidade,
    titulo,
    avaliados: Number(avaliados || 0),
    pendentes: Number(pendentes || 0),
    // O terceiro estado, e o que impede a tela de mentir.
    semBase: Number(avaliados || 0) === 0,
    ok: Number(avaliados || 0) > 0 && Number(pendentes || 0) === 0,
    texto,
    onde: onde || '',
    exemplos: exemplos || []
  };
}

const um = async (sql, params) => {
  const { rows } = await consultar(sql, params);
  return rows[0] || {};
};
const alguns = async (sql, params) => {
  const { rows } = await consultar(sql, params);
  return rows;
};

async function preCheckDoSped({ competencia }) {
  const janela = janelaDaCompetencia(competencia);
  const { de, ate } = janela;
  const checks = [];

  // ------------------------------------------------------------------ BLOCO 0
  const est = await um(`select count(*) total,
      count(*) filter (where ativo) ativos,
      count(*) filter (where ativo and perfil_sped is null) sem_perfil,
      count(*) filter (where ativo and indicador_atividade is null) sem_ativ
    from estabelecimento`);

  checks.push(conferencia({
    reg: '0000', id: 'estabelecimento', gravidade: 'impede',
    titulo: 'Estabelecimento cadastrado',
    avaliados: 1, pendentes: Number(est.ativos) > 0 ? 0 : 1,
    texto: Number(est.ativos) > 0
      ? `${est.ativos} estabelecimento(s) ativo(s).`
      : 'Nenhum estabelecimento cadastrado. A EFD é POR estabelecimento: sem um, não há arquivo a gerar.',
    onde: 'Configurações › Fiscal › Estabelecimentos'
  }));

  checks.push(conferencia({
    reg: '0000', id: 'perfil', gravidade: 'impede',
    titulo: 'Perfil de apresentação (IND_PERFIL)',
    avaliados: Number(est.ativos), pendentes: Number(est.sem_perfil),
    texto: Number(est.ativos) === 0
      ? 'Sem estabelecimento, não há perfil a declarar.'
      : `${est.sem_perfil} de ${est.ativos} sem perfil declarado. O arquivo de agosto/2026 do sistema atual usou perfil "${sped.OBSERVADO_0000.indPerfil}" — o perfil muda QUAIS registros o arquivo precisa ter, então ele não tem padrão aqui: alguém declara.`,
    onde: 'Configurações › Fiscal › Estabelecimentos'
  }));

  checks.push(conferencia({
    reg: '0000', id: 'atividade', gravidade: 'impede',
    titulo: 'Indicador de atividade (IND_ATIV)',
    avaliados: Number(est.ativos), pendentes: Number(est.sem_ativ),
    texto: Number(est.ativos) === 0
      ? 'Sem estabelecimento, não há indicador a declarar.'
      : `${est.sem_ativ} de ${est.ativos} sem indicador. O arquivo de agosto usou "${sped.OBSERVADO_0000.indAtiv}" (outros, NÃO industrial) — o que contraria a leitura de que importadora é equiparada a industrial. Vale conferir com o contador antes de declarar.`,
    onde: 'Configurações › Fiscal › Estabelecimentos'
  }));

  const emp = await um(`select count(*) total,
      count(*) filter (where ativo and (regime_tributario is null or crt is null)) sem_regime
    from empresa`);
  checks.push(conferencia({
    reg: '0000', id: 'regime', gravidade: 'impede',
    titulo: 'Regime tributário da empresa',
    avaliados: Number(emp.total), pendentes: Number(emp.sem_regime),
    texto: Number(emp.total) === 0
      ? 'Nenhuma empresa cadastrada.'
      : `${emp.sem_regime} de ${emp.total} sem regime ou CRT.`,
    onde: 'Configurações › Fiscal › Empresas'
  }));

  // 0100 — O CONTABILISTA. Achado novo: ele existe no arquivo e não existe aqui.
  checks.push(conferencia({
    reg: '0100', id: 'contabilista', gravidade: 'semFonte',
    titulo: 'Dados do contabilista',
    avaliados: 0, pendentes: 0,
    texto: 'O registro 0100 pede nome, CPF, CRC, CNPJ do escritório, endereço, município, telefone e e-mail do contabilista. Nada disso existe no sistema — nem tabela, nem tela. É uma linha no arquivo e um cadastro que falta.',
    onde: 'não existe ainda'
  }));

  // 0150 — os participantes CITADOS por documento da competência.
  const part = await um(`select count(*) avaliados,
      count(*) filter (where codigo_municipio is null or btrim(codigo_municipio) = '') sem_municipio,
      count(*) filter (where logradouro is null or btrim(logradouro) = '') sem_logradouro,
      count(*) filter (where bairro is null or btrim(bairro) = '') sem_bairro,
      count(*) filter (where tipo_documento = 'NENHUM') sem_documento
    from fiscal_participantes p
    where exists (select 1 from fiscal_documentos d
                   where d.participante_id = p.id and d.data_emissao between $1 and $2)`, [de, ate]);

  checks.push(conferencia({
    reg: '0150', id: 'part_municipio', gravidade: 'impede',
    titulo: 'Código do município dos participantes',
    avaliados: Number(part.avaliados), pendentes: Number(part.sem_municipio),
    texto: Number(part.avaliados) === 0
      ? 'Nenhum participante citado por documento desta competência — não há o que conferir.'
      : `${part.sem_municipio} de ${part.avaliados} sem código IBGE do município.`,
    onde: 'Cadastros › Pessoas'
  }));
  checks.push(conferencia({
    reg: '0150', id: 'part_endereco', gravidade: 'impede',
    titulo: 'Endereço dos participantes',
    avaliados: Number(part.avaliados),
    pendentes: Math.max(Number(part.sem_logradouro), Number(part.sem_bairro)),
    texto: Number(part.avaliados) === 0
      ? 'Nenhum participante citado nesta competência.'
      : `${part.sem_logradouro} sem logradouro, ${part.sem_bairro} sem bairro, de ${part.avaliados}.`,
    onde: 'Cadastros › Pessoas'
  }));
  checks.push(conferencia({
    reg: '0150', id: 'part_documento', gravidade: 'atencao',
    titulo: 'CPF ou CNPJ dos participantes',
    avaliados: Number(part.avaliados), pendentes: Number(part.sem_documento),
    texto: Number(part.avaliados) === 0
      ? 'Nenhum participante citado nesta competência.'
      : `${part.sem_documento} de ${part.avaliados} sem CPF e sem CNPJ. No arquivo de agosto, 50% dos 179 participantes tinham CNPJ e 50% CPF — nenhum ficou sem os dois.`,
    onde: 'Cadastros › Pessoas'
  }));

  // E o quadro A MONTANTE: como o cadastro está, independente de haver nota.
  // Sem isto, tudo acima fica "sem base" e a tela não diria nada de útil hoje.
  const pessoas = await um(`select count(*) total,
      count(*) filter (where coalesce(btrim(extra->>'ibgeCityCode'), '') = '') sem_ibge,
      count(*) filter (where coalesce(btrim(extra->>'neighborhood'), '') = '') sem_bairro,
      count(*) filter (where coalesce(btrim(extra->>'streetNumber'), '') = '') sem_numero,
      count(*) filter (where coalesce(btrim(zip_code), '') = '') sem_cep
    from people`);
  checks.push(conferencia({
    reg: '0150', id: 'cadastro_pessoas', gravidade: 'atencao',
    titulo: 'O cadastro de pessoas, antes de virar participante',
    avaliados: Number(pessoas.total),
    pendentes: Number(pessoas.sem_ibge),
    texto: `Dos ${pessoas.total} cadastros: ${pessoas.sem_ibge} sem código IBGE, ${pessoas.sem_cep} sem CEP, ${pessoas.sem_bairro} sem bairro, ${pessoas.sem_numero} sem número. Quem entrar numa nota entra assim — e aí vira pendência do 0150.`,
    onde: 'Cadastros › Pessoas'
  }));

  // 0190 — as unidades. Aqui a conferência é um cruzamento: unidade EM USO
  // que não tem descrição cadastrada.
  const unidades = await alguns(`select btrim(p.unidade_comercial) u, count(*) n
      from products p
     where coalesce(btrim(p.unidade_comercial), '') <> ''
       and not exists (select 1 from fiscal_unidades fu
                        where upper(btrim(fu.codigo)) = upper(btrim(p.unidade_comercial)))
     group by 1 order by 2 desc`);
  const totalUnidades = await um(`select count(distinct upper(btrim(unidade_comercial))) n
      from products where coalesce(btrim(unidade_comercial), '') <> ''`);
  checks.push(conferencia({
    reg: '0190', id: 'unidades', gravidade: 'impede',
    titulo: 'Descrição de cada unidade de medida',
    avaliados: Number(totalUnidades.n), pendentes: unidades.length,
    texto: `${unidades.length} de ${totalUnidades.n} unidades em uso sem descrição cadastrada. O arquivo de agosto declarou 33 unidades, todas com descrição — aquelas descrições são a fonte certa para preencher aqui, e não um palpite.`,
    onde: 'Fiscal › Unidades (não existe ainda)',
    exemplos: unidades.slice(0, 8).map((x) => `${x.u} (${x.n} produtos)`)
  }));

  // 0200 — os itens.
  const prod = await um(`select count(*) total,
      count(*) filter (where ncm is null or btrim(ncm) = '') sem_ncm,
      count(*) filter (where ncm is not null and btrim(ncm) !~ '^[0-9]{8}$') ncm_torto,
      count(*) filter (where coalesce(btrim(unidade_comercial), '') = '') sem_unidade,
      count(*) filter (where coalesce(btrim(tipo_produto_fiscal), '') = '') sem_tipo,
      count(distinct tipo_produto_fiscal) tipos
    from products`);
  checks.push(conferencia({
    reg: '0200', id: 'ncm', gravidade: 'impede',
    titulo: 'NCM dos produtos',
    avaliados: Number(prod.total), pendentes: Number(prod.sem_ncm) + Number(prod.ncm_torto),
    texto: `${prod.sem_ncm} sem NCM e ${prod.ncm_torto} com NCM fora de 8 dígitos, de ${prod.total}. A SEFAZ exige NCM em todo item, e a emissão já recusa item sem ele.`,
    onde: 'Estoque › Produtos'
  }));
  checks.push(conferencia({
    reg: '0200', id: 'unidade_produto', gravidade: 'impede',
    titulo: 'Unidade de inventário dos produtos',
    avaliados: Number(prod.total), pendentes: Number(prod.sem_unidade),
    texto: `${prod.sem_unidade} de ${prod.total} sem unidade.`,
    onde: 'Estoque › Produtos'
  }));
  checks.push(conferencia({
    reg: '0200', id: 'tipo_item', gravidade: 'atencao',
    titulo: 'Tipo do item (TIPO_ITEM)',
    avaliados: Number(prod.total), pendentes: Number(prod.tipos) <= 1 ? Number(prod.total) : Number(prod.sem_tipo),
    texto: `O arquivo de agosto usou ${sped.OBSERVADO.tiposDeItem.length} tipos distintos (${sped.OBSERVADO.tiposDeItem.join(', ')}). Aqui há ${prod.tipos} valor(es) distinto(s) em ${prod.total} produtos — mercadoria de revenda, matéria-prima, produto acabado e serviço vão para o arquivo com códigos diferentes, e um valor só para tudo significa que essa distinção não está feita.`,
    onde: 'Estoque › Produtos'
  }));

  // 0450 e C110 — observações do lançamento. 298 linhas de cada em agosto.
  checks.push(conferencia({
    reg: '0450', id: 'observacoes', gravidade: 'semFonte',
    titulo: 'Tabela de observações do lançamento fiscal',
    avaliados: 0, pendentes: 0,
    texto: `O arquivo de agosto teve ${sped.LINHAS_EM_AGOSTO['0450']} observações no 0450 e ${sped.LINHAS_EM_AGOSTO.C110} referências a elas no C110 — quase uma por documento. São os textos legais que cada operação exige. Não há tabela nem campo para isso aqui.`,
    onde: 'não existe ainda'
  }));

  // ------------------------------------------------------------------ BLOCO C
  const doc = await um(`select count(*) total,
      count(*) filter (where estabelecimento_id is null) sem_estab,
      count(*) filter (where data_emissao is null) sem_data,
      count(*) filter (where participante_id is null) sem_part,
      count(*) filter (where situacao = 'CANCELADO') cancelados
    from fiscal_documentos where data_emissao between $1 and $2`, [de, ate]);

  checks.push(conferencia({
    reg: 'C100', id: 'documentos', gravidade: 'impede',
    titulo: 'Documentos fiscais na competência',
    avaliados: 1, pendentes: Number(doc.total) > 0 ? 0 : 1,
    texto: Number(doc.total) > 0
      ? `${doc.total} documento(s), ${doc.cancelados} cancelado(s). Em agosto o sistema atual escriturou ${sped.LINHAS_EM_AGOSTO.C100}.`
      : `Nenhum documento fiscal nesta competência. Em agosto o sistema atual escriturou ${sped.LINHAS_EM_AGOSTO.C100} — é essa a ordem de grandeza que falta. Enquanto nada emitir nota aqui, o resto do Bloco C não tem o que conferir.`,
    onde: 'Fiscal › Emitir NF-e'
  }));
  checks.push(conferencia({
    reg: 'C100', id: 'doc_estabelecimento', gravidade: 'impede',
    titulo: 'Documento ligado ao estabelecimento',
    avaliados: Number(doc.total), pendentes: Number(doc.sem_estab),
    texto: Number(doc.total) === 0
      ? 'Sem documento na competência.'
      : `${doc.sem_estab} de ${doc.total} sem estabelecimento. O arquivo é por estabelecimento: documento solto não entra em nenhum.`,
    onde: 'Fiscal › Documentos Fiscais'
  }));
  checks.push(conferencia({
    reg: 'C100', id: 'doc_data_participante', gravidade: 'impede',
    titulo: 'Data e participante do documento',
    avaliados: Number(doc.total), pendentes: Number(doc.sem_data) + Number(doc.sem_part),
    texto: Number(doc.total) === 0
      ? 'Sem documento na competência.'
      : `${doc.sem_data} sem data de emissão, ${doc.sem_part} sem participante.`,
    onde: 'Fiscal › Documentos Fiscais'
  }));

  const itens = await um(`select count(*) total,
      count(*) filter (where cfop is null or btrim(cfop) = '') sem_cfop,
      count(*) filter (where ncm is null or btrim(ncm) = '') sem_ncm,
      count(*) filter (where not exists (select 1 from fiscal_item_tributos t where t.item_id = i.id)) sem_tributo,
      count(*) filter (where produto_fiscal_id is null) sem_retrato
    from fiscal_documento_itens i
    join fiscal_documentos d on d.id = i.documento_id
   where d.data_emissao between $1 and $2`, [de, ate]);

  checks.push(conferencia({
    reg: 'C170', id: 'item_cfop_ncm', gravidade: 'impede',
    titulo: 'CFOP e NCM de cada item',
    avaliados: Number(itens.total), pendentes: Number(itens.sem_cfop) + Number(itens.sem_ncm),
    texto: Number(itens.total) === 0
      ? `Nenhum item na competência. Em agosto foram ${sped.LINHAS_EM_AGOSTO.C170} linhas de C170.`
      : `${itens.sem_cfop} sem CFOP, ${itens.sem_ncm} sem NCM, de ${itens.total}.`,
    onde: 'Fiscal › Documentos Fiscais'
  }));
  checks.push(conferencia({
    reg: 'C170', id: 'item_tributo', gravidade: 'impede',
    titulo: 'Imposto por item',
    avaliados: Number(itens.total), pendentes: Number(itens.sem_tributo),
    texto: Number(itens.total) === 0
      ? 'Nenhum item na competência — e é aqui que a fase DK abriu a morada para o imposto por item, que antes não existia em coluna nenhuma.'
      : `${itens.sem_tributo} de ${itens.total} itens sem nenhum tributo registrado. O C170 pede CST, base, alíquota e valor de cada um.`,
    onde: 'Fiscal › Documentos Fiscais'
  }));
  checks.push(conferencia({
    reg: 'C170', id: 'item_retrato', gravidade: 'atencao',
    titulo: 'Retrato fiscal do produto usado no item',
    avaliados: Number(itens.total), pendentes: Number(itens.sem_retrato),
    texto: Number(itens.total) === 0
      ? 'Nenhum item na competência.'
      : `${itens.sem_retrato} de ${itens.total} sem ponteiro para o retrato do produto. Sem ele, "com que NCM este item foi escriturado" volta a ser comparação de datas.`,
    onde: 'Fiscal › Documentos Fiscais'
  }));

  checks.push(conferencia({
    reg: 'C190', id: 'analitico', gravidade: 'semFonte',
    titulo: 'Registro analítico por CST × CFOP × alíquota',
    avaliados: 0, pendentes: 0,
    texto: `O C190 agrega os itens de cada documento por CST, CFOP e alíquota — ${sped.LINHAS_EM_AGOSTO.C190} linhas em agosto, mais que os ${sped.LINHAS_EM_AGOSTO.C100} documentos. É conta a fazer sobre os itens, e não existe aqui. As alíquotas que apareceram no arquivo: 17, 12, 7, 4 e 0.`,
    onde: 'não existe ainda'
  }));

  // ------------------------------------------------------------------ BLOCO E
  const regras = await um('select count(*) n from regra_fiscal');
  const grupos = await um(`select (select count(*) from grupo_tributario) grupos,
      (select count(*) from products where grupo_tributario_id is not null) classificados,
      (select count(*) from products) produtos,
      (select count(distinct ncm) from products where ncm is not null) ncms`);
  checks.push(conferencia({
    reg: 'E110', id: 'regras', gravidade: 'impede',
    titulo: 'Regras fiscais preenchidas',
    avaliados: 1, pendentes: Number(regras.n) > 0 ? 0 : 1,
    texto: Number(regras.n) > 0
      ? `${regras.n} regra(s) cadastrada(s).`
      : `Nenhuma regra fiscal. Sem regra não há CFOP nem CST; sem eles não há C170 nem C190, e sem esses não há apuração. São ${grupos.ncms} NCM distintos, ${grupos.grupos} grupos tributários e ${grupos.classificados} de ${grupos.produtos} produtos classificados. É o gargalo mais a montante de todos, e é conteúdo fiscal, não código.`,
    onde: 'Fiscal › Regras Fiscais'
  }));
  checks.push(conferencia({
    reg: 'E110', id: 'apuracao', gravidade: 'semFonte',
    titulo: 'Apuração do ICMS',
    avaliados: 0, pendentes: 0,
    texto: `O E110 tem 15 campos de totalização do período e o E116 ${sped.LINHAS_EM_AGOSTO.E116} obrigações a recolher, com código de receita e data de vencimento. Não há apuração neste sistema. Os códigos de ajuste são tabela oficial por UF — inventá-los produziria arquivo aceito com valor errado.`,
    onde: 'não existe ainda'
  }));
  checks.push(conferencia({
    reg: 'E210', id: 'apuracao_st', gravidade: 'semFonte',
    titulo: 'Apuração do ICMS-ST por UF',
    avaliados: 0, pendentes: 0,
    texto: `Em agosto houve ${sped.LINHAS_EM_AGOSTO.E200} períodos de ST (um por UF de destino) e ${sped.LINHAS_EM_AGOSTO.E250} obrigações. Também não existe aqui.`,
    onde: 'não existe ainda'
  }));

  // ------------------------------------------------------------------ BLOCO 1
  checks.push(conferencia({
    reg: '1010', id: 'bloco1', gravidade: 'semFonte',
    titulo: 'Obrigatoriedade de registros do Bloco 1',
    avaliados: 0, pendentes: 0,
    texto: 'O 1010 tem 14 indicadores de "sim/não" sobre obrigações específicas (exportação, combustíveis, ativo imobilizado, entre outras). São respostas do contador, não do sistema — mas alguém tem de guardá-las.',
    onde: 'não existe ainda'
  }));

  // ---------------------------------------------------------------- o resumo
  const impedem = checks.filter((c) => c.gravidade === 'impede' && c.pendentes > 0).length;
  const atencoes = checks.filter((c) => c.gravidade === 'atencao' && c.pendentes > 0).length;
  const semFonte = checks.filter((c) => c.gravidade === 'semFonte').length;
  const semBase = checks.filter((c) => c.semBase && c.gravidade !== 'semFonte').length;

  return {
    ...janela,
    // A referência observada, para a tela poder dizer de onde tirou os números
    // de comparação em vez de eles aparecerem do nada.
    referencia: {
      arquivo: 'sped01082026-31082026.txt (sistema atual, agosto/2026)',
      codVer: sped.OBSERVADO_0000.codVer,
      linhas: sped.OBSERVADO.linhas,
      registros: sped.REGISTROS.length,
      semFonteNoSistema: sped.semFonte().map((r) => r.reg)
    },
    resumo: { impedem, atencoes, semFonte, semBase, total: checks.length },
    // Agrupado por bloco, na ordem em que o arquivo os escreve.
    blocos: sped.blocos()
      .map((bloco) => ({
        bloco,
        registros: sped.doBloco(bloco).map((r) => ({
          ...r,
          linhasEmAgosto: sped.LINHAS_EM_AGOSTO[r.reg] || 0,
          conferencias: checks.filter((c) => c.reg === r.reg)
        }))
      }))
      // Bloco cujos registros são todos do gerador (abertura/encerramento) não
      // rende linha na tela: ele não tem nada a conferir, e mostrá-lo com um
      // "ok" verde sugeriria que o bloco está pronto.
      .filter((b) => b.registros.some((r) => r.conferencias.length))
  };
}

module.exports = { preCheckDoSped, janelaDaCompetencia };
