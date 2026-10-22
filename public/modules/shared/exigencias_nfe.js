// AS EXIGÊNCIAS DE NF-e DE CADA CLIENTE (fase FB, 22/10/2026).
//
// O usuário colou "006_exigencias_nfe_cliente.sql": a ARWEG (Grupo WEG) só
// aceita a nota com o pedido de compra dela em cada item (xPed / nItemPed), o
// código do material dela no item, o pedido, a condição de pagamento, o centro
// e o depósito recebedor nas informações complementares, sem dados bancários,
// e o XML por e-mail. O perfil de cada cliente fica em Fiscal › Exigências de
// NF-e por Cliente; o pedido do cliente é digitado no próprio pedido de venda.
//
// FONTE ÚNICA, como shared/venda_obrigatorios.js: a tela mostra o que falta com
// estas funções e o servidor recusa a emissão com as mesmas
// (prepararNfeParaTransmitir). É o validar_exigencias_nfe do script, em código.
//
// Tudo isto só vale para cliente COM PERFIL ativo: sem perfil, o pedido do
// cliente não vai à nota.
(function (raiz) {
  const digitos = (v) => String(v == null ? '' : v).replace(/\D/g, '');
  const texto = (v, max) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);

  // As marcas do perfil, na ordem da tela. `campo` é o nome no objeto, `coluna`
  // o da tabela cliente_exigencia_nfe.
  const MARCAS = [
    { campo: 'exigeXpedItem', coluna: 'exige_xped_item', grupo: 'XML', rotulo: 'Nº do pedido de compra em cada item (xPed)' },
    { campo: 'exigeNitempedItem', coluna: 'exige_nitemped_item', grupo: 'XML', rotulo: 'Item do pedido em cada item da nota (nItemPed)' },
    { campo: 'exigeMesmasLinhas', coluna: 'exige_mesmas_linhas', grupo: 'XML', rotulo: 'Uma linha da nota por item do pedido (sem repetir o item)' },
    { campo: 'exigeRefRetorno', coluna: 'exige_ref_retorno', grupo: 'XML', rotulo: 'Retorno refere a NF-e de remessa (chave)' },
    { campo: 'exigePedidoInfcpl', coluna: 'exige_pedido_infcpl', grupo: 'DANFE', rotulo: 'Nº do pedido nas informações complementares' },
    { campo: 'exigeCodigoMaterial', coluna: 'exige_codigo_material', grupo: 'DANFE', rotulo: 'Código do material do cliente em cada item' },
    { campo: 'exigeCondPagto', coluna: 'exige_cond_pagto', grupo: 'DANFE', rotulo: 'Condição de pagamento' },
    { campo: 'exigeUnidadePedido', coluna: 'exige_unidade_pedido', grupo: 'DANFE', rotulo: 'Unidade do item igual à do pedido do cliente' },
    { campo: 'exigeCentro', coluna: 'exige_centro', grupo: 'DANFE', rotulo: 'Centro recebedor' },
    { campo: 'exigeDeposito', coluna: 'exige_deposito', grupo: 'DANFE', rotulo: 'Depósito recebedor' },
    { campo: 'proibeDadosBancarios', coluna: 'proibe_dados_bancarios', grupo: 'DANFE', rotulo: 'Sem dados bancários na nota' }
  ];

  const LIMITE_DE_EMAILS = 10;
  const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  // "agência", "conta corrente", "c/c" e "chave pix" — os mesmos do script.
  const DADOS_BANCARIOS = /(ag[eê]ncia|conta corrente|(^|[^a-z0-9])c\/c([^a-z0-9]|$)|chave pix)/i;

  /** O perfil como a tela o manda -> o que se grava, com os erros. */
  function normalizarPerfil(body) {
    const b = body || {};
    const erros = [];
    const cnpjCpf = digitos(b.cnpjCpf);
    if (cnpjCpf.length !== 11 && cnpjCpf.length !== 14) erros.push('Informe o CNPJ (14 dígitos) ou o CPF (11 dígitos) do cliente.');
    const nome = texto(b.nome, 200);
    if (!nome) erros.push('Informe o nome do cliente.');
    const emails = (Array.isArray(b.emailsXml) ? b.emailsXml : String(b.emailsXml || '').split(/[\s,;]+/))
      .map((e) => String(e || '').trim().toLowerCase()).filter(Boolean);
    const unicos = [...new Set(emails)];
    const invalidos = unicos.filter((e) => !EMAIL.test(e));
    if (invalidos.length) erros.push(`E-mail inválido: ${invalidos.join(', ')}.`);
    if (unicos.length > LIMITE_DE_EMAILS) erros.push(`No máximo ${LIMITE_DE_EMAILS} e-mails (é o limite da Focus por envio).`);
    const perfil = {
      cnpjCpf,
      cadastroId: texto(b.cadastroId, 80),
      nome,
      ativo: b.ativo !== false,
      emailsXml: unicos.slice(0, LIMITE_DE_EMAILS),
      rotuloMaterial: texto(b.rotuloMaterial, 40) || 'MATERIAL',
      modeloInfcpl: String(b.modeloInfcpl == null ? '' : b.modeloInfcpl).trim().slice(0, 1000),
      observacoes: String(b.observacoes == null ? '' : b.observacoes).trim().slice(0, 2000)
    };
    MARCAS.forEach((m) => { perfil[m.campo] = b[m.campo] === true; });
    return { perfil, erros };
  }

  /** O pedido do cliente (cabeçalho), como vem do pedido de venda ou da tela. */
  function normalizarPedido(p) {
    const x = p || {};
    return {
      numero: texto(x.numero, 60),
      condicaoPagamento: texto(x.condicaoPagamento, 60),
      centro: texto(x.centro, 60),
      deposito: texto(x.deposito, 60)
    };
  }

  /** Os três campos do pedido do cliente em cada item. */
  function normalizarItem(item) {
    const x = item || {};
    return {
      itemPedidoCliente: digitos(x.itemPedidoCliente).slice(0, 9),
      codigoMaterialCliente: texto(x.codigoMaterialCliente, 60),
      unidadeCliente: texto(x.unidadeCliente, 6).toUpperCase()
    };
  }

  /** O texto das informações complementares, pelo modelo do perfil. */
  function textoDoPedido(perfil, pedido) {
    const modelo = String((perfil && perfil.modeloInfcpl) || '').trim();
    if (!modelo) return '';
    const p = normalizarPedido(pedido);
    return modelo
      .split('{pedido}').join(p.numero)
      .split('{cond_pagto}').join(p.condicaoPagamento)
      .split('{centro}').join(p.centro)
      .split('{deposito}').join(p.deposito);
  }

  /** "MATERIAL ARWEG: 12345" — o código do material no texto do item. */
  function textoDoMaterial(perfil, codigo) {
    const c = texto(codigo, 60);
    if (!c) return '';
    return `${texto(perfil && perfil.rotuloMaterial, 40) || 'MATERIAL'}: ${c}`;
  }

  /**
   * O QUE FALTA PARA O CLIENTE ACEITAR A NOTA. Lista vazia = pode emitir.
   *
   * `itens`: os da nota, cada um com descricao e os três campos do pedido do
   * cliente (normalizarItem). `infCpl`: o texto que vai às informações
   * complementares. `referencias`: as chaves referenciadas.
   */
  function conferir({ perfil, pedido, itens, infCpl, tipoOperacao, referencias } = {}) {
    if (!perfil || perfil.ativo === false) return [];
    const problemas = [];
    const falta = (item, exigencia, problema) => problemas.push({ item, exigencia, problema });
    const p = normalizarPedido(pedido);
    const complementar = String(infCpl || '');
    const lista = Array.isArray(itens) ? itens : [];

    if ((perfil.exigeXpedItem || perfil.exigePedidoInfcpl) && !p.numero) {
      falta(null, 'pedido', 'Informe o nº do pedido de compra do cliente.');
    }
    if (perfil.exigeXpedItem && p.numero.length > 15) {
      falta(null, 'pedido', `O nº do pedido de compra tem até 15 caracteres na NF-e (xPed); "${p.numero}" tem ${p.numero.length}.`);
    }
    const vistos = new Map();
    lista.forEach((bruto, i) => {
      const item = normalizarItem(bruto);
      const nome = `Item ${i + 1}${bruto && bruto.descricao ? ` (${curto(bruto.descricao)})` : ''}`;
      if (perfil.exigeNitempedItem && !item.itemPedidoCliente) falta(i + 1, 'nItemPed', `${nome}: falta o item do pedido do cliente (ex.: 10, 20).`);
      if (item.itemPedidoCliente.length > 6) falta(i + 1, 'nItemPed', `${nome}: o item do pedido do cliente tem até 6 dígitos.`);
      if (perfil.exigeCodigoMaterial && !item.codigoMaterialCliente) falta(i + 1, 'material', `${nome}: falta o código do material do cliente.`);
      if (perfil.exigeUnidadePedido && !item.unidadeCliente) falta(i + 1, 'unidade', `${nome}: falta a unidade do pedido do cliente.`);
      if (item.itemPedidoCliente) {
        const chave = String(Number(item.itemPedidoCliente));
        vistos.set(chave, (vistos.get(chave) || []).concat(i + 1));
      }
    });
    if (perfil.exigeMesmasLinhas) {
      vistos.forEach((linhas, itemDoPedido) => {
        if (linhas.length > 1) falta(null, 'linhas', `O item ${itemDoPedido} do pedido do cliente está em mais de uma linha da nota (linhas ${linhas.join(', ')}): o cliente exige uma linha por item do pedido.`);
      });
    }
    if (perfil.exigeCondPagto && !p.condicaoPagamento) falta(null, 'cond_pagto', 'Informe a condição de pagamento do pedido do cliente.');
    if (perfil.exigeCentro && !p.centro) falta(null, 'centro', 'Informe o centro recebedor do pedido do cliente.');
    if (perfil.exigeDeposito && !p.deposito) falta(null, 'deposito', 'Informe o depósito recebedor do pedido do cliente.');
    if (perfil.exigePedidoInfcpl && p.numero && !complementar.includes(p.numero)) {
      falta(null, 'infCpl', `O nº do pedido ${p.numero} não está nas informações complementares.`);
    }
    if (perfil.exigeCentro && p.centro && !complementar.includes(p.centro)) falta(null, 'centro', 'O centro recebedor não está nas informações complementares.');
    if (perfil.exigeDeposito && p.deposito && !complementar.includes(p.deposito)) falta(null, 'deposito', 'O depósito recebedor não está nas informações complementares.');
    if (perfil.proibeDadosBancarios && DADOS_BANCARIOS.test(complementar)) {
      falta(null, 'dados_bancarios', 'Tire os dados bancários (agência, conta, chave Pix) das observações: este cliente não os aceita na nota.');
    }
    if (perfil.exigeRefRetorno && String(tipoOperacao || '').toUpperCase() === 'RETORNO'
      && !(Array.isArray(referencias) && referencias.some((r) => digitos(r && (r.chaveAcesso || r.chave)).length === 44))) {
      falta(null, 'retorno', 'Retorno para este cliente precisa da chave da NF-e de remessa dele.');
    }
    return problemas;
  }

  function curto(v) {
    return String(v || '').replace(/\s+/g, ' ').trim().slice(0, 40);
  }

  /** O perfil de um documento, numa lista de perfis. */
  function perfilDe(perfis, documento) {
    const d = digitos(documento);
    if (!d) return null;
    return (Array.isArray(perfis) ? perfis : []).find((x) => x && x.cnpjCpf === d && x.ativo !== false) || null;
  }

  const api = {
    MARCAS, LIMITE_DE_EMAILS, DADOS_BANCARIOS,
    normalizarPerfil, normalizarPedido, normalizarItem, textoDoPedido, textoDoMaterial, conferir, perfilDe
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else raiz.MavisExigenciasNfe = api;
})(typeof window !== 'undefined' ? window : globalThis);
