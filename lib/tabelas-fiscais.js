/**
 * LEITURA DAS TABELAS OFICIAIS DE NCM E CEST (fase DO).
 *
 * Puro: recebe o texto que a fonte publica e devolve linhas. Quem baixa e
 * grava é scripts/carregar-tabelas-ncm-cest.js; quem testa com pedaços reais
 * das duas fontes é scripts/test-tabelas-fiscais.js.
 *
 *   NCM   Portal Único Siscomex — JSON com a nomenclatura inteira (capítulos,
 *         posições, subposições e os códigos de 8 dígitos).
 *   CEST  Convênio ICMS 142/2018, página do CONFAZ — uma tabela HTML por anexo
 *         (segmento), com ITEM | CEST | NCM/SH | DESCRIÇÃO.
 */

const so = (v) => String(v ?? '').replace(/\D/g, '');

/** 'dd/mm/aaaa' -> 'aaaa-mm-dd'; '31/12/9999' (sem fim) -> null. */
function dataBr(v) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(v || '').trim());
  if (!m || m[3] === '9999') return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

/**
 * A NOMENCLATURA DO SISCOMEX.
 *
 * Os códigos de 8 dígitos ('0101.29.00') têm descrição curta ("-- Outros") que
 * sozinha não diz nada; a completa é a dos pais — posição (4), subposições (5
 * e 6) e item (7) — mais a dele.
 */
function lerNcmSiscomex(texto) {
  const json = JSON.parse(texto);
  const lista = json.Nomenclaturas || [];
  const porCodigo = new Map(lista.map((n) => [so(n.Codigo), String(n.Descricao || '').trim()]));
  // A descrição do Siscomex traz marcação ("(<i>méteil</i>)") e entidade HTML.
  const semHtml = (d) => String(d || '').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
  const limpa = (d) => semHtml(d).replace(/^[-\s]+/, '').replace(/[:.]\s*$/, '').trim();
  const itens = [];
  for (const n of lista) {
    const codigo = so(n.Codigo);
    if (codigo.length !== 8) continue;
    const partes = [];
    for (const tam of [4, 5, 6, 7]) {
      const pai = porCodigo.get(codigo.slice(0, tam));
      if (pai && !partes.includes(limpa(pai))) partes.push(limpa(pai));
    }
    const propria = limpa(n.Descricao);
    if (propria && partes[partes.length - 1] !== propria) partes.push(propria);
    itens.push({
      codigo,
      descricao: semHtml(n.Descricao),
      descricaoCompleta: partes.join(' › '),
      dataInicio: dataBr(n.Data_Inicio),
      dataFim: dataBr(n.Data_Fim)
    });
  }
  return {
    versao: [json.Data_Ultima_Atualizacao_NCM, json.Ato].filter(Boolean).join(' — '),
    itens
  };
}

/**
 * O CAMPO NCM/SH DO CONVÊNIO -> prefixos de dígitos.
 *
 * Formatos encontrados na redação vigente (01/10/2026):
 *   '8711.60.00'            o código
 *   '3917', '8714.9'        posição, subposição: prefixo
 *   'Capítulo 33'           '33'
 *   'Capítulos 13 e 15 a 23' '13', '15', '16' … '23'
 *   '8704.31.30,'           a vírgula sobra do texto
 *   '008.13', '00909'       zero a mais na frente: '0813', '0909'
 *   '' (vazio)              CEST "999 — outros": não restringe
 *
 * Token que não se encaixa em nada volta em `descartados` — só um na redação
 * vigente ('926.90.90', no CEST 20.040.00, que tem 3926.90.40 ao lado e é
 * erro de digitação do próprio convênio).
 */
function prefixosDoTexto(texto) {
  const t = String(texto || '').replace(/\s+/g, ' ').trim();
  const prefixos = [];
  const descartados = [];
  if (!t) return { prefixos, descartados };

  if (/cap[ií]tulo/i.test(t)) {
    const resto = t.replace(/cap[ií]tulos?/i, '');
    for (const faixa of resto.split(/,|\be\b/)) {
      const nums = (faixa.match(/\d+/g) || []).map(Number);
      if (/\ba\b/.test(faixa) && nums.length === 2) {
        for (let c = nums[0]; c <= nums[1]; c += 1) prefixos.push(String(c).padStart(2, '0'));
      } else {
        for (const c of nums) prefixos.push(String(c).padStart(2, '0'));
      }
    }
    return { prefixos: [...new Set(prefixos)], descartados };
  }

  for (const bruto of t.split(' ')) {
    const token = bruto.replace(/[,;]+$/, '');
    if (!token) continue;
    let d = so(token);
    const primeiroGrupo = token.split('.')[0];
    if (primeiroGrupo.length === 3 || (d.length === 5 && !token.includes('.'))) {
      // '008.13' e '00909': o zero a mais na frente. Sem ele (926.90.90) não
      // há como saber o dígito que falta.
      if (d.startsWith('00')) d = d.slice(1);
      else { descartados.push(token); continue; }
    }
    if (d.length < 2 || d.length > 8) { descartados.push(token); continue; }
    prefixos.push(d);
  }
  return { prefixos: [...new Set(prefixos)], descartados };
}

/**
 * OS ANEXOS DO CONVÊNIO 142/2018.
 *
 * A página traz a redação vigente e as anteriores, e as anteriores vêm com a
 * classe "...verde" ("Redação original, efeitos até…"). Só as vigentes entram.
 * Um CEST pode ocupar mais de uma linha (um NCM por linha): os prefixos se
 * juntam.
 */
function lerCestConfaz(html) {
  const texto = String(html);
  const limpa = (c) => c.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
  const porCest = new Map();
  const descartados = [];
  let segmentoNome = null;

  // Percorre na ordem do documento: subtítulo de anexo (o nome do segmento)
  // e linhas de tabela, para cada linha saber de qual anexo ela é.
  const pedacos = texto.match(/<p class="A6-1Subtitulo">[\s\S]*?<\/p>|<tr>[\s\S]*?<\/tr>/g) || [];
  for (const p of pedacos) {
    if (p.startsWith('<p')) {
      const t = limpa(p);
      // "(Cláusula vigésima segunda…)" também é subtítulo no HTML, no meio do
      // anexo de alimentícios: é nota, não nome de segmento.
      if (t && !/^ANEXO\b/i.test(t) && !t.startsWith('(')) segmentoNome = t;
      continue;
    }
    if (/verde/i.test(p)) continue;
    const celulas = [...p.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => limpa(m[1]));
    if (celulas.length < 4 || !/^\d{2}\.\d{3}\.\d{2}$/.test(celulas[1])) continue;
    const cest = so(celulas[1]);
    const { prefixos, descartados: fora } = prefixosDoTexto(celulas[2]);
    for (const f of fora) descartados.push(`${celulas[1]}: ${f}`);
    if (!porCest.has(cest)) {
      porCest.set(cest, { cest, segmento: cest.slice(0, 2), segmentoNome, descricao: celulas[3], ncmPrefixos: [] });
    }
    const atual = porCest.get(cest);
    for (const x of prefixos) if (!atual.ncmPrefixos.includes(x)) atual.ncmPrefixos.push(x);
  }
  return { itens: [...porCest.values()], descartados };
}

/** O CEST cobre o NCM? Lista de prefixos vazia não restringe. */
function cestCobreNcm(prefixos, ncm) {
  const n = so(ncm);
  if (!prefixos || !prefixos.length) return true;
  return prefixos.some((p) => n.startsWith(p));
}

module.exports = { lerNcmSiscomex, lerCestConfaz, prefixosDoTexto, cestCobreNcm };
