window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.fiscal = window.MavisSubscreenRegistry.fiscal || {};

// GERAR SPED: a EFD ICMS/IPI de um estabelecimento num mês, a partir das notas
// deste sistema — as emitidas pela Focus e as de entrada lançadas por XML.
//
// A TELA TEM TRÊS PARTES, e a ordem é a da pergunta que a pessoa faz:
//
//   1. PODE GERAR? — o que impede, o que só avisa, e as notas que ainda não
//      puderam ser escrituradas (autorizada sem XML baixado, por exemplo).
//   2. O QUE VAI SAIR — quantas notas, e a apuração do ICMS do mês.
//   3. OS DADOS DO SPED — o que não vem de nota nenhuma: contador, perfil,
//      código de receita, saldo inicial, e a decisão sobre o crédito das
//      entradas. Preenchíveis a partir do último SPED do sistema anterior.
//
// O botão de gerar só existe quando nada impede. A prévia e o arquivo passam
// pelo mesmo caminho no servidor: o que a tela diz é o que o arquivo será.
//
// O QUE ESTA TELA NÃO SABE: notas que saíram por OUTRO sistema no mesmo mês.
// Enquanto parte das vendas sai pelo Viper, o SPED daqui não tem essas notas —
// e isso está escrito na tela, perto do botão.
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

  // A sugestão lida do SPED do sistema anterior. Fica na tela até a pessoa
  // salvar ou trocar de estabelecimento — não é gravada sozinha.
  let importada = null;

  const brl = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const mesBr = (iso) => {
    const m = /^(\d{4})-(\d{2})$/.exec(String(iso || ''));
    return m ? `${MESES[Number(m[2]) - 1]} de ${m[1]}` : String(iso || '');
  };
  // A EFD que se prepara em outubro é a de setembro: o padrão é o mês passado.
  function mesPassado() {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  function paraBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }

  function lista(escapeHtml, itens) {
    return itens && itens.length
      ? `<ul class="muted" style="margin: 6px 0 0 18px;">${itens.map((i) => `<li>${escapeHtml(i)}</li>`).join('')}</ul>` : '';
  }

  function blocoSituacao(escapeHtml, previa, erroPrevia) {
    if (erroPrevia) return `<p class="fiscal-aviso-homologacao">${escapeHtml(erroPrevia)}</p>`;
    const imp = previa.impedimentos || [];
    const av = previa.avisos || [];
    const pend = (previa.sincronia && previa.sincronia.pendentes) || [];
    const veredito = imp.length
      ? `<p class="sales-totals-alerta"><strong>${imp.length} ${imp.length === 1 ? 'ponto impede' : 'pontos impedem'}</strong> a geração do SPED de ${escapeHtml(mesBr(previa.competencia))}.</p>`
      : `<p class="sales-totals-nota"><strong>Pronto para gerar.</strong> Nada impede o SPED de ${escapeHtml(mesBr(previa.competencia))}${av.length ? ` — ${av.length} ${av.length === 1 ? 'aviso' : 'avisos'} abaixo` : ''}.</p>`;
    const linha = (tom, rotulo, x) => `
      <tr>
        <td><span class="finance-badge finance-badge-${tom}">${rotulo}</span></td>
        <td><strong>${escapeHtml(x.titulo)}</strong><br><span class="muted">${escapeHtml(x.detalhe || '')}</span>${lista(escapeHtml, x.itens)}</td>
      </tr>`;
    const linhas = [
      ...imp.map((x) => linha('danger', 'impede', x)),
      ...(pend.length ? [linha('warning', 'pendente', {
        titulo: `${pend.length} nota(s) do mês ainda não puderam ser escrituradas`,
        detalhe: 'Elas ficam FORA do arquivo enquanto isso. Nota autorizada sem XML: busque o XML em Fiscal › Arquivos Fiscais.',
        itens: pend.slice(0, 20)
      })] : []),
      ...av.map((x) => linha('warning', 'aviso', x))
    ].join('');
    return veredito + (linhas ? `<div class="table-scroll"><table class="table"><tbody>${linhas}</tbody></table></div>` : '');
  }

  function blocoResumo(escapeHtml, previa) {
    const r = previa.resumo || {};
    const a = previa.apuracao || {};
    const pode = !(previa.impedimentos || []).length;
    const campos = [
      ['VL_TOT_DEBITOS', 'Débitos (saídas)'],
      ['VL_TOT_CREDITOS', 'Créditos (entradas)'],
      ['VL_SLD_CREDOR_ANT', 'Saldo credor do mês anterior'],
      ['VL_ICMS_RECOLHER', 'ICMS a recolher'],
      ['VL_SLD_CREDOR_TRANSPORTAR', 'Saldo credor para o mês seguinte'],
      ['DEB_ESP', 'Débito especial (extemporâneo)']
    ];
    return `
      <div class="panel">
        <h3>O que vai sair</h3>
        <div class="cards">
          <div class="card"><h3>Notas no mês</h3><p>${(r.documentos || 0).toLocaleString('pt-BR')}</p>
            <span class="muted">${r.saidas || 0} saídas · ${r.entradas || 0} entradas · ${r.canceladas || 0} canceladas</span></div>
          <div class="card"><h3>Participantes</h3><p>${(r.participantes || 0).toLocaleString('pt-BR')}</p><span class="muted">clientes e fornecedores (0150)</span></div>
          <div class="card"><h3>Itens de entrada</h3><p>${(r.itensC170 || 0).toLocaleString('pt-BR')}</p><span class="muted">${r.itens || 0} produtos no 0200</span></div>
          <div class="card"><h3>ICMS a recolher</h3><p>${brl(a.VL_ICMS_RECOLHER)}</p><span class="muted">apuração do mês (E110)</span></div>
        </div>
        <div class="table-scroll">
          <table class="table">
            <thead><tr><th>Apuração do ICMS (E110)</th><th class="num">Valor</th></tr></thead>
            <tbody>${campos.map(([k, rotulo]) => `<tr><td>${escapeHtml(rotulo)} <span class="muted">${k}</span></td>
              <td class="num">${a[k] === null || a[k] === undefined ? '—' : brl(a[k])}</td></tr>`).join('')}</tbody>
          </table>
        </div>
        <p class="muted">
          <strong>Só entram as notas deste sistema</strong>: as emitidas pela Focus e as entradas lançadas por XML.
          Nota que saiu por outro sistema no mesmo mês não está aqui — e um SPED sem ela declara menos do que houve.
        </p>
        <div class="row" style="align-items: center; gap: 12px;">
          ${pode
            ? '<button type="button" id="spedGerarBaixar">Gerar e baixar o SPED</button><span class="muted">Arquivo em ISO 8859-1, pronto para o PVA da Receita. Valide no PVA antes de transmitir.</span>'
            : '<button type="button" disabled>Gerar e baixar o SPED</button><span class="muted">Resolva o que impede, acima.</span>'}
        </div>
      </div>`;
  }

  function campo(escapeHtml, nome, rotulo, valor, dica, tipo = 'text') {
    return `<label>${escapeHtml(rotulo)}
      <input type="${tipo}" data-cfg="${nome}" value="${escapeHtml(valor === null || valor === undefined ? '' : String(valor))}" ${dica ? `placeholder="${escapeHtml(dica)}"` : ''} />
    </label>`;
  }

  function blocoConfiguracao(escapeHtml, cfg, estab) {
    const v = importada ? { ...cfg, ...importada.sugestao } : cfg;
    const ind = v.indicadores_1010 || {};
    const outroCnpj = importada && importada.origem.cnpj && estab && importada.origem.cnpj !== String(estab.cnpj).replace(/\D/g, '');
    const banner = importada ? `
      <div class="fiscal-aviso-cst">
        <p><strong>Preenchido a partir do SPED de ${escapeHtml(mesBr(importada.origem.competencia))}</strong>
        (${escapeHtml(importada.origem.empresa)}). <strong>Ainda não foi salvo</strong> — confira e salve.</p>
        ${outroCnpj ? `<p class="form-error">Atenção: o arquivo é do CNPJ ${escapeHtml(importada.origem.cnpj)}, e não deste estabelecimento.</p>` : ''}
        ${lista(escapeHtml, importada.observacoes)}
      </div>` : '';
    return `
      <div class="panel">
        <div class="cadastro-page-head">
          <div>
            <h3>Dados do SPED deste estabelecimento</h3>
            <p class="muted">O que o arquivo precisa e não vem de nota nenhuma. O jeito mais seguro de preencher é a partir
            do último SPED que o sistema anterior gerou para este CNPJ.</p>
          </div>
          <div class="row" style="gap: 8px;">
            <button type="button" id="spedImportarEscolher">Preencher a partir do último SPED anterior</button>
            <input type="file" id="spedImportarArquivo" accept=".txt,text/plain" hidden />
          </div>
        </div>
        ${banner}

        <h4>Crédito do ICMS das entradas</h4>
        <p class="muted">Os SPEDs do sistema anterior declaram <strong>crédito zero</strong> em todos os meses, mesmo com ICMS
        destacado nas notas de entrada. As duas escolhas abaixo dão impostos diferentes — <strong>decida com o contador</strong>.
        Enquanto nada for escolhido, o SPED não é gerado.</p>
        <div class="row" style="gap: 24px; flex-wrap: wrap;">
          <label><input type="radio" name="spedCredito" value="DESTACADO" ${v.credito_icms_entradas === 'DESTACADO' ? 'checked' : ''} />
            Tomar o crédito do ICMS destacado nas entradas</label>
          <label><input type="radio" name="spedCredito" value="NENHUM" ${v.credito_icms_entradas === 'NENHUM' ? 'checked' : ''} />
            Não tomar crédito (entradas sem base e sem ICMS)</label>
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
          ${campo(escapeHtml, 'e116_codigo_receita', 'Código de receita do ICMS (E116)', v.e116_codigo_receita, '144910014')}
          ${campo(escapeHtml, 'e116_dia_vencimento', 'Dia do vencimento no mês seguinte', v.e116_dia_vencimento, '10', 'number')}
        </div>

        <h4>Onde a escrituração deste sistema começa</h4>
        <p class="muted">O saldo credor do primeiro mês é o do último SPED do sistema anterior (campo 14 do E110). Daí em diante
        cada mês passa o saldo ao seguinte. Corrigir uma nota de um mês já entregue muda os meses depois dele.</p>
        <div class="row" style="gap: 12px; flex-wrap: wrap;">
          ${campo(escapeHtml, 'competencia_inicial', 'Primeira competência gerada aqui', v.competencia_inicial, '', 'month')}
          ${campo(escapeHtml, 'saldo_credor_inicial', 'Saldo credor com que ela começa (R$)', v.saldo_credor_inicial, '0,00')}
          <label style="align-self: end;"><input type="checkbox" data-cfg="bloco_k_obrigatorio" ${v.bloco_k_obrigatorio ? 'checked' : ''} />
            Obrigado ao Bloco K (estoque)</label>
        </div>

        <h4>Contabilista (registro 0100)</h4>
        <div class="row" style="gap: 12px; flex-wrap: wrap;">
          ${CONTADOR.map(([k, r, d]) => campo(escapeHtml, k, r, v[k], d)).join('')}
        </div>

        <h4>Registro 1010 — a empresa tem…</h4>
        <p class="muted">Cada &ldquo;sim&rdquo; obriga um registro do Bloco 1 que este sistema ainda não gera.</p>
        <div class="row" style="gap: 6px 24px; flex-wrap: wrap;">
          ${INDICADORES.map(([k, r]) => `<label><input type="checkbox" data-ind="${k}" ${ind[k] === 'S' ? 'checked' : ''} /> ${escapeHtml(r)}</label>`).join('')}
        </div>

        <div class="row" style="align-items: center; gap: 12px; margin-top: 12px;">
          <button type="button" id="spedSalvarConfig">Salvar dados do SPED</button>
          ${importada ? '<button type="button" id="spedDescartarImport" class="secondary">Descartar o que foi preenchido</button>' : ''}
        </div>
      </div>`;
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
      content.innerHTML = F.semEstabelecimento(escapeHtml, 'Gerar SPED', erro);
      return;
    }
    if (state.spedGerarEstab !== escolhido) {
      // A sugestão importada é de UM estabelecimento; trocar de estabelecimento
      // a descarta, senão o contador de uma filial iria parar em outra.
      importada = null;
      state.spedGerarEstab = escolhido;
    }
    const estab = estabs.find((e) => e.id === escolhido);
    const competencia = state.spedGerarCompetencia || mesPassado();
    const q = `estabelecimentoId=${encodeURIComponent(escolhido)}`;

    content.innerHTML = '<div class="panel"><h3>Gerar SPED</h3><p class="muted">Escriturando as notas do mês e montando a prévia...</p></div>';
    let cfg = {};
    let previa = null;
    let erroPrevia = null;
    try {
      const [c, p] = await Promise.all([
        api(`/api/fiscal/sped/configuracao?${q}`),
        api(`/api/fiscal/sped/previa?${q}&competencia=${encodeURIComponent(competencia)}`).catch((e) => { erroPrevia = e.message || 'Não foi possível montar a prévia.'; return null; })
      ]);
      cfg = c.configuracao || {};
      previa = p;
    } catch (e) {
      content.innerHTML = `<div class="panel"><h3>Gerar SPED</h3><p class="form-error">${escapeHtml(e.message || 'Não foi possível carregar.')}</p></div>`;
      return;
    }

    content.innerHTML = `
      <div class="panel">
        <div class="cadastro-page-head">
          <div>
            <h3>Gerar SPED — ${escapeHtml(mesBr(competencia))}</h3>
            <p class="muted">A EFD ICMS/IPI do estabelecimento, montada a partir das notas deste sistema.</p>
          </div>
          <div class="row" style="gap: 12px; align-items: end;">
            ${F.seletorEstabelecimento(escapeHtml, estabs, escolhido)}
            <label>Competência <input type="month" id="spedGerarCompetencia" value="${escapeHtml(competencia)}" /></label>
          </div>
        </div>
        ${blocoSituacao(escapeHtml, previa || {}, erroPrevia)}
      </div>
      ${previa ? blocoResumo(escapeHtml, previa) : ''}
      ${blocoConfiguracao(escapeHtml, cfg, estab)}`;

    F.ligarSeletor(ctx, () => desenhar(ctx));
    content.querySelector('#spedGerarCompetencia').addEventListener('change', (ev) => {
      state.spedGerarCompetencia = ev.target.value;
      desenhar(ctx);
    });

    content.querySelector('#spedGerarBaixar')?.addEventListener('click', async (ev) => {
      const botao = ev.currentTarget;
      botao.disabled = true;
      botao.textContent = 'Gerando...';
      try {
        // Binário (Latin-1): fetch cru com o token, como Arquivos Fiscais faz
        // com o zip — `api()` faria .json() na resposta.
        const resposta = await fetch(`/api/fiscal/sped/gerar?${q}&competencia=${encodeURIComponent(competencia)}`,
          { headers: { 'x-auth-token': (typeof getSessionToken === 'function' ? getSessionToken() : '') || '' } });
        if (!resposta.ok) {
          const j = await resposta.json().catch(() => ({}));
          throw new Error(j.error || `Falha ao gerar o SPED (${resposta.status}).`);
        }
        const nome = (/filename="([^"]+)"/.exec(resposta.headers.get('Content-Disposition') || '') || [])[1] || `sped-${competencia}.txt`;
        const url = URL.createObjectURL(await resposta.blob());
        const a = document.createElement('a');
        a.href = url;
        a.download = nome;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
        showToast('SPED gerado. Valide no PVA da Receita antes de transmitir.', 'success');
      } catch (e) {
        showToast(e.message || 'Não foi possível gerar o SPED.', 'error');
      } finally {
        botao.disabled = false;
        botao.textContent = 'Gerar e baixar o SPED';
      }
    });

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
        desenhar(ctx);
      } catch (e) {
        showToast(e.message || 'Não foi possível ler o arquivo.', 'error');
      } finally {
        arquivo.value = '';
      }
    });
    content.querySelector('#spedDescartarImport')?.addEventListener('click', () => { importada = null; desenhar(ctx); });

    content.querySelector('#spedSalvarConfig').addEventListener('click', async (ev) => {
      const botao = ev.currentTarget;
      botao.disabled = true;
      try {
        await api(`/api/fiscal/sped/configuracao?${q}`, { method: 'PUT', body: JSON.stringify(lerFormulario(content)) });
        importada = null;
        showToast('Dados do SPED salvos.', 'success');
        desenhar(ctx);
      } catch (e) {
        showToast(e.message || 'Não foi possível salvar.', 'error');
        botao.disabled = false;
      }
    });
  }

  window.MavisSubscreenRegistry.fiscal.sped_gerar = desenhar;
}(window.MavisFiscalDocs));
