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

  const api = { mostrar };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (raiz) raiz.MavisDanfe = api;
})(typeof window !== 'undefined' ? window : null);
