// DUPLICIDADE DE CADASTRO — FONTE ÚNICA.
//
// Mora em public/ porque o navegador carrega por <script>, mas o server.js
// também faz require() dele. Mesma razão do sales_status.js e do
// purchase_status.js: se a tela entendesse "duplicado" de um jeito e o servidor
// de outro, o usuário veria um aviso e receberia uma recusa, ou o contrário.
//
// E ERA LITERALMENTE O CASO. A regra estava escrita DUAS VEZES, palavra por
// palavra: `findDuplicateRegistration` em server.js e
// `findDuplicateRegistrationClient` em public/app.js, cada uma com sua própria
// cópia de `normalizeText` e `buildAddressKey`. Duas cópias de uma regra são
// duas regras — a segunda só ainda não divergiu.
//
// O QUE MUDOU DE COMPORTAMENTO
// ----------------------------
// As duas cópias RECUSAVAM o cadastro em três situações: mesmo CPF/CNPJ, mesmo
// NOME, mesmo ENDEREÇO. As duas últimas estão erradas, e o preço foi medido
// neste banco em 24/09/2026, sobre as 6.492 pessoas importadas:
//
//     87 pessoas têm o nome de outra
//    737 pessoas têm o endereço completo de outra (282 endereços repetidos)
//
// Nenhuma delas conseguia ser salva — nem EDITADA, porque a conferência
// ignora só o próprio id: abrir "João Silva" e corrigir o telefone dele
// encontrava o outro João Silva e recusava. Oitocentos e poucos cadastros
// legítimos travados por uma regra que queria evitar digitação em dobro.
//
// E são legítimos mesmo:
//   · homônimo é comum, e dois "José Maria da Silva" não são a mesma pessoa;
//   · mãe e filho no mesmo endereço são dois clientes;
//   · o condomínio, o prédio comercial e a loja do shopping repetem endereço
//     por natureza;
//   · marido e esposa, matriz e filial, pessoa física e a empresa dela.
//
// O DOCUMENTO É A IDENTIDADE. CPF e CNPJ existem justamente para dizer "esta é
// a mesma pessoa", e é só neles que a recusa se sustenta. Nome e endereço são
// COINCIDÊNCIA: valem um aviso — "olha, parece com este aqui" —, não um não.
//
// POR QUE AVISO, E NÃO SILÊNCIO
// -----------------------------
// Porque a regra não nasceu sem motivo: cadastrar a mesma pessoa duas vezes
// divide o histórico dela em dois, e quem procura pelo nome acha metade. O
// aviso serve a isso sem travar — quem está cadastrando é quem sabe se é a
// mesma pessoa, e a pergunta chega no instante em que ele pode responder.
(function (raiz) {
  function normalizarTexto(valor) {
    return String(valor || '')
      .normalize('NFD')
      // Remove os acentos combinantes (U+0300–U+036F). Escapado por código, e
      // não colado literalmente: caractere combinante solto no fonte é
      // invisível no editor e some num "salvar como" errado.
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ');
  }

  function soDigitos(valor) {
    return String(valor || '').replace(/\D/g, '');
  }

  // `address` OU `street`: o formulário grava `street`, e registros mais
  // antigos (e alguns payloads de integração) usam `address`. Ler só um dos
  // dois fazia a chave sair vazia para metade da base — e chave vazia não
  // compara com nada, então a conferência passava a não conferir.
  function linhaDeEndereco(registro) {
    return registro.address || registro.street || '';
  }

  /**
   * A chave do endereço COMPLETO, e não do logradouro.
   *
   * Sem número, bairro, cidade, UF e CEP, "Rua Brasil" bateria com toda Rua
   * Brasil do país. Devolve '' quando não há logradouro — e quem compara
   * ignora chave vazia, senão os 6.492 cadastros sem endereço colidiriam todos
   * entre si.
   */
  function chaveDeEndereco(registro) {
    const linha = normalizarTexto(linhaDeEndereco(registro));
    if (!linha) return '';
    return [
      linha,
      normalizarTexto(registro.streetNumber || registro.addressNumber || ''),
      normalizarTexto(registro.neighborhood || ''),
      normalizarTexto(registro.city || ''),
      normalizarTexto(registro.state || ''),
      soDigitos(registro.zipCode || '')
    ].join('|');
  }

  /**
   * O QUE RECUSA O CADASTRO. Só o documento.
   *
   * Devolve a mensagem, ou null. `excluirId` é o próprio registro na edição:
   * sem ele, editar um cadastro encontraria a si mesmo e recusaria sempre.
   */
  function bloqueio(registros, registro, excluirId) {
    const documento = soDigitos(registro.document || '');
    if (!documento) return null;
    for (const outro of registros) {
      if (excluirId && outro.id === excluirId) continue;
      if (soDigitos(outro.document || '') === documento) {
        return `Já existe um cadastro com o CPF/CNPJ informado (${outro.name || 'sem nome'}).`;
      }
    }
    return null;
  }

  /**
   * O QUE MERECE UM AVISO. Nome e endereço.
   *
   * Devolve uma lista de { tipo, mensagem, id, nome } — lista, e não a primeira
   * ocorrência, porque as duas coincidências podem existir ao mesmo tempo e
   * dizer só uma esconde a outra.
   *
   * Para no primeiro homônimo e no primeiro endereço repetido: a pergunta é
   * "parece com alguém?", e listar os 87 homônimos não ajuda quem vai decidir.
   */
  function avisos(registros, registro, excluirId) {
    const nome = normalizarTexto(registro.name || '');
    const chave = chaveDeEndereco(registro);
    const achados = [];
    let temNome = false;
    let temEndereco = false;

    for (const outro of registros) {
      if (excluirId && outro.id === excluirId) continue;
      if (!temNome && nome && normalizarTexto(outro.name || '') === nome) {
        temNome = true;
        achados.push({
          tipo: 'nome',
          id: outro.id,
          nome: outro.name || '',
          mensagem: `Já existe um cadastro com o nome "${registro.name}"`
            + `${outro.document ? ` (documento ${outro.document})` : ''}.`
        });
      }
      if (!temEndereco && chave && chaveDeEndereco(outro) === chave) {
        temEndereco = true;
        achados.push({
          tipo: 'endereco',
          id: outro.id,
          nome: outro.name || '',
          mensagem: `Este endereço já é o de "${outro.name || 'outro cadastro'}".`
        });
      }
      if (temNome && temEndereco) break;
    }
    return achados;
  }

  /** O texto da pergunta que a tela faz antes de salvar. */
  function textoDoAviso(lista) {
    if (!lista.length) return '';
    return `${lista.map((a) => a.mensagem).join(' ')} Cadastrar mesmo assim?`;
  }

  const api = { normalizarTexto, soDigitos, linhaDeEndereco, chaveDeEndereco, bloqueio, avisos, textoDoAviso };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (raiz) raiz.MavisDuplicidade = api;
})(typeof window !== 'undefined' ? window : null);
