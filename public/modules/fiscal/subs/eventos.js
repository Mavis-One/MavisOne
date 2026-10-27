window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.fiscal = window.MavisSubscreenRegistry.fiscal || {};

// Eventos NF-e e NF-e Inutilizadas.
//
// As duas telas são a MESMA consulta com filtro diferente, então moram no mesmo
// arquivo: separá-las em dois faria a próxima mudança precisar ser feita duas
// vezes, que é como as duas versões começam a divergir.
//
// A inutilização já era gravada há tempo (nfe_eventos, tipo INUTILIZACAO), mas
// não aparecia em lugar nenhum: a única leitura existente filtrava por nfe_id,
// e inutilização tem nfe_id nulo — ela queima uma faixa de números que nunca
// virou nota. Ver getEventosFiscais em lib/db/fiscal.js.
(function (F) {
  const FILTROS = [
    { chave: '', label: 'Todos' },
    { chave: 'CCE', label: 'Cartas de Correção' },
    { chave: 'CANCELAMENTO', label: 'Cancelamentos' },
    { chave: 'INUTILIZACAO', label: 'Inutilizações' }
  ];

  // A faixa e a justificativa da inutilização só existem dentro do payload que
  // foi enviado à Focus — não viraram coluna. Ler dali é o que há.
  function dadosInutilizacao(evento) {
    const p = evento.payloadEnviado || {};
    return {
      serie: p.serie ?? '-',
      inicial: p.numero_inicial ?? p.numeroInicial ?? '-',
      final: p.numero_final ?? p.numeroFinal ?? '-',
      justificativa: p.justificativa || ''
    };
  }

  function faixa(evento) {
    const d = dadosInutilizacao(evento);
    return d.inicial === d.final ? String(d.inicial) : `${d.inicial} a ${d.final}`;
  }

  function notaDoEvento(escapeHtml, evento) {
    if (!evento.nfe) return '<span class="muted">— (faixa sem nota)</span>';
    const numero = evento.nfe.numero ? `nº ${evento.nfe.numero}` : evento.nfe.referencia || '-';
    const serie = evento.nfe.serie ? ` / série ${evento.nfe.serie}` : '';
    return escapeHtml(numero + serie);
  }

  function tomDoStatus(status) {
    const s = String(status || '').toLowerCase();
    if (/autoriz|homolog|sucesso|^ok$/.test(s)) return 'success';
    if (/erro|rejeit|falh|neg/.test(s)) return 'danger';
    return 'info';
  }

  function textoDaCorrecao(evento) {
    const enviado = evento.payloadEnviado || {};
    return String(enviado.correcao || enviado.correção || '').trim();
  }

  function nomeArquivo(valor) {
    return String(valor || 'carta-correcao').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'carta-correcao';
  }

  function baixarCartaCorrecao(evento, estabelecimento) {
    const P = window.MavisPdfPedido;
    if (!P) {
      showToast('Gerador de PDF indisponível. Recarregue a página.', 'error');
      return;
    }

    const d = {
      emitente: estabelecimento || {},
      nfe: evento.nfe || {},
      correcao: textoDaCorrecao(evento),
      protocolo: evento.respostaFocus && (
        evento.respostaFocus.protocolo || evento.respostaFocus.numero_protocolo
      ),
      data: F.dataHora(evento.criadoEm)
    };
    const doc = P.novoDocumento();
    const esquerda = P.MARGEM;
    const direita = doc.pagina.largura - P.MARGEM;
    const largura = doc.larguraUtil;
    const quebrar = (texto, tamanho, negrito = false) => P.quebrar(String(texto || '-'), largura - 16, tamanho, negrito);
    const linha = (rotulo, valor, tamanho = 9) => {
      const linhas = quebrar(`${rotulo}: ${valor || '-'}`, tamanho);
      doc.caber(linhas.length * (tamanho + 4) + 10);
      doc.retangulo(esquerda, doc.y - linhas.length * (tamanho + 4) - 8, largura, linhas.length * (tamanho + 4) + 8);
      linhas.forEach((texto) => {
        doc.y -= tamanho + 4;
        doc.texto(esquerda + 8, doc.y, texto, tamanho);
      });
      doc.y -= 4;
    };
    const titulo = (texto) => {
      doc.caber(30);
      doc.y -= 16;
      doc.texto(esquerda, doc.y, texto, 10, true);
      doc.y -= 8;
    };

    doc.texto(esquerda, doc.y - 12, d.emitente.razaoSocial || d.emitente.nomeFantasia || 'Emitente', 12, true);
    doc.y -= 27;
    const endereco = [
      [d.emitente.logradouro, d.emitente.numero].filter(Boolean).join(', '),
      [d.emitente.bairro, d.emitente.municipio, d.emitente.uf].filter(Boolean).join(' - '),
      d.emitente.cep ? `CEP ${d.emitente.cep}` : ''
    ].filter(Boolean).join(' | ');
    for (const texto of quebrar(`CNPJ: ${P.mascaraDocumento(d.emitente.cnpj)}    IE: ${d.emitente.inscricaoEstadual || '-'}`, 8.5)) {
      doc.texto(esquerda, doc.y, texto, 8.5);
      doc.y -= 11;
    }
    if (endereco) {
      for (const texto of quebrar(endereco, 8.5)) {
        doc.texto(esquerda, doc.y, texto, 8.5);
        doc.y -= 11;
      }
    }
    doc.y -= 5;
    doc.linha(esquerda, doc.y, direita, doc.y);
    doc.y -= 9;
    doc.retangulo(esquerda, doc.y - 31, largura, 31, true);
    doc.textoCentro(doc.pagina.largura / 2, doc.y - 20, 'CARTA DE CORREÇÃO ELETRÔNICA', 12, true);
    doc.y -= 43;

    titulo('IDENTIFICAÇÃO DA NF-e');
    linha('Número / série', `${d.nfe.numero || d.nfe.referencia || '-'} / ${d.nfe.serie || '-'}`);
    linha('Chave de acesso', d.nfe.chaveAcesso || '-');
    linha('Protocolo de autorização da NF-e', d.nfe.protocolo || '-');
    linha('Protocolo do evento', d.protocolo || '-');
    linha('Data do evento', d.data);

    titulo('TEXTO DA CORREÇÃO');
    const tamanho = 10;
    const linhasCorrecao = P.quebrar(d.correcao || 'Texto da correção não registrado.', largura - 20, tamanho);
    const altura = Math.max(50, linhasCorrecao.length * (tamanho + 5) + 20);
    doc.caber(altura + 8);
    const topo = doc.y;
    doc.retangulo(esquerda, topo - altura, largura, altura);
    linhasCorrecao.forEach((texto, i) => doc.texto(esquerda + 10, topo - 18 - i * (tamanho + 5), texto, tamanho));
    doc.y = topo - altura - 18;
    doc.texto(esquerda, doc.y, 'Documento auxiliar para registro e consulta do evento fiscal.', 7.5, false, 0.4);

    const bytes = P.serializar(doc.paginas, doc.pagina);
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `carta-correcao-${nomeArquivo(d.nfe.numero || d.nfe.referencia)}.pdf`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function desenhar(ctx, { titulo, tipoFixo }) {
    const { api, content, escapeHtml, state } = ctx;
    const redesenhar = () => desenhar(ctx, { titulo, tipoFixo });

    let estabelecimentos = [];
    let erroEstabelecimentos = null;
    try {
      const resposta = await api('/api/fiscal/estabelecimentos');
      estabelecimentos = resposta.estabelecimentos || [];
    } catch (e) {
      erroEstabelecimentos = e.message || 'Não foi possível carregar os estabelecimentos.';
    }
    const nomePorId = new Map(estabelecimentos.map((e) => [e.id, e]));

    // Filtro só existe na tela de Eventos; Inutilizadas já nasce filtrada.
    const filtroAtivo = tipoFixo || state.fiscalEventoTipo || '';
    const tipoConsulta = tipoFixo || filtroAtivo;

    let eventos = [];
    let erroConsulta = null;
    try {
      const params = new URLSearchParams();
      if (tipoConsulta) params.set('tipo', tipoConsulta);
      const res = await api(`/api/fiscal/eventos?${params.toString()}`);
      eventos = res.eventos || [];
    } catch (e) {
      erroConsulta = e.message || 'Não foi possível carregar os eventos.';
    }

    const ehInutilizadas = tipoFixo === 'INUTILIZACAO';

    content.innerHTML = `
      <div class="panel">
        <div class="cadastro-page-head">
          <div>
            <h3>${escapeHtml(titulo)}</h3>
          </div>
        </div>

        ${tipoFixo ? '' : `
          <div class="finance-granularity-group" role="tablist">
            ${FILTROS.map((f) => `
              <button type="button" class="finance-pill ${f.chave === filtroAtivo ? 'active' : ''}" data-filtro="${escapeHtml(f.chave)}">${escapeHtml(f.label)}</button>
            `).join('')}
          </div>`}

        ${erroConsulta ? `<p class="form-error">${escapeHtml(erroConsulta)}</p>` : ''}
        ${erroEstabelecimentos ? `<p class="form-error">${escapeHtml(`Não foi possível carregar os nomes dos estabelecimentos: ${erroEstabelecimentos}`)}</p>` : ''}

        ${!eventos.length ? `
          <p class="muted">${escapeHtml(ehInutilizadas
            ? 'Nenhuma faixa de numeração foi inutilizada nos estabelecimentos.'
            : 'Nenhum evento registrado nos estabelecimentos.')}</p>
        ` : `
        <table class="table">
          <thead>
            <tr>
              <th>Quando</th>
              <th>Estabelecimento</th>
              ${ehInutilizadas ? '<th>Série</th><th>Faixa</th><th>Justificativa</th>' : '<th>Tipo</th><th>NF-e</th>'}
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${eventos.map((ev, i) => {
              const t = F.rotuloTipo(ev.tipo);
              const d = dadosInutilizacao(ev);
              const estabelecimento = nomePorId.get(ev.estabelecimentoId);
              return `
              <tr>
                <td>${escapeHtml(F.dataHora(ev.criadoEm))}</td>
                <td>${escapeHtml(estabelecimento
                  ? `${estabelecimento.nomeFantasia || estabelecimento.razaoSocial} — ${F.cnpj(estabelecimento.cnpj)}`
                  : 'Estabelecimento não identificado')}</td>
                ${ehInutilizadas ? `
                  <td>${escapeHtml(String(d.serie))}</td>
                  <td>${escapeHtml(faixa(ev))}</td>
                  <td class="fiscal-justificativa" title="${escapeHtml(d.justificativa)}">${escapeHtml(d.justificativa || '-')}</td>
                ` : `
                  <td><span class="finance-badge finance-badge-${t.tom}">${escapeHtml(t.label)}</span></td>
                  <td>${notaDoEvento(escapeHtml, ev)}</td>
                `}
                <td><span class="finance-badge finance-badge-${tomDoStatus(ev.status)}">${escapeHtml(ev.status || '-')}</span></td>
                <td><button type="button" class="secondary" data-detalhe="ev${i}" aria-expanded="false">Detalhes</button></td>
              </tr>
              <tr data-detalhe-de="ev${i}" hidden>
                <td colspan="${ehInutilizadas ? 7 : 6}">
                  <div class="fiscal-detalhe">
                    ${ev.tipo === 'CCE' ? '<button type="button" class="secondary" data-pdf="ev' + i + '">Baixar Carta de Correção (PDF)</button>' : ''}
                    ${F.blocoJson(escapeHtml, 'Enviado', ev.payloadEnviado)}
                    ${F.blocoJson(escapeHtml, 'Resposta da SEFAZ', ev.respostaFocus)}
                  </div>
                </td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
        <p class="muted">${eventos.length} evento${eventos.length === 1 ? '' : 's'} — os 200 mais recentes.</p>
        `}
      </div>`;

    F.ligarSeletor(ctx, redesenhar);
    content.querySelectorAll('[data-pdf]').forEach((botao) => {
      botao.addEventListener('click', () => {
        const indice = Number(botao.dataset.pdf.slice(2));
        baixarCartaCorrecao(eventos[indice], nomePorId.get(eventos[indice].estabelecimentoId));
      });
    });
    F.ligarDetalhes(ctx);
    content.querySelectorAll('[data-filtro]').forEach((botao) => {
      botao.addEventListener('click', () => {
        state.fiscalEventoTipo = botao.dataset.filtro;
        redesenhar();
      });
    });
  }

  window.MavisSubscreenRegistry.fiscal.eventos = (ctx) => desenhar(ctx, {
    titulo: 'Eventos NF-e',
    tipoFixo: null
  });

  window.MavisSubscreenRegistry.fiscal.inutilizadas = (ctx) => desenhar(ctx, {
    titulo: 'NF-e Inutilizadas',
    tipoFixo: 'INUTILIZACAO'
  });
})(window.MavisFiscalDocs);
