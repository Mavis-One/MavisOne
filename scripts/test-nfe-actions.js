// Testa as regras de habilitação do painel de ações fiscais nos 4 cenários que
// importam: nada selecionado, 1 nota autorizada, 1 nota cancelada, várias notas.
const fs = require('fs');
global.window = {};
(0, eval)(fs.readFileSync(require('path').join(__dirname, '..', 'public/modules/finance/nfe_actions.js'), 'utf8'));
const A = global.window.MavisNfeActions;

const base = {
  escapeHtml: (s) => s, showToast() {}, print() {}, cancelar() {}, duplicar() {}, irParaVenda() {},
  baixarArquivo() {}, baixarLote() {}, cartaCorrecao() {}, consultarStatus() {}, statusServico() {},
  limparSelecao() {}
};
// A lista mostra DUAS origens. `nfe()` é a nota real, transmitida à SEFAZ;
// `manual()` é o registro lançado à mão no Financeiro, que não existe lá.
const nfe = (over = {}) => ({ id: 'n1', number: '168', status: 'autorizada', origem: 'fiscal', ...over });
const manual = (over = {}) => ({ id: 'm1', number: '9', status: 'autorizada', origem: 'financeiro', ...over });

let falhas = 0;
const check = (nome, cond, det) => { console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det ? ' -> ' + det : ''}`); if (!cond) falhas++; };

function liberadas(ctx) {
  const c = { ...base, ...ctx };
  c.nfe = c.selecionadas.length === 1 ? c.selecionadas[0] : null;
  return A.CATALOG.filter((a) => !A.motivoBloqueio(a, c)).map((a) => a.id);
}
function motivo(id, ctx) {
  const c = { ...base, ...ctx };
  c.nfe = c.selecionadas.length === 1 ? c.selecionadas[0] : null;
  return A.motivoBloqueio(A.CATALOG.find((a) => a.id === id), c);
}

console.log(`catálogo: ${A.CATALOG.length} ações\n`);

// Trava de projeto, não detalhe de UI: NF-e não pode ser excluída em hipótese
// alguma. Uma nota autorizada é cancelada (evento registrado na SEFAZ) e
// permanece no histórico — apagar o registro quebraria a auditoria e a
// conciliação com a SEFAZ. Este teste falha se alguém reintroduzir a ação.
console.log('--- trava: exclusão de NF-e não pode existir ---');
const proibidas = A.CATALOG.filter((a) => /excluir|deletar|remover|apagar/i.test(a.id + ' ' + a.label));
check('nenhuma ação de exclusão no catálogo', proibidas.length === 0,
  proibidas.length ? 'ENCONTRADA: ' + proibidas.map((a) => a.id).join(', ') : 'ok');

console.log('\n--- nada selecionado ---');
const vazio = liberadas({ selecionadas: [], apiFiscalConfigurada: true });
// "Status Serviço" pergunta pela SEFAZ, não por uma nota — por isso é a única
// que funciona sem seleção nenhuma.
check('Cancelar Seleção e Status Serviço', JSON.stringify(vazio.sort()) === JSON.stringify(['cancelar_selecao', 'status_servico']), vazio.join(', '));
check('Status Serviço não exige seleção', motivo('status_servico', { selecionadas: [], apiFiscalConfigurada: true }) === null);
check('mas exige a API configurada', /API fiscal/.test(motivo('status_servico', { selecionadas: [], apiFiscalConfigurada: false })));

console.log('\n--- 1 NF autorizada, API fiscal NÃO configurada ---');
const semApi = liberadas({ selecionadas: [nfe()], apiFiscalConfigurada: false });
// Imprimir e etiquetas não dependem da API: saem do que a lista já tem. O
// 80mm ficou de fora de propósito para nota fiscal — o layout resume a nota
// pelos itens da lista, e a lista fiscal não manda itens; ver o bloco sobre a
// DANFE, mais abaixo. Para o registro manual do Financeiro os quatro valem.
check('impressões liberadas', ['imprimir', 'etiqueta', 'etiqueta_2col'].every((i) => semApi.includes(i)), semApi.join(', '));
check('e o 80mm fica de fora só na nota fiscal',
  !semApi.includes('imprimir_80mm')
  && liberadas({ selecionadas: [manual()], apiFiscalConfigurada: false }).includes('imprimir_80mm'));
check('duplicar e cancelar liberados', semApi.includes('duplicar') && semApi.includes('cancelar'));
check('Baixar XML bloqueado por falta de API', /API fiscal/.test(motivo('baixar_xml', { selecionadas: [nfe()], apiFiscalConfigurada: false })));
check('nenhuma ação de API liberada', !semApi.some((i) => ['baixar_xml', 'baixar_danfe', 'carta_correcao', 'consultar_status'].includes(i)));

console.log('\n--- 1 NF autorizada, API fiscal CONFIGURADA ---');
const comApi = liberadas({ selecionadas: [nfe()], apiFiscalConfigurada: true });
// Depois da unificação, a nota fiscal REALMENTE baixa XML e DANFE: a rota
// /api/fiscal/nfe/:id/xml existe, e agora o menu aponta para ela.
check('Baixar XML liberado para nota fiscal autorizada', comApi.includes('baixar_xml'), motivo('baixar_xml', { selecionadas: [nfe()], apiFiscalConfigurada: true }) || 'liberado');
check('Baixar DANFE liberado', comApi.includes('baixar_danfe'));
check('Carta de Correção liberada', comApi.includes('carta_correcao'));
check('Cancelamento extemporâneo liberado', comApi.includes('cancelamento_extemporaneo'));
check('nenhuma ação sobrou sem handler', A.CATALOG.filter((a) => !a.run && !a.enabled).length === 0,
  A.CATALOG.filter((a) => !a.run && !a.enabled).map((a) => a.id).join(', ') || 'todas com run');
check('Cancelar NFe liberado', comApi.includes('cancelar'));
check('Ir Para a Venda bloqueado sem vínculo', /não tem venda/.test(motivo('ir_para_venda', { selecionadas: [nfe()], apiFiscalConfigurada: true })));
check('Ir Para a Venda liberado com vínculo',
  liberadas({ selecionadas: [nfe({ orderId: 'ord-1' })], apiFiscalConfigurada: true }).includes('ir_para_venda'));

console.log('\n--- 1 NF cancelada ---');
const cancelada = { selecionadas: [nfe({ status: 'cancelada' })], apiFiscalConfigurada: true };
check('Cancelar NFe bloqueado', /autorizada/.test(motivo('cancelar', cancelada)), motivo('cancelar', cancelada));
check('impressão continua liberada', liberadas(cancelada).includes('imprimir'));

console.log('\n--- várias NFs selecionadas (comportamento das capturas) ---');
const varias = { selecionadas: [nfe(), nfe({ id: 'n2' })], apiFiscalConfigurada: true };
const lote = liberadas(varias);
check('ações de nota única bloqueadas', !lote.includes('imprimir') && !lote.includes('cancelar'), lote.join(', '));
check('motivo explica o porquê', /apenas uma/.test(motivo('imprimir', varias)), motivo('imprimir', varias));
check('Cancelar Seleção sempre disponível', lote.includes('cancelar_selecao'));

console.log('\n--- registro manual do Financeiro não é nota da SEFAZ ---');
// A lista mostra as duas origens juntas. Um registro manual não tem chave, XML,
// DANFE nem protocolo — oferecer o botão e devolver erro de servidor seria pior
// do que dizer o motivo. E o motivo NÃO pode ser "só para autorizada": isso
// mandaria a pessoa tentar autorizar algo que nunca vai à SEFAZ.
const soManual = { selecionadas: [manual()], apiFiscalConfigurada: true };
['baixar_xml', 'baixar_danfe', 'baixar_danfe_untrib', 'carta_correcao', 'cancelamento_extemporaneo'].forEach((id) => {
  const m = motivo(id, soManual);
  check(`${id} bloqueado para nota manual`, Boolean(m), m || 'XX LIBEROU');
  check(`  e o motivo explica que ela não foi à SEFAZ`, /não foi transmitida à SEFAZ/.test(m || ''), (m || '').slice(0, 50));
});
check('imprimir continua liberado para nota manual', liberadas(soManual).includes('imprimir'));
check('cancelar continua liberado para nota manual', liberadas(soManual).includes('cancelar'));

// Seleção mista: basta uma manual para a ação de lote não poder rodar.
const mista = { selecionadas: [nfe(), manual()], apiFiscalConfigurada: true };
check('lote com uma nota manual no meio é bloqueado', Boolean(motivo('xml_lote', mista)), motivo('xml_lote', mista) || 'XX LIBEROU');
check('lote só de notas fiscais é liberado',
  liberadas({ selecionadas: [nfe(), nfe({ id: 'n2' })], apiFiscalConfigurada: true }).includes('xml_lote'));

console.log('\n--- toda ação bloqueada tem motivo legível ---');
let semMotivo = 0;
[{ selecionadas: [], apiFiscalConfigurada: false }, { selecionadas: [nfe()], apiFiscalConfigurada: false }, varias].forEach((ctx) => {
  const c = { ...base, ...ctx };
  c.nfe = c.selecionadas.length === 1 ? c.selecionadas[0] : null;
  A.CATALOG.forEach((a) => {
    const m = A.motivoBloqueio(a, c);
    if (m !== null && (typeof m !== 'string' || m.length < 8)) semMotivo++;
  });
});
check('nenhum motivo vazio ou genérico demais', semMotivo === 0, `${semMotivo} sem motivo`);

console.log('\n--- baixar arquivo tem que LEVAR o token ---');
// A autenticação deste sistema é por CABEÇALHO (x-auth-token, no
// sessionStorage), nunca por cookie. Logo, qualquer navegação limpa para uma
// rota de /api — window.open, href, location, form action — chega ao servidor
// sem token e leva 403.
//
// Foi exatamente o que aconteceu com "Baixar DANFE": window.open apontava para
// a rota, o 403 acontecia na ABA NOVA e a tela não tinha como avisar. Quatro
// ações passavam por ali (DANFE, XML, DANFE com UN. TRIB. e o lote) e nenhuma
// funcionava, com o PDF já guardado no banco. Medido em 15/08/2026: a mesma
// rota devolvia 13 KB de %PDF-1.3 com o token e 403 sem ele.
const path = require('path');
const RAIZ = path.join(__dirname, '..');
const lerArquivo = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');

function varrer(dir, achados = []) {
  for (const nome of fs.readdirSync(dir)) {
    const inteiro = path.join(dir, nome);
    if (fs.statSync(inteiro).isDirectory()) varrer(inteiro, achados);
    else if (nome.endsWith('.js')) achados.push(path.relative(RAIZ, inteiro).replace(/\\/g, '/'));
  }
  return achados;
}
// window.open('/api/...'), location = '/api/...', href = '/api/...' — em
// qualquer forma de aspas, com ou sem template string.
const NAVEGACAO_CRUA = /(?:window\.open|location\.(?:href|assign|replace)|\.href\s*=)\s*\(?\s*[`'"]\/api\/|(?:window\.open|location\.(?:href|assign|replace)|\.href\s*=)\s*\(?\s*`[^`]*\/api\//;
const infratores = varrer(path.join(RAIZ, 'public'))
  .filter((rel) => NAVEGACAO_CRUA.test(lerArquivo(rel)));
check('nenhuma tela aponta navegação crua para /api', infratores.length === 0,
  infratores.length ? 'ENCONTRADO em: ' + infratores.join(', ') : 'ok');

console.log('\n--- janela de impressão: "noopener" e referência não convivem ---');
// Por especificação, window.open com noopener DEVOLVE NULL — mas a aba é
// criada do mesmo jeito. Quem guarda o retorno para escrever conteúdo (`win`,
// document.write, print) recebe null, cai no guard de pop-up e deixa uma aba
// about:blank vazia, sem conteúdo e sem erro.
//
// Aconteceu em 17/08/2026 nas quatro ações de impressão da NF-e (Imprimir,
// 80mm, Etiqueta, Etiqueta 2 colunas) e na impressão de Vendas — nesta última
// com um aviso que culpava o navegador por um bug nosso. Medido: com noopener
// devolveu NULL e criou a aba; sem ele, o conteúdo é escrito e win.opener
// segue null pela atribuição seguinte, que dá a mesma isolação.
const COM_NOOPENER_E_RETORNO = /(?:const|let|var)\s+\w+\s*=\s*window\.open\([^)]*noopener/;
const janelasOrfas = varrer(path.join(RAIZ, 'public'))
  .filter((rel) => COM_NOOPENER_E_RETORNO.test(lerArquivo(rel)));
check('ninguém guarda o retorno de um window.open com noopener', janelasOrfas.length === 0,
  janelasOrfas.length ? 'ENCONTRADO em: ' + janelasOrfas.join(', ') : 'ok');

// A isolação não pode ter sumido junto com o noopener.
const telasQueImprimem = varrer(path.join(RAIZ, 'public'))
  .filter((rel) => /window\.open\(\s*''\s*,\s*'_blank'\s*\)/.test(lerArquivo(rel)));
check('e quem abre janela em branco continua zerando o opener',
  telasQueImprimem.every((rel) => /\.opener\s*=\s*null/.test(lerArquivo(rel))),
  telasQueImprimem.join(', ') || 'nenhuma');

// Pop-up bloqueado DE VERDADE tem que falar. O silêncio foi o que fez o
// usuário procurar o problema em tudo menos no botão.
const telaPrint = lerArquivo('public/modules/finance/subs/nfe_emitidas.js');
// O fim do trecho é o registro da tela — buscado A PARTIR do início da função,
// porque `window.MavisSubscreenRegistry` também aparece na linha 1 do arquivo e
// um indexOf solto devolvia 0, deixando a fatia vazia (e o teste "falhando" por
// não ter o que ler).
const inicioPrint = telaPrint.indexOf('function nfePrint');
const impressao = telaPrint.slice(inicioPrint, telaPrint.indexOf('window.MavisSubscreenRegistry', inicioPrint));
check('achei a função de impressão para inspecionar', impressao.length > 200, `${impressao.length} caracteres`);
check('impressão bloqueada avisa em vez de sair calada',
  /if \(!win\) throw new Error\(/.test(impressao) && !/if \(!win\) return;/.test(impressao));

console.log('\n--- pedir texto usa o componente do sistema, não o prompt do navegador ---');
// O prompt do navegador não sabe validar. A SEFAZ exige 15 caracteres na
// justificativa de cancelamento e na Carta de Correção, e o jeito antigo só
// descobria isso DEPOIS: a caixa fechava levando o texto embora e um aviso
// dizia que era curto demais. Para tentar de novo, digitar tudo outra vez.
const appJs = lerArquivo('public/app.js');
// Sem comentários: a primeira versão deste check acusou o comentário que
// EXPLICA a troca ("no lugar do window.prompt()"). Teste que reclama de texto
// em vez de código ensina a esconder a palavra, não a corrigir o problema.
const semComentarios = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const promptsCrus = varrer(path.join(RAIZ, 'public'))
  .filter((rel) => /(?:^|[^.\w])(?:window\.)?prompt\s*\(/m.test(
    semComentarios(lerArquivo(rel)).replace(/promptModal\s*\(/g, '')));
check('nenhuma tela usa mais o prompt do navegador', promptsCrus.length === 0,
  promptsCrus.length ? 'ENCONTRADO em: ' + promptsCrus.join(', ') : 'ok');
check('o sistema tem o seu promptModal', /function promptModal\(/.test(appJs));
// O ganho real sobre o prompt: o botão só liga quando o texto serve.
const corpoPrompt = appJs.slice(appJs.indexOf('function promptModal('), appJs.indexOf('function animarEntrada'));
check('o botão fica desligado enquanto o texto é curto', /botao\.disabled = curto/.test(corpoPrompt));
check('e o contador diz quanto falta', /Faltam \$\{faltam\} caractere/.test(corpoPrompt));
check('desistir devolve null, e não texto vazio', /encerrar\(null\)/.test(corpoPrompt));
// Arrastar para selecionar texto e soltar fora não pode jogar fora o que já
// foi digitado — por isso o clique só conta se COMEÇOU no fundo.
check('clique fora só fecha se começou fora', /comecouNoFundo/.test(corpoPrompt));
check('Escape desiste', /evento\.key === 'Escape'/.test(corpoPrompt));
// Campo multilinha: Enter quebra linha, confirmar é Ctrl+Enter.
check('Enter sozinho não confirma', /evento\.key === 'Enter' && \(evento\.ctrlKey \|\| evento\.metaKey\)/.test(corpoPrompt));
// Injeção: hoje só chega mensagem do sistema, mas basta um dia passar nome de
// cliente para o innerHTML virar problema.
check('o texto entra por textContent, não innerHTML', !/prompt-titulo'\)\.innerHTML/.test(corpoPrompt)
  && /\.prompt-titulo'\)\.textContent/.test(corpoPrompt));

const telaNfes2 = lerArquivo('public/modules/finance/subs/nfe_emitidas.js');
check('cancelamento usa o modal, com o mínimo da SEFAZ', /promptModal\(\{[\s\S]{0,600}minimo: 15[\s\S]{0,200}maximo: 255/.test(telaNfes2));
check('Carta de Correção também, com o teto de 1000', /promptModal\(\{[\s\S]{0,600}minimo: 15[\s\S]{0,200}maximo: 1000/.test(telaNfes2));
// O aviso do extemporâneo era só mais uma linha no meio do texto do prompt.
check('o aviso do extemporâneo virou campo próprio', /aviso: opcoes\.extemporaneo/.test(telaNfes2));

const css = lerArquivo('public/app.css');
check('o estilo do prompt existe', /\.prompt-modal \{/.test(css));
// A lição da tela de Pessoas: classe nova não pode redefinir componente que já
// existe. .modal-overlay/.modal/.modal-actions continuam com uma definição só.
['.modal-overlay', '.modal-actions', '.btn-danger', '.btn-muted'].forEach((sel) => {
  const ocorrencias = css.split('\n').filter((l) => l.trimStart().startsWith(sel + ' {')).length;
  check(`  ${sel} continua definido uma vez só`, ocorrencias === 1, `${ocorrencias} definição(ões)`);
});

console.log('\n--- imprimir uma nota da SEFAZ imprime a DANFE, não um resumo nosso ---');
// Os layouts internos nasceram para o registro MANUAL do Financeiro. Numa nota
// fiscal eles produzem uma página sem sentido, e não por acaso:
// fiscalNfeParaLista devolve `items: []` e não devolve endereço. O impresso
// saía com "Endereço: -, - - -" e a tabela de produtos VAZIA — um papel
// parecido com nota, sem os produtos, que alguém pode entregar junto com a
// mercadoria achando que é a DANFE. Relatado pelo usuário em 17/08/2026.
check('a lista fiscal realmente não manda itens nem endereço',
  /items: \[\]/.test(lerArquivo('server.js').slice(
    lerArquivo('server.js').indexOf('function fiscalNfeParaLista'),
    lerArquivo('server.js').indexOf('function filterNfes')))
  && !/clientAddress/.test(lerArquivo('server.js').slice(
    lerArquivo('server.js').indexOf('function fiscalNfeParaLista'),
    lerArquivo('server.js').indexOf('function filterNfes'))));
check('nota de origem fiscal cai no caminho da DANFE', /origem === 'fiscal'/.test(impressao));
check('e busca a DANFE com o token', /\/danfe`[\s\S]{0,160}'x-auth-token': getSessionToken\(\)/.test(impressao));
// Sem DANFE (ainda não autorizada) não existe documento — dizer isso é melhor
// do que imprimir um resumo oco.
check('sem DANFE, explica em vez de imprimir página oca',
  /if \(!nfe\.temDanfe\)[\s\S]{0,200}throw new Error\('A DANFE só existe/.test(impressao));
// Etiqueta NÃO é documento fiscal: continua no layout interno.
check('etiqueta continua interna', !/'etiqueta'/.test(
  telaPrint.slice(telaPrint.indexOf('NFE_LAYOUTS_DE_DOCUMENTO ='), telaPrint.indexOf('function nfeEscreverAviso'))));

const so80 = { selecionadas: [nfe()], apiFiscalConfigurada: true };
const motivo80 = motivo('imprimir_80mm', so80);
check('80mm bloqueado para nota fiscal', Boolean(motivo80), motivo80 || 'XX LIBEROU');
check('  e o motivo manda usar a DANFE', /DANFE/.test(motivo80 || ''), (motivo80 || '').slice(0, 60));
check('80mm continua liberado para registro manual',
  liberadas({ selecionadas: [manual()], apiFiscalConfigurada: true }).includes('imprimir_80mm'));

const telaNfes = lerArquivo('public/modules/finance/subs/nfe_emitidas.js');
const download = telaNfes.slice(
  telaNfes.indexOf('async function baixarArquivoFiscal'),
  telaNfes.indexOf('async function consultarStatusFiscal'));
check('o download busca com o token da sessão', /'x-auth-token': getSessionToken\(\)/.test(download));
// Sem isto, erro de servidor vira aba em branco: o usuário não descobre que a
// nota ainda não tem arquivo, nem que perdeu a permissão.
check('e mostra o erro NA TELA quando a rota recusa', /if \(!resposta\.ok\)[\s\S]{0,600}showToast/.test(download));
// A ORDEM importa: abrir a aba depois do await sai do gesto do clique, e o
// Chrome barra a navegação — a janela aparece e fica em "about:blank", sem PDF
// e sem erro. Foi o segundo bug desta mesma função, encontrado em 15/08/2026
// com a primeira correção já no ar, e invisível no Chrome sem interface (que
// não liga o bloqueador de pop-up).
const posAbertura = download.indexOf("window.open('', '_blank')");
const posBusca = download.indexOf('await fetch(');
check('a aba é aberta ANTES da busca, dentro do clique', posAbertura > -1 && posAbertura < posBusca,
  posAbertura === -1 ? 'window.open sem abrir vazia primeiro' : `abertura em ${posAbertura}, busca em ${posBusca}`);
check('e a navegação usa a aba já aberta', /aba\.location\.replace\(url\)/.test(download));
// Aba em branco esquecida é o sintoma que fez o usuário procurar problema onde
// não estava: quando a rota recusa, a janela tem que sumir.
check('erro fecha a aba em vez de deixá-la em branco', /if \(aba\) aba\.close\(\);[\s\S]{0,120}showToast/.test(download));
// Revogar na hora deixaria a aba em branco — o objeto some antes de ser lido.
check('e o objeto só é liberado depois', /setTimeout\(\(\) => URL\.revokeObjectURL\(url\)/.test(download));
// Dez notas selecionadas seriam dez pop-ups, e o navegador bloqueia da segunda
// em diante — o lote vai para o disco.
check('o lote não abre abas', /paraLeitura: false/.test(telaNfes));

console.log(`\n===== ${falhas === 0 ? 'TODOS OS CHECKS PASSARAM' : falhas + ' FALHA(S)'} =====`);
process.exit(falhas ? 1 : 0);
