// MOSTRA O DANFE QUE A ROTA /api/fiscal/nfe/:id/danfe DEVOLVEU, numa janela já
// aberta pelo clique (abrir dentro do clique é o que escapa do bloqueador de
// pop-up).
//
// PDF (NF-e) vai para o visualizador do navegador, como sempre foi.
//
// HTML (o DANFCe da NFC-e) NÃO pode ir pelo mesmo caminho: um endereço blob:
// herda a origem DESTE sistema, e o HTML que veio da Focus rodaria com acesso à
// sessão de quem está logado. Ele entra num <iframe sandbox> SEM allow-scripts:
// nenhum script dele roda. O `allow-same-origin` existe só para ESTE código
// medir a altura do cupom e imprimir o quadro — com script desligado lá dentro,
// não há o que use essa origem do lado de lá.
(function (raiz) {
  'use strict';

  function mostrar(win, blob, titulo) {
    const tipo = String((blob && blob.type) || '').toLowerCase();
    if (!tipo.includes('text/html')) {
      const url = URL.createObjectURL(blob);
      win.location.replace(url);
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      return Promise.resolve();
    }
    return blob.text().then((html) => {
      const doc = win.document;
      doc.open();
      doc.write('<!doctype html><meta charset="utf-8"><title></title>'
        + '<style>body{margin:0;font:14px system-ui;background:#f4f4f4}'
        + '.barra{padding:10px;text-align:center}.barra button{font:inherit;padding:8px 18px;cursor:pointer}'
        + 'iframe{display:block;margin:0 auto 24px;border:0;background:#fff;width:100%;max-width:480px}'
        + '@media print{.barra{display:none}body{background:#fff}}</style>'
        + '<div class="barra"><button type="button">Imprimir</button></div>');
      doc.close();
      doc.title = titulo || 'DANFCe';
      const quadro = doc.createElement('iframe');
      quadro.setAttribute('sandbox', 'allow-same-origin allow-modals');
      quadro.srcdoc = html;
      quadro.addEventListener('load', () => {
        try {
          const altura = quadro.contentDocument.documentElement.scrollHeight;
          quadro.style.height = `${altura + 16}px`;
        } catch (_) {
          quadro.style.height = '90vh';
        }
      });
      doc.body.appendChild(quadro);
      doc.querySelector('.barra button').addEventListener('click', () => {
        try { quadro.contentWindow.print(); } catch (_) { win.print(); }
      });
    });
  }

  /**
   * A PÁGINA DA NOTA, COM O BOTÃO DE BAIXAR (15/10/2026, pedido do usuário:
   * "um botão ao lado dos números de pedidos referente às NF geradas por eles,
   * que leve o usuário a uma página viewer pdf com possibilidade para
   * download"). Abre uma aba nova DENTRO do clique (escapa do bloqueador de
   * pop-up), busca a DANFE com o token e monta ali: o título, Imprimir, Baixar
   * (com o nome da nota, e não o código aleatório de um blob) e o PDF embutido
   * — o visualizador do navegador, com a rolagem e o zoom dele. O DANFCe da
   * NFC-e (HTML da Focus) entra no iframe sandbox sem script, como em mostrar.
   *
   * O PDF embutido por blob: precisa de frame-src 'self' blob: na CSP
   * (server.js). Página escrita pelo sistema, sem script dela: os botões são
   * ligados daqui.
   */
  function abrirNota({ nfeId, titulo = 'DANFE', nomeDoArquivo = 'danfe', token = '' }) {
    const win = window.open('', '_blank');
    if (!win) return Promise.reject(new Error('O navegador bloqueou a aba nova. Libere os pop-ups deste site e tente de novo.'));
    win.opener = null;
    const doc = win.document;
    const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    doc.open();
    doc.write('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title></title>'
      + '<style>'
      + 'html,body{height:100%}body{margin:0;font:14px system-ui,sans-serif;background:#525659;display:flex;flex-direction:column}'
      + '.barra{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:10px 16px;background:#14202b;color:#fff}'
      + '.barra h1{font-size:15px;margin:0;flex:1;min-width:0}'
      + '.barra button,.barra a{font:inherit;padding:8px 16px;border-radius:8px;border:0;cursor:pointer;text-decoration:none}'
      + '.barra .baixar{background:#16a34a;color:#fff}.barra .imprimir{background:#e5e7eb;color:#111}'
      + '.barra [hidden]{display:none}'
      + '.quadro{flex:1;display:flex;min-height:0}'
      + '.quadro iframe{flex:1;border:0;width:100%;background:#fff}'
      + '.aviso{color:#fff;padding:24px;font-size:15px}'
      + '@media print{.barra{display:none}}'
      + '</style>'
      + `<div class="barra"><h1>${esc(titulo)}</h1>`
      + '<button type="button" class="imprimir" hidden>Imprimir</button>'
      + '<a class="baixar" hidden>Baixar</a></div>'
      + '<div class="quadro"><p class="aviso">Abrindo…</p></div>');
    doc.close();
    doc.title = titulo;
    const quadro = doc.querySelector('.quadro');
    const aviso = (texto) => { quadro.innerHTML = `<p class="aviso">${esc(texto)}</p>`; };

    return fetch(`/api/fiscal/nfe/${encodeURIComponent(nfeId)}/danfe`, { headers: { 'x-auth-token': token || '' } })
      .then(async (resposta) => {
        if (!resposta.ok) {
          const corpo = await resposta.json().catch(() => ({}));
          aviso(corpo.error || `Não foi possível abrir a nota (HTTP ${resposta.status}).`);
          return;
        }
        const blob = await resposta.blob();
        const ehHtml = String(blob.type || '').toLowerCase().includes('text/html');
        // O endereço é da ABA DA NOTA (win.URL): vive e morre com ela, e não
        // com a do sistema — recarregar o ERP não quebra o Baixar desta aba.
        const url = (win.URL || URL).createObjectURL(blob);
        const baixar = doc.querySelector('.baixar');
        baixar.href = url;
        baixar.setAttribute('download', `${nomeDoArquivo}.${ehHtml ? 'html' : 'pdf'}`);
        baixar.textContent = ehHtml ? 'Baixar' : 'Baixar PDF';
        baixar.hidden = false;
        const iframe = doc.createElement('iframe');
        iframe.title = titulo;
        if (ehHtml) {
          iframe.setAttribute('sandbox', 'allow-same-origin allow-modals');
          iframe.srcdoc = await blob.text();
        } else {
          iframe.src = url;
        }
        quadro.innerHTML = '';
        quadro.appendChild(iframe);
        const imprimir = doc.querySelector('.imprimir');
        imprimir.hidden = false;
        imprimir.addEventListener('click', () => {
          try { iframe.contentWindow.focus(); iframe.contentWindow.print(); } catch (_) { win.print(); }
        });
      })
      .catch((erro) => aviso(`Falha ao buscar a nota: ${erro.message || 'erro desconhecido'}`));
  }

  const api = { mostrar, abrirNota };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (raiz) raiz.MavisDanfe = api;
})(typeof window !== 'undefined' ? window : null);
