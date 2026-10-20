// EXCLUIR CENTRO DE CUSTO (20/10/2026, pedido do usuário: "eu preciso de um
// botão de exclusão de centro de custos").
//
// Decisão do usuário: os lançamentos que usam o centro ficam SEM centro de
// custo. A tela pergunta antes, dizendo quantos são.
//
// Provado no navegador (servidor local): centro de teste ligado a um
// lançamento; a pergunta disse "1 lançamento fica sem centro de custo"; o
// centro saiu do banco, o lançamento ficou sem centro e a auditoria guardou o
// centro e a contagem. Dados de teste apagados.
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const ler = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8').replace(/\r\n/g, '\n');
let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};

const permissoes = require('../lib/permissoes');
const banco = ler('lib/db/financeiro.js');
const servidor = ler('server.js');
const tela = ler('public/modules/finance/subs/centros_de_custo.js');

check('DELETE do centro é finance.excluir; a contagem, finance.ler',
  permissoes.resolverPermissao('/api/finance/cost-centers/x', 'DELETE') === 'finance.excluir'
  && permissoes.resolverPermissao('/api/finance/cost-centers/x/uso', 'GET') === 'finance.ler');
check('numa transação: os lançamentos ficam sem centro, e o centro sai',
  /async function deleteCostCenter\(id\) \{\s*return emTransacao\(async \(cliente\) => \{[\s\S]{0,300}update financial_entries set cost_center_id = null, updated_at = now\(\) where cost_center_id = \$1[\s\S]{0,120}delete from cost_centers where id = \$1/.test(banco));
check('a rota grava a auditoria com o centro e quantos mudaram',
  /action: 'excluirCentroDeCusto',[\s\S]{0,200}details: \{ centro: feito\.centro, lancamentosSemCentro: feito\.lancamentos \}/.test(servidor));
check('a tela: Excluir só para quem pode', /\$\{podeExcluir \? ` <button type="button" class="btn-danger" data-cc-excluir=/.test(tela)
  && /state\.user\.permissions\.includes\('finance\.excluir'\)/.test(tela));
check('  pergunta antes, dizendo quantos lançamentos ficam sem centro',
  /await api\(`\/api\/finance\/cost-centers\/\$\{encodeURIComponent\(centro\.id\)\}\/uso`\)/.test(tela) && /sem centro de custo\./.test(tela));
check('a auditoria mostra o nome da ação', /excluirCentroDeCusto: 'Exclusão de centro de custo'/.test(ler('public/modules/settings/subs/access_logs.js')));

console.log(`\n===== ${falhas === 0 ? 'TODOS OS CHECKS PASSARAM' : falhas + ' FALHA(S)'} =====`);
process.exit(falhas ? 1 : 0);
