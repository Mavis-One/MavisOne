window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.fiscal = window.MavisSubscreenRegistry.fiscal || {};

// CONFERIR SPED: lê o arquivo da EFD que o sistema antigo gerou, diz o que está
// errado e devolve um arquivo corrigido.
//
// POR QUE ESTA TELA EXISTE ANTES DE "GERAR SPED". Em 01/10/2026 este sistema
// não tem nenhuma nota fiscal — as de setembro saíram pelo ViperERP — e um SPED
// gerado daqui sairia vazio. O arquivo do Viper, lido pelo gerador daqui, tinha
// defeitos que ninguém via: o de setembro declara 68 linhas no Bloco K e tem
// 67, e todos os meses declaram crédito de ICMS zero.
//
// A FRONTEIRA, que a tela tem de deixar à vista: o arquivo corrigido muda a
// FORMA (contagens, casas decimais, espaços, codificação) e nunca o CONTEÚDO.
// Crédito, débito e E116 mudam o imposto, e quem decide é o contador — esses
// aparecem como "não corrigido", com o número que daria.
//
// Nada fica guardado: o arquivo vai, a conferência volta, e sair da tela
// descarta as duas. Não é dado do sistema.
(function () {
  const GRAVIDADE = {
    erro: { rotulo: 'erro', tom: 'danger', ordem: 0 },
    atencao: { rotulo: 'atenção', tom: 'warning', ordem: 1 },
    info: { rotulo: 'forma', tom: 'muted', ordem: 2 }
  };

  const CAMPOS_E110 = [
    ['VL_TOT_DEBITOS', 'Débitos (saídas)'],
    ['VL_TOT_CREDITOS', 'Créditos (entradas)'],
    ['VL_SLD_CREDOR_ANT', 'Saldo credor do mês anterior'],
    ['VL_SLD_APURADO', 'Saldo devedor apurado'],
    ['VL_ICMS_RECOLHER', 'ICMS a recolher'],
    ['VL_SLD_CREDOR_TRANSPORTAR', 'Saldo credor a transportar'],
    ['DEB_ESP', 'Débito especial (extemporâneo)']
  ];

  // O resultado vive aqui, e não em `state`: é do arquivo que foi escolhido
  // agora, e não deve reaparecer ao voltar à tela outro dia.
  let resultado = null;

  const brl = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
    'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const mesBr = (iso) => {
    const m = /^(\d{4})-(\d{2})$/.exec(String(iso || ''));
    return m ? `${MESES[Number(m[2]) - 1]} de ${m[1]}` : '—';
  };
  const cnpjBr = (c) => String(c || '').replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');

  /** Bytes do arquivo em base64, em fatias: um SPED de 450 KB estoura o
   *  `String.fromCharCode(...bytes)` de uma vez só. */
  function paraBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(bin);
  }

  function baixar(base64, nome) {
    const bin = atob(base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    // Latin-1 declarado no tipo: é o que o Guia pede e o que o arquivo é.
    const url = URL.createObjectURL(new Blob([bytes], { type: 'text/plain;charset=iso-8859-1' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = nome;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  function relatorio(escapeHtml) {
    const r = resultado;
    const a = r.arquivo;
    const problemas = [...r.problemas].sort((x, y) => GRAVIDADE[x.gravidade].ordem - GRAVIDADE[y.gravidade].ordem);
    const naoCorrigidos = problemas.filter((p) => !p.corrigido && p.gravidade !== 'info');
    const corrigidos = problemas.filter((p) => p.corrigido);

    const cabecalho = a.competencia ? `
      <div class="cards">
        <div class="card"><h3>Competência</h3><p>${escapeHtml(mesBr(a.competencia))}</p></div>
        <div class="card"><h3>Empresa</h3><p style="font-size: 0.95rem;">${escapeHtml(a.empresa)}<br><span class="muted">${escapeHtml(cnpjBr(a.cnpj))} · IE ${escapeHtml(a.ie || '—')}</span></p></div>
        <div class="card"><h3>Notas no arquivo</h3><p>${r.resumo.notas.toLocaleString('pt-BR')}</p>
          <span class="muted">${r.resumo.saidas} saídas · ${r.resumo.entradas} entradas · ${r.resumo.canceladas} canceladas</span></div>
        <div class="card"><h3>Linhas</h3><p>${(a.linhas || 0).toLocaleString('pt-BR')}</p>
          <span class="muted">leiaute ${escapeHtml(a.codVer || '—')} · ${escapeHtml(a.codificacao)}</span></div>
      </div>` : '';

    // O VEREDITO em uma frase. É o que a pessoa precisa saber antes de ler o
    // resto: dá para entregar o corrigido, ou ainda falta decisão?
    const veredito = !r.corrigido && !r.apuracao
      ? `<p class="fiscal-aviso-homologacao"><strong>O arquivo não pôde ser conferido.</strong></p>`
      : naoCorrigidos.length
        ? `<p class="sales-totals-alerta"><strong>${naoCorrigidos.length} ${naoCorrigidos.length === 1 ? 'ponto precisa' : 'pontos precisam'} de decisão</strong>
            antes da entrega — o arquivo corrigido NÃO mexe neles. ${corrigidos.length ? `Os outros ${corrigidos.length} foram corrigidos.` : ''}</p>`
        : `<p class="sales-totals-nota"><strong>Nenhum ponto pendente de decisão.</strong>
            ${corrigidos.length ? `${corrigidos.length} ${corrigidos.length === 1 ? 'problema de forma foi corrigido' : 'problemas de forma foram corrigidos'} no arquivo abaixo.` : 'O arquivo já estava como o Guia pede.'}</p>`;

    const linhas = problemas.map((p) => {
      const g = GRAVIDADE[p.gravidade] || GRAVIDADE.info;
      const itens = p.itens && p.itens.length
        ? `<ul class="muted" style="margin: 6px 0 0 18px;">${p.itens.map((i) => `<li>${escapeHtml(i)}</li>`).join('')}</ul>` : '';
      return `
        <tr>
          <td><span class="finance-badge finance-badge-${g.tom}">${escapeHtml(g.rotulo)}</span></td>
          <td><strong>${escapeHtml(p.titulo)}</strong><br><span class="muted">${escapeHtml(p.detalhe || '')}</span>${itens}</td>
          <td>${p.corrigido
            ? '<span class="finance-badge finance-badge-success">corrigido no arquivo</span>'
            : '<span class="finance-badge finance-badge-warning">não corrigido</span>'}</td>
        </tr>`;
    }).join('');

    const tabelaProblemas = problemas.length ? `
      <div class="table-scroll">
        <table class="table">
          <thead><tr><th>Tipo</th><th>O que foi encontrado</th><th>No arquivo corrigido</th></tr></thead>
          <tbody>${linhas}</tbody>
        </table>
      </div>` : '';

    const ap = r.apuracao;
    const apuracao = ap ? `
      <div class="panel">
        <h3>Apuração do ICMS (E110)</h3>
        <p class="muted">O &ldquo;declarado&rdquo; é o que está no arquivo. O &ldquo;pelas notas&rdquo; é o mesmo E110 refeito
        a partir das notas do próprio arquivo (registro C190), com o saldo anterior e os ajustes que o arquivo declara.</p>
        <div class="table-scroll">
          <table class="table">
            <thead><tr><th>Campo</th><th class="num">Declarado</th><th class="num">Pelas notas</th><th></th></tr></thead>
            <tbody>
              ${CAMPOS_E110.map(([k, rotulo]) => {
                const d = ap.declarado[k] || 0;
                const c = ap.calculado[k] || 0;
                const difere = Math.abs(d - c) >= 0.005;
                return `<tr>
                  <td>${escapeHtml(rotulo)} <span class="muted">${k}</span></td>
                  <td class="num">${brl(d)}</td>
                  <td class="num">${brl(c)}</td>
                  <td>${difere ? '<span class="finance-badge finance-badge-warning">difere</span>' : ''}</td>
                </tr>`;
              }).join('')}
              <tr>
                <td>Obrigações a recolher (soma do E116)</td>
                <td class="num">${brl(ap.somaE116)}</td>
                <td class="num">${brl(ap.esperadoE116)}</td>
                <td>${Math.abs(ap.somaE116 - ap.esperadoE116) >= 0.005 ? '<span class="finance-badge finance-badge-warning">difere</span>' : ''}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>` : '';

    const c = r.corrigido;
    const download = c && c.base64 ? `
      <div class="row" style="align-items: center; gap: 12px;">
        <button type="button" id="spedBaixarCorrigido">Baixar arquivo corrigido</button>
        <span class="muted">${escapeHtml(c.nome)} · ${c.linhas.toLocaleString('pt-BR')} linhas · ISO 8859-1.
        Conferir no PVA da Receita antes de transmitir.</span>
      </div>` : '';

    return `
      <div class="panel">
        <h3>${escapeHtml(a.nome)}</h3>
        ${cabecalho}
        ${veredito}
        ${tabelaProblemas}
        ${download}
      </div>
      ${apuracao}`;
  }

  async function desenhar(ctx) {
    const { api, content, escapeHtml, showToast } = ctx;

    content.innerHTML = `
      <div class="panel">
        <div class="cadastro-page-head">
          <div>
            <h3>Conferir SPED</h3>
            <p class="muted">
              Escolha o arquivo da EFD ICMS/IPI gerado pelo sistema anterior (<code>.txt</code>).
              A conferência diz o que está errado e devolve um arquivo corrigido.
            </p>
            <p class="muted">
              <strong>O corrigido muda só a forma</strong> — contagens de linhas, casas decimais, espaços
              e a codificação que o Guia Prático pede. <strong>Valores não são alterados</strong>: crédito,
              débito e obrigações a recolher mudam o imposto, e aparecem como &ldquo;não corrigido&rdquo;
              para o contador decidir.
            </p>
          </div>
        </div>
        <div class="row" style="align-items: center; gap: 12px;">
          <button type="button" id="spedEscolher">Escolher arquivo do SPED</button>
          <input type="file" id="spedArquivo" accept=".txt,text/plain" hidden />
          <span class="muted" id="spedSituacao">${resultado ? '' : 'Nenhum arquivo conferido ainda.'}</span>
        </div>
      </div>
      <div id="spedResultado">${resultado ? relatorio(escapeHtml) : ''}</div>`;

    const entrada = content.querySelector('#spedArquivo');
    const situacao = content.querySelector('#spedSituacao');
    content.querySelector('#spedEscolher').addEventListener('click', () => entrada.click());

    entrada.addEventListener('change', async () => {
      const arquivo = entrada.files && entrada.files[0];
      if (!arquivo) return;
      situacao.textContent = `Conferindo ${arquivo.name}...`;
      try {
        const buffer = await arquivo.arrayBuffer();
        resultado = await api('/api/fiscal/sped/conferir', {
          method: 'POST',
          body: JSON.stringify({ nome: arquivo.name, conteudoBase64: paraBase64(buffer) })
        });
        desenhar(ctx);
      } catch (e) {
        situacao.textContent = '';
        showToast(e.message || 'Não foi possível conferir o arquivo.', 'error');
      } finally {
        // Sem limpar, escolher o MESMO arquivo de novo não dispara `change`.
        entrada.value = '';
      }
    });

    content.querySelector('#spedBaixarCorrigido')?.addEventListener('click', () => {
      baixar(resultado.corrigido.base64, resultado.corrigido.nome);
    });
  }

  window.MavisSubscreenRegistry.fiscal.sped_conferir = desenhar;
})();
