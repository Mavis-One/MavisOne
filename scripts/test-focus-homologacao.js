#!/usr/bin/env node
// Trava de homologação da Focus NFe.
//
// O que este teste protege: uma nota autorizada em produção não tem desfazer.
// Ela existe para a SEFAZ, entra na apuração e, passado o prazo, nem cancelar
// dá mais. Todo o resto do sistema é reversível; isso não é.
//
// As formas de furar a trava sem ninguém perceber:
//   1. a variável sumir do .env e o padrão virar "produção";
//   2. um estabelecimento salvo como "producao" ser rebaixado em silêncio —
//      o usuário acha que emitiu de verdade, ou leva um 403 sem explicação;
//   3. a URL de produção continuar alcançável por algum caminho lateral
//      (download de XML/DANFE não passa pelo focusRequest);
//   4. a tela continuar oferecendo "Produção" num sistema que vai recusar.
//
// E, já em homologação, a rejeição que trava toda primeira integração: a
// SEFAZ exige um nome fixo no destinatário.
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const ler = (p) => fs.readFileSync(path.join(RAIZ, p), 'utf8').replace(/\r\n/g, '\n');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};

// O módulo é carregado sem .env: o que vale aqui é o comportamento do código,
// não a configuração desta máquina.
delete process.env.FOCUS_NFE_SOMENTE_HOMOLOGACAO;
const focus = require('../lib/focusnfe');
const { buildNfePayload } = require('../lib/nfePayloadBuilder');

console.log('--- o padrão é fechado: sem a variável, o sistema assume teste ---');
// Se a trava só ligasse com a variável presente, um .env incompleto num
// servidor novo emitiria valendo já na primeira nota.
check('sem a variável, a trava está ligada', focus.somenteHomologacao() === true);
process.env.FOCUS_NFE_SOMENTE_HOMOLOGACAO = '';
check('vazia também trava', focus.somenteHomologacao() === true);
process.env.FOCUS_NFE_SOMENTE_HOMOLOGACAO = 'sim';
check('qualquer valor que não seja desligar, trava', focus.somenteHomologacao() === true);

console.log('\n--- só um desligamento explícito libera produção ---');
['0', 'false', 'off', 'nao', 'não'].forEach((valor) => {
  process.env.FOCUS_NFE_SOMENTE_HOMOLOGACAO = valor;
  check(`"${valor}" desliga a trava`, focus.somenteHomologacao() === false);
});

console.log('\n--- com a trava ligada, produção é recusada, não rebaixada ---');
process.env.FOCUS_NFE_SOMENTE_HOMOLOGACAO = '1';
const pedidoProducao = focus.ambienteEfetivo('producao');
check('o pedido de produção é preservado no relato', pedidoProducao.pedido === 'producao');
check('mas o efetivo é homologação', pedidoProducao.efetivo === 'homologacao');
check('e fica marcado como bloqueado', pedidoProducao.bloqueado === true);
const homologacao = focus.ambienteEfetivo('homologacao');
check('homologação passa sem bloqueio', homologacao.efetivo === 'homologacao' && homologacao.bloqueado === false);

// Rebaixar em silêncio mandaria um token de produção para a URL de
// homologação: a Focus responde 403 e o erro fica parecendo credencial
// inválida, quando o problema é de configuração.
const chamadas = [
  ['emitirNfe', () => focus.emitirNfe('ref-teste', {}, { token: 'tk', ambiente: 'producao' })],
  ['consultarNfe', () => focus.consultarNfe('ref-teste', { token: 'tk', ambiente: 'producao' })],
  ['cancelarNfe', () => focus.cancelarNfe('ref-teste', 'motivo', { token: 'tk', ambiente: 'producao' })],
  ['inutilizarNumeracao', () => focus.inutilizarNumeracao({ cnpj: '1', serie: 1, numeroInicial: 1, numeroFinal: 1, justificativa: 'x' }, { token: 'tk', ambiente: 'producao' })],
  // Download de arquivo monta a URL por fora do focusRequest — é o caminho
  // lateral mais fácil de esquecer.
  ['baixarArquivo', () => focus.baixarArquivo('/arquivos/nota.xml', { token: 'tk', ambiente: 'producao' })]
];

(async () => {
  for (const [nome, executar] of chamadas) {
    let recusou = false;
    let mensagem = '';
    try {
      await executar();
    } catch (error) {
      recusou = error.status === 409;
      mensagem = error.message || '';
    }
    check(`${nome} recusa produção`, recusou, recusou ? '409' : 'NÃO RECUSOU — chamada saiu');
    if (recusou) {
      check(`  ${nome}: o erro diz o que fazer`, /Homologação/i.test(mensagem) && /token de homologação/i.test(mensagem));
    }
  }

  console.log('\n--- checkStatus conta em qual ambiente está ---');
  const semToken = await focus.checkStatus({ token: '', ambiente: 'homologacao' });
  check('relata a trava', semToken.travadoEmHomologacao === true);
  check('relata o ambiente efetivo', semToken.ambiente === 'homologacao');
  const statusProducao = await focus.checkStatus({ token: '', ambiente: 'producao' });
  check('mostra que o estabelecimento pediu produção', statusProducao.ambienteSolicitado === 'producao', statusProducao.ambienteSolicitado);
  check('mas o efetivo continua homologação', statusProducao.ambiente === 'homologacao');

  console.log('\n--- o payload em homologação usa o nome exigido pela SEFAZ ---');
  const destinatario = {
    nome: 'Cliente Verdadeiro Ltda', documento: '12345678000199', contribuinte: true,
    logradouro: 'Rua A', numero: '10', bairro: 'Centro', municipio: 'Joinville', uf: 'SC', cep: '89201000'
  };
  const argsBase = {
    estabelecimento: { cnpj: '11222333000181', razaoSocial: 'Emitente SC Ltda', logradouro: 'Rua B', numero: '1', bairro: 'Centro', municipio: 'Joinville', uf: 'SC', cep: '89201000', codigoMunicipio: '4209102', inscricaoEstadual: '123456789' },
    empresa: { crt: 1 },
    destinatario,
    itens: [{ descricao: 'Produto', codigoProduto: 'P1', ncm: '84713012', quantidade: 1, valorUnitario: 100, unidadeComercial: 'UN', regraFiscal: { cfop: '5102', csosn: '102', cstPis: '49', cstCofins: '49' } }],
    naturezaOperacao: 'Venda', tipoDocumento: 1, finalidadeEmissao: 1, dataEmissao: '2026-08-10T10:00:00-03:00',
    informacoesAdicionais: 'Pedido 123'
  };

  const NOME_EXIGIDO = 'NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL';
  const emHomologacao = buildNfePayload({ ...argsBase, ambiente: 'homologacao' });
  check('nome do destinatário é o texto exigido', emHomologacao.nome_destinatario === NOME_EXIGIDO, emHomologacao.nome_destinatario);
  // Sem acento e em maiúsculas: a SEFAZ compara o texto exato.
  check('sem acento, em maiúsculas', NOME_EXIGIDO === NOME_EXIGIDO.toUpperCase() && !/[À-ÿ]/.test(NOME_EXIGIDO));
  check('o CNPJ do destinatário continua o real', emHomologacao.cnpj_destinatario === '12345678000199');
  check('o nome real vai para as informações adicionais', /Cliente Verdadeiro Ltda/.test(emHomologacao.informacoes_adicionais_contribuinte || ''));
  check('e o texto que o usuário digitou não se perde', /Pedido 123/.test(emHomologacao.informacoes_adicionais_contribuinte || ''));

  // Padrão fechado também aqui: payload montado sem ambiente vira teste.
  const semAmbiente = buildNfePayload({ ...argsBase });
  check('sem ambiente informado, monta como teste', semAmbiente.nome_destinatario === NOME_EXIGIDO);

  const emProducao = buildNfePayload({ ...argsBase, ambiente: 'producao' });
  check('em produção, o nome real é preservado', emProducao.nome_destinatario === 'Cliente Verdadeiro Ltda');
  check('e sem o carimbo de teste', !/SEM VALOR FISCAL/.test(emProducao.informacoes_adicionais_contribuinte || ''));

  console.log('\n--- o servidor manda o ambiente efetivo para o builder ---');
  // Passar estabelecimento.focusAmbiente cru furaria a trava: o payload sairia
  // com o nome real do cliente numa nota que a Focus vai emitir em homologação.
  const serverSrc = ler('server.js');
  check('buildNfePayload recebe ambienteEfetivo', /ambiente:\s*focusNfe\.ambienteEfetivo\(estabelecimento\.focusAmbiente\)\.efetivo/.test(serverSrc));
  check('a listagem de estabelecimentos informa a trava', /travadoEmHomologacao:\s*focusNfe\.somenteHomologacao\(\)/.test(serverSrc));

  console.log('\n--- a tela não oferece o que o servidor vai recusar ---');
  const telaSrc = ler('public/modules/settings/subs/fiscal.js');
  // A trava impede ENTRAR em produção, não descreve o que já está salvo. Uma
  // <option> desabilitada E selecionada continua sendo enviada no submit: se a
  // regra fosse só a trava, um estabelecimento já gravado como produção voltava
  // gravado como produção a cada "salvar alterações", sem nada explicando.
  check('a opção Produção é desabilitada quando entrar em produção está bloqueado', /producaoBloqueada \? 'disabled' : ''/.test(telaSrc));
  check('e "bloqueado" é a trava + ainda não estar em produção', /const producaoBloqueada = travadoEmHomologacao && !producaoJaSalva/.test(telaSrc));
  check('quem já está em produção sob a trava é avisado, não silenciado', /producaoJaSalva[\s\S]{0,200}toda emissão por ele vai ser recusada/.test(telaSrc));
  check('a tela avisa que não tem valor fiscal', /fiscal-aviso-homologacao/.test(telaSrc));
  check('o aviso tem estilo', /\.fiscal-aviso-homologacao/.test(ler('public/app.css')));
  // Se a resposta não trouxer o campo, a tela deve se comportar como travada.
  check('a tela começa travada por padrão', /let travadoEmHomologacao = true/.test(telaSrc));
  check('e só destrava com um false explícito', /res\.travadoEmHomologacao !== false/.test(telaSrc));

  console.log('\n--- o teste de conexão não acusa token bom de ruim ---');
  const focusSrc = ler('lib/focusnfe.js');
  // /empresas é endpoint de conta PARCEIRA: com o token comum de uma empresa
  // a Focus responde 404, e o botão "Testar conexão" diria "Falhou" para uma
  // credencial perfeitamente válida. Verificado contra a homologação real.
  check('checkStatus não usa /empresas', !/focusRequest\('GET', '\/empresas', undefined, creds\)/.test(focusSrc));
  check('usa /hooks, que responde ao token da empresa', /focusRequest\('GET', '\/hooks', undefined, creds\)/.test(focusSrc));
  check('só o 401 é reportado como token recusado', /error\.status === 401/.test(focusSrc));
  check('listarEmpresas avisa que exige token parceiro', /token de conta PARCEIRA/.test(focusSrc));

  console.log('\n--- o campo do token não aceita a senha do login por autofill ---');
  // Aconteceu de verdade: o campo é type="password", o Chrome ignora
  // autocomplete="off" em campo de senha e gravou a senha do login do ERP como
  // token da Focus. O único sintoma era 401 "permissao_negada" no Testar
  // conexão — que parece token expirado, e manda procurar defeito na Focus.
  const dbFiscalSrc = ler('lib/db/fiscal.js');
  check('o campo usa new-password, que o Chrome respeita', /name="focusToken"[^>]*autocomplete="new-password"/.test(telaSrc));
  check('e não o autocomplete="off", que ele ignora', !/name="focusToken"[^>]*autocomplete="off"/.test(telaSrc));
  // Gravar é o ponto de controle: só o servidor vê o valor antes de cifrar, e
  // depois de cifrado o token nunca mais volta pra tela pra ser conferido.
  check('a gravação valida o formato antes de cifrar', /encryptToBytea\(assertTokenValido\(payload\.focusToken\)\)/.test(dbFiscalSrc));
  check('e a mensagem aponta o autofill como suspeito', /preenchimento automático do navegador/.test(focusSrc));

  // A validação tem que barrar o caso real sem recusar token bom.
  const tentaToken = (valor) => {
    try {
      focus.assertTokenValido(valor);
      return null;
    } catch (err) {
      return err.status || 'erro sem status';
    }
  };
  check('a senha do login é recusada', tentaToken('SENHA-REMOVIDA-DO-HISTORICO') === 400);
  check('senha longa com pontuação também', tentaToken('Senha@Forte#2026!') === 400);
  check('campo vazio é recusado', tentaToken('') === 400);
  check('a recusa é 400 (erro do usuário), não 500', tentaToken('SENHA-REMOVIDA-DO-HISTORICO') === 400);
  check('token de 32 alfanuméricos passa', tentaToken('aB3dE5gH7jK9mN1pQ3sT5vX7zA9cE1gJ') === null);
  check('espaço em volta é tolerado, não recusado', tentaToken('  aB3dE5gH7jK9mN1pQ3sT5vX7zA9cE1gJ  ') === null);

  console.log('\n--- a falha do teste de conexão diz o motivo, não só "Falhou" ---');
  // A mensagem só existia no title do badge: um token errado ficava idêntico
  // a uma queda da Focus para quem não passa o mouse em cima.
  check('o motivo é renderizado no fluxo da célula', /fiscal-status-motivo/.test(telaSrc));
  check('o motivo tem estilo', /\.fiscal-status-motivo/.test(ler('public/app.css')));
  check('o 401 cita o autofill entre as causas', /preenchimento automático do navegador/.test(focusSrc));

  console.log('\n--- o token global só serve de padrão em teste ---');
  // Em produção o token é quem identifica o emitente: um token global
  // emitindo por outra filial sairia com o CNPJ errado na nota.
  check('o fallback é condicionado à trava', /if \(!creds && somenteHomologacao\(\)\)/.test(focusSrc));
  check('e o erro em produção explica o porquê', /cada estabelecimento precisa do token próprio/.test(focusSrc));

  console.log('\n--- registrar webhook não acumula endereço morto ---');
  // A Focus ADICIONA hooks em vez de substituir: trocar de domínio deixaria a
  // URL velha sendo chamada e gerando retentativa para sempre.
  check('lista os webhooks antes de criar', /client\.listarWebhooks\(\)/.test(serverSrc));
  check('remove os que apontam para outro lugar', /client\.excluirWebhook\(hook\.id\)/.test(serverSrc));
  check('só mexe no mesmo evento', /String\(hook\.event \|\| ''\) !== 'nfe'/.test(serverSrc));
  check('e no mesmo CNPJ', /String\(hook\.cnpj \|\| ''\)\.replace\(\/\\D\/g, ''\) !== cnpjLimpo/.test(serverSrc));
  check('não recria um hook idêntico', /if \(jaRegistrado\)/.test(serverSrc));
  check('falha ao limpar não impede o registro', /não aborta|Não aborta/i.test(serverSrc));
  check('a tela distingue "já estava registrado"', /jaRegistrado/.test(telaSrc));

  console.log('\n--- a variável está documentada ---');
  check('.env.example explica a trava', /FOCUS_NFE_SOMENTE_HOMOLOGACAO/.test(ler('.env.example')));

  console.log(`\n===== ${falhas === 0 ? 'TODOS OS CHECKS PASSARAM' : falhas + ' FALHA(S)'} =====`);
  process.exit(falhas ? 1 : 0);
})();
