/**
 * A CONEXÃO COM O POSTGRES — e os tipos que ela devolve.
 *
 * Este arquivo substitui o createClient() do Supabase. O que ele tem de
 * diferente de um `new Pool()` qualquer é a segunda metade: os PARSERS DE TIPO.
 *
 * POR QUE MEXER NOS PARSERS EM VEZ DE ACEITAR O PADRÃO DO DRIVER
 * --------------------------------------------------------------
 * O resto do sistema (os 15 módulos de lib/db) foi escrito contra o PostgREST,
 * que entrega tudo como JSON. O driver `pg` entrega objetos JavaScript nativos,
 * e nos poucos pontos em que os dois discordam a diferença é SILENCIOSA — o
 * dado chega, só chega diferente. Três casos, todos medidos neste schema:
 *
 *   bytea      PostgREST manda a string "\x4d5a...". O `pg` manda um Buffer.
 *              lib/db/fiscal.js faz String(row.conteudo).replace(/^\\x/,'') e
 *              lê hexadecimal — num Buffer isso vira lixo em UTF-8, e o XML da
 *              NF-e sai corrompido sem ninguém reclamar.
 *
 *   date       PostgREST manda "2026-08-31". O `pg` monta um Date na meia-noite
 *              LOCAL — que em qualquer fuso a oeste de Greenwich é o dia
 *              anterior às 21h. Vencimento de parcela andaria um dia.
 *
 *   numeric    PostgREST manda número JSON. O `pg` manda string, porque numeric
 *              não cabe em double sem perder precisão. "100.00" + 50 daria
 *              "100.0050" numa soma de valores.
 *
 * A regra deste arquivo é uma só: DEVOLVER O QUE O POSTGREST DEVOLVIA. Não é o
 * formato mais bonito — é o formato contra o qual o sistema inteiro já foi
 * escrito e testado. Mudar os dois lados de uma vez seria trocar uma migração
 * verificável por uma caçada a bug.
 *
 * O numeric vira Number aqui, então: sim, dinheiro passa por double. Isso NÃO é
 * uma regressão — é exatamente o que já acontecia com o PostgREST, e a conta
 * fiscal de verdade é feita em lib/calcularTributos.js, que arredonda a cada
 * passo. Se um dia o sistema precisar de precisão exata em repouso, o lugar de
 * resolver é lá e no schema (numeric na conta, não em double), não aqui.
 */

const { Pool, types } = require('pg');

// OIDs dos tipos do Postgres. Números fixos no catálogo do banco, não mudam
// entre versões — por isso podem ser constantes e não uma consulta.
const OID = {
  BYTEA: 17,
  INT8: 20,
  FLOAT4: 700,
  FLOAT8: 701,
  DATE: 1082,
  TIMESTAMP: 1114,
  TIMESTAMPTZ: 1184,
  NUMERIC: 1700
};

/**
 * bytea: entrega o texto cru do Postgres, que já é "\x<hex>" — o mesmo formato
 * que o PostgREST usava. Sem parser, o driver montaria um Buffer.
 */
types.setTypeParser(OID.BYTEA, (texto) => texto);

/**
 * date: string "AAAA-MM-DD", sem fuso e sem Date. Uma data de vencimento não
 * tem hora nem fuso; transformá-la em instante é inventar informação que o
 * banco não guardou, e a invenção sempre erra para o lado do dia anterior.
 */
types.setTypeParser(OID.DATE, (texto) => texto);

/**
 * timestamptz: ISO 8601 com Z, como o PostgREST. O texto cru do Postgres vem
 * como "2026-08-31 15:00:00+00" (espaço no lugar do T), que new Date() em Node
 * até aceita, mas que quebra qualquer código que corte a string. Normalizar
 * aqui deixa uma forma só circulando no sistema.
 *
 * O CONTRATO É `paraIsoPeloDate`, logo abaixo: o texto vira
 * `new Date(texto).toISOString()`, e o texto cru volta quando o Date é
 * inválido. O `paraIso` registrado no driver devolve EXATAMENTE isso para
 * qualquer texto — só chega lá por um caminho mais curto no caso comum.
 */
function paraIsoPeloDate(texto) {
  if (!texto) return texto;
  const instante = new Date(texto);
  // "infinity" e "-infinity" são timestamps válidos no Postgres e viram Invalid
  // Date. Devolver o texto cru é melhor do que devolver null: preserva o dado.
  return Number.isNaN(instante.getTime()) ? texto : instante.toISOString();
}

// ---------------------------------------------------------------------------
// O CAMINHO RÁPIDO DO timestamptz (desempenho, 07/10/2026)
//
// POR QUE EXISTE: este parser roda uma vez por CÉLULA. As rotas pesadas leem
// tabelas inteiras com `select *` — o painel converte 128 mil datas por
// requisição, o Financeiro 108 mil (created_at/updated_at de 27 mil
// lançamentos e 25 mil baixas, datas que quase nenhuma tela mostra). Medido
// nos perfis de CPU das 28 rotas mais pesadas: o `paraIsoPeloDate` era 16% de
// TODA a CPU, ~1 µs por célula, e quase todo esse tempo é do `toISOString()`
// (700 ns), não do parse. Trocar só o parse não ganhava nada — por isso a
// área do Financeiro tinha concluído que "não há parser mais rápido e exato".
// Há, se a string de saída for montada sem passar pelo Date: 98 ns por célula.
//
// POR QUE É EXATO: o caminho rápido só aceita o leiaute que o Postgres emite
// com DateStyle ISO —
//
//     AAAA-MM-DD HH:MM:SS[.f{1,6}]±HH[:MM]
//
// — com ano 1000..9999 e CAMPOS VÁLIDOS (mês 1-12, dia que existe no mês,
// bissexto gregoriano, 0-23 h, 0-59 min/s, offset até 15:59). Nesse domínio a
// conta é aritmética pura, no mesmo calendário gregoriano proléptico do Date, e
// a fração é TRUNCADA em milissegundos como o V8 faz. TUDO o que não for
// exatamente isso — infinity, BC, ano de 5 dígitos ou menor que 1000, offset
// com segundos (o LMT de datas antigas, "-03:06:28"), DateStyle diferente,
// "30 de fevereiro" que o Date "conserta", qualquer texto estranho — cai no
// `paraIsoPeloDate`, o código de antes, sem mudança.
//
// Provado antes de entrar: as 128 colunas timestamptz do banco (todos os
// valores) em 6 fusos de sessão e 3 DateStyle não-ISO, mais 1,4 milhão de
// casos sintéticos (1890-2100, viradas de dia/mês/ano, bissextos 1900/2000/
// 2100, frações de 1 a 6 dígitos, 13 fusos): zero diferenças. Os casos
// sintéticos viraram scripts/test-parser-timestamptz.js.
//
// A string sai de UM `String.fromCharCode` com os 24 códigos, e não de
// concatenação: fica plana, e o JSON.stringify da resposta não precisa achatar
// uma árvore de pedaços depois (montar + stringify: 22 ms contra 87 ms nas
// 134 mil datas do banco).
// ---------------------------------------------------------------------------
const DIAS_NO_MES = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function diasNoMes(ano, mes) {
  if (mes !== 2) return DIAS_NO_MES[mes - 1];
  return (ano % 4 === 0 && (ano % 100 !== 0 || ano % 400 === 0)) ? 29 : 28;
}

// O dígito na posição i, ou -1 se não for dígito.
function digito(texto, i) {
  const c = texto.charCodeAt(i) - 48;
  return c >= 0 && c <= 9 ? c : -1;
}

function doisDigitos(texto, i) {
  const a = digito(texto, i);
  const b = digito(texto, i + 1);
  return a < 0 || b < 0 ? -1 : a * 10 + b;
}

function paraIso(texto) {
  if (!texto) return texto;
  const n = texto.length;
  // 22 = "AAAA-MM-DD HH:MM:SS±HH"; 32 = com ".ffffff" e "±HH:MM".
  if (n < 22 || n > 32
    || texto.charCodeAt(4) !== 45 || texto.charCodeAt(7) !== 45 || texto.charCodeAt(10) !== 32
    || texto.charCodeAt(13) !== 58 || texto.charCodeAt(16) !== 58) return paraIsoPeloDate(texto);
  const y1 = digito(texto, 0); const y2 = digito(texto, 1); const y3 = digito(texto, 2); const y4 = digito(texto, 3);
  const mo1 = digito(texto, 5); const mo2 = digito(texto, 6); const d1 = digito(texto, 8); const d2 = digito(texto, 9);
  const h1 = digito(texto, 11); const h2 = digito(texto, 12); const mi1 = digito(texto, 14); const mi2 = digito(texto, 15);
  const s1 = digito(texto, 17); const s2 = digito(texto, 18);
  // y1 === 0 é ano < 1000: o Date tem regras próprias para anos curtos, e não
  // vale a pena reproduzi-las para datas que este sistema não tem.
  if ((y1 | y2 | y3 | y4 | mo1 | mo2 | d1 | d2 | h1 | h2 | mi1 | mi2 | s1 | s2) < 0 || y1 === 0) return paraIsoPeloDate(texto);
  const ano = y1 * 1000 + y2 * 100 + y3 * 10 + y4;
  const mes = mo1 * 10 + mo2; const dia = d1 * 10 + d2;
  const hora = h1 * 10 + h2; const min = mi1 * 10 + mi2; const seg = s1 * 10 + s2;
  if (mes < 1 || mes > 12 || dia < 1 || dia > diasNoMes(ano, mes) || hora > 23 || min > 59 || seg > 59) return paraIsoPeloDate(texto);

  // A fração: o Postgres manda até 6 dígitos (microssegundos) e o Date guarda
  // milissegundos, TRUNCANDO o resto — ".999999" vira ".999", não ".000" do
  // segundo seguinte. Por isso só os três primeiros dígitos contam.
  let i = 19; let f1 = 0; let f2 = 0; let f3 = 0;
  if (texto.charCodeAt(19) === 46) {
    i = 20; let quantos = 0;
    while (i < n) {
      const c = digito(texto, i);
      if (c < 0) break;
      if (quantos === 0) f1 = c; else if (quantos === 1) f2 = c; else if (quantos === 2) f3 = c;
      quantos += 1; i += 1;
    }
    if (quantos === 0 || quantos > 6) return paraIsoPeloDate(texto);
  }
  const sinal = texto.charCodeAt(i);
  if (sinal !== 43 && sinal !== 45) return paraIsoPeloDate(texto);
  const resto = n - i - 1;
  let oh; let om = 0;
  if (resto === 2) {
    oh = doisDigitos(texto, i + 1);
  } else if (resto === 5 && texto.charCodeAt(i + 3) === 58) {
    oh = doisDigitos(texto, i + 1); om = doisDigitos(texto, i + 4);
  } else return paraIsoPeloDate(texto); // ±HH:MM:SS (LMT) e lixo
  if (oh < 0 || om < 0 || oh > 15 || om > 59) return paraIsoPeloDate(texto);

  // O caso de quase todas as células: offset de hora cheia que não cruza a
  // meia-noite (no banco real, 95 de 134.802 cruzam). Data, minuto, segundo e
  // fração são os do texto; só a hora muda.
  if (om === 0) {
    const h = sinal === 45 ? hora + oh : hora - oh;
    if (h >= 0 && h < 24) {
      return String.fromCharCode(48 + y1, 48 + y2, 48 + y3, 48 + y4, 45, 48 + mo1, 48 + mo2, 45, 48 + d1, 48 + d2, 84,
        48 + ((h / 10) | 0), 48 + (h % 10), 58, 48 + mi1, 48 + mi2, 58, 48 + s1, 48 + s2, 46, 48 + f1, 48 + f2, 48 + f3, 90);
    }
  }
  // Cruzou o dia (ou offset de meia hora): o instante em ms pelo Date.UTC, que
  // é barato, e a decomposição em data civil por aritmética inteira — o
  // algoritmo "civil_from_days" de Howard Hinnant, no mesmo calendário
  // gregoriano proléptico do Date.
  const offsetMs = (oh * 60 + om) * 60000;
  const utc = Date.UTC(ano, mes - 1, dia, hora, min, seg, f1 * 100 + f2 * 10 + f3) + (sinal === 45 ? offsetMs : -offsetMs);
  const dias = Math.floor(utc / 86400000);
  let r = utc - dias * 86400000;
  const H = Math.floor(r / 3600000); r -= H * 3600000;
  const M = Math.floor(r / 60000); r -= M * 60000;
  const S = Math.floor(r / 1000); const MS = r - S * 1000;
  const z = dias + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const D = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const MO = mp < 10 ? mp + 3 : mp - 9;
  const Y = yoe + era * 400 + (MO <= 2 ? 1 : 0);
  // Saiu de 1000..9999 com o offset (1000-01-01 00:00+14, 9999-12-31 23:00-12):
  // o toISOString escreve o ano estendido ("+010000"), e quem sabe fazer isso
  // é ele.
  if (Y < 1000 || Y > 9999) return new Date(utc).toISOString();
  return String.fromCharCode(48 + ((Y / 1000) | 0), 48 + (((Y / 100) | 0) % 10), 48 + (((Y / 10) | 0) % 10), 48 + (Y % 10), 45,
    48 + ((MO / 10) | 0), 48 + (MO % 10), 45, 48 + ((D / 10) | 0), 48 + (D % 10), 84,
    48 + ((H / 10) | 0), 48 + (H % 10), 58, 48 + ((M / 10) | 0), 48 + (M % 10), 58, 48 + ((S / 10) | 0), 48 + (S % 10), 46,
    48 + ((MS / 100) | 0), 48 + (((MS / 10) | 0) % 10), 48 + (MS % 10), 90);
}
types.setTypeParser(OID.TIMESTAMPTZ, paraIso);

/**
 * timestamp (sem fuso): hoje o schema não tem nenhuma coluna assim — foi
 * conferido. O parser existe para o dia em que alguém criar uma: sem ele, essa
 * coluna sairia como Date e reintroduziria o problema do date. Aqui NÃO se
 * converte para UTC, porque não há fuso para converter: só troca o espaço pelo
 * T e mantém o que o banco guardou.
 */
types.setTypeParser(OID.TIMESTAMP, (texto) => (texto ? String(texto).replace(' ', 'T') : texto));

/**
 * numeric / int8: número, como no JSON do PostgREST. Ver o cabeçalho sobre
 * precisão — a escolha é deliberada e mantém o comportamento de hoje.
 */
const paraNumero = (texto) => (texto === null ? null : Number(texto));
types.setTypeParser(OID.NUMERIC, paraNumero);
types.setTypeParser(OID.INT8, paraNumero);

// Os mesmos parsers valem para as versões em ARRAY dos tipos acima. Sem isto,
// uma coluna numeric[] voltaria com strings dentro enquanto numeric volta com
// números — a incoerência mais difícil de achar que existe.
const OID_ARRAY = { 1001: OID.BYTEA, 1016: OID.INT8, 1182: OID.DATE, 1115: OID.TIMESTAMP, 1185: OID.TIMESTAMPTZ, 1231: OID.NUMERIC };
for (const [oidArray, oidElemento] of Object.entries(OID_ARRAY)) {
  const parseElemento = types.getTypeParser(Number(oidElemento));
  const parseArrayPadrao = types.getTypeParser(Number(oidArray));
  types.setTypeParser(Number(oidArray), (texto) => {
    const lista = parseArrayPadrao(texto);
    return Array.isArray(lista) ? lista.map((item) => (item === null ? null : parseElemento(String(item)))) : lista;
  });
}

/**
 * A URL de conexão. Uma variável só, no formato que todo mundo entende
 * (psql, pg_dump, Portainer), em vez do par URL + chave do Supabase.
 */
function urlDoBanco() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'DATABASE_URL precisa estar definida nas variáveis de ambiente (veja .env.example).\n' +
      'Para o Postgres em Docker deste repositório, o valor é:\n' +
      '  DATABASE_URL=postgres://mavisone:mavisone@localhost:5432/mavisone'
    );
  }
  return url;
}

let pool = null;

/**
 * O pool é PREGUIÇOSO de propósito: criado na primeira consulta, não no
 * require. Vários scripts do repositório carregam lib/db só para ler o
 * código-fonte (os testes puros fazem exatamente isso) e não devem exigir banco
 * no ar nem DATABASE_URL definida só para serem carregados.
 */
function obterPool() {
  if (pool) return pool;
  pool = new Pool({
    connectionString: urlDoBanco(),
    // O servidor é um processo Node só, com dezenas de rotas curtas. 10 conexões
    // sobram; o padrão do driver também é 10, está explícito para quem for
    // ajustar na VPS saber onde mexer.
    max: Number(process.env.DATABASE_POOL_MAX || 10),
    idleTimeoutMillis: 30000,
    // Sem isto, uma queda de rede deixa o processo pendurado para sempre numa
    // consulta. 10s é folgado para consulta local e curto para dar erro legível.
    connectionTimeoutMillis: Number(process.env.DATABASE_TIMEOUT_MS || 10000),
    // O TETO DA CONSULTA — e por que o de cima não bastava (fase DF).
    //
    // `connectionTimeoutMillis` limita PEGAR uma conexão, e não o tempo que a
    // consulta leva depois de pegá-la. Uma consulta que nunca volta — banco
    // sobrecarregado, lock esperando outra transação, índice faltando numa
    // tabela que cresceu — segurava a conexão para sempre. Dez delas assim e o
    // pool acaba: daí em diante TODA requisição fica na fila do
    // `connectionTimeoutMillis`, leva 10s e responde erro. O sistema inteiro
    // para por causa de uma consulta, e nada no log diz qual.
    //
    // Com `statement_timeout`, o Postgres cancela a consulta e devolve um erro
    // nomeando o comando. A conexão volta ao pool, as outras requisições
    // seguem, e quem investiga tem o SQL culpado em mãos.
    //
    // 30s é escolhido com medição, não por gosto: a consulta mais lenta deste
    // sistema é o `select *` dos 14.864 pedidos, entre 320 e 600 ms conforme a
    // concorrência. 30s dá cinquenta vezes de folga sobre o pior caso real —
    // curto o bastante para a conexão voltar, longo o bastante para nunca
    // interromper trabalho legítimo. A VPS ajusta pela variável.
    //
    // QUEM PRECISA DE MAIS pede na própria transação, com `set local` — é o que
    // scripts/aplicar-migracoes.js faz, porque criar índice em tabela grande
    // pode passar de 30s e migração interrompida no meio é exatamente o que
    // aquele script existe para evitar. A isenção fica visível lá, e não
    // escondida num teto global generoso demais para servir de teto.
    statement_timeout: Number(process.env.DATABASE_STATEMENT_TIMEOUT_MS || 30000),
    // E O TETO DO DRIVER, porque o de cima não cobre banco CONGELADO.
    //
    // `statement_timeout` é imposto pelo Postgres: é ELE que aborta a consulta e
    // devolve o erro. Se o Postgres não está rodando — container pausado, máquina
    // travada, rede que engole pacote sem fechar o socket — não há quem aborte, e
    // a consulta fica pendurada com o teto configurado e tudo.
    //
    // Medido em 28/09/2026, com `docker pause` no container e uma conexão JÁ
    // OCIOSA no pool (o caso ruim: numa conexão nova o connectionTimeoutMillis
    // pegaria): teto de 2s configurado, e a consulta passou de 15s sem resposta
    // até eu desistir de esperar. É o mesmo sintoma de 16/09, quando o achado
    // nasceu — o teto do banco sozinho não o fecha.
    //
    // 35s, ACIMA dos 30s do banco, e a ordem é de propósito: com o banco vivo,
    // quem cancela é o Postgres, que devolve o comando culpado e o código 57014.
    // Este aqui só entra quando não há ninguém do outro lado para perguntar, e
    // então o erro é genérico ("Query read timeout") porque não há o que saber.
    // Invertida, a ordem trocaria todo erro bom por um erro genérico.
    query_timeout: Number(process.env.DATABASE_QUERY_TIMEOUT_MS || 35000),
    // O JIT DO POSTGRES DESLIGADO NAS CONEXÕES DO SISTEMA (desempenho, 07/10/2026).
    //
    // O JIT compila a consulta em código de máquina quando o custo ESTIMADO do
    // plano passa de 100 mil. Neste sistema, quem passa são os relatórios do
    // catálogo — e passam por estimativa errada, não por volume: o
    // `jsonb_array_elements(o.items)` é estimado em 100 linhas por pedido (são
    // ~1), e 13 mil pedidos viram "800 mil itens". A compilação custava mais
    // que a consulta inteira. Medido em A/B intercalado, mesma conexão:
    //
    //   condensado por produto .... 904 ms -> 135 ms   (compilação: 1,5 s)
    //   ranking de produtos ....... 715 ms -> 210 ms
    //   rentabilidade por produto . 626 ms -> 109 ms
    //   limite de crédito ......... 392 ms ->   9 ms
    //
    // Nenhuma consulta ficou mais rápida COM o JIT. Fora dos relatórios ele
    // nunca liga: as 145 consultas distintas das 111 rotas GET têm custo máximo
    // de 12.661 (o select * dos lançamentos), oito vezes abaixo do limiar —
    // desligar ali não muda nada, nem para melhor nem para pior.
    //
    // E não muda resultado: o JIT troca COMO a expressão é executada, nunca o
    // que ela devolve (as 12 consultas afetadas devolveram as mesmas linhas, na
    // mesma ordem, com ele ligado e desligado).
    //
    // `options` vai no pacote de início da conexão — é o mesmo mecanismo do
    // PGOPTIONS. A variável existe para a VPS poder religar ou acrescentar
    // outra opção sem mexer em código; ela SUBSTITUI o padrão, então quem a
    // definir e quiser manter o JIT desligado escreve o `-c jit=off` junto.
    // Atenção: um `?options=` dentro da DATABASE_URL tem precedência sobre isto
    // (o driver lê a URL por último).
    options: process.env.DATABASE_PG_OPTIONS || '-c jit=off'
  });
  // Um erro num cliente ocioso do pool é evento, não exceção: sem este
  // ouvinte, o Node derruba o processo inteiro quando o banco reinicia.
  pool.on('error', (erro) => {
    console.error('[banco] conexão ociosa caiu:', erro.message);
  });
  return pool;
}

// ---------------------------------------------------------------------------
// A CARONA EM LEITURA IDÊNTICA QUE JÁ ESTÁ EM VOO (desempenho, 07/10/2026)
//
// O PROBLEMA: o navegador abre o sistema disparando painel, gráficos e sino
// (duas vezes) ao mesmo tempo, e cada rota faz as SUAS leituras inteiras. O
// mesmo `select *` dos 27 mil lançamentos saía três vezes AO MESMO TEMPO, idem
// baixas, pedidos e produtos: ~295 mil linhas parseadas no event loop para
// responder quatro requisições que precisavam de UMA leitura de cada. Medido
// (mediana de 6 rodadas intercaladas): a abertura levava 3,6 s, o event loop
// ficava travado até 1,2 s, e o `/api/me` de outra pessoa esperava 1,8 s.
//
// O QUE ISTO FAZ: quando uma leitura chega e uma IDÊNTICA (mesmo SQL, mesmos
// parâmetros) já está em voo, ela espera a mesma ida ao banco em vez de abrir
// outra. É a "promessa compartilhada" que o lerComCache (lib/db/cadastros.js)
// já usa — sem o cache: quando a consulta volta, o voo é apagado e NADA fica
// guardado. A pergunta seguinte, mesmo um milissegundo depois, vai ao banco.
//
// AS QUATRO REGRAS QUE MANTÊM O RESULTADO IGUAL
//
// 1. Só o SELECT do construtor (`banco.from(...).select(...)`, em
//    lib/db/consulta.js) pega carona. A gramática dele não tem função com
//    efeito nem escrita: colunas, filtros, ordem, limite. SQL cru — sessão,
//    `rpc('next_cadastro_code')`, o `nextval` do número do lançamento,
//    relatórios — passa direto pelo `consultar`, como sempre passou.
//    E o mesmo SQL devolve o mesmo para QUALQUER usuário porque toda conexão
//    do pool é a mesma (uma DATABASE_URL, nenhum `set_config`/`set role` por
//    usuário): o escopo de vendedor e a permissão entram como filtro no SQL
//    (parâmetro diferente = chave diferente) ou são aplicados depois, pela rota,
//    sobre linhas que já são só dela. No dia em que a conexão passar a carregar
//    o usuário (RLS por sessão), a chave da carona tem de passar a carregá-lo
//    também.
//
// 2. GERAÇÃO DE ESCRITA: todo comando do `consultar` que pode mudar dado (não
//    começa com SELECT, ou chama nextval/setval/função no FROM, ou trava linha
//    com FOR UPDATE) e todo fim de `emTransacao` incrementam a geração AO
//    TERMINAR — antes de quem gravou receber a resposta. A geração entra na
//    chave da carona: quem lê depois que uma gravação deste processo terminou
//    nunca pega carona numa leitura que saiu antes dela. Gravou e releu, vê o
//    que gravou. Na dúvida a classificação diz "escrita", que só custa uma
//    carona perdida.
//
// 3. CADA UM RECEBE LINHAS PRÓPRIAS. Quem saiu primeiro recebe o resultado do
//    driver; cada carona recebe uma CÓPIA — linha nova e cada valor json/jsonb
//    ou array copiado em profundidade —, feita antes de qualquer rota continuar.
//    Um `sort()` no lugar ou um `linha.x = y` numa rota não aparece na outra.
//    A cópia só é exata para o que o driver devolve hoje: primitivos, arrays e
//    objetos simples de JSON (os parsers acima transformam date, timestamptz,
//    bytea e numeric em texto/número). Se algum dia uma coluna chegar como
//    OUTRA classe (interval, point, Date), a cópia recusa e cada carona vai ao
//    banco sozinha, como antes — nunca entrega um objeto compartilhado.
//
// 4. JANELA CURTA: só se pega carona em voo que saiu há no máximo
//    DATABASE_CARONA_MAX_MS (padrão 100 ms; zero desliga). A geração cobre as
//    gravações DESTE processo; o teto cobre as de fora (um script de importação
//    gravando direto no banco): quem pega carona vê a foto do banco de no
//    máximo 100 ms antes de chegar — a mesma que veria se tivesse chegado 100
//    ms antes. Nas rajadas medidas, toda carona pegou voo com ≤ 7 ms de idade
//    (o navegador dispara junto, e cada rota lê logo depois do portão), então
//    o teto não custa ganho.
//
// ERRO: se a leitura líder falha (queda de conexão, statement_timeout), quem
// pegou carona recebe o mesmo erro — sozinho teria tentado a sua, quase sempre
// com o mesmo destino. A tela já trata erro de rede.
//
// GANHO MEDIDO (A/B intercalado, mediana de 6, junto com o parser rápido de
// timestamptz): abertura 3.575 -> 1.456 ms, event loop máx. 1.249 -> 386 ms,
// `/api/me` de terceiro 1.849 -> 263 ms; três vendedores no Meu Painel 1.666 ->
// 723 ms; duas pessoas em Lançamentos 2.593 -> 1.063 ms. E o pico de memória da
// primeira abertura cai ~20%: as caronas compartilham as strings (imutáveis)
// em vez de montar quatro cópias das mesmas 53 mil linhas.
// ---------------------------------------------------------------------------
let geracaoDeEscrita = 0;
const leiturasEmVoo = new Map();
let tetoDaCaronaMs = null;

function tetoDaCarona() {
  // Lido na primeira leitura, e não no require: o server.js carrega o .env
  // depois de alguns requires, pelo mesmo motivo do pool ser preguiçoso.
  if (tetoDaCaronaMs === null) {
    const valor = Number(process.env.DATABASE_CARONA_MAX_MS);
    tetoDaCaronaMs = process.env.DATABASE_CARONA_MAX_MS !== undefined && process.env.DATABASE_CARONA_MAX_MS !== '' && Number.isFinite(valor) && valor >= 0
      ? valor
      : 100;
  }
  return tetoDaCaronaMs;
}

/**
 * O comando pode mudar dado (ou sequência)? Conservador: tudo o que não é um
 * SELECT simples conta como escrita. `with ... insert`, `update ... returning`,
 * `select nextval(...)`, `select * from "next_cadastro_code"()` e
 * `select ... for update` são escrita; um `select` comum, não.
 */
function podeMudarDado(sql) {
  if (typeof sql !== 'string') return true;
  if (!/^\s*select\b/i.test(sql)) return true;
  return /\b(nextval|setval|pg_advisory\w*|set_config|pg_notify)\s*\(|\bfrom\s+"?[a-z_][a-z0-9_]*"?\s*\(|\bfor\s+(update|share|no\s+key\s+update|key\s+share)\b/i.test(sql);
}

async function consultar(sql, parametros) {
  const escreve = podeMudarDado(sql);
  try {
    return await obterPool().query(sql, parametros);
  } finally {
    // No finally, e não só no sucesso: uma escrita que deu erro pode ter
    // gravado parte (ou o erro pode ter vindo depois do COMMIT implícito).
    if (escreve) geracaoDeEscrita += 1;
  }
}

/**
 * Parâmetros que viram a MESMA chave só quando o driver os manda iguais:
 * texto, booleano, null, número finito e arrays deles. NaN e Infinity ficam de
 * fora porque o JSON os escreve como null (o driver não); Date, Buffer e objeto
 * ficam de fora por não terem uma forma JSON única. Fora disso, sem carona.
 */
function parametroSimples(valor) {
  if (valor === null) return true;
  const tipo = typeof valor;
  if (tipo === 'string' || tipo === 'boolean') return true;
  if (tipo === 'number') return Number.isFinite(valor);
  if (Array.isArray(valor)) return valor.every(parametroSimples);
  return false;
}

// Marca de "não sei copiar isto": a cópia desiste e as caronas vão ao banco.
const NAO_COPIAVEL = Symbol('nao-copiavel');

function copiarValorJson(valor) {
  if (valor === null || typeof valor !== 'object') return valor;
  if (Array.isArray(valor)) {
    const copia = new Array(valor.length);
    for (let i = 0; i < valor.length; i += 1) copia[i] = copiarValorJson(valor[i]);
    return copia;
  }
  const prototipo = Object.getPrototypeOf(valor);
  if (prototipo !== Object.prototype && prototipo !== null) throw NAO_COPIAVEL;
  const copia = {};
  for (const chave of Object.keys(valor)) {
    // JSON.parse cria "__proto__" como propriedade PRÓPRIA; uma atribuição
    // comum trocaria o protótipo da cópia em vez de copiar o dado.
    if (chave === '__proto__') {
      Object.defineProperty(copia, chave, { value: copiarValorJson(valor[chave]), enumerable: true, writable: true, configurable: true });
    } else {
      copia[chave] = copiarValorJson(valor[chave]);
    }
  }
  return copia;
}

/** As linhas, cada uma nova, com todo valor não primitivo copiado. Ou null. */
function copiarLinhas(linhas) {
  try {
    const copias = new Array(linhas.length);
    for (let i = 0; i < linhas.length; i += 1) {
      const copia = { ...linhas[i] };
      for (const coluna in copia) {
        const valor = copia[coluna];
        if (valor !== null && typeof valor === 'object') copia[coluna] = copiarValorJson(valor);
      }
      copias[i] = copia;
    }
    return copias;
  } catch (erro) {
    if (erro === NAO_COPIAVEL) return null;
    throw erro;
  }
}

/**
 * A leitura que aceita carona. Só para o SELECT do construtor (ver a regra 1
 * acima); qualquer outro SQL usa `consultar`.
 */
function consultarLeitura(sql, parametros) {
  const teto = tetoDaCarona();
  const lista = parametros || [];
  if (!(teto > 0) || !Array.isArray(lista) || !lista.every(parametroSimples)) return consultar(sql, parametros);

  const chave = `${geracaoDeEscrita}\u0000${sql}\u0000${JSON.stringify(lista)}`;
  const agora = performance.now();
  const voo = leiturasEmVoo.get(chave);
  if (voo && agora - voo.saiuEm <= teto) {
    return new Promise((resolver, rejeitar) => voo.caronas.push({ resolver, rejeitar }));
  }

  // Sem voo (ou voo velho demais para a janela): esta leitura sai, e passa a
  // ser o voo de quem chegar logo depois.
  const entrada = { saiuEm: agora, caronas: [] };
  leiturasEmVoo.set(chave, entrada);
  const largar = () => {
    // Só apaga se ainda é ESTE voo: um voo velho que termina depois de outro
    // ter tomado o lugar dele não pode apagar o novo.
    if (leiturasEmVoo.get(chave) === entrada) leiturasEmVoo.delete(chave);
  };
  return consultar(sql, parametros).then((resultado) => {
    largar();
    if (entrada.caronas.length) {
      for (const carona of entrada.caronas) {
        const linhas = copiarLinhas(resultado.rows || []);
        if (linhas === null) {
          // Uma classe que a cópia não conhece: cada carona faz a sua leitura,
          // exatamente como faria sem este mecanismo.
          consultar(sql, parametros).then(carona.resolver, carona.rejeitar);
        } else {
          carona.resolver({ ...resultado, rows: linhas });
        }
      }
    }
    return resultado;
  }, (erro) => {
    largar();
    for (const carona of entrada.caronas) carona.rejeitar(erro);
    throw erro;
  });
}

/**
 * TUDO OU NADA — a garantia que este repositorio nao tinha.
 *
 * `consultar()` pega uma conexao do pool, roda UM comando e devolve a conexao.
 * Duas chamadas seguidas sao duas transacoes independentes: se a segunda
 * falhar, a primeira ja esta gravada e nao volta atras.
 *
 * Enquanto o razao de estoque morava no db.json isso passava despercebido: uma
 * transferencia gravava dois movimentos e um registro num `writeFileSync` so, e
 * era atomica POR ACIDENTE — atomica porque era um arquivo, nao porque alguem
 * garantiu. Em SQL vira tres INSERTs, e sem BEGIN a transferencia pode ficar
 * pela metade: a saida gravada e a entrada nao, com o estoque sumindo de um
 * deposito sem aparecer no outro.
 *
 * O callback recebe um `cliente` com o mesmo `.query(sql, params)` do pool, e
 * TODO comando da transacao precisa passar por ele — usar `consultar()` la
 * dentro pega OUTRA conexao, que nao esta na transacao, e o rollback nao
 * desfaz o que ela gravou.
 *
 *     await emTransacao(async (cliente) => {
 *       await cliente.query('insert into ...', [...]);
 *       await cliente.query('update ...', [...]);
 *     });
 *
 * O `release()` fica no finally porque conexao nao devolvida ao pool e o tipo
 * de vazamento que so aparece sob carga: as 10 do pool acabam, e o sistema
 * inteiro para de responder esperando conexao que nunca volta.
 */
async function emTransacao(callback) {
  const cliente = await obterPool().connect();
  try {
    await cliente.query('BEGIN');
    const resultado = await callback(cliente);
    await cliente.query('COMMIT');
    return resultado;
  } catch (erro) {
    // O rollback tambem pode falhar (conexao ja caiu). Se falhar, o erro que
    // interessa e o ORIGINAL — o do rollback so esconderia a causa.
    try { await cliente.query('ROLLBACK'); } catch { /* conexao perdida */ }
    throw erro;
  } finally {
    cliente.release();
    // A transação terminou (gravada ou desfeita): leitura que vier depois não
    // pega carona em voo que saiu antes dela. Ver a regra 2 da carona, acima.
    geracaoDeEscrita += 1;
  }
}

async function fecharPool() {
  if (!pool) return;
  const atual = pool;
  pool = null;
  await atual.end();
}

// `paraIso` e `paraIsoPeloDate` saem para o teste (scripts/test-parser-timestamptz.js)
// conferir um contra o outro sem banco.
// `podeMudarDado` e `copiarLinhas` saem para scripts/test-carona-de-leitura.js.
module.exports = {
  obterPool, consultar, consultarLeitura, emTransacao, fecharPool, urlDoBanco, OID,
  paraIso, paraIsoPeloDate, podeMudarDado, copiarLinhas
};
