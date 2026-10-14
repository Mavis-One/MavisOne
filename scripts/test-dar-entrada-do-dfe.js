#!/usr/bin/env node
/**
 * NOTAS CONTRA CNPJ: MANIFESTAR EM JANELA E "DAR ENTRADA" (14/10/2026).
 *
 * Queixa do usuário: "o botão de manifestar não está funcionando", e pedido:
 * depois da Ciência ou da Confirmação, um botão para dar entrada na nota.
 *
 * A causa: o formulário de manifestação nascia no FIM da página, abaixo de
 * dezenas de notas; o clique parecia não fazer nada. Agora é uma janela.
 *
 * Provado no navegador (sem enviar nada à SEFAZ): clicar "Manifestar" na 9ª
 * nota abriu a janela visível; Cancelar fechou. Com uma nota temporária em
 * Ciência e XML de exemplo, a linha mostrou "pendente" e "Dar entrada", que
 * abriu Compras › Entrada de NF-e com a nota conferida (2 itens); lançar
 * marcou a nota como "lançada" na lista. Nota, entrada, movimento e o produto
 * (saldo 0, custo 36,99, do backup de 14/10 14:10) foram restaurados.
 */
const fs = require('fs');
const path = require('path');

let falhas = 0;
const check = (nome, cond) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}`);
  if (!cond) falhas += 1;
};
const ler = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const lista = ler('public/modules/fiscal/subs/notas_contra_cnpj.js');
const entrada = ler('public/modules/purchases/subs/entrada_nfe.js');

check('a manifestação abre numa janela por cima da lista', lista.includes('<div class="modal-overlay" id="dfeManifestacaoModal">'));
check('manifestar não lança a entrada sozinho', !/lancarEntrada\(/.test(lista) && !lista.includes("api('/api/purchases/entrada-nfe'"));
check('Ciência e Confirmação oferecem "Dar entrada"',
  lista.includes('const podeDarEntrada = (doc) => Boolean(doc.manifestacaoCodigo) && catalogo.liberaXml(doc.manifestacaoCodigo) && !doc.entradaId;')
  && lista.includes('data-dar-entrada='));
check('"Dar entrada" abre a Entrada de NF-e com a nota', lista.includes("state.entradaNfeDoDfe = { dfeId: documentoId, chave: doc ? doc.chave : '' };")
  && lista.includes("state.activeSub = 'entrada_nfe';"));
check('  sem o módulo Compras, avisa', lista.includes('Dar entrada é do módulo Compras, que não está liberado para você.'));
check('a Entrada de NF-e carrega o XML da nota recebida',
  entrada.includes('const { xml } = await api(`/api/fiscal/dfe/${encodeURIComponent(doDfe.dfeId)}/xml`);') && entrada.includes('tela.dfeId = doDfe.dfeId;'));
check('  e ao lançar liga a entrada à nota (vira "lançada")',
  entrada.includes('await api(`/api/fiscal/dfe/${encodeURIComponent(tela.dfeId)}/entrada`, { method: \'POST\', body: JSON.stringify({ entradaId }) });'));
check('valor da nota em reais', lista.includes("Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })"));

console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TUDO OK =====');
process.exit(falhas ? 1 : 0);
