window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.fiscal = window.MavisSubscreenRegistry.fiscal || {};

// SPED FISCAL (EFD ICMS/IPI): gera o arquivo do mês a partir das notas deste
// sistema — as emitidas pela Focus e as entradas lançadas por XML.
//
// SIMPLIFICADA EM 01/10/2026, a partir das telas de SPED que o usuário mostrou
// (a do ViperERP e a de outro sistema): um formulário curto e um botão, e a
// lista do que já foi gerado embaixo. A primeira versão abria com a prévia, a
// apuração e o formulário de configuração inteiros na mesma página.
//
//   GERAR ARQUIVO       estabelecimento, mês, ano, vencimento da guia,
//                       retificador — e o botão. O que impede aparece ali
//                       mesmo, sob o botão; se nada impede, o arquivo baixa.
//   ARQUIVOS GERADOS    cada SPED gerado fica guardado (fase DM) e baixa de
//                       novo exatamente como foi entregue.
//   DADOS DO SPED       o que não vem de nota (contador, crédito, perfil…),
//                       recolhido — e aberto sozinho quando falta algo. SÓ
//                       PARA ADMINISTRADOR (01/10/2026): o servidor nem manda
//                       a configuração a quem não é (`restrito`), só a lista
//                       do que falta, para a pessoa saber a quem pedir.
//
// FORA, DE PROPÓSITO: "Inventário (Bloco H)" e "Bloco K", que as duas telas de
// referência têm. Este sistema não tem estoque por estabelecimento com data, e
// um botão que não faz o que promete é pior do que nenhum.
(function (F) {
  const INDICADORES = [
    ['IND_EXP', 'Exportação (registro 1100)'],
    ['IND_CCRF', 'Créditos de ICMS a controlar (registro 1200)'],
    ['IND_COMB', 'Combustíveis (registro 1300)'],
    ['IND_USINA', 'Usina de açúcar e álcool (registro 1390)'],
    ['IND_VA', 'Valores agregados (registro 1400)'],
    ['IND_EE', 'Energia elétrica (registro 1500)'],
    ['IND_CART', 'Vendas com cartão ou pagamento eletrônico (registro 1601)'],
    ['IND_FORM', 'Formulário de segurança (registro 1700)'],
    ['IND_AER', 'Transporte aéreo (registro 1800)'],
    ['IND_GIAF1', 'GIAF 1 (registro 1960)'],
    ['IND_GIAF3', 'GIAF 3 (registro 1970)'],
    ['IND_GIAF4', 'GIAF 4 (registro 1980)'],
    ['IND_REST_RESSARC', 'Restituição e ressarcimento de ICMS-ST (registro 1250)']
  ];

  const CONTADOR = [
    ['contador_nome', 'Nome do contador', ''],
    ['contador_cpf', 'CPF', 'só números'],
    ['contador_crc', 'CRC', ''],
    ['contador_cnpj', 'CNPJ do escritório', 'só números'],
    ['contador_cep', 'CEP', ''],
    ['contador_endereco', 'Endereço', ''],
    ['contador_numero', 'Número', ''],
    ['contador_complemento', 'Complemento', ''],
    ['contador_bairro', 'Bairro', ''],
    ['contador_telefone', 'Telefone', ''],
    ['contador_email', 'E-mail', ''],
    ['contador_codigo_municipio', 'Código IBGE do município', '7 dígitos']
  ];

  const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

  // Vive enquanto a tela está aberta: a sugestão lida do SPED anterior (ainda
  // não salva) e o resultado da última geração (o que aparece sob o botão).
  let importada = null;
  let resultado = null;

  const brl = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const mesBr = (iso) => {
    const m = /^(\d{4})-(\d{2})$/.exec(String(iso || ''));
    return m ? `${MESES[Number(m[2]) - 1]} de ${m[1]}` : String(iso || '');
  };
  const dataHora = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '');
  const token = () => (typeof getSessionToken === 'function' ? getSessionToken() : '') || '';

  // A EFD que se prepara em outubro é a de setembro: o padrão é o mês passado.
  function mesPassado() {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - 1);
    return { ano: d.getFullYear(), mes: d.getMonth() + 1 };
  }

  /** O vencimento sugerido: o dia configurado, no mês seguinte à competência. */
  function vencimentoSugerido(ano, mes, dia) {
    if (!dia) return '';
    const a = mes === 12 ? ano + 1 : ano;
    const m = mes === 12 ? 1 : mes + 1;
    const ultimo = new Date(a, m, 0).getDate();
    return `${a}-${String(m).padStart(2, '0')}-${String(Math.min(Number(dia), ultimo)).padStart(2, '0')}`;
  }

  function paraBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }

  async function baixar(id) {
    const resposta = await fetch(`/api/fiscal/sped/arquivos/${encodeURIComponent(id)}`, { headers: { 'x-auth-token': token() } });
    if (!resposta.ok) {
      const j = await resposta.json().catch(() => ({}));
      throw new Error(j.error || `Falha ao baixar (${resposta.status}).`);
    }
    const nome = (/filename="([^"]+)"/.exec(resposta.headers.get('Content-Disposition') || '') || [])[1] || 'sped.txt';
    const url = URL.createObjectURL(await resposta.blob());
    const a = document.createElement('a');
    a.href = url;
    a.download = nome;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  function itens(escapeHtml, lista) {
    return lista && lista.length
      ? `<ul class="muted" style="margin: 4px 0 0 18px;">${lista.map((i) => `<li>${escapeHtml(i)}</li>`).join('')}</ul>` : '';
  }

  /** O que aparece sob o botão depois de gerar. */
  function blocoResultado(escapeHtml) {
    if (!resultado) return '';
    const linha = (tom, rotulo, x) => `<li style="margin-bottom: 6px;"><span class="finance-badge finance-badge-${tom}">${rotulo}</span>
      <strong>${escapeHtml(x.titulo)}</strong><br><span class="muted">${escapeHtml(x.detalhe || '')}</span>${itens(escapeHtml, x.itens)}</li>`;
    if (resultado.impedimentos) {
      return `
        <div class="fiscal-aviso-cst" style="margin-top: 12px;">
          <p><strong>O SPED de ${escapeHtml(mesBr(resultado.competencia))} não foi gerado.</strong>
          ${resultado.impedimentos.length === 1 ? 'Um ponto impede' : `${resultado.impedimentos.length} pontos impedem`}:</p>
          <ul style="list-style: none; padding: 0; margin: 0;">${resultado.impedimentos.map((x) => linha('danger', 'impede', x)).join('')}</ul>
        </div>`;
    }
    const r = resultado.resumo || {};
    return `
      <div style="margin-top: 12px;">
        <p class="sales-totals-nota"><strong>SPED de ${escapeHtml(mesBr(resultado.competencia))} gerado</strong> —
        ${r.documentos || 0} nota(s), ICMS a recolher ${brl(resultado.apuracao && resultado.apuracao.VL_ICMS_RECOLHER)}.
        Valide no PVA da Receita antes de transmitir.</p>
        ${(resultado.avisos || []).length ? `<ul style="list-style: none; padding: 0; margin: 0;">${resultado.avisos.map((x) => linha('warning', 'aviso', x)).join('')}</ul>` : ''}
      </div>`;
  }

  function blocoArquivos(escapeHtml, arquivos) {
    if (!arquivos.length) return '<p class="muted" style="text-align: center; padding: 24px 0;">Nenhum arquivo gerado para este estabelecimento.</p>';
    return `
      <div class="table-scroll">
        <table class="table">
          <thead><tr><th>Competência</th><th>Gerado em</th><th>Por</th><th class="num">Notas</th><th class="num">ICMS a recolher</th><th></th><th></th></tr></thead>
          <tbody>${arquivos.map((a) => `
            <tr>
              <td>${escapeHtml(mesBr(a.competencia))}${a.retificadora ? ' <span class="finance-badge finance-badge-info">retificador</span>' : ''}</td>
              <td>${escapeHtml(dataHora(a.geradoEm))}</td>
              <td>${escapeHtml(a.geradoPor || '')}</td>
              <td class="num">${a.documentos}</td>
              <td class="num">${brl(a.icmsRecolher)}</td>
              <td>${a.avisos.length ? `<span class="finance-badge finance-badge-warning" title="${escapeHtml(a.avisos.map((x) => x.titulo).join(' · '))}">${a.avisos.length} aviso(s)</span>` : ''}</td>
              <td><button type="button" class="secondary" data-baixar="${escapeHtml(a.id)}">Baixar</button></td>
            </tr>`).join('')}</tbody>
        </table>
      </div>`;
  }

  function campo(escapeHtml, nome, rotulo, valor, dica, tipo = 'text') {
    return `<label>${escapeHtml(rotulo)}
      <input type="${tipo}" data-cfg="${nome}" value="${escapeHtml(valor === null || valor === undefined ? '' : String(valor))}" ${dica ? `placeholder="${escapeHtml(dica)}"` : ''} />
    </label>`;
  }

  // Caixa de marcar e botão de opção ao lado do texto. A regra global de input
  // estica o radio à largura toda (a bolinha ia parar longe do texto, visto no
  // print de 01/10/2026); .checkbox-grid já alinha o checkbox.
  const RADIO = 'style="width: auto; margin: 0;"';

  function blocoConfiguracao(escapeHtml, cfg, estab, falta) {
    const v = importada ? { ...cfg, ...importada.sugestao } : cfg;
    const ind = v.indicadores_1010 || {};
    const outroCnpj = importada && importada.origem.cnpj && estab && importada.origem.cnpj !== String(estab.cnpj).replace(/\D/g, '');
    return `
      <details class="panel" ${falta.length || importada ? 'open' : ''}>
        <summary style="cursor: pointer;"><strong>Dados do estabelecimento para o SPED</strong>
          ${falta.length
            ? `<span class="finance-badge finance-badge-danger">falta: ${escapeHtml(falta.join(', '))}</span>`
            : '<span class="finance-badge finance-badge-success">completo</span>'}
        </summary>
        <p>
          <button type="button" class="secondary" id="spedImportarEscolher">Preencher a partir do último SPED anterior</button>
          <input type="file" id="spedImportarArquivo" accept=".txt,text/plain" hidden />
        </p>
        ${importada ? `
          <div class="fiscal-aviso-cst">
            <p><strong>Preenchido a partir do SPED de ${escapeHtml(mesBr(importada.origem.competencia))}</strong>
            (${escapeHtml(importada.origem.empresa)}). <strong>Ainda não foi salvo</strong> — confira e salve.</p>
            ${outroCnpj ? `<p class="form-error">Atenção: o arquivo é do CNPJ ${escapeHtml(importada.origem.cnpj)}, e não deste estabelecimento.</p>` : ''}
            ${itens(escapeHtml, importada.observacoes)}
          </div>` : ''}

        <h4>Crédito do ICMS das entradas</h4>
        <div class="checkbox-grid">
          <label><input type="radio" ${RADIO} name="spedCredito" value="DESTACADO" ${v.credito_icms_entradas === 'DESTACADO' ? 'checked' : ''} /> Tomar o crédito do ICMS destacado nas entradas</label>
          <label><input type="radio" ${RADIO} name="spedCredito" value="NENHUM" ${v.credito_icms_entradas === 'NENHUM' ? 'checked' : ''} /> Não tomar crédito (entradas sem base e sem ICMS)</label>
        </div>

        <h4>Identificação e apuração</h4>
        <div class="row" style="gap: 12px; flex-wrap: wrap;">
          <label>Perfil
            <select data-cfg="perfil_sped">
              ${['', 'A', 'B', 'C'].map((p) => `<option value="${p}" ${String(v.perfil_sped || '') === p ? 'selected' : ''}>${p || '—'}</option>`).join('')}
            </select>
          </label>
          <label>Atividade
            <select data-cfg="indicador_atividade">
              <option value="" ${v.indicador_atividade === null || v.indicador_atividade === undefined ? 'selected' : ''}>—</option>
              <option value="0" ${String(v.indicador_atividade) === '0' ? 'selected' : ''}>0 — industrial ou equiparado</option>
              <option value="1" ${String(v.indicador_atividade) === '1' ? 'selected' : ''}>1 — outros</option>
            </select>
          </label>
          ${campo(escapeHtml, 'e116_codigo_receita', 'Código de receita do ICMS', v.e116_codigo_receita, '144910014')}
          ${campo(escapeHtml, 'e116_dia_vencimento', 'Dia de vencimento da guia', v.e116_dia_vencimento, '10', 'number')}
          ${campo(escapeHtml, 'competencia_inicial', 'Primeira competência gerada aqui', v.competencia_inicial, '', 'month')}
          ${campo(escapeHtml, 'saldo_credor_inicial', 'Saldo credor inicial (R$)', v.saldo_credor_inicial, '0,00')}
        </div>

        <h4>Contabilista</h4>
        <div class="row" style="gap: 12px; flex-wrap: wrap;">
          ${CONTADOR.map(([k, r, d]) => campo(escapeHtml, k, r, v[k], d)).join('')}
        </div>

        <h4>Registro 1010 — a empresa tem…</h4>
        <div class="checkbox-grid">
          ${INDICADORES.map(([k, r]) => `<label><input type="checkbox" data-ind="${k}" ${ind[k] === 'S' ? 'checked' : ''} /> ${escapeHtml(r)}</label>`).join('')}
          <label><input type="checkbox" data-cfg="bloco_k_obrigatorio" ${v.bloco_k_obrigatorio ? 'checked' : ''} /> Obrigado ao Bloco K (estoque)</label>
        </div>

        <div class="row" style="align-items: center; gap: 12px; margin-top: 12px;">
          <button type="button" id="spedSalvarConfig">Salvar dados do SPED</button>
          ${importada ? '<button type="button" class="secondary" id="spedDescartarImport">Descartar o que foi preenchido</button>' : ''}
        </div>
      </details>`;
  }

  function lerFormulario(content) {
    const dados = {};
    content.querySelectorAll('[data-cfg]').forEach((el) => {
      dados[el.dataset.cfg] = el.type === 'checkbox' ? el.checked : el.value;
    });
    const credito = content.querySelector('input[name="spedCredito"]:checked');
    dados.credito_icms_entradas = credito ? credito.value : null;
    dados.indicadores_1010 = {};
    content.querySelectorAll('[data-ind]').forEach((el) => { dados.indicadores_1010[el.dataset.ind] = el.checked ? 'S' : 'N'; });
    return dados;
  }

  async function desenhar(ctx) {
    const { api, content, escapeHtml, state, showToast } = ctx;
    const { lista: estabs, escolhido, erro } = await F.carregarEstabelecimentos(ctx);
    if (!estabs.length) {
      content.innerHTML = F.semEstabelecimento(escapeHtml, 'SPED Fiscal', erro);
      return;
    }
    if (state.spedGerarEstab !== escolhido) {
      // A sugestão importada e o resultado são de UM estabelecimento.
      importada = null;
      resultado = null;
      state.spedGerarEstab = escolhido;
    }
    const estab = estabs.find((e) => e.id === escolhido);
    const q = `estabelecimentoId=${encodeURIComponent(escolhido)}`;
    const padrao = mesPassado();
    const ano = Number(state.spedAno || padrao.ano);
    const mes = Number(state.spedMes || padrao.mes);

    let cfg = {};
    let falta = [];
    let restrito = true;
    let arquivos = [];
    try {
      const [c, a] = await Promise.all([api(`/api/fiscal/sped/configuracao?${q}`), api(`/api/fiscal/sped/arquivos?${q}`)]);
      cfg = c.configuracao || {};
      falta = c.faltando || [];
      restrito = c.restrito !== false;
      arquivos = a.arquivos || [];
    } catch (e) {
      content.innerHTML = `<div class="panel"><h3>SPED Fiscal (EFD ICMS/IPI)</h3><p class="form-error">${escapeHtml(e.message || 'Não foi possível carregar.')}</p></div>`;
      return;
    }
    // O vencimento: o que a pessoa digitou para ESTA competência, ou o sugerido
    // pelo dia configurado. Trocar mês/ano volta ao sugerido.
    const chave = `${escolhido}|${ano}-${mes}`;
    const vencimento = state.spedVencimentoChave === chave ? state.spedVencimento : vencimentoSugerido(ano, mes, cfg.e116_dia_vencimento);
    const anoAtual = new Date().getFullYear();
    const anos = [anoAtual - 2, anoAtual - 1, anoAtual];

    content.innerHTML = `
      <div class="panel">
        <h3>SPED Fiscal (EFD ICMS/IPI)</h3>
        <h4>Gerar arquivo</h4>
        <div class="row" style="gap: 12px; flex-wrap: wrap; align-items: end;">
          ${F.seletorEstabelecimento(escapeHtml, estabs, escolhido)}
          <label>Mês
            <select id="spedMes">${MESES.map((m, i) => `<option value="${i + 1}" ${i + 1 === mes ? 'selected' : ''}>${m[0].toUpperCase() + m.slice(1)}</option>`).join('')}</select>
          </label>
          <label>Ano
            <select id="spedAno">${anos.map((a) => `<option value="${a}" ${a === ano ? 'selected' : ''}>${a}</option>`).join('')}</select>
          </label>
          <label>Vencimento da guia do ICMS
            <input type="date" id="spedVencimento" value="${escapeHtml(vencimento || '')}" />
          </label>
        </div>
        <div class="row checkbox-grid" style="gap: 16px; align-items: center; margin-top: 12px;">
          <label><input type="checkbox" id="spedRetificadora" /> Arquivo retificador (substitui um já entregue)</label>
          <button type="button" id="spedGerar">Gerar SPED</button>
        </div>
        ${restrito && falta.length ? `<p class="fiscal-aviso-cst">Os dados do SPED deste estabelecimento estão incompletos
          (falta: ${escapeHtml(falta.join(', '))}). Só um administrador pode completá-los.</p>` : ''}
        <div id="spedResultado">${blocoResultado(escapeHtml)}</div>
      </div>

      <div class="panel">
        <h3>Arquivos gerados</h3>
        ${blocoArquivos(escapeHtml, arquivos)}
      </div>

      ${restrito ? '' : blocoConfiguracao(escapeHtml, cfg, estab, falta)}`;

    const redesenhar = () => desenhar(ctx);
    F.ligarSeletor(ctx, redesenhar);
    content.querySelector('#spedMes').addEventListener('change', (ev) => { state.spedMes = ev.target.value; resultado = null; redesenhar(); });
    content.querySelector('#spedAno').addEventListener('change', (ev) => { state.spedAno = ev.target.value; resultado = null; redesenhar(); });
    content.querySelector('#spedVencimento').addEventListener('change', (ev) => {
      state.spedVencimento = ev.target.value;
      state.spedVencimentoChave = chave;
    });

    content.querySelector('#spedGerar').addEventListener('click', async (ev) => {
      const botao = ev.currentTarget;
      const competencia = `${ano}-${String(mes).padStart(2, '0')}`;
      botao.disabled = true;
      botao.textContent = 'Gerando...';
      try {
        // fetch cru, e não api(): o 409 traz a LISTA do que impede, e api() só
        // repassa a mensagem.
        const resposta = await fetch('/api/fiscal/sped/gerar', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-auth-token': token() },
          body: JSON.stringify({
            estabelecimentoId: escolhido, competencia,
            vencimento: content.querySelector('#spedVencimento').value || null,
            retificadora: content.querySelector('#spedRetificadora').checked
          })
        });
        const j = await resposta.json().catch(() => ({}));
        if (resposta.status === 409 && j.impedimentos) {
          resultado = { competencia, impedimentos: j.impedimentos };
        } else if (!resposta.ok) {
          throw new Error(j.error || `Falha ao gerar o SPED (${resposta.status}).`);
        } else {
          resultado = { competencia, resumo: j.resumo, apuracao: j.apuracao, avisos: j.avisos };
          await baixar(j.arquivo.id);
        }
        redesenhar();
      } catch (e) {
        showToast(e.message || 'Não foi possível gerar o SPED.', 'error');
        botao.disabled = false;
        botao.textContent = 'Gerar SPED';
      }
    });

    content.querySelectorAll('[data-baixar]').forEach((b) => b.addEventListener('click', async () => {
      try { await baixar(b.dataset.baixar); } catch (e) { showToast(e.message, 'error'); }
    }));

    // Daqui para baixo, só a seção de dados do SPED — que não existe para quem
    // não é administrador.
    if (restrito) return;
    const arquivo = content.querySelector('#spedImportarArquivo');
    content.querySelector('#spedImportarEscolher').addEventListener('click', () => arquivo.click());
    arquivo.addEventListener('change', async () => {
      const f = arquivo.files && arquivo.files[0];
      if (!f) return;
      try {
        importada = await api('/api/fiscal/sped/configuracao/importar', {
          method: 'POST',
          body: JSON.stringify({ estabelecimentoId: escolhido, conteudoBase64: paraBase64(await f.arrayBuffer()) })
        });
        redesenhar();
      } catch (e) {
        showToast(e.message || 'Não foi possível ler o arquivo.', 'error');
      } finally {
        arquivo.value = '';
      }
    });
    content.querySelector('#spedDescartarImport')?.addEventListener('click', () => { importada = null; redesenhar(); });

    content.querySelector('#spedSalvarConfig').addEventListener('click', async (ev) => {
      const botao = ev.currentTarget;
      botao.disabled = true;
      try {
        await api(`/api/fiscal/sped/configuracao?${q}`, { method: 'PUT', body: JSON.stringify(lerFormulario(content)) });
        importada = null;
        showToast('Dados do SPED salvos.', 'success');
        redesenhar();
      } catch (e) {
        showToast(e.message || 'Não foi possível salvar.', 'error');
        botao.disabled = false;
      }
    });
  }

  window.MavisSubscreenRegistry.fiscal.sped_gerar = desenhar;
}(window.MavisFiscalDocs));
