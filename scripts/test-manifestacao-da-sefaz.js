#!/usr/bin/env node
/**
 * A MANIFESTAÇÃO QUE A SEFAZ JÁ TEM (15/10/2026). Pedido do usuário: "verifique
 * pela SEFAZ todas as notas antigas que já foram manifestadas nos últimos tempos
 * e atualize elas no MavisONE".
 *
 * A lista da Focus traz `manifestacao_destinatario` ("situação atual da
 * manifestação do destinatário": nulo, ciencia, confirmacao, desconhecimento,
 * nao_realizada — doc da Focus, conferida em 15/10/2026), e a busca só a
 * guardava no `resumo`. Provado no banco local (matriz, busca "desde o
 * início" na Focus de produção, só leitura): 540 notas, 11 novas, 109
 * manifestações atualizadas (ciência) e a confirmação feita daqui mantida. O
 * botão "Atualizar todas as empresas" passou pelas 10 empresas no navegador
 * (com a busca simulada): seguiu a página que faltava, a empresa que falhou não
 * parou as outras, e o aviso somou tudo.
 */
const fs = require('fs');
const path = require('path');
const Module = require('module');

let falhas = 0;
const check = (nome, cond, extra) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${!cond && extra !== undefined ? ` -> ${extra}` : ''}`);
  if (!cond) falhas += 1;
};
const ler = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

// lib/db/dfe.js com o banco simulado: guarda o que seria gravado.
const gravacoes = [];
const clienteFalso = {
  banco: { from: () => ({ update: (campos) => ({ eq: (_col, id) => { gravacoes.push({ id, ...campos }); return Promise.resolve({ error: null }); } }) }) },
  createId: () => 'x', assertNoError: () => {}
};
const carregarOriginal = Module._load;
Module._load = function (pedido, pai, ...resto) {
  if (pedido === './client' && pai && /lib[\\/]db[\\/]dfe\.js$/.test(pai.filename)) return clienteFalso;
  return carregarOriginal.call(this, pedido, pai, ...resto);
};
const dfe = require('../lib/db/dfe');
Module._load = carregarOriginal;

(async () => {
  const caso = async (texto, atual) => {
    gravacoes.length = 0;
    const mudou = await dfe.registrarManifestacaoDaSefaz('dfe-1', texto, atual);
    return { mudou, codigo: gravacoes[0] ? gravacoes[0].manifestacao_codigo : null, autor: gravacoes[0] ? gravacoes[0].manifestado_por_nome : null };
  };
  let r = await caso('ciencia', '');
  check('ciência na SEFAZ e nada aqui: grava 210210', r.mudou && r.codigo === '210210');
  check('  com o autor "SEFAZ" (não foi feita daqui)', r.autor === 'SEFAZ (feita fora do MavisONE)');
  check('"nulo" e vazio não gravam nada', !(await caso('nulo', '')).mudou && !(await caso('', '210210')).mudou);
  check('ciência não rebaixa uma confirmação', !(await caso('ciencia', '210200')).mudou);
  r = await caso('confirmacao', '210210');
  check('confirmação sobe a ciência', r.mudou && r.codigo === '210200');
  r = await caso('nao_realizada', '');
  check('nao_realizada (Focus) vira 210240 (o catálogo usa hífen)', r.mudou && r.codigo === '210240');
  check('a mesma manifestação não regrava', !(await caso('ciencia', '210210')).mudou);
  r = await caso('desconhecimento', '210200');
  check('duas finais diferentes: vale a situação atual da SEFAZ', r.mudou && r.codigo === '210220');

  const servidor = ler('server.js');
  check('a busca registra a manifestação de cada nota gravada',
    /const gravado = await dfeDb\.gravarDocumento\([\s\S]{0,700}await dfeDb\.registrarManifestacaoDaSefaz\(gravado\.id, documento\.manifestacao, gravado\.manifestacaoCodigo\)/.test(servidor));
  check('  e conta quantas mudaram', servidor.includes('manifestacoesAtualizadas += 1;') && /novos,\s*manifestacoesAtualizadas,\s*chavesCompletadas,/.test(servidor));
  check('o modo "desde o início" avança o ponteiro', servidor.includes("if (modo === 'ultimo-nsu' || modo === 'tres-meses' || modo === 'tudo') {"));
  check('a Focus traduzida traz a manifestação pelo nome conferido',
    ler('lib/focusnfe.js').includes("manifestacao: String(primeiroCampo(bruto, CAMPOS_DFE.manifestacao) || ''),")
    && ler('lib/focusnfe.js').includes("manifestacao: ['manifestacao_destinatario'],"));
  check('gravarDocumento devolve a manifestação que a nota já tem', ler('lib/db/dfe.js').includes("manifestacaoCodigo: existente.manifestacaoCodigo || ''"));

  const tela = ler('public/modules/fiscal/subs/notas_contra_cnpj.js');
  check('tela: opção "Todas as notas (desde o início)"', tela.includes('<option value="tudo"'));
  check('  e o botão que passa por todas as empresas, continuando a que tiver mais páginas',
    tela.includes("id=\"dfeAtualizarTodas\"") && /let modo = 'tudo';[\s\S]{0,400}if \(!r\.faltaBuscar\) break;\s*modo = 'ultimo-nsu';/.test(tela));
  check('  empresa que falha não para as outras', /\} catch \(erro\) \{\s*falhas\.push\(/.test(tela));

  console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TUDO OK =====');
  process.exit(falhas ? 1 : 0);
})();
