// CUPOM DO PEDIDO PARA IMPRESSORA TÉRMICA (12/10/2026).
//
// Pedido do usuário: "uma modelagem de impressão a mais para esses pedidos,
// para impressoras térmicas de cupom". O modelo A4 (Imprimir Pedido) tem
// tabela de sete colunas e cabeçalho com logo — numa bobina de 80 mm isso sai
// espremido ou cortado. Aqui o pedido é recomposto para uma coluna estreita:
// cada item em duas linhas (descrição; quantidade × unitário = total), totais
// alinhados à direita, sem imagem (térmica imprime logo mal e gasta bobina).
//
// Duas larguras, as das impressoras de cupom comuns:
//   80 mm  área útil ~72 mm   (Epson TM-T20, Elgin i9, Bematech MP-4200)
//   58 mm  área útil ~48 mm   (as portáteis e as de balcão menores)
//
// NÃO É DOCUMENTO FISCAL — o rodapé diz. Cupom fiscal é a NFC-e, emitida pelo
// próprio pedido (Mais Ações › Emitir NFC-e).
//
// Função pura: recebe os dados prontos e devolve o HTML. Quem junta os dados
// do formulário é o app.js; o teste roda isto sem navegador.
(function (raiz) {
  const LARGURAS = {
    80: { papel: 80, area: 72, fonte: 12, total: 15 },
    58: { papel: 58, area: 48, fonte: 10.5, total: 13 }
  };

  const escapar = (v) => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const numero = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const reais = (v) => numero(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  // Quantidade sem zeros sobrando: "2", "1,5", "0,125".
  const quantidade = (v) => numero(v).toLocaleString('pt-BR', { maximumFractionDigits: 4 });
  const dataBR = (iso) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
    return m ? `${m[3]}/${m[2]}/${m[1]}` : String(iso || '');
  };
  const documento = (valor) => {
    const d = String(valor || '').replace(/\D/g, '');
    if (d.length === 14) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
    if (d.length === 11) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
    return String(valor || '');
  };

  const linhaValor = (rotulo, valor, classe = '') =>
    `<div class="lv ${classe}"><span>${escapar(rotulo)}</span><span>${escapar(valor)}</span></div>`;

  /**
   * @param d  { titulo, numero, data, hora, validade, status, vendedor,
   *             emitente: { nome, cnpj, endereco, telefone },
   *             cliente: { nome, documento, telefone, endereco },
   *             itens: [{ codigo, descricao, quantidade, unidade, unitario }],
   *             totais: { produtos, frete, outros, desconto, total },
   *             condicao, pagamentos: [{ forma, valor, vencimento }],
   *             observacao }
   * @param opcoes { largura: 80 | 58 }
   */
  function montarCupom(d, { largura = 80 } = {}) {
    const L = LARGURAS[largura] || LARGURAS[80];
    const emit = d.emitente || {};
    const cli = d.cliente || {};
    const tot = d.totais || {};
    const itens = (d.itens || []).map((i) => {
      const total = numero(i.quantidade) * numero(i.unitario);
      return `
        <div class="item">
          <div class="desc">${escapar([i.codigo, i.descricao].filter(Boolean).join(' '))}</div>
          <div class="lv"><span>${escapar(quantidade(i.quantidade))} ${escapar(i.unidade || 'UN')} x ${escapar(reais(i.unitario))}</span><span>${escapar(reais(total))}</span></div>
        </div>`;
    }).join('');
    const pagamentos = (d.pagamentos || []).filter((p) => p && (p.forma || numero(p.valor)));

    return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8" />
      <title>${escapar(d.titulo || 'Pedido')} ${escapar(d.numero || '')}</title>
      <style>
        @page { size: ${L.papel}mm auto; margin: 0; }
        * { box-sizing: border-box; }
        html, body { margin: 0; padding: 0; background: #fff; color: #000; }
        body { width: ${L.area}mm; margin: 0 auto; padding: 3mm 0 6mm;
               font-family: "Courier New", Courier, monospace; font-size: ${L.fonte}px; line-height: 1.35; }
        .c { text-align: center; }
        .b { font-weight: bold; }
        .sep { border-top: 1px dashed #000; margin: 5px 0; }
        .lv { display: flex; flex-wrap: wrap; justify-content: space-between; column-gap: 6px; }
        .lv span:last-child { margin-left: auto; text-align: right; white-space: nowrap; }
        /* "5 UN x R$ 8.390,00" não se parte: na bobina de 58 mm, quando não
           cabe junto do total, é o total que desce para a linha de baixo. */
        .item .lv span:first-child { white-space: nowrap; }
        .item { margin: 0 0 4px; }
        .desc { word-break: break-word; }
        .total { font-size: ${L.total}px; font-weight: bold; }
        .obs { white-space: pre-wrap; word-break: break-word; }
        .assina { margin-top: 18px; text-align: center; }
        .assina div { border-top: 1px solid #000; margin: 0 4mm; padding-top: 2px; }
        @media screen { body { box-shadow: 0 0 0 1px #ddd; } }
      </style></head><body>
      ${emit.nome ? `<div class="c b">${escapar(emit.nome)}</div>` : ''}
      ${emit.cnpj ? `<div class="c">CNPJ ${escapar(documento(emit.cnpj))}</div>` : ''}
      ${emit.endereco ? `<div class="c">${escapar(emit.endereco)}</div>` : ''}
      ${emit.telefone ? `<div class="c">${escapar(emit.telefone)}</div>` : ''}
      <div class="sep"></div>
      <div class="c b">${escapar(String(d.titulo || 'PEDIDO').toUpperCase())}${d.numero ? ` Nº ${escapar(d.numero)}` : ''}</div>
      <div class="c">${escapar(dataBR(d.data))}${d.hora ? ` ${escapar(d.hora)}` : ''}</div>
      ${d.validade ? `<div class="c">Validade ${escapar(dataBR(d.validade))}</div>` : ''}
      ${d.status ? `<div class="c">${escapar(d.status)}</div>` : ''}
      ${d.vendedor ? `<div>Vendedor: ${escapar(d.vendedor)}</div>` : ''}
      <div class="sep"></div>
      <div>Cliente: ${escapar(cli.nome || 'Consumidor')}</div>
      ${cli.documento ? `<div>CPF/CNPJ: ${escapar(documento(cli.documento))}</div>` : ''}
      ${cli.telefone ? `<div>Fone: ${escapar(cli.telefone)}</div>` : ''}
      ${cli.endereco ? `<div>${escapar(cli.endereco)}</div>` : ''}
      <div class="sep"></div>
      ${itens || '<div class="c">Sem itens</div>'}
      <div class="sep"></div>
      ${linhaValor('Itens', reais(tot.produtos))}
      ${numero(tot.frete) ? linhaValor('Frete', reais(tot.frete)) : ''}
      ${numero(tot.outros) ? linhaValor('Outros', reais(tot.outros)) : ''}
      ${numero(tot.desconto) ? linhaValor('Desconto', '-' + reais(tot.desconto)) : ''}
      ${linhaValor('TOTAL', reais(tot.total), 'total')}
      ${d.condicao || pagamentos.length ? '<div class="sep"></div>' : ''}
      ${d.condicao ? `<div>Pagamento: ${escapar(d.condicao)}</div>` : ''}
      ${pagamentos.map((p) => linhaValor(`${p.forma || 'Pagamento'}${p.vencimento ? ` ${dataBR(p.vencimento)}` : ''}`, reais(p.valor))).join('')}
      ${d.observacao ? `<div class="sep"></div><div class="obs">${escapar(d.observacao)}</div>` : ''}
      ${d.assinatura ? '<div class="assina"><div>Assinatura do cliente</div></div>' : ''}
      <div class="sep"></div>
      <div class="c">DOCUMENTO SEM VALOR FISCAL</div>
      </body></html>`;
  }

  const api = { LARGURAS, montarCupom };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (raiz) raiz.MavisCupomPedido = api;
})(typeof window !== 'undefined' ? window : null);
