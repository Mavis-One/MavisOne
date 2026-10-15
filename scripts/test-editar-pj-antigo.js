#!/usr/bin/env node
/**
 * EDITAR UM CADASTRO PJ ANTIGO DAVA "CNPJ NÃO ENCONTRADO" (15/10/2026). Relato
 * do usuário: "tento editar cadastros antigos e recebo sempre a mensagem de
 * que meu cnpj não foi encontrado, porém ele busca na base de dados pela api".
 *
 * A causa: os PJ antigos (importados do Viper; 1.227 no banco local) estão na
 * tabela `people`, e não em `cnpjs`. O salvamento escolhia a rota pelo TIPO —
 * pessoa-juridica ia para PUT /api/cadastros/cnpjs/<id>, que procura só em
 * `cnpjs` e respondia 404 "CNPJ não encontrado". Os PJ novos nascem em `cnpjs`,
 * por isso só os antigos falhavam.
 *
 * Provado: pela API, PUT /cnpjs/pes-1715828400000-7g4anm -> 404 "CNPJ não
 * encontrado". No navegador, com a correção, a mesma edição foi por PUT
 * /api/cadastros/pessoas/pes-1715828400000-7g4anm e deu "Cadastro atualizado
 * com sucesso." (cadastro e log restaurados depois).
 */
const fs = require('fs');
const path = require('path');
const { semComentarios } = require('./sem-comentarios');

let falhas = 0;
const check = (nome, cond) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}`);
  if (!cond) falhas += 1;
};
const app = semComentarios(fs.readFileSync(path.join(__dirname, '..', 'public/app.js'), 'utf8'));

const trecho = app.slice(app.indexOf("const endpointBase = kind === 'cnpj' ? '/api/cadastros/cnpjs' : '/api/cadastros/pessoas';") - 600,
  app.indexOf("const endpointBase = kind === 'cnpj' ? '/api/cadastros/cnpjs' : '/api/cadastros/pessoas';"));
const regra = trecho.match(/const kind = (isEditing\s*\?[\s\S]*?);\s*$/);

console.log('\n--- a rota do salvamento ---');
check('a regra está lá', Boolean(regra));
// A própria expressão da tela, avaliada com os casos.
const rota = regra ? new Function('isEditing', 'peopleDraft', 'payload', 'type', `return ${regra[1]};`) : () => '';
check('PJ antigo (em people) editado vai para /pessoas',
  rota(true, { kind: 'people' }, { id: 'pes-1715828400000-7g4anm' }, 'pessoa-juridica') === 'people');
check('PJ da tabela cnpjs editado vai para /cnpjs',
  rota(true, { kind: 'cnpj' }, { id: 'cnpj-1' }, 'pessoa-juridica') === 'cnpj');
check('sem o kind (rascunho de outro caminho), o id decide',
  rota(true, {}, { id: 'pes-1' }, 'pessoa-juridica') === 'people'
  && rota(true, {}, { id: 'cnpj-1' }, 'pessoa-juridica') === 'cnpj');
check('PJ novo continua nascendo em cnpjs', rota(false, {}, {}, 'pessoa-juridica') === 'cnpj');
check('PF nova continua em pessoas', rota(false, {}, {}, 'pessoa-fisica') === 'people');

console.log('\n--- o rascunho guarda de onde veio ---');
check('ao salvar', /people: \{ \.\.\.payload, kind: peopleDraft\.kind \} \};/.test(app));
check('e quando o salvamento falha', /people: \{ \.\.\.payload, kind: peopleDraft\.kind, error: error\.message \|\| 'Erro ao salvar pessoa\.' \}/.test(app));

console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TUDO OK =====');
process.exit(falhas ? 1 : 0);
