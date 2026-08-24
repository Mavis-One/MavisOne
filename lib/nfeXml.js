/**
 * LEITOR DE XML DE NF-e — o arquivo que o fornecedor manda, virado em objeto.
 *
 * POR QUE UM PARSER PRÓPRIO
 * -------------------------
 * O projeto tem três dependências (supabase-js, bcryptjs, dotenv) e nenhuma lê
 * XML. Acrescentar uma biblioteca de XML por causa de um formato que é sempre o
 * mesmo — layout 4.00 da NF-e, gerado por máquina, sem exóticos — custaria mais
 * do que as ~120 linhas abaixo, e cada dependência nova é superfície de
 * atualização e de vulnerabilidade que alguém precisa acompanhar.
 *
 * O QUE ESTE PARSER RECUSA DE PROPÓSITO
 * -------------------------------------
 * `<!DOCTYPE`. Um XML com DOCTYPE pode declarar entidades, e entidade externa é
 * o ataque clássico de XXE: o arquivo manda o servidor ler /etc/passwd, ou a
 * chave de serviço do ambiente, e devolver o conteúdo dentro de um campo da
 * nota. Entidade interna recursiva ("billion laughs") derruba o processo por
 * memória. NF-e legítima NUNCA tem DOCTYPE — a SEFAZ não emite assim. Então
 * recusar é grátis, e é a única defesa que não depende de eu prever o truque.
 *
 * As cinco entidades do XML (&amp; &lt; &gt; &quot; &apos;) e as numéricas são
 * expandidas; qualquer outra fica literal, porque não há como haver declaração
 * de entidade sem DOCTYPE.
 *
 * NAMESPACE
 * ---------
 * O prefixo é descartado (`ns2:infNFe` vira `infNFe`). NF-e usa um namespace só
 * e alguns emissores prefixam, outros não — tratar os dois como nomes
 * diferentes faria a leitura falhar dependendo de quem gerou o arquivo.
 *
 * MAIÚSCULAS IMPORTAM: `nNF` (número) e `NCM` são campos distintos e o layout é
 * case-sensitive. Nada aqui normaliza caixa.
 */

// 4 MB. Uma NF-e de 500 itens não passa de ~1,5 MB; acima disso ou não é nota
// ou é alguém tentando ocupar a memória do servidor com um arquivo só.
const LIMITE_XML_BYTES = 4 * 1024 * 1024;

function erroXml(mensagem, status = 400) {
  const err = new Error(mensagem);
  err.status = status;
  return err;
}

const ENTIDADES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodificar(texto) {
  return String(texto).replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (inteiro, corpo) => {
    if (corpo[0] === '#') {
      const codigo = corpo[1] === 'x' || corpo[1] === 'X'
        ? parseInt(corpo.slice(2), 16)
        : parseInt(corpo.slice(1), 10);
      return Number.isFinite(codigo) ? String.fromCodePoint(codigo) : inteiro;
    }
    return ENTIDADES[corpo] !== undefined ? ENTIDADES[corpo] : inteiro;
  });
}

function semPrefixo(nome) {
  const corte = nome.indexOf(':');
  return corte === -1 ? nome : nome.slice(corte + 1);
}

function lerAtributos(bruto) {
  const atributos = {};
  for (const m of bruto.matchAll(/([\w:.-]+)\s*=\s*"([^"]*)"|([\w:.-]+)\s*=\s*'([^']*)'/g)) {
    const nome = semPrefixo(m[1] || m[3]);
    atributos[nome] = decodificar(m[2] !== undefined ? m[2] : m[4]);
  }
  return atributos;
}

function novoNo(nome) {
  return { nome, atributos: {}, filhos: [], texto: '' };
}

/**
 * XML -> árvore de nós { nome, atributos, filhos, texto }.
 */
function parseXml(xml) {
  const texto = String(xml || '');
  if (Buffer.byteLength(texto, 'utf8') > LIMITE_XML_BYTES) {
    throw erroXml('O arquivo passa de 4 MB. Isso não é uma NF-e.');
  }
  if (/<!DOCTYPE/i.test(texto)) {
    // Ver o cabeçalho: entidade externa lê arquivo do servidor.
    throw erroXml('XML com DOCTYPE é recusado por segurança. NF-e da SEFAZ não tem DOCTYPE.');
  }

  const raiz = novoNo('#raiz');
  const pilha = [raiz];
  let i = 0;

  while (i < texto.length) {
    const abre = texto.indexOf('<', i);
    if (abre === -1) break;

    if (abre > i) {
      const conteudo = texto.slice(i, abre);
      if (conteudo.trim()) pilha[pilha.length - 1].texto += decodificar(conteudo);
    }

    if (texto.startsWith('<!--', abre)) {
      const fim = texto.indexOf('-->', abre);
      i = fim === -1 ? texto.length : fim + 3;
      continue;
    }
    if (texto.startsWith('<![CDATA[', abre)) {
      const fim = texto.indexOf(']]>', abre);
      const bruto = texto.slice(abre + 9, fim === -1 ? texto.length : fim);
      // CDATA é literal: não passa por decodificar().
      pilha[pilha.length - 1].texto += bruto;
      i = fim === -1 ? texto.length : fim + 3;
      continue;
    }
    if (texto.startsWith('<?', abre)) {
      const fim = texto.indexOf('?>', abre);
      i = fim === -1 ? texto.length : fim + 2;
      continue;
    }

    // Fim da tag, respeitando aspas: um atributo pode conter ">".
    let fecha = -1;
    let aspas = '';
    for (let j = abre + 1; j < texto.length; j += 1) {
      const c = texto[j];
      if (aspas) { if (c === aspas) aspas = ''; continue; }
      if (c === '"' || c === "'") { aspas = c; continue; }
      if (c === '>') { fecha = j; break; }
    }
    if (fecha === -1) throw erroXml('XML malformado: uma tag ficou sem fechar.');

    const corpo = texto.slice(abre + 1, fecha).trim();
    i = fecha + 1;

    if (corpo.startsWith('/')) {
      const nome = semPrefixo(corpo.slice(1).trim());
      // Fecha até achar a tag de mesmo nome. Emissor que erra o aninhamento
      // (existe) não deve derrubar a leitura inteira.
      for (let k = pilha.length - 1; k > 0; k -= 1) {
        if (pilha[k].nome === nome) { pilha.length = k; break; }
      }
      continue;
    }

    const autoFechada = corpo.endsWith('/');
    const limpo = autoFechada ? corpo.slice(0, -1).trim() : corpo;
    const espaco = limpo.search(/\s/);
    const nome = semPrefixo(espaco === -1 ? limpo : limpo.slice(0, espaco));
    const no = novoNo(nome);
    if (espaco !== -1) no.atributos = lerAtributos(limpo.slice(espaco + 1));

    pilha[pilha.length - 1].filhos.push(no);
    if (!autoFechada) pilha.push(no);
  }

  return raiz;
}

/** Primeiro filho de um nome, em qualquer profundidade. */
function achar(no, nome) {
  if (!no) return null;
  for (const filho of no.filhos) {
    if (filho.nome === nome) return filho;
  }
  for (const filho of no.filhos) {
    const achado = achar(filho, nome);
    if (achado) return achado;
  }
  return null;
}

/** Filhos diretos de um nome. */
function filhos(no, nome) {
  if (!no) return [];
  return no.filhos.filter((filho) => filho.nome === nome);
}

/** Texto de um caminho relativo ("enderEmit/xLgr"), '' se faltar. */
function txt(no, caminho) {
  let atual = no;
  for (const parte of String(caminho || '').split('/').filter(Boolean)) {
    if (!atual) return '';
    atual = atual.filhos.find((filho) => filho.nome === parte) || null;
  }
  return atual ? atual.texto.trim() : '';
}

/** Número de um caminho; 0 quando ausente (o layout omite campo zerado). */
function num(no, caminho) {
  const valor = txt(no, caminho);
  if (valor === '') return 0;
  const n = Number(valor);
  return Number.isFinite(n) ? n : 0;
}

module.exports = { parseXml, achar, filhos, txt, num, decodificar, erroXml, LIMITE_XML_BYTES };
