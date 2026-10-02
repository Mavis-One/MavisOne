#!/usr/bin/env node
/**
 * AS REGRAS FISCAIS DO ERP VIP, ADAPTADAS PARA O MAVISONE.
 *
 *   node scripts/carregar-regras-fiscais-vip.js              só mostra o que faria
 *   node scripts/carregar-regras-fiscais-vip.js --confirmo   grava
 *
 * DE ONDE VEIO. Em 01/10/2026 o usuário exportou a tela de regras fiscais do
 * sistema anterior (ERP VIP, empresa SAL INFINITY PLUS — MATRIZ): quatro
 * regras — COMPRA DE MERCADORIA, TRANSFERENCIA ENTRE FILIAIS, VENDA AO
 * CONSUMIDOR (NFC-e) e VENDA DE MERCADORIA. Os dados estão transcritos aqui
 * embaixo; o JSON original não entra no repositório.
 *
 * COMO O MODELO DE LÁ VIRA O DAQUI
 * --------------------------------
 * Lá: Regra (tipo de operação) -> Condição -> Aplicação (CFOP + regra de cada
 * imposto) -> Sub-condições. Aqui: uma linha de `regra_fiscal` reúne critério e
 * resultado, e a mais específica vence (lib/db/fiscal.js, resolverRegraFiscal).
 *
 *   "Tipo de tributo do produto: Substituição Tributária"  -> grupo tributário
 *       "Substituição tributária (ST)" (431 produtos já classificados)
 *   "Tipo de tributo: Todos"                               -> regra sem grupo
 *       (coringa); a de grupo vence por ser mais específica, como lá
 *   "UF diferente: Não"                                    -> dentro_do_estado
 *   CFOP "x102" com UF diferente = Não                     -> 5102
 *
 * VENDA AO CONSUMIDOR (NFC-e) tem as MESMAS duas aplicações da VENDA DE
 * MERCADORIA (5405/CST 60 e x102/CST 00 17%, PIS 0,65% e COFINS 3%). Aqui a
 * NFC-e usa o tipo de operação VENDA, então as duas regras de venda cobrem.
 *
 * COMPRA DE MERCADORIA não tem imposto: são 18 conversões de CFOP do
 * fornecedor para o CFOP de entrada. Vão para `cfop_conversao_entrada` (fase
 * DN), uma linha por CFOP.
 *
 * O QUE NÃO VEIO IGUAL, e por quê
 * -------------------------------
 * Seis conversões de lá resultam em CFOP que NÃO EXISTE na tabela oficial
 * (Ajuste SINIEF 07/01): 1105, 1106, 1108 (e 2105, 2106, 2108), 1404, 1405 e
 * 1656. O "x" de lá trocava só o primeiro dígito, e essas vendas do fornecedor
 * não têm entrada com o mesmo final. Aqui elas foram para o CFOP de entrada
 * que corresponde à operação — e ficam listadas na saída deste script:
 *
 *   x105, x106, x108  ->  x102  compra para comercialização
 *   x404, x405        ->  x403  compra para comercialização com ST
 *   x656              ->  x653  compra de combustível por consumidor final
 *
 * Os SPEDs que o sistema anterior gerou têm C190 com CFOP 1105, 1106, 2105,
 * 2106 e 2108 — que vieram exatamente dessas conversões.
 */

require('dotenv').config();
const { obterPool } = require('../lib/db/conexao');
const { createId } = require('../lib/db/client');

const CNPJ_RAIZ = '43792899';
const VIGENCIA = '2026-10-01';

const PIS_COFINS_VENDA = { cstPis: '01', aliquotaPis: 0.65, cstCofins: '01', aliquotaCofins: 3 };
const PIS_COFINS_TRANSF = { cstPis: '08', aliquotaPis: 0, cstCofins: '08', aliquotaCofins: 0 };

// IBS/CBS — NÃO VEIO DO ERP VIP, que deixava o bloco vazio em todas as regras.
// É obrigatório na NF-e/NFC-e do regime normal desde 03/08/2026 (Ato Conjunto
// RFB/CGIBS nº 4/2026, NT 2025.002), e a rejeição 1115 só foi ADIADA: nota sem
// o grupo é autorizada e está errada. Na venda: CST 000, cClassTrib 000001
// (tributação integral) e as alíquotas de teste de 2026 — CBS 0,9%, IBS 0,1%
// todo da UF (o do município é 0% e tem de ir informado; ver
// lib/nfePayloadBuilder.js).
//
// A TRANSFERÊNCIA fica SEM: entre estabelecimentos do mesmo titular o
// enquadramento é outro (não incidência), e o código não é chute — é pergunta
// para o contador.
const IBS_CBS_VENDA_2026 = { cstIbsCbs: '000', classTrib: '000001', aliquotaIbsUf: 0.1, aliquotaIbsMun: 0, aliquotaCbs: 0.9 };

// grupo: 'ST' = o grupo "Substituição tributária (ST)"; null = sem grupo.
const REGRAS = [
  { vip: 'VENDA DE MERCADORIA › Venda - ST (interna)', tipo: 'VENDA', grupo: 'ST', cfop: '5405', cstIcms: '60', modalidadeBc: null, aliquotaIcms: 0, ...PIS_COFINS_VENDA, ibsCbs: IBS_CBS_VENDA_2026 },
  { vip: 'VENDA DE MERCADORIA › Venda - tributado (interna)', tipo: 'VENDA', grupo: null, cfop: '5102', cstIcms: '00', modalidadeBc: 3, aliquotaIcms: 17, ...PIS_COFINS_VENDA, ibsCbs: IBS_CBS_VENDA_2026 },
  { vip: 'TRANSFERENCIA ENTRE FILIAIS › Transferencia - ST', tipo: 'TRANSFERENCIA', grupo: 'ST', cfop: '5409', cstIcms: '60', modalidadeBc: null, aliquotaIcms: 0, ...PIS_COFINS_TRANSF },
  { vip: 'TRANSFERENCIA ENTRE FILIAIS › Transferencia - tributado', tipo: 'TRANSFERENCIA', grupo: null, cfop: '5152', cstIcms: '00', modalidadeBc: 3, aliquotaIcms: 17, ...PIS_COFINS_TRANSF }
];

// As 18 sub-condições de COMPRA DE MERCADORIA, na ordem da tela de lá.
// [CFOPs do fornecedor, final que lá se aplicava, final que vai aqui]
const COMPRAS = [
  [['5102', '6102'], '102', '102'],
  [['5949', '6949'], '949', '949'],
  [['5656', '6656'], '656', '653'],
  [['5106', '6106'], '106', '102'],
  [['5101', '6101'], '101', '101'],
  [['5409', '6409'], '409', '409'],
  [['5403', '6403'], '403', '403'],
  [['5405', '6405'], '405', '403'],
  [['5105', '6105'], '105', '102'],
  [['5108', '6108'], '108', '102'],
  [['5404', '6404'], '404', '403'],
  [['5913', '6913'], '913', '913'],
  [['5117', '6117'], '117', '117'],
  [['5916', '6916'], '916', '916'],
  [['6401', '5401'], '401', '401'],
  [['5922', '6922'], '922', '922'],
  [['5912', '6912'], '912', '912'],
  [['5152'], '152', '152']
];

// O primeiro dígito da entrada: fornecedor no estado (5) -> 1, fora (6) -> 2,
// exterior (7) -> 3. É o "x" de lá.
const entradaDe = (cfopOrigem, final) => ({ 5: '1', 6: '2', 7: '3' }[cfopOrigem[0]]) + final;

(async () => {
  const confirmo = process.argv.includes('--confirmo');
  const pool = obterPool();
  const c = await pool.connect();
  let falhou = false;
  try {
    await c.query('begin');
    const { rows: [empresa] } = await c.query('select id, razao_social from empresa where cnpj_raiz = $1', [CNPJ_RAIZ]);
    if (!empresa) throw new Error(`empresa ${CNPJ_RAIZ} não cadastrada neste banco`);
    const { rows: grupos } = await c.query('select id, nome from grupo_tributario where empresa_id = $1 and ativo', [empresa.id]);
    const grupoSt = grupos.find((g) => /substitui/i.test(g.nome));
    if (!grupoSt) throw new Error('grupo tributário de Substituição tributária não encontrado');
    console.log(`\nEmpresa: ${empresa.razao_social} · grupo ST: "${grupoSt.nome}"`);

    console.log('\n--- regras fiscais (venda e transferência) ---');
    for (const r of REGRAS) {
      const grupoId = r.grupo === 'ST' ? grupoSt.id : null;
      const { rows: existentes } = await c.query(
        `select id, cfop, cst_icms, aliquota_icms, cst_pis, aliquota_pis, cst_cofins, aliquota_cofins, cst_ibs_cbs from regra_fiscal
          where empresa_id = $1 and tipo_operacao = $2 and grupo_tributario_id is not distinct from $3
            and dentro_do_estado is true and ncm is null and origem is null and uf_destino is null
            and destinatario_contribuinte is null and vigencia_fim is null`,
        [empresa.id, r.tipo, grupoId]);
      if (existentes.length) {
        const e = existentes[0];
        const igual = e.cfop === r.cfop && String(e.cst_icms || '').trim() === r.cstIcms && Number(e.aliquota_icms) === r.aliquotaIcms
          && String(e.cst_pis || '').trim() === r.cstPis && Number(e.aliquota_pis) === r.aliquotaPis;
        // A regra gravada antes desta versão do script não tinha IBS/CBS:
        // completa — só o bloco IBS/CBS, e só se ele estiver vazio.
        if (igual && r.ibsCbs && !e.cst_ibs_cbs) {
          const t = r.ibsCbs;
          await c.query(
            `update regra_fiscal set cst_ibs_cbs = $2, class_trib = $3, aliquota_ibs_uf = $4, aliquota_ibs_mun = $5,
               aliquota_ibs = $6, aliquota_cbs = $7 where id = $1`,
            [e.id, t.cstIbsCbs, t.classTrib, t.aliquotaIbsUf, t.aliquotaIbsMun, t.aliquotaIbsUf + t.aliquotaIbsMun, t.aliquotaCbs]);
          console.log(`  ~   ${r.vip}: já existia — completada com IBS/CBS (CST 000, cClassTrib 000001, CBS 0,9%, IBS 0,1%)`);
          continue;
        }
        console.log(`  ${igual ? '==' : '!!'}  ${r.vip}: já existe ${igual ? 'igual' : `DIFERENTE (CFOP ${e.cfop}, CST ${e.cst_icms}) — não mexo`}`);
        continue;
      }
      const t = r.ibsCbs || {};
      await c.query(
        `insert into regra_fiscal (id, empresa_id, tipo_operacao, grupo_tributario_id, dentro_do_estado, cfop, cst_icms,
           modalidade_bc_icms, aliquota_icms, cst_pis, aliquota_pis, cst_cofins, aliquota_cofins, prioridade, vigencia_inicio,
           cst_ibs_cbs, class_trib, aliquota_ibs_uf, aliquota_ibs_mun, aliquota_ibs, aliquota_cbs)
         values (gen_random_uuid(), $1, $2, $3, true, $4, $5, $6, $7, $8, $9, $10, $11, 0, $12, $13, $14, $15, $16, $17, $18)`,
        [empresa.id, r.tipo, grupoId, r.cfop, r.cstIcms, r.modalidadeBc, r.aliquotaIcms, r.cstPis, r.aliquotaPis, r.cstCofins, r.aliquotaCofins, VIGENCIA,
          t.cstIbsCbs || null, t.classTrib || null,
          r.ibsCbs ? t.aliquotaIbsUf : null, r.ibsCbs ? t.aliquotaIbsMun : null,
          r.ibsCbs ? t.aliquotaIbsUf + t.aliquotaIbsMun : null, r.ibsCbs ? t.aliquotaCbs : null]);
      console.log(`  +   ${r.vip}: ${r.tipo}${r.grupo ? ' · grupo ST' : ' · sem grupo'} · dentro do estado -> CFOP ${r.cfop}, CST ${r.cstIcms}`
        + `${r.aliquotaIcms ? ` ${r.aliquotaIcms}%` : ''}, PIS ${r.cstPis} ${String(r.aliquotaPis).replace('.', ',')}%, COFINS ${r.cstCofins} ${r.aliquotaCofins}%`);
    }

    console.log('\n  As de TRANSFERENCIA ficam SEM IBS/CBS, de propósito: o enquadramento entre');
    console.log('  estabelecimentos do mesmo titular é pergunta para o contador.');

    console.log('\n--- conversão de CFOP nas compras ---');
    const corrigidas = [];
    let novas = 0;
    for (const [origens, finalVip, finalAqui] of COMPRAS) {
      for (const origem of origens) {
        const entrada = entradaDe(origem, finalAqui);
        if (finalVip !== finalAqui) corrigidas.push(`${origem} -> ${entradaDe(origem, finalVip)} (não existe) virou ${entrada}`);
        const { rows: ja } = await c.query('select cfop_entrada from cfop_conversao_entrada where empresa_id = $1 and cfop_origem = $2', [empresa.id, origem]);
        if (ja.length) {
          if (ja[0].cfop_entrada !== entrada) console.log(`  !!  ${origem}: já existe -> ${ja[0].cfop_entrada}, não mexo`);
          continue;
        }
        await c.query(
          `insert into cfop_conversao_entrada (id, empresa_id, cfop_origem, cfop_entrada, observacao, criado_por_nome)
           values ($1, $2, $3, $4, $5, 'Carga das regras do ERP VIP')`,
          [createId('cfopent'), empresa.id, origem, entrada,
            finalVip !== finalAqui ? `No ERP VIP ia para ${entradaDe(origem, finalVip)}, que não existe na tabela de CFOP.` : null]);
        novas += 1;
      }
    }
    console.log(`  +   ${novas} conversão(ões) nova(s)`);
    if (corrigidas.length) {
      console.log('\n  CORRIGIDAS em relação ao ERP VIP (o CFOP de lá não existe):');
      for (const x of corrigidas) console.log(`      ${x}`);
    }
    console.log('\n  MANTIDAS como lá, mas para conferir: 5101/6101 -> 1101/2101 e 5401/6401 -> 1401/2401');
    console.log('  são "compra para INDUSTRIALIZAÇÃO"; para revenda seriam 1102/2102 e 1403/2403.');

    if (confirmo) {
      await c.query('commit');
      console.log('\n===== GRAVADO =====');
    } else {
      await c.query('rollback');
      console.log('\n(nada gravado — rode com --confirmo para gravar)');
    }
  } catch (e) {
    falhou = true;
    try { await c.query('rollback'); } catch (_) { /* conexão perdida */ }
    console.error('\nERRO:', e.message);
  } finally {
    c.release();
    await pool.end();
  }
  process.exit(falhou ? 1 : 0);
})();
