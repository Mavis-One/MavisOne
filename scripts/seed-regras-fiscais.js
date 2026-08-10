#!/usr/bin/env node
/**
 * Modelo de regras fiscais para os CFOPs que a empresa realmente usa.
 *
 * Origem dos CFOPs: listagem do ERP atual do usuário (2026-08-10).
 *   5102 — venda dentro de SC, sem ST
 *   5405 — venda dentro de SC, mercadoria com ICMS-ST já retido (substituído)
 *   6108 — venda interestadual para NÃO contribuinte
 *   6403 — venda interestadual com ST, na condição de substituto
 *
 * Todos os quatro são "adquirida ou recebida de terceiros": é REVENDA. Por
 * isso nenhuma regra sai com IPI — quem destaca IPI é indústria ou importador.
 *
 * O que este script preenche sozinho: só o que decorre do CFOP e do regime,
 * onde não existe escolha a fazer. Alíquota de ICMS, MVA e a decisão entre
 * CSOSN 101/102 dependem do contador e ficam NULAS de propósito — uma nota
 * autorizada com alíquota chutada só aparece na apuração, e aí já foi.
 *
 * Uso:
 *   node scripts/seed-regras-fiscais.js                      # lista as empresas
 *   node scripts/seed-regras-fiscais.js <empresaId>          # mostra o que faria
 *   node scripts/seed-regras-fiscais.js <empresaId> --aplicar
 *   node scripts/seed-regras-fiscais.js <empresaId> --aplicar --ncm-st 84713012,85287220
 *
 * As regras de ST (5405/6403) só são criadas com --ncm-st: elas valem por
 * mercadoria, não por operação. Uma regra de ST sem NCM competiria de igual
 * para igual com a regra normal de venda, e qual das duas venceria passaria a
 * depender de desempate — o item errado sairia sem ICMS destacado.
 */
require('dotenv').config();
const fiscalDb = require('../lib/db/fiscal');

const args = process.argv.slice(2);
const empresaId = args.find((a) => !a.startsWith('--'));
const aplicar = args.includes('--aplicar');
const ncmSt = (() => {
  const i = args.indexOf('--ncm-st');
  if (i === -1 || !args[i + 1]) return [];
  return args[i + 1].split(',').map((s) => s.replace(/\D/g, '')).filter(Boolean);
})();

const hoje = new Date().toISOString().slice(0, 10);

// PIS/COFINS do Lucro Presumido: regime CUMULATIVO. 0,65% e 3,00%, CST 01.
// Os 1,65%/7,6% dos exemplos que se acham por aí são de Lucro Real
// (não-cumulativo) — trocar os dois gera nota autorizada com valor errado.
const PIS_COFINS_PRESUMIDO = { cstPis: '01', aliquotaPis: 0.65, cstCofins: '01', aliquotaCofins: 3.0 };
// No Simples, PIS/COFINS saem no DAS: a nota declara "outras operações".
const PIS_COFINS_SIMPLES = { cstPis: '49', aliquotaPis: 0, cstCofins: '49', aliquotaCofins: 0 };

function regrasRegimeNormal() {
  const base = { tipoOperacao: 'VENDA', vigenciaInicio: hoje, ...PIS_COFINS_PRESUMIDO };
  const regras = [
    {
      ...base,
      cfop: '5102',
      dentroDoEstado: true,
      cstIcms: '00',
      prioridade: 10,
      aliquotaIcms: null, // PENDENTE: alíquota interna de SC para o NCM
      observacaoFisco: null,
      _pendencias: ['aliquotaIcms — alíquota interna de ICMS em SC (varia por NCM: 17%, 12%, 25%)']
    },
    {
      ...base,
      cfop: '6108',
      dentroDoEstado: false,
      // O CFOP 6108 já diz "destinada a não contribuinte": travar o critério
      // impede que uma venda a contribuinte caia nesta regra por engano.
      destinatarioContribuinte: false,
      cstIcms: '00',
      prioridade: 10,
      aliquotaIcms: null, // PENDENTE: 12% (Sul/Sudeste exceto ES) ou 7% (N/NE/CO/ES); 4% se importado
      aliquotaInternaUfDestino: null, // PENDENTE: DIFAL — alíquota interna do estado de destino
      aliquotaFcpUfDestino: null,     // PENDENTE: FCP do estado de destino (0% a 2%)
      _pendencias: [
        'aliquotaIcms — 12% para Sul/Sudeste (exceto ES), 7% para N/NE/CO e ES, 4% se mercadoria importada',
        'aliquotaInternaUfDestino e aliquotaFcpUfDestino — DIFAL da EC 87/2015, por UF de destino'
      ],
      _nota: 'DIFAL: 100% para o destino desde 2019. O sistema só monta a partilha quando a regra usa CST (regime normal).'
    }
  ];

  for (const ncm of ncmSt) {
    regras.push({
      ...base,
      cfop: '5405',
      ncm,
      dentroDoEstado: true,
      // CST 60 = ICMS já foi cobrado antes, por substituição. Nada a destacar
      // agora: alíquota ZERO é o valor correto, não "não preenchido".
      cstIcms: '60',
      aliquotaIcms: 0,
      prioridade: 50,
      _pendencias: []
    });
    regras.push({
      ...base,
      cfop: '6403',
      ncm,
      dentroDoEstado: false,
      destinatarioContribuinte: true,
      // Como SUBSTITUTO, é ele quem retém o ST do estado de destino.
      cstIcms: '10',
      aliquotaIcms: null,
      cstIcmsSt: '10',
      mvaSt: null,
      aliquotaIcmsSt: null,
      prioridade: 50,
      _pendencias: [
        'aliquotaIcms — alíquota interestadual (12% ou 7%, 4% se importado)',
        'mvaSt e aliquotaIcmsSt — MVA/IVA-ST e alíquota interna do destino, por NCM e por protocolo'
      ],
      _nota: 'Só existe ST interestadual onde houver protocolo/convênio entre SC e a UF de destino. Sem protocolo, a operação é 6102 comum.'
    });
  }
  return regras;
}

function regrasSimples() {
  const base = { tipoOperacao: 'VENDA', vigenciaInicio: hoje, ...PIS_COFINS_SIMPLES };
  const regras = [
    {
      ...base,
      cfop: '5102',
      dentroDoEstado: true,
      // 102 = sem permissão de crédito; 101 = com crédito, e aí a nota precisa
      // declarar o percentual vindo de empresa.aliquota_credito_icms_sn.
      csosn: '102',
      prioridade: 10,
      _pendencias: ['csosn — confirmar 102 (sem crédito) x 101 (com crédito ao destinatário) x 500']
    },
    {
      ...base,
      cfop: '6108',
      dentroDoEstado: false,
      destinatarioContribuinte: false,
      csosn: '102',
      prioridade: 10,
      _pendencias: ['csosn — confirmar 102 x 101'],
      // ADI 5.464 do STF: o Simples é dispensado do DIFAL. O builder já não
      // monta a partilha quando a regra usa CSOSN — não preencher as colunas
      // de DIFAL aqui é intencional.
      _nota: 'Simples Nacional é DISPENSADO do DIFAL (ADI 5.464). Sem alíquota de UF de destino de propósito.'
    }
  ];

  for (const ncm of ncmSt) {
    regras.push({
      ...base,
      cfop: '5405',
      ncm,
      dentroDoEstado: true,
      csosn: '500', // ICMS cobrado anteriormente por ST — equivalente ao CST 60
      prioridade: 50,
      _pendencias: []
    });
    regras.push({
      ...base,
      cfop: '6403',
      ncm,
      dentroDoEstado: false,
      destinatarioContribuinte: true,
      csosn: '202', // 201 se for dar crédito de ICMS ao destinatário
      mvaSt: null,
      aliquotaIcmsSt: null,
      prioridade: 50,
      _pendencias: [
        'csosn — 202 (sem crédito) x 201 (com crédito ao destinatário)',
        'mvaSt e aliquotaIcmsSt — MVA/IVA-ST e alíquota interna do destino'
      ]
    });
  }
  return regras;
}

(async () => {
  const empresas = await fiscalDb.getEmpresas();

  if (!empresaId) {
    if (!empresas.length) {
      console.log('Nenhuma empresa cadastrada ainda.');
      console.log('Cadastre em Configurações → Fiscal → Empresa antes de rodar este script.');
      return;
    }
    console.log('Empresas cadastradas:\n');
    empresas.forEach((e) => console.log(`  ${e.id}  ${e.razaoSocial}  (CRT ${e.crt} — ${e.regimeTributario})`));
    console.log('\nRode de novo passando o id da empresa.');
    return;
  }

  const empresa = empresas.find((e) => e.id === empresaId);
  if (!empresa) {
    console.error(`Empresa ${empresaId} não encontrada.`);
    process.exit(1);
  }

  // O CRT é quem decide, não o nome do regime: é ele que vai na nota e que
  // determina se a tributação sai como CST ou como CSOSN.
  const simples = Number(empresa.crt) === 1 || Number(empresa.crt) === 2;
  const regras = simples ? regrasSimples() : regrasRegimeNormal();

  console.log(`Empresa: ${empresa.razaoSocial}`);
  console.log(`Regime:  CRT ${empresa.crt} — ${simples ? 'Simples Nacional (usa CSOSN)' : 'Regime normal (usa CST)'}`);
  console.log(`NCMs com ST informados: ${ncmSt.length ? ncmSt.join(', ') : 'nenhum (regras 5405/6403 não serão criadas)'}\n`);

  const existentes = await fiscalDb.getRegrasFiscais(empresaId);
  console.log(`Regras já cadastradas para esta empresa: ${existentes.length}\n`);

  const pendencias = [];
  for (const regra of regras) {
    const { _pendencias = [], _nota, ...campos } = regra;
    const rotulo = `CFOP ${campos.cfop}${campos.ncm ? ' NCM ' + campos.ncm : ''}`;
    const tributacao = campos.csosn ? `CSOSN ${campos.csosn}` : `CST ${campos.cstIcms}`;
    console.log(`  ${rotulo.padEnd(24)} ${tributacao.padEnd(12)} PIS/COFINS ${campos.cstPis}`);
    if (_nota) console.log(`      nota: ${_nota}`);
    _pendencias.forEach((p) => {
      console.log(`      PENDENTE: ${p}`);
      pendencias.push(`${rotulo}: ${p}`);
    });

    // Duplicar regra é pior do que não criar: duas regras com a mesma
    // especificidade fazem o resultado depender de desempate.
    const jaExiste = existentes.some((e) =>
      e.cfop === campos.cfop && (e.ncm || null) === (campos.ncm || null) && e.tipoOperacao === campos.tipoOperacao);
    if (jaExiste) {
      console.log('      (já existe uma regra com este CFOP/NCM — pulando)');
      continue;
    }

    if (aplicar) {
      await fiscalDb.createRegraFiscal({ ...campos, empresaId });
      console.log('      criada.');
    }
  }

  console.log('');
  if (!aplicar) {
    console.log('Nada foi gravado. Rode de novo com --aplicar para criar as regras acima.');
  } else {
    console.log('Regras criadas.');
  }

  if (pendencias.length) {
    console.log(`\n${pendencias.length} campo(s) dependem do contador e ficaram em branco.`);
    console.log('Emitir com eles em branco gera rejeição ou imposto errado — preencha em');
    console.log('Fiscal → Regras Fiscais antes da primeira emissão.');
  }
})().catch((error) => {
  console.error('ERRO:', error.message);
  process.exit(1);
});
