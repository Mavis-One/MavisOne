// QUANTAS VEZES DÁ PARA ERRAR A SENHA — E O QUE ACONTECE DEPOIS.
//
// O PROBLEMA
// ----------
// Medido nesta base, antes desta mudança: 30 logins errados em 1.824 ms
// (~16/s), todos respondidos com 401, nenhum bloqueio, nenhum atraso, e a conta
// continuando a aceitar login logo em seguida. Um único cliente, sozinho,
// tentava ~1.400.000 senhas por dia contra uma conta conhecida.
//
// A CONTA DE DOIS LADOS, e não de um
// ----------------------------------
// Contar só por usuário transforma o limite em ARMA: qualquer pessoa erra a
// senha do administrador cinco vezes de propósito e o tranca. Contar só por IP
// não segura quem distribui as tentativas entre contas.
//
// Então são duas janelas, com propósitos diferentes:
//
//   POR IP      janela larga e bloqueio longo. É quem está atacando, e travá-lo
//               não prejudica ninguém legítimo atrás de outro endereço.
//   POR USUÁRIO janela curta e bloqueio CURTO — 5 minutos. O suficiente para
//               tornar a força bruta inviável (5 tentativas por 5 minutos são
//               1.440 por dia, contra 1.400.000), e curto o bastante para não
//               valer a pena usar como negação de serviço contra um colega.
//
// ACERTAR ZERA OS DOIS. Quem erra três vezes e lembra a senha não fica
// carregando um contador até o fim da janela.
//
// Sem banco e sem relógio próprio: o estado vive em memória (como as sessões) e
// o instante entra por parâmetro, para o teste não depender de esperar.

const REGRAS = {
  ip: { limite: 20, janelaMs: 15 * 60 * 1000, bloqueioMs: 15 * 60 * 1000 },
  usuario: { limite: 5, janelaMs: 5 * 60 * 1000, bloqueioMs: 5 * 60 * 1000 }
};

function criarLimitador(regras = REGRAS) {
  const estado = new Map();

  const chave = (escopo, valor) => `${escopo}:${String(valor || '').toLowerCase()}`;

  function registro(escopo, valor) {
    const k = chave(escopo, valor);
    if (!estado.has(k)) estado.set(k, { falhas: [], bloqueadoAte: 0 });
    return estado.get(k);
  }

  /**
   * Está bloqueado agora? Devolve `{ bloqueado, segundos, escopo }`.
   *
   * O escopo vai junto porque a mensagem para quem errou a própria senha é
   * diferente da mensagem para quem está varrendo o formulário.
   */
  function conferir({ ip, usuario }, agora = Date.now()) {
    for (const [escopo, valor] of [['ip', ip], ['usuario', usuario]]) {
      if (!valor) continue;
      const r = registro(escopo, valor);
      if (r.bloqueadoAte > agora) {
        return { bloqueado: true, escopo, segundos: Math.ceil((r.bloqueadoAte - agora) / 1000) };
      }
    }
    return { bloqueado: false, escopo: null, segundos: 0 };
  }

  /** Uma tentativa que falhou. Devolve o bloqueio, se este erro o causou. */
  function falhou({ ip, usuario }, agora = Date.now()) {
    let resultado = { bloqueado: false, escopo: null, segundos: 0 };
    for (const [escopo, valor] of [['ip', ip], ['usuario', usuario]]) {
      if (!valor) continue;
      const regra = regras[escopo];
      const r = registro(escopo, valor);
      // Só as falhas DENTRO da janela contam: um erro de ontem não pode somar
      // com um de hoje e trancar quem digitou errado uma vez em cada dia.
      r.falhas = r.falhas.filter((t) => agora - t < regra.janelaMs).concat(agora);
      if (r.falhas.length >= regra.limite) {
        r.bloqueadoAte = agora + regra.bloqueioMs;
        // Zera a contagem junto com o bloqueio: senão, ao sair dele, a próxima
        // falha sozinha trancaria de novo na hora.
        r.falhas = [];
        if (!resultado.bloqueado) {
          resultado = { bloqueado: true, escopo, segundos: Math.ceil(regra.bloqueioMs / 1000) };
        }
      }
    }
    return resultado;
  }

  /** Entrou. Limpa o contador dos dois lados. */
  function acertou({ ip, usuario }) {
    for (const [escopo, valor] of [['ip', ip], ['usuario', usuario]]) {
      if (valor) estado.delete(chave(escopo, valor));
    }
  }

  /** Manutenção: some com o que já não vale, para a memória não crescer sempre. */
  function limpar(agora = Date.now()) {
    const maiorJanela = Math.max(...Object.values(regras).map((r) => r.janelaMs + r.bloqueioMs));
    for (const [k, r] of estado) {
      const ultima = r.falhas.length ? r.falhas[r.falhas.length - 1] : 0;
      if (r.bloqueadoAte < agora && agora - ultima > maiorJanela) estado.delete(k);
    }
    return estado.size;
  }

  const mensagem = (escopo, segundos) => {
    const minutos = Math.max(1, Math.ceil(segundos / 60));
    return escopo === 'usuario'
      ? `Muitas tentativas de login para este usuário. Tente de novo em ${minutos} minuto${minutos > 1 ? 's' : ''}.`
      : `Muitas tentativas de login deste dispositivo. Tente de novo em ${minutos} minuto${minutos > 1 ? 's' : ''}.`;
  };

  return { conferir, falhou, acertou, limpar, mensagem, tamanho: () => estado.size };
}

module.exports = { criarLimitador, REGRAS };
