window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.fiscal = window.MavisSubscreenRegistry.fiscal || {};

// ARQUIVOS FISCAIS DO PERÍODO — o acervo de XML, conferido e em zip.
//
// A QUEM ESTA TELA SERVE, e por que ela não se chama "SPED"
// --------------------------------------------------------
// O contador gera a EFD ICMS/IPI a partir dos XML. Este sistema já guarda
// todos eles — o XML de cada nota autorizada (baixado da Focus) e o de cada
// entrada (o arquivo que o fornecedor mandou) —, e até aqui a única forma de
// tirá-los era clicando nota por nota. Num mês com trezentas notas isso não é
// uma tela ruim, é uma tela que ninguém usa.
//
// Ela NÃO gera o arquivo do SPED, e o nome diz isso de propósito. Gerar a EFD
// hoje produziria arquivo inválido: medido em 17/09/2026, os 6.492 participantes
// estão sem o código IBGE do município, que o registro 0150 exige; o `TIPO_ITEM`
// do registro 0200 não existe como conceito (os 5.475 produtos estão todos como
// `NORMAL`, que é outra classificação); não há cadastro de contabilista para o
// 0100; e não há apuração nenhuma para o Bloco E. Botão que produz arquivo que a
// SEFAZ rejeita é pior do que botão que não existe, porque alguém entrega.
//
// O QUE ELA CONSERTA DE VERDADE
// -----------------------------
// O acervo pode ter buraco, e ninguém sabia. O download do XML de saída é
// melhor esforço e roda UMA vez, no instante em que a nota passa a AUTORIZADO
// (ver baixarEGuardarArquivosNfe em server.js). A Focus gera o arquivo de forma
// assíncrona, então essa primeira tentativa pode chegar antes do arquivo
// existir — e não havia retentativa. Esta tela mostra quantas faltam, quais
// são, e tem o botão que busca de novo.
(function (F) {
  function primeiroDiaDoMes() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
  }
  function hoje() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  // 'aaaa-mm-dd' -> 'dd/mm/aaaa' sem passar por Date: converter e reformatar faz
  // a data pular um dia em fuso negativo, que é o Brasil inteiro.
  function diaBr(iso) {
    const t = String(iso || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return t || '-';
    const [a, m, d] = t.split('-');
    return `${d}/${m}/${a}`;
  }

  // `.cards`/`.card` são os cartões que o sistema já tem (app.css), e são
  // responsivos de fábrica. A única classe nova é o tom de alerta do número —
  // inventar um cartão próprio aqui seria manter dois.
  function cartao(rotulo, valor, alerta) {
    return `<div class="card">
      <h3>${rotulo}</h3>
      <p${alerta ? ' class="acervo-alerta"' : ''}>${valor}</p>
    </div>`;
  }

  async function desenhar(ctx) {
    const { api, content, escapeHtml, state, showToast } = ctx;
    const redesenhar = () => desenhar(ctx);

    const { lista, escolhido, erro } = await F.carregarEstabelecimentos(ctx);
    if (!lista.length) { content.innerHTML = F.semEstabelecimento(escapeHtml, 'Arquivos Fiscais', erro); return; }

    const de = state.fiscalAcervoDe || primeiroDiaDoMes();
    const ate = state.fiscalAcervoAte || hoje();

    let dados = null;
    let erroConsulta = null;
    try {
      dados = await api(`/api/fiscal/acervo?estabelecimentoId=${encodeURIComponent(escolhido)}`
        + `&de=${encodeURIComponent(de)}&ate=${encodeURIComponent(ate)}`);
    } catch (e) {
      erroConsulta = e.message || 'Não foi possível ler o acervo.';
    }

    const saidas = (dados && dados.saidas) || { total: 0, comXml: 0, semXml: 0 };
    const entradas = (dados && dados.entradas) || { total: 0, comXml: 0, semXml: 0 };
    const faltantes = (dados && dados.faltantes) || [];
    const temArquivo = saidas.comXml + entradas.comXml > 0;
    // Buscar de novo só faz sentido para quem tem URL na Focus. Sem ela não há
    // de onde baixar, e oferecer o botão prometeria o que ele não cumpre.
    const recuperaveis = faltantes.filter((f) => f.temUrl).length;

    content.innerHTML = `
      <div class="panel">
        <div class="cadastro-page-head">
          <div>
            <h3>Arquivos Fiscais</h3>
            <p class="muted">O XML de cada nota do período — as suas e as que você recebeu —
            em um zip só, para o escritório de contabilidade. <strong>Não é o arquivo do SPED</strong>:
            é a matéria-prima dele.</p>
          </div>
          ${F.seletorEstabelecimento(escapeHtml, lista, escolhido)}
        </div>

        <div class="row" style="max-width: 620px; align-items: end;">
          <label>De<input type="date" id="acervoDe" value="${escapeHtml(de)}" /></label>
          <label>Até<input type="date" id="acervoAte" value="${escapeHtml(ate)}" /></label>
          <button type="button" id="acervoBuscar">Conferir período</button>
        </div>

        ${erroConsulta ? `<p class="fiscal-aviso-homologacao">${escapeHtml(erroConsulta)}</p>` : `
          <div class="cards">
            ${cartao('Notas emitidas', saidas.total)}
            ${cartao('Com XML guardado', saidas.comXml)}
            ${cartao('Sem XML', saidas.semXml, saidas.semXml > 0)}
            ${cartao('Entradas com XML', entradas.comXml)}
          </div>

          ${saidas.semXml > 0 ? `
            <div class="fiscal-aviso-cst">
              <p><strong>${saidas.semXml} nota(s) do período sem o XML guardado aqui.</strong>
              O download é feito uma vez, quando a nota é autorizada, e a Focus gera o arquivo
              alguns instantes depois — quando a primeira tentativa chega antes, o arquivo ficava
              sem ser buscado de novo. É isso que o botão abaixo faz.</p>
              <p class="muted">Faltando:
                ${faltantes.slice(0, 20).map((f) => `<code>${escapeHtml(String(f.numero))}${f.temUrl ? '' : ' (sem link na Focus)'}</code>`).join(', ')}
                ${faltantes.length > 20 ? ` e mais ${faltantes.length - 20}` : ''}
              </p>
              ${recuperaveis
                ? `<button type="button" id="acervoRecuperar">Buscar os ${recuperaveis} XML que faltam</button>`
                : '<p class="muted">Nenhuma delas tem link da Focus gravado — nesse caso o XML só sai pelo painel da Focus NFe.</p>'}
            </div>
          ` : (saidas.total > 0 ? '<p class="muted">Acervo completo: toda nota do período tem XML guardado aqui.</p>' : '')}

          <div class="row" style="align-items: center; gap: 12px;">
            ${temArquivo
              ? `<button type="button" id="acervoZip">Baixar ${saidas.comXml + entradas.comXml} XML em zip</button>
                 <span class="muted">${saidas.comXml} de saída e ${entradas.comXml} de entrada,
                 de ${escapeHtml(diaBr(de))} a ${escapeHtml(diaBr(ate))}, em pastas separadas.</span>`
              : '<p class="muted">Nenhum XML arquivado neste período.</p>'}
          </div>
        `}
      </div>
    `;

    F.ligarSeletor(ctx, redesenhar);
    document.getElementById('acervoBuscar')?.addEventListener('click', () => {
      state.fiscalAcervoDe = document.getElementById('acervoDe').value;
      state.fiscalAcervoAte = document.getElementById('acervoAte').value;
      redesenhar();
    });

    document.getElementById('acervoRecuperar')?.addEventListener('click', async (ev) => {
      const botao = ev.currentTarget;
      // Desabilita enquanto roda: são chamadas à Focus uma a uma, e dois
      // cliques disparariam o lote duas vezes.
      botao.disabled = true;
      botao.textContent = 'Buscando na Focus...';
      try {
        const res = await api('/api/fiscal/acervo/buscar-faltantes', {
          method: 'POST',
          body: JSON.stringify({ estabelecimentoId: escolhido, de, ate })
        });
        const partes = [`${res.recuperadas} de ${res.tentadas} recuperado(s)`];
        if (res.falhas?.length) partes.push(`${res.falhas.length} falhou: ${res.falhas[0].motivo}`);
        showToast(partes.join('. '), res.recuperadas ? 'success' : 'warning');
        redesenhar();
      } catch (e) {
        showToast(e.message || 'Não foi possível buscar os arquivos.', 'error');
        botao.disabled = false;
        botao.textContent = 'Tentar de novo';
      }
    });

    document.getElementById('acervoZip')?.addEventListener('click', async () => {
      // O zip NÃO vai por `api()`: aquele caminho faz `response.json()`, e um
      // zip parseado como JSON é um erro de sintaxe. Aqui a resposta é binária,
      // então é fetch cru com o token no cabeçalho — o mesmo que a tela de
      // NF-e já faz para baixar XML e DANFE individuais.
      try {
        const resposta = await fetch(`/api/fiscal/acervo/zip?estabelecimentoId=${encodeURIComponent(escolhido)}`
          + `&de=${encodeURIComponent(de)}&ate=${encodeURIComponent(ate)}`,
        // `getSessionToken()` é o global do app.js, e é assim que as outras
        // telas que baixam binário fazem (nfe_emitidas.js, entrada_nfe.js). Ler
        // o sessionStorage na mão aqui significaria repetir o nome da chave —
        // e no dia em que ela mudasse, esta tela quebraria sozinha.
        { headers: { 'x-auth-token': (typeof getSessionToken === 'function' ? getSessionToken() : '') || '' } });
        if (!resposta.ok) {
          const erroJson = await resposta.json().catch(() => ({}));
          throw new Error(erroJson.error || `Falha ao gerar o zip (${resposta.status}).`);
        }
        const blob = await resposta.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `xml-${de}-a-${ate}.zip`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        // Sem o revoke o blob fica na memória da aba até recarregar, e um zip de
        // um mês não é pequeno.
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      } catch (e) {
        showToast(e.message || 'Não foi possível baixar o zip.', 'error');
      }
    });
  }

  window.MavisSubscreenRegistry.fiscal.arquivos = desenhar;
}(window.MavisFiscalDocs));
