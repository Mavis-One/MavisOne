// DADOS AO VIVO (15/10/2026). Pedido do usuário: "estou com uma tela aberta em
// uma NF, preciso abrir uma nova para conseguir cadastrar um vendedor porém
// depois de cadastrar um vendedor, o mesmo ainda não aparece até eu atualizar a
// página, deixe uma verificação automática e deixe isso padronizado no sistema
// inteiro".
//
// O servidor sempre respondeu o dado novo; quem ficava velha era a tela, que
// busca as listas UMA vez ao abrir. Daqui em diante, toda gravação avisa:
//   - as outras abas DESTE navegador, na hora (BroadcastChannel) — `gravou`,
//     chamado por apiDireto depois de toda gravação que deu certo;
//   - os OUTROS computadores pela versão dos dados do servidor, conferida
//     quando a aba volta a ficar visível (GET /api/dados/versao).
//
// A aba avisada atualiza a tela aberta, sem perder o que foi digitado:
//   1. se a tela registrou como se atualizar (`aoMudar`), é isso que roda — o
//      pedido de venda e a emissão de NF-e buscam as listas de novo e
//      redesenham com o que estava preenchido;
//   2. se não registrou e nada foi digitado nela, ela é aberta de novo, como
//      quem clica no menu, no mesmo ponto da rolagem;
//   3. se não registrou e há algo digitado, fica como está — redesenhar
//      apagaria o trabalho; as listas de apoio já esquecidas valem na próxima
//      vez que ela abrir.
// Aba escondida espera voltar a ficar visível; quem está digitando num campo
// da tela espera sair dele.
(function () {
  const canal = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('mavisone:dados') : null;
  const ESPERA_MS = 300;
  const INTERVALO_DA_CONFERENCIA_MS = 5000;

  let opcoes = null;
  let versaoVista = 0;
  let pendente = false;
  let agendado = null;
  let telaSuja = false;
  let atualizando = false;
  let registro = null;
  let ultimaConferencia = 0;

  const conteudo = () => document.getElementById('moduleContent');
  const ehCampo = (el) => el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) && el.type !== 'search';
  const digitandoNaTela = () => {
    const ativo = document.activeElement;
    const raiz = conteudo();
    return Boolean(raiz && ehCampo(ativo) && raiz.contains(ativo));
  };

  function anotarVersao(valor) {
    const n = Number(valor || 0);
    if (n > versaoVista) versaoVista = n;
  }

  function agendar() {
    pendente = true;
    if (!opcoes || !opcoes.logado()) return;
    if (document.hidden) return; // volta pelo visibilitychange
    if (digitandoNaTela()) return; // volta pelo focusout
    clearTimeout(agendado);
    agendado = setTimeout(aplicar, ESPERA_MS);
  }

  async function aplicar() {
    if (!pendente || atualizando || !opcoes || !opcoes.logado()) return;
    if (document.hidden || digitandoNaTela()) return;
    pendente = false;
    atualizando = true;
    try {
      if (typeof opcoes.esquecerListas === 'function') opcoes.esquecerListas();
      const raiz = conteudo();
      const valido = registro && registro.rota === opcoes.rotaAtual() && registro.raiz === raiz && raiz && raiz.isConnected;
      if (valido) {
        await registro.atualizar();
      } else if (!telaSuja) {
        const rolagem = window.scrollY;
        await opcoes.redesenhar();
        window.scrollTo(0, rolagem);
      }
    } catch (_) {
      // A tela fica como estava; a próxima gravação tenta de novo.
    } finally {
      atualizando = false;
    }
  }

  async function conferirServidor() {
    if (!opcoes || !opcoes.logado() || document.hidden) return;
    const agora = Date.now();
    if (agora - ultimaConferencia < INTERVALO_DA_CONFERENCIA_MS) return;
    ultimaConferencia = agora;
    try {
      const { versao } = await opcoes.buscarVersao();
      const n = Number(versao || 0);
      const primeira = !versaoVista;
      if (n > versaoVista) {
        versaoVista = n;
        if (!primeira) agendar();
      }
    } catch (_) {
      // Sem resposta: confere na próxima vez que a aba voltar.
    }
  }

  if (canal) {
    canal.addEventListener('message', (evento) => {
      const m = evento.data || {};
      if (m.tipo !== 'gravou') return;
      anotarVersao(m.versao);
      agendar();
    });
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    if (pendente) agendar();
    conferirServidor();
  });
  // Duas janelas lado a lado não trocam a visibilidade: o foco é que avisa.
  if (typeof window.addEventListener === 'function') {
    window.addEventListener('focus', () => {
      if (pendente) agendar();
      conferirServidor();
    });
  }
  document.addEventListener('focusout', (evento) => {
    if (!pendente || !ehCampo(evento.target)) return;
    // O foco pode estar só passando para o campo ao lado.
    setTimeout(() => { if (pendente) agendar(); }, 0);
  });
  // Algo digitado na tela: o redesenho geral (passo 2) não pode mais rodar.
  const marcarSuja = (evento) => {
    const raiz = conteudo();
    if (raiz && ehCampo(evento.target) && raiz.contains(evento.target)) telaSuja = true;
  };
  document.addEventListener('input', marcarSuja, true);
  document.addEventListener('change', marcarSuja, true);

  window.MavisDados = {
    /** app.js entrega o que só ele sabe: a rota, o login, como redesenhar. */
    configurar(novas) { opcoes = novas; },

    /** Tela nova aberta (loadModule): nada digitado nela, nada registrado. */
    telaNova() {
      telaSuja = false;
      registro = null;
      // A primeira tela depois de entrar marca de onde a versão parte.
      if (!versaoVista) conferirServidor();
    },

    /**
     * A tela aberta sabe se atualizar sem perder o que foi digitado. Vale
     * enquanto ela estiver aberta; abrir outra tela esquece o registro.
     */
    aoMudar(atualizar) {
      registro = { atualizar, rota: opcoes ? opcoes.rotaAtual() : '', raiz: conteudo() };
    },

    /**
     * apiDireto: uma gravação deu certo nesta aba. Só avisa quando o servidor
     * contou a gravação como mudança (cabeçalho X-Versao-Dados): prévia, nota
     * em edição salva sozinha e preferência de tela não redesenham ninguém.
     */
    gravou(_caminho, versao) {
      if (!Number(versao || 0)) return;
      anotarVersao(versao);
      try { canal?.postMessage({ tipo: 'gravou', versao: Number(versao || 0) }); } catch (_) { /* aba fechando */ }
    },

    /**
     * Gravou por cima da tela aberta, nesta mesma aba (os atalhos "Novo
     * Cliente/Produto"): a tela de baixo atualiza como se fosse outra aba.
     */
    mudouAqui() { agendar(); },

    /** Para os testes. */
    _estado: () => ({ versaoVista, pendente, telaSuja, temRegistro: Boolean(registro) })
  };
}());
