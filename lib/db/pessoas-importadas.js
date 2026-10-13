// PESSOAS DO VIPER — o que a API confere e grava (13/10/2026).
// O que entra e por quê: lib/importacao-pessoas-viper.js.
//
// Pelas funções de lib/db/cadastros.js, e não por SQL solto: são elas que
// mantêm o cache do cadastro (fase DI) em dia — um INSERT por fora deixaria a
// pessoa nova invisível na lista até o servidor reiniciar.
//
// Não é uma transação, e não precisa ser: cada passo é por pessoa, e rodar de
// novo não duplica (o documento já existe e o papel já está lá). Um tropeço no
// meio deixa as primeiras gravadas; a segunda rodada termina o resto.
'use strict';

const cadastros = require('./cadastros');
const { planejar } = require('../importacao-pessoas-viper');

async function carregarExistentes() {
  const [pessoas, cnpjs] = await Promise.all([cadastros.getPeople(), cadastros.getCnpjs()]);
  return [
    ...pessoas.map((p) => ({ id: p.id, tabela: 'people', name: p.name, document: p.document, roles: p.roles })),
    ...cnpjs.map((c) => ({ id: c.id, tabela: 'cnpjs', name: c.name, document: c.document, roles: c.roles }))
  ];
}

/**
 * @param itens   saída de lerPlanilha().itens
 * @param opcoes  { papel, simular, documentoValido(doc) -> bool, hoje 'AAAA-MM-DD' }
 */
async function gravarPessoas(itens, { papel = 'Cliente', simular = false, documentoValido = () => true, hoje } = {}) {
  if (!Array.isArray(itens) || !itens.length) {
    const erro = new Error('Nenhuma pessoa recebida.');
    erro.status = 400;
    throw erro;
  }
  const plano = planejar(itens, await carregarExistentes(), papel);
  // CPF/CNPJ com dígito errado não vira cadastro novo: a tela recusaria o
  // mesmo documento. Quem já existe com ele não é afetado.
  const invalidos = plano.novos.filter((i) => !documentoValido(i.documento));
  const novos = plano.novos.filter((i) => documentoValido(i.documento));
  const resumo = {
    jaTinham: plano.jaTinham,
    ganhamPapel: plano.ganhamPapel.map((g) => ({ codigo: g.codigo, nome: g.nome })),
    novos: novos.map((i) => ({ codigo: i.codigo, nome: i.nome, documento: i.documento, tipo: i.tipo })),
    invalidos: invalidos.map((i) => ({ codigo: i.codigo, nome: i.nome, documento: i.documento }))
  };
  if (simular) return { simulado: true, criados: 0, papelGravado: 0, ...resumo };

  let papelGravado = 0;
  for (const g of plano.ganhamPapel) {
    const gravado = g.tabela === 'cnpjs'
      ? await cadastros.updateCnpj(g.id, { roles: g.papeis })
      : await cadastros.updatePerson(g.id, { roles: g.papeis });
    if (gravado) papelGravado += 1;
  }
  let criados = 0;
  for (const i of novos) {
    await cadastros.createPerson({
      type: i.tipo,
      name: i.nome,
      tradeName: i.fantasia,
      document: i.documento,
      status: i.ativo ? 'ativo' : 'inativo',
      inactive: !i.ativo,
      roles: [papel],
      importadoDe: 'ViperERP',
      importadoEm: hoje || new Date().toISOString().slice(0, 10),
      codigoViper: i.codigo
    });
    criados += 1;
  }
  return { simulado: false, criados, papelGravado, ...resumo };
}

module.exports = { gravarPessoas };
