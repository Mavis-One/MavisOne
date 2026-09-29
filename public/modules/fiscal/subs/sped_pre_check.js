window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.fiscal = window.MavisSubscreenRegistry.fiscal || {};

// PRÉ-CHECK DO SPED: o que falta para gerar a EFD da competência.
//
// ESTA TELA NÃO GERA ARQUIVO, e o nome diz isso. Gerar a EFD exige o layout de
// serialização de cada registro — ordem, tipo, tamanho, decimais e
// obrigatoriedade de cada campo — que sai do Guia Prático da versão que o
// arquivo declara. Enquanto isso não estiver em mãos, uma tela de "Gerar"
// produziria um arquivo que o PVA recusa, ou pior, aceita com o valor no campo
// errado.
//
// O que ela responde é a outra metade da pergunta, e essa metade dá para
// responder hoje: DE TUDO QUE O ARQUIVO PRECISA, o que este sistema já tem?
//
// A LISTA DE REGISTROS NÃO É INVENTADA. Ela foi levantada do arquivo que o
// SISTEMA ATUAL gerou para agosto de 2026 — 2.176 linhas, 40 tipos de registro
// — então cada linha desta tela é um registro que a escrituração desta empresa
// efetivamente usa, com a contagem de agosto ao lado como ordem de grandeza.
//
// O TERCEIRO ESTADO, E POR QUE ELE EXISTE
// ---------------------------------------
// Uma conferência aqui tem QUATRO resultados, e não dois:
//
//   ok ................ olhou N linhas e nenhuma tem problema
//   impede/atenção .... olhou N e M têm problema
//   sem base .......... NÃO HAVIA O QUE OLHAR
//   não existe ........ o dado não sai de lugar nenhum deste sistema
//
// "Sem base" é o estado de quase todo o Bloco C hoje, porque há 0 documentos
// fiscais. "0 itens sem CFOP" é verdade e é inútil quando não há item — e uma
// tela que pintasse isso de verde diria que está tudo pronto para gerar um
// arquivo vazio. Por isso ele aparece em cinza e conta separado no resumo.
//
// "Não existe" é a categoria que o arquivo de verdade revelou: o registro 0100
// (o contabilista), o 0450 e o C110 (observações do lançamento), o C190
// (analítico por CST x CFOP x alíquota) e o Bloco E inteiro não têm de onde
// sair aqui. Não é pendência de cadastro — é trabalho que não estava em nenhuma
// fase do plano porque ninguém sabia que existia.
(function () {
  const ESTADOS = {
    impede: { rotulo: 'impede', tom: 'danger' },
    atencao: { rotulo: 'atenção', tom: 'warning' },
    semFonte: { rotulo: 'não existe no sistema', tom: 'info' },
    semBase: { rotulo: 'sem base para conferir', tom: 'muted' },
    ok: { rotulo: 'ok', tom: 'success' }
  };

  /** Qual dos quatro estados esta conferência está. A ordem importa. */
  function estadoDe(c) {
    // `semFonte` vem primeiro porque ele também tem `avaliados = 0`, e sem esta
    // saída todo registro sem fonte apareceria como "sem base" — que sugere
    // "ainda não há dado", quando o certo é "não há onde guardar".
    if (c.gravidade === 'semFonte') return ESTADOS.semFonte;
    if (c.semBase) return ESTADOS.semBase;
    if (c.pendentes > 0) return ESTADOS[c.gravidade] || ESTADOS.atencao;
    return ESTADOS.ok;
  }

  const NOME_DO_BLOCO = {
    0: 'Bloco 0 — abertura, cadastros e tabelas',
    B: 'Bloco B — ISS',
    C: 'Bloco C — documentos fiscais de mercadoria',
    D: 'Bloco D — serviços de transporte',
    E: 'Bloco E — apuração do ICMS e do IPI',
    G: 'Bloco G — CIAP (ativo imobilizado)',
    H: 'Bloco H — inventário',
    K: 'Bloco K — produção e estoque',
    1: 'Bloco 1 — obrigações específicas',
    9: 'Bloco 9 — controle e encerramento'
  };

  /** 'aaaa-mm' -> 'agosto de 2026'. */
  function mesBr(competencia) {
    const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
      'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
    const m = /^(\d{4})-(\d{2})$/.exec(String(competencia || ''));
    if (!m) return String(competencia || '');
    return `${MESES[Number(m[2]) - 1]} de ${m[1]}`;
  }

  async function desenhar(ctx) {
    const { api, content, escapeHtml, state } = ctx;

    // O mês passado é o padrão, e quem escolhe outro fica com a escolha. O
    // servidor também tem esse padrão: um lado só teria de adivinhar o outro.
    const competencia = state.spedCompetencia || '';
    const query = competencia ? `?competencia=${encodeURIComponent(competencia)}` : '';

    let dados = null;
    let erro = null;
    try {
      dados = await api(`/api/fiscal/sped/pre-check${query}`);
    } catch (e) {
      erro = e.message || 'Não foi possível rodar o pré-check do SPED.';
    }

    if (erro) {
      content.innerHTML = `
        <div class="panel">
          <h3>Pré-check do SPED</h3>
          <p class="form-error">${escapeHtml(erro)}</p>
        </div>`;
      return;
    }

    const r = dados.resumo;
    const ref = dados.referencia;

    const cabecalho = `
      <div class="panel">
        <div class="cadastro-page-head">
          <div>
            <h3>Pré-check do SPED — ${escapeHtml(mesBr(dados.competencia))}</h3>
            <p class="muted">
              O que falta para gerar a EFD ICMS/IPI de ${escapeHtml(dados.de)} a ${escapeHtml(dados.ate)}.
              <strong>Esta tela não gera o arquivo</strong>: ela diz o que estaria faltando se ele fosse gerado.
            </p>
          </div>
          <div class="row">
            <label>Competência
              <input type="month" id="spedCompetencia" value="${escapeHtml(dados.competencia)}" />
            </label>
          </div>
        </div>

        <p class="${r.impedem ? 'sales-totals-alerta' : 'sales-totals-nota'}">
          <strong>${r.impedem}</strong> ${r.impedem === 1 ? 'pendência impede' : 'pendências impedem'} a geração ·
          <strong>${r.atencoes}</strong> ${r.atencoes === 1 ? 'merece atenção' : 'merecem atenção'} ·
          <strong>${r.semFonte}</strong> ${r.semFonte === 1 ? 'registro não existe' : 'registros não existem'} no sistema ·
          <strong>${r.semBase}</strong> sem base para conferir
        </p>

        <p class="muted">
          A lista de registros saiu do arquivo que o <strong>sistema atual</strong> gerou
          (${escapeHtml(ref.arquivo)}): ${ref.linhas.toLocaleString('pt-BR')} linhas,
          ${ref.registros} tipos de registro, layout <code>COD_VER ${escapeHtml(ref.codVer)}</code>.
          A coluna &ldquo;agosto&rdquo; é quantas linhas de cada registro aquele arquivo teve —
          serve de ordem de grandeza do que falta aqui.
        </p>
      </div>`;

    const corpo = dados.blocos.map((b) => {
      const comConferencia = b.registros.filter((reg) => reg.conferencias.length);
      if (!comConferencia.length) return '';
      const linhas = comConferencia.map((reg) => reg.conferencias.map((c, i) => {
        const e = estadoDe(c);
        const exemplos = c.exemplos && c.exemplos.length
          ? `<br><span class="muted">${escapeHtml(c.exemplos.join(' · '))}</span>`
          : '';
        // A contagem só aparece quando ela quer dizer algo. "0 de 0" é ruído, e
        // é o que sairia em toda linha do Bloco C hoje.
        const conta = c.avaliados > 0
          ? `${c.pendentes.toLocaleString('pt-BR')} de ${c.avaliados.toLocaleString('pt-BR')}`
          : '—';
        return `
          <tr>
            ${i === 0 ? `<td rowspan="${reg.conferencias.length}">
              <strong>${escapeHtml(reg.reg)}</strong>
              <br><span class="muted">${escapeHtml(reg.nome)}</span>
              <br><span class="muted">${reg.campos} campos</span>
            </td>` : ''}
            ${i === 0 ? `<td rowspan="${reg.conferencias.length}" class="num">${reg.linhasEmAgosto ? reg.linhasEmAgosto.toLocaleString('pt-BR') : '—'}</td>` : ''}
            <td>${escapeHtml(c.titulo)}${exemplos}</td>
            <td class="num">${conta}</td>
            <td><span class="finance-badge finance-badge-${e.tom}">${escapeHtml(e.rotulo)}</span></td>
            <td>${escapeHtml(c.texto)}${c.onde ? `<br><span class="muted">onde: ${escapeHtml(c.onde)}</span>` : ''}</td>
          </tr>`;
      }).join('')).join('');

      return `
        <div class="panel">
          <h3>${escapeHtml(NOME_DO_BLOCO[b.bloco] || 'Bloco ' + b.bloco)}</h3>
          <div class="table-scroll">
            <table class="table">
              <thead>
                <tr>
                  <th>Registro</th>
                  <th>agosto</th>
                  <th>Conferência</th>
                  <th>Pendentes</th>
                  <th>Estado</th>
                  <th>O que é</th>
                </tr>
              </thead>
              <tbody>${linhas}</tbody>
            </table>
          </div>
        </div>`;
    }).join('');

    const semFonte = ref.semFonteNoSistema || [];
    const rodape = `
      <div class="panel">
        <h3>O que ainda não tem morada neste sistema</h3>
        <p class="muted">
          ${semFonte.length} dos ${ref.registros} registros do arquivo não saem de lugar nenhum daqui:
          <strong>${escapeHtml(semFonte.join(', '))}</strong>.
        </p>
        <p class="muted">
          Isso não é pendência de cadastro — é desenvolvimento que não estava previsto, e apareceu
          porque o arquivo de verdade foi lido. O <code>0100</code> é o cadastro do contabilista;
          o <code>0450</code> e o <code>C110</code> são os textos legais de cada lançamento;
          o <code>C190</code> é a agregação dos itens por CST, CFOP e alíquota; o Bloco E é a
          apuração, cujos códigos de ajuste são tabela oficial por UF.
        </p>
        <p class="muted">
          E o gerador em si continua faltando o layout de serialização de cada registro, que sai do
          Guia Prático da versão <code>${escapeHtml(ref.codVer)}</code>. A contagem de campos ao lado
          de cada registro é conferência, não especificação: quando o gerador existir, o número de
          campos que ele produzir tem de bater com o do arquivo antigo. Bater não prova que está
          certo; não bater prova que está errado.
        </p>
      </div>`;

    content.innerHTML = cabecalho + corpo + rodape;

    const campo = content.querySelector('#spedCompetencia');
    if (campo) {
      campo.addEventListener('change', () => {
        state.spedCompetencia = campo.value;
        desenhar(ctx);
      });
    }
  }

  window.MavisSubscreenRegistry.fiscal.sped_pre_check = desenhar;
})();
