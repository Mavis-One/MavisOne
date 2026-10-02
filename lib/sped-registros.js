// OS REGISTROS QUE A EFD DESTA EMPRESA USA — levantados do arquivo real.
//
// QUEM USA ISTO HOJE: scripts/test-sped-leiaute.js, que confere a contagem de
// campos do leiaute contra a deste arquivo real. O "pré-check do SPED", para o
// qual esta lista foi escrita e que os comentários abaixo citam, foi removido
// em 01/10/2026 a pedido do usuário — a tela "SPED Fiscal" diz o que impede ao
// tentar gerar.
//
// DE ONDE ISTO SAIU, E POR QUE IMPORTA
// ------------------------------------
// Em 29/09/2026 o usuário mostrou o arquivo que o SISTEMA ATUAL gera:
// `sped01082026-31082026.txt`, a EFD ICMS/IPI de agosto de 2026, 2.176 linhas,
// 288.754 bytes, com quebra LF. (Escrevi aqui "latin1"; em 01/10/2026 os dez
// arquivos do sistema antigo foram medidos e são UTF-8 — ver OBSERVADO.) Ele foi lido, e o que está aqui é o
// que ele declara — não a minha memória do Guia Prático.
//
// A diferença não é detalhe. Antes disso eu escrevi, no diagnóstico e em duas
// migrações, que não tinha o layout dos registros e não o inventaria. Continuo
// sem o Guia; o que eu tenho agora é melhor para ESTA finalidade: a lista dos
// registros que a escrituração desta empresa efetivamente usa, com a contagem
// de campos de cada um, observada num arquivo que o contador aceitou.
//
// O QUE ESTA LISTA É E O QUE ELA NÃO É
// ------------------------------------
// ELA É: quais registros o arquivo tem, quantos campos cada um tem, e de onde
// o dado de cada um sairia neste sistema. É o suficiente para o pré-check
// responder "o que falta para gerar".
//
// ELA NÃO É: o layout de serialização. Ordem, tipo, tamanho, decimais e
// obrigatoriedade de cada campo saem do Guia Prático da versão que o arquivo
// declara (COD_VER 020), e sem eles não se escreve o gerador. Um arquivo
// observado diz quantos campos existem; não diz qual campo é qual, nem o que a
// norma exige em cada um.
//
// Por isso `campos` está aqui como CONFERÊNCIA, e não como especificação:
// quando o gerador existir, a contagem que ele produzir tem de bater com a que
// o sistema antigo produzia, registro por registro. Bater não prova que está
// certo; não bater prova que está errado.
//
// O ARQUIVO FOI EMBORA depois da leitura — ele saiu de `Downloads` entre duas
// execuções do script de análise, e a extração das descrições de unidade do
// 0190 (33 delas, que resolveriam a pendência do 0190) não chegou a acontecer.
// O que está registrado aqui é o que foi lido antes disso.

// Os valores que o arquivo de agosto DECLARA no registro 0000. Ficam aqui
// porque o pré-check os usa como referência: quando o estabelecimento for
// cadastrado, é contra estes valores que a conferência se faz.
const OBSERVADO_0000 = {
  codVer: '020',      // campo 02 — a versão do layout
  codFin: '0',        // campo 03 — 0 = remessa do arquivo original
  uf: 'SC',           // campo 09
  codMun: '4208906',  // campo 11 — Joinville
  indPerfil: 'B',     // campo 14 — o perfil de apresentação
  indAtiv: '1'        // campo 15 — 1 = outros (NÃO industrial)
};

// Outros valores observados, úteis como conferência e como aviso.
const OBSERVADO = {
  linhas: 2176,
  bytes: 288754,
  // MEDIDO em 01/10/2026 nos dez arquivos (dez/2025 a set/2026): todos decodificam
  // como UTF-8 estrito, nenhum tem CR. O Guia pede ISO 8859-1, e é isso que o
  // gerador escreve (lib/sped-gerador.js); o sistema antigo não seguia.
  codificacao: 'utf-8',
  // C100 campo 05 (COD_MOD): o arquivo tem 55 E 65. NFC-e entra na mesma
  // escrituração, e `nfe` já tem `emite_nfce` no estabelecimento.
  modelos: ['55', '65'],
  // C100 campo 06 (COD_SIT): só regular e cancelado apareceram.
  situacoes: ['00', '02'],
  // 0200 campo 07 (TIPO_ITEM): cinco tipos distintos. Aqui
  // `products.tipo_produto_fiscal` só tem 'NORMAL' em todas as 5.475 linhas.
  tiposDeItem: ['00', '07', '08', '10', '99'],
  // Blocos que o arquivo declara SEM DADOS (IND_MOV = 1). Só estes dois foram
  // lidos; G, H, K e 1 aparecem no arquivo e o valor do indicador deles não
  // chegou a ser impresso antes de o arquivo sair de Downloads — então não são
  // afirmados aqui.
  blocosVaziosObservados: ['B', 'D']
};

/**
 * OS REGISTROS, na ordem em que apareceram no arquivo.
 *
 * `fonte` é o que responde a pergunta do pré-check: de onde, NESTE sistema,
 * sairia o dado deste registro. `null` quer dizer que não sai de lugar nenhum —
 * e são esses que o pré-check precisa gritar, porque são trabalho que ninguém
 * sabe que existe.
 */
const REGISTROS = [
  { reg: '0000', bloco: '0', campos: 15, nome: 'Abertura e identificação do estabelecimento', fonte: 'estabelecimento' },
  { reg: '0001', bloco: '0', campos: 2, nome: 'Abertura do Bloco 0', fonte: 'gerador' },
  { reg: '0005', bloco: '0', campos: 10, nome: 'Dados complementares do estabelecimento', fonte: 'estabelecimento' },
  { reg: '0100', bloco: '0', campos: 14, nome: 'Contabilista', fonte: null },
  { reg: '0150', bloco: '0', campos: 13, nome: 'Cadastro dos participantes', fonte: 'fiscal_participantes' },
  { reg: '0190', bloco: '0', campos: 3, nome: 'Unidades de medida', fonte: 'fiscal_unidades' },
  { reg: '0200', bloco: '0', campos: 13, nome: 'Cadastro dos itens', fonte: 'produto_fiscal' },
  { reg: '0450', bloco: '0', campos: 3, nome: 'Tabela de observações do lançamento fiscal', fonte: null },
  { reg: '0990', bloco: '0', campos: 2, nome: 'Encerramento do Bloco 0', fonte: 'gerador' },

  { reg: 'B001', bloco: 'B', campos: 2, nome: 'Abertura do Bloco B (ISS)', fonte: 'gerador' },
  { reg: 'B990', bloco: 'B', campos: 2, nome: 'Encerramento do Bloco B', fonte: 'gerador' },

  { reg: 'C001', bloco: 'C', campos: 2, nome: 'Abertura do Bloco C', fonte: 'gerador' },
  { reg: 'C100', bloco: 'C', campos: 29, nome: 'Nota fiscal (modelos 55 e 65)', fonte: 'fiscal_documentos' },
  { reg: 'C110', bloco: 'C', campos: 3, nome: 'Observação do lançamento fiscal', fonte: null },
  { reg: 'C170', bloco: 'C', campos: 38, nome: 'Itens do documento', fonte: 'fiscal_documento_itens' },
  // fonte era `null` até 30/09/2026 ("não sai de lugar nenhum daqui"). Deixou
  // de ser: a agregação está em lib/sped-apuracao.js (`linhasC190`) e o dado
  // vem de fiscal_documento_itens + fiscal_item_tributos, que a fase DK criou.
  // O E110 continua `null` porque duas entradas dele — saldo credor do período
  // anterior e ajustes — não têm onde morar.
  { reg: 'C190', bloco: 'C', campos: 12, nome: 'Registro analítico (CST x CFOP x alíquota)', fonte: 'fiscal_documento_itens' },
  { reg: 'C990', bloco: 'C', campos: 2, nome: 'Encerramento do Bloco C', fonte: 'gerador' },

  { reg: 'D001', bloco: 'D', campos: 2, nome: 'Abertura do Bloco D (serviços de transporte)', fonte: 'gerador' },
  { reg: 'D990', bloco: 'D', campos: 2, nome: 'Encerramento do Bloco D', fonte: 'gerador' },

  { reg: 'E001', bloco: 'E', campos: 2, nome: 'Abertura do Bloco E', fonte: 'gerador' },
  { reg: 'E100', bloco: 'E', campos: 3, nome: 'Período de apuração do ICMS', fonte: 'gerador' },
  { reg: 'E110', bloco: 'E', campos: 15, nome: 'Apuração do ICMS — operações próprias', fonte: null },
  { reg: 'E116', bloco: 'E', campos: 10, nome: 'Obrigações do ICMS a recolher', fonte: null },
  { reg: 'E200', bloco: 'E', campos: 4, nome: 'Período de apuração do ICMS-ST', fonte: null },
  { reg: 'E210', bloco: 'E', campos: 15, nome: 'Apuração do ICMS-ST', fonte: null },
  { reg: 'E250', bloco: 'E', campos: 10, nome: 'Obrigações do ICMS-ST a recolher', fonte: null },
  { reg: 'E990', bloco: 'E', campos: 2, nome: 'Encerramento do Bloco E', fonte: 'gerador' },

  { reg: 'G001', bloco: 'G', campos: 2, nome: 'Abertura do Bloco G (CIAP)', fonte: 'gerador' },
  { reg: 'G990', bloco: 'G', campos: 2, nome: 'Encerramento do Bloco G', fonte: 'gerador' },

  { reg: 'H001', bloco: 'H', campos: 2, nome: 'Abertura do Bloco H (inventário)', fonte: 'gerador' },
  { reg: 'H990', bloco: 'H', campos: 2, nome: 'Encerramento do Bloco H', fonte: 'gerador' },

  { reg: 'K001', bloco: 'K', campos: 2, nome: 'Abertura do Bloco K (produção e estoque)', fonte: 'gerador' },
  { reg: 'K990', bloco: 'K', campos: 2, nome: 'Encerramento do Bloco K', fonte: 'gerador' },

  { reg: '1001', bloco: '1', campos: 2, nome: 'Abertura do Bloco 1', fonte: 'gerador' },
  { reg: '1010', bloco: '1', campos: 14, nome: 'Obrigatoriedade de registros do Bloco 1', fonte: null },
  { reg: '1990', bloco: '1', campos: 2, nome: 'Encerramento do Bloco 1', fonte: 'gerador' },

  { reg: '9001', bloco: '9', campos: 2, nome: 'Abertura do Bloco 9', fonte: 'gerador' },
  { reg: '9900', bloco: '9', campos: 3, nome: 'Registros do arquivo', fonte: 'gerador' },
  { reg: '9990', bloco: '9', campos: 2, nome: 'Encerramento do Bloco 9', fonte: 'gerador' },
  { reg: '9999', bloco: '9', campos: 2, nome: 'Encerramento do arquivo', fonte: 'gerador' }
];

// Quantas linhas de cada registro o arquivo de agosto teve. Serve de ORDEM DE
// GRANDEZA no pré-check: "298 registros 0450 em agosto, e aqui não há de onde
// tirar nenhum" diz mais que "0450 não tem fonte".
const LINHAS_EM_AGOSTO = {
  '0000': 1, '0001': 1, '0005': 1, '0100': 1, '0150': 179, '0190': 33, '0200': 263,
  '0450': 298, '0990': 1,
  B001: 1, B990: 1,
  C001: 1, C100: 311, C110: 298, C170: 352, C190: 333, C990: 1,
  D001: 1, D990: 1,
  E001: 1, E100: 1, E110: 1, E116: 26, E200: 6, E210: 6, E250: 4, E990: 1,
  G001: 1, G990: 1, H001: 1, H990: 1, K001: 1, K990: 1,
  1001: 1, 1010: 1, 1990: 1,
  9001: 1, 9900: 40, 9990: 1, 9999: 1
};

/** Os registros de um bloco, na ordem do arquivo. */
function doBloco(bloco) {
  return REGISTROS.filter((r) => r.bloco === bloco);
}

/** Os blocos, na ordem em que o arquivo os escreve. */
function blocos() {
  const vistos = [];
  for (const r of REGISTROS) if (!vistos.includes(r.bloco)) vistos.push(r.bloco);
  return vistos;
}

/**
 * Os registros que NÃO têm fonte neste sistema.
 *
 * É a lista mais importante deste arquivo: cada um é um trabalho que não está
 * em nenhuma fase do plano porque ninguém sabia que ele existia. O 0100
 * (contabilista) e o C190 (analítico por CST x CFOP x alíquota) só apareceram
 * porque o arquivo de verdade foi lido.
 */
function semFonte() {
  return REGISTROS.filter((r) => r.fonte === null);
}

module.exports = { REGISTROS, LINHAS_EM_AGOSTO, OBSERVADO_0000, OBSERVADO, doBloco, blocos, semFonte };
