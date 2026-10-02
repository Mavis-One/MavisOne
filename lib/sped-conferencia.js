/**
 * A CONFERÊNCIA DE UM SPED PRONTO — o arquivo que o sistema antigo gerou.
 *
 * POR QUE ISTO VEM ANTES DE GERAR O SPED DAQUI
 * --------------------------------------------
 * Em 01/10/2026 este sistema tem 0 documentos fiscais: as notas de setembro
 * saíram pelo ViperERP. Um SPED gerado do banco hoje sairia vazio. Mas o
 * arquivo que o Viper gera está à mão, e lido pelo gerador daqui
 * (lib/sped-gerador.js) ele mostrou dois defeitos que nenhuma tela mostrava:
 *
 *   - setembro/2026 declara K990 = 68 com 67 linhas no Bloco K — o PVA confere
 *     essa contagem;
 *   - todos os dez meses (dez/2025 a set/2026) declaram crédito de ICMS 0,00
 *     com ICMS destacado nas entradas.
 *
 * Esta função faz essa leitura para qualquer arquivo e devolve três coisas:
 * o que está errado, o que foi CORRIGIDO no arquivo de saída, e o que NÃO foi.
 *
 * A FRONTEIRA DO QUE SE CORRIGE, e ela é o ponto deste arquivo
 * -----------------------------------------------------------
 * CORRIGE o que é forma: contagens de linha (x990, Bloco 9), casas decimais,
 * espaço nas pontas de texto, e a codificação (UTF-8 -> ISO 8859-1). Nada disso
 * muda um centavo declarado — é o mesmo conteúdo escrito do jeito que o Guia
 * pede, e a prova é que o gerador reproduz os dez arquivos campo a campo.
 *
 * NÃO CORRIGE o que é conteúdo: crédito, débito, E116, versão do leiaute. Esses
 * mudam o imposto ou a interpretação do arquivo, e a decisão é do contador. A
 * conferência APONTA, com o número que daria, e o arquivo corrigido sai com o
 * valor que veio.
 */

const gerador = require('./sped-gerador');
const apuracao = require('./sped-apuracao');

// O COD_VER de cada ano, pela Tabela 3.1.1 do Guia Prático (versão do leiaute
// por período de apuração). Só os anos que esta empresa escritura: o arquivo de
// dez/2025 declara 019, mar a set/2026 declaram 020.
const VERSAO_POR_ANO = { 2023: '017', 2024: '018', 2025: '019', 2026: '020' };

// CFOPs de entrada que, pelo nome, raramente dão crédito de ICMS a quem compra:
// o ICMS deles não é da operação de quem escritura. Servem só para separar o
// número no aviso — quem decide é o contador.
const CFOP_RARAMENTE_CREDITAVEL = {
  1949: 'outra entrada não especificada',
  2949: 'outra entrada não especificada',
  1403: 'compra para comercialização com ST',
  2403: 'compra para comercialização com ST',
  1556: 'uso e consumo',
  2556: 'uso e consumo',
  1551: 'ativo imobilizado (vai pelo CIAP)',
  2551: 'ativo imobilizado (vai pelo CIAP)'
};

function moeda(v) {
  return Math.round(Number(v || 0) * 100) / 100;
}

function brl(v) {
  return Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function estrutural(reg) {
  return /^.(001|990)$/.test(reg) || /^9/.test(reg);
}

/** ddmmaaaa -> { ano, mes, iso: 'aaaa-mm' } */
function periodo(ddmmaaaa) {
  const m = /^(\d{2})(\d{2})(\d{4})$/.exec(String(ddmmaaaa || ''));
  if (!m) return null;
  return { ano: Number(m[3]), mes: Number(m[2]), iso: `${m[3]}-${m[2]}` };
}

/** Como os bytes chegaram: o Guia pede Latin-1; o sistema antigo grava UTF-8. */
function codificacaoDe(buffer) {
  let temAcima = false;
  for (const b of buffer) if (b > 0x7f) { temAcima = true; break; }
  if (!temAcima) return 'ascii';
  try { new TextDecoder('utf-8', { fatal: true }).decode(buffer); return 'utf-8'; } catch { return 'latin1'; }
}

/**
 * CONFERE o arquivo e devolve o relatório e o arquivo corrigido.
 *
 * `buffer` são os bytes do arquivo como vieram. `nome` é só para batizar o
 * corrigido.
 */
function conferirEfd(buffer, { nome = 'sped.txt' } = {}) {
  const problemas = [];
  const add = (p) => problemas.push({ corrigido: false, ...p });

  const codificacao = codificacaoDe(buffer);
  let lidos;
  try {
    lidos = gerador.lerEfd(buffer);
  } catch (e) {
    // Arquivo que não se lê não tem conferência nem correção: o defeito pode
    // estar em qualquer lugar depois da linha que quebrou.
    add({ gravidade: 'erro', codigo: 'ILEGIVEL', titulo: 'O arquivo não pôde ser lido como EFD ICMS/IPI', detalhe: e.message });
    return { ok: false, arquivo: { nome, bytes: buffer.length, codificacao }, problemas, apuracao: null, resumo: null, corrigido: null };
  }

  const r0000 = lidos.find((r) => r.REG === '0000');
  if (!r0000) {
    add({ gravidade: 'erro', codigo: 'SEM_0000', titulo: 'O arquivo não tem o registro 0000', detalhe: 'Sem ele não há empresa nem período.' });
    return { ok: false, arquivo: { nome, bytes: buffer.length, codificacao }, problemas, apuracao: null, resumo: null, corrigido: null };
  }

  const per = periodo(r0000.DT_INI);
  const original = (Buffer.isBuffer(buffer) ? (codificacao === 'latin1' ? buffer.toString('latin1') : buffer.toString('utf8')) : String(buffer))
    .split(/\r?\n/).filter(Boolean);
  const regerado = gerador.gerarEfd(gerador.separarEmBlocos(lidos));
  const novas = regerado.linhas;

  // ------------------------------------------------------------------
  // 1. ESTRUTURA — o que o gerador escreve sozinho. Linha a linha: a ordem dos
  //    registros de dado é a mesma (o gerador não reordena), então só as
  //    estruturais podem diferir de posição se uma contagem estiver errada.
  // ------------------------------------------------------------------
  const estruturaisOriginais = original.filter((l) => estrutural(l.split('|')[1]));
  const estruturaisNovas = novas.filter((l) => estrutural(l.split('|')[1]));
  const errosDeEstrutura = [];
  const maior = Math.max(estruturaisOriginais.length, estruturaisNovas.length);
  for (let i = 0; i < maior; i++) {
    const a = estruturaisOriginais[i] || '';
    const b = estruturaisNovas[i] || '';
    if (a === b) continue;
    const pa = a.split('|');
    const pb = b.split('|');
    if (pa[1] && pa[1] === pb[1] && /990$/.test(pa[1]) && pa[1] !== '9990') {
      errosDeEstrutura.push(`${pa[1]} declara ${pa[2]} linhas; o bloco ${pa[1].charAt(0)} tem ${pb[2]}`);
    } else if (pa[1] === '9900' && pb[1] === '9900' && pa[2] === pb[2]) {
      errosDeEstrutura.push(`9900 do ${pa[2]} declara ${pa[3]}; o arquivo tem ${pb[3]}`);
    } else {
      errosDeEstrutura.push(`esperado ${b || '(nada)'}, veio ${a || '(nada)'}`);
    }
  }
  if (errosDeEstrutura.length) {
    add({
      gravidade: 'erro',
      codigo: 'ESTRUTURA',
      titulo: `${errosDeEstrutura.length} contagem(ns) de linhas errada(s)`,
      detalhe: 'O validador da Receita (PVA) confere cada uma destas contagens.',
      itens: errosDeEstrutura.slice(0, 20),
      corrigido: true
    });
  }

  // ------------------------------------------------------------------
  // 2. FORMA — casas decimais e espaço nas pontas. Não muda valor; muda como
  //    ele está escrito. Contado por registro para o relatório não virar lista
  //    de 500 linhas.
  // ------------------------------------------------------------------
  const formaPorReg = {};
  let espacos = 0;
  const dados = original.filter((l) => !estrutural(l.split('|')[1]));
  const dadosNovos = novas.filter((l) => !estrutural(l.split('|')[1]));
  for (let i = 0; i < Math.min(dados.length, dadosNovos.length); i++) {
    if (dados[i] === dadosNovos[i]) continue;
    const pa = dados[i].split('|');
    const pb = dadosNovos[i].split('|');
    for (let j = 2; j < pa.length - 1; j++) {
      if (pa[j] === pb[j]) continue;
      if (pa[j].trim() === pb[j]) espacos += 1;
      else formaPorReg[pa[1]] = (formaPorReg[pa[1]] || 0) + 1;
    }
  }
  const formas = Object.entries(formaPorReg);
  if (formas.length) {
    add({
      gravidade: 'info',
      codigo: 'DECIMAIS',
      titulo: 'Números escritos sem as casas decimais do leiaute',
      detalhe: 'Ex.: "282" num campo de duas casas, que o Guia escreve "282,00". O valor é o mesmo.',
      itens: formas.map(([reg, n]) => `${reg}: ${n} campo(s)`),
      corrigido: true
    });
  }
  if (espacos) {
    add({
      gravidade: 'info',
      codigo: 'ESPACOS',
      titulo: `${espacos} texto(s) com espaço no começo ou no fim`,
      detalhe: r0000.NOME !== String(r0000.NOME).trim() ? `Inclusive o nome da empresa no 0000: "${r0000.NOME}".` : 'O espaço sai; o texto fica igual.',
      corrigido: true
    });
  }

  // ------------------------------------------------------------------
  // 3. CODIFICAÇÃO
  // ------------------------------------------------------------------
  const latin = gerador.paraLatin1(regerado.texto);
  if (codificacao === 'utf-8') {
    add({
      gravidade: 'atencao',
      codigo: 'CODIFICACAO',
      titulo: 'Arquivo gravado em UTF-8; o Guia Prático pede ISO 8859-1 (Latin-1)',
      detalhe: 'Lido como Latin-1, "São José" vira "SÃ£o JosÃ©". O corrigido sai em Latin-1.'
        + (latin.trocados.length ? ` ${latin.trocados.length} caractere(s) sem equivalente em Latin-1 viraram "?": ${[...new Set(latin.trocados)].join(' ')}` : ''),
      corrigido: true
    });
  }

  // ------------------------------------------------------------------
  // 4. VERSÃO DO LEIAUTE — aponta, não troca: mudar o COD_VER de um arquivo
  //    pronto não muda o leiaute em que ele foi escrito.
  // ------------------------------------------------------------------
  const versaoEsperada = per && VERSAO_POR_ANO[per.ano];
  if (versaoEsperada && r0000.COD_VER !== versaoEsperada) {
    add({
      gravidade: 'erro',
      codigo: 'COD_VER',
      titulo: `Versão do leiaute ${r0000.COD_VER}, e o período ${per.iso} pede ${versaoEsperada}`,
      detalhe: 'O PVA escolhe as regras de validação pela versão declarada. Não corrigido: quem gera de novo é o sistema de origem.'
    });
  }

  // ------------------------------------------------------------------
  // 5. A APURAÇÃO — o E110 refeito a partir dos C190 do próprio arquivo.
  // ------------------------------------------------------------------
  const docs = [];
  const creditoPorCfop = {};
  let resumo = { notas: 0, entradas: 0, saidas: 0, canceladas: 0, participantes: 0, itens: 0 };
  for (const r of lidos) {
    if (r.REG === 'C100') {
      const entrada = r.IND_OPER === '0';
      docs.push({ sentido: entrada ? 'ENTRADA' : 'SAIDA', situacao: r.COD_SIT, linhas: [] });
      resumo.notas += 1;
      if (entrada) resumo.entradas += 1; else resumo.saidas += 1;
      if (['02', '03', '04', '05'].includes(r.COD_SIT)) resumo.canceladas += 1;
    } else if (r.REG === 'C190' && docs.length) {
      const doc = docs[docs.length - 1];
      doc.linhas.push(r);
      if (doc.sentido === 'ENTRADA' && r.VL_ICMS) creditoPorCfop[r.CFOP] = moeda((creditoPorCfop[r.CFOP] || 0) + r.VL_ICMS);
    } else if (r.REG === '0150') resumo.participantes += 1;
    else if (r.REG === '0200') resumo.itens += 1;
  }

  const e110 = lidos.find((r) => r.REG === 'E110') || null;
  let blocoApuracao = null;
  if (e110) {
    const zeros = { debitosDoDocumento: 0, debitosDaApuracao: 0, estornosDeCredito: 0, creditosDoDocumento: 0, creditosDaApuracao: 0, estornosDeDebito: 0 };
    // O saldo anterior e os ajustes vêm do PRÓPRIO arquivo: a pergunta aqui é
    // "o E110 fecha com os documentos dele?", não "qual seria o saldo".
    const calc = apuracao.apuracaoE110(docs, {
      saldoCredorAnterior: e110.VL_SLD_CREDOR_ANT || 0,
      ajustes: {
        ...zeros,
        debitosDoDocumento: e110.VL_AJ_DEBITOS || 0,
        debitosDaApuracao: e110.VL_TOT_AJ_DEBITOS || 0,
        estornosDeCredito: e110.VL_ESTORNOS_CRED || 0,
        creditosDoDocumento: e110.VL_AJ_CREDITOS || 0,
        creditosDaApuracao: e110.VL_TOT_AJ_CREDITOS || 0,
        estornosDeDebito: e110.VL_ESTORNOS_DEB || 0
      },
      deducoes: e110.VL_TOT_DED || 0
    }).campos;

    const difere = (k) => Math.abs((calc[k] || 0) - (e110[k] || 0)) >= 0.005;
    if (difere('VL_TOT_DEBITOS')) {
      add({ gravidade: 'erro', codigo: 'DEBITOS', titulo: 'O débito declarado não é a soma das saídas', detalhe: `Declarado ${brl(e110.VL_TOT_DEBITOS)}; o C190 das saídas soma ${brl(calc.VL_TOT_DEBITOS)}.` });
    }
    if (difere('DEB_ESP')) {
      add({ gravidade: 'erro', codigo: 'DEB_ESP', titulo: 'O débito especial não fecha com os documentos extemporâneos', detalhe: `Declarado ${brl(e110.DEB_ESP)}; calculado ${brl(calc.DEB_ESP)}.` });
    }

    const lista = Object.entries(creditoPorCfop).map(([cfop, valor]) => ({
      cfop, valor, observacao: CFOP_RARAMENTE_CREDITAVEL[cfop] || null
    })).sort((a, b) => b.valor - a.valor);
    if (difere('VL_TOT_CREDITOS')) {
      const raro = moeda(lista.filter((x) => x.observacao).reduce((s, x) => s + x.valor, 0));
      add({
        gravidade: 'atencao',
        codigo: 'CREDITOS',
        titulo: `Crédito declarado ${brl(e110.VL_TOT_CREDITOS)}; as entradas têm ${brl(calc.VL_TOT_CREDITOS)} de ICMS no C190`,
        detalhe: `Nem tudo é crédito: ${brl(raro)} estão em CFOPs que raramente dão crédito (outras entradas, compra com ST, uso e consumo, ativo). `
          + 'Se a empresa tem regime que veda o crédito (TTD de importação, por exemplo), o Guia pede o crédito escriturado e anulado por ajuste no E111, não omitido. '
          + 'Decisão do contador — o arquivo corrigido mantém o valor declarado.',
        itens: lista.slice(0, 12).map((x) => `CFOP ${x.cfop}: ${brl(x.valor)}${x.observacao ? ` (${x.observacao})` : ''}`)
      });
    }

    // E116: a soma das obrigações tem de ser o ICMS a recolher mais o débito
    // especial (Guia, E110 campo 15).
    const somaE116 = moeda(lidos.filter((r) => r.REG === 'E116').reduce((s, r) => s + (r.VL_OR || 0), 0));
    const esperadoE116 = moeda((e110.VL_ICMS_RECOLHER || 0) + (e110.DEB_ESP || 0));
    if (Math.abs(somaE116 - esperadoE116) >= 0.005) {
      add({
        gravidade: 'erro',
        codigo: 'E116',
        titulo: `As obrigações a recolher (E116) somam ${brl(somaE116)}; deviam somar ${brl(esperadoE116)}`,
        detalhe: `O Guia manda o E116 somar o ICMS a recolher (${brl(e110.VL_ICMS_RECOLHER)}) mais o débito especial (${brl(e110.DEB_ESP)}). Não corrigido: falta saber o código de receita e o vencimento da diferença.`
      });
    }

    blocoApuracao = {
      declarado: Object.fromEntries(Object.entries(e110).filter(([k]) => k !== 'REG')),
      calculado: Object.fromEntries(Object.entries(calc).filter(([k]) => k !== 'REG')),
      creditoPorCfop: lista,
      somaE116,
      esperadoE116
    };
  } else if (docs.length) {
    add({ gravidade: 'erro', codigo: 'SEM_E110', titulo: 'Há notas no Bloco C e não há apuração (E110)', detalhe: 'Sem E110 o arquivo não declara imposto.' });
  }

  const nomeCorrigido = String(nome).replace(/\.txt$/i, '') + '-corrigido.txt';
  return {
    ok: !problemas.some((p) => p.gravidade === 'erro' && !p.corrigido),
    arquivo: {
      nome,
      bytes: buffer.length,
      codificacao,
      linhas: original.length,
      competencia: per ? per.iso : null,
      empresa: String(r0000.NOME || '').trim(),
      cnpj: r0000.CNPJ || null,
      ie: r0000.IE || null,
      uf: r0000.UF || null,
      codVer: r0000.COD_VER,
      perfil: r0000.IND_PERFIL || null
    },
    resumo,
    problemas,
    apuracao: blocoApuracao,
    corrigido: {
      nome: nomeCorrigido,
      linhas: novas.length,
      bytes: latin.buffer.length,
      caracteresTrocados: latin.trocados.length,
      // Só existe se algo foi de fato corrigido — senão baixar "o corrigido"
      // seria baixar o mesmo arquivo com outro nome e a impressão de conserto.
      base64: problemas.some((p) => p.corrigido) ? latin.buffer.toString('base64') : null
    }
  };
}

/**
 * O QUE O ÚLTIMO SPED DO SISTEMA ANTERIOR DIZ SOBRE O PRÓXIMO.
 *
 * A escrituração deste sistema começa no mês seguinte ao último SPED que o
 * Viper gerou, e herda dele o que não é de nota nenhuma: o contabilista (0100),
 * o perfil e a atividade (0000), o código de receita e o vencimento (E116), as
 * respostas do 1010, se havia Bloco K — e o SALDO CREDOR, que é o campo 14 do
 * E110 dele e o campo 10 do primeiro E110 daqui.
 *
 * Devolve SUGESTÕES: a tela preenche o formulário e quem salva é a pessoa.
 * O crédito das entradas fica de fora de propósito — o arquivo declara zero,
 * e copiar isso seria tomar a decisão que é do contador.
 */
function configuracaoDoSpedAnterior(buffer) {
  const lidos = gerador.lerEfd(buffer);
  const um = (reg) => lidos.find((r) => r.REG === reg) || null;
  const r0000 = um('0000');
  if (!r0000) throw Object.assign(new Error('O arquivo não tem o registro 0000.'), { status: 400 });
  const per = periodo(r0000.DT_INI);
  const proxima = per && (per.mes === 12 ? `${per.ano + 1}-01` : `${per.ano}-${String(per.mes + 1).padStart(2, '0')}`);
  const r0100 = um('0100') || {};
  const e110 = um('E110') || {};
  const e116 = um('E116');
  const r1010 = um('1010') || {};
  const temCredito = lidos.some((r) => r.REG === 'C190') && Number(e110.VL_TOT_CREDITOS || 0) === 0;
  return {
    origem: {
      competencia: per ? per.iso : null,
      cnpj: r0000.CNPJ || null,
      empresa: String(r0000.NOME || '').trim(),
      ie: r0000.IE || null
    },
    sugestao: {
      perfil_sped: r0000.IND_PERFIL || null,
      indicador_atividade: r0000.IND_ATIV === undefined ? null : Number(r0000.IND_ATIV),
      contador_nome: r0100.NOME || null,
      contador_cpf: r0100.CPF || null,
      contador_crc: r0100.CRC || null,
      contador_cnpj: r0100.CNPJ || null,
      contador_cep: r0100.CEP || null,
      contador_endereco: r0100.END || null,
      contador_numero: r0100.NUM || null,
      contador_complemento: r0100.COMPL || null,
      contador_bairro: r0100.BAIRRO || null,
      contador_telefone: r0100.FONE || null,
      contador_email: r0100.EMAIL || null,
      contador_codigo_municipio: r0100.COD_MUN || null,
      e116_codigo_receita: e116 ? e116.COD_REC || null : null,
      e116_dia_vencimento: e116 && /^\d{8}$/.test(e116.DT_VCTO || '') ? Number(e116.DT_VCTO.slice(0, 2)) : null,
      indicadores_1010: Object.fromEntries(Object.entries(r1010).filter(([k]) => k !== 'REG')),
      competencia_inicial: proxima,
      saldo_credor_inicial: Number(e110.VL_SLD_CREDOR_TRANSPORTAR || 0),
      bloco_k_obrigatorio: lidos.some((r) => r.REG === 'K200')
    },
    // O que a tela tem de dizer junto da sugestão.
    observacoes: [
      ...(temCredito ? ['O arquivo declara crédito de ICMS zero com ICMS nas entradas — a decisão sobre o crédito não foi copiada.'] : []),
      ...(lidos.some((r) => r.REG === 'K200') ? ['O arquivo tem Bloco K (K200). Este sistema ainda não gera o Bloco K.'] : []),
      ...(lidos.some((r) => r.REG === 'E200') ? ['O arquivo tem apuração de ICMS-ST (E200/E210). Este sistema ainda não gera o ST.'] : [])
    ]
  };
}

module.exports = { conferirEfd, configuracaoDoSpedAnterior, VERSAO_POR_ANO, CFOP_RARAMENTE_CREDITAVEL };
