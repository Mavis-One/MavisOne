// PESSOAS DO VIPER PELA PLANILHA "PESSOAS" (13/10/2026) — a parte pura.
//
// A planilha (61 pessoas) não diz o papel de ninguém: Código | Nome | Nome
// Fantasia/Apelido | Tipo | Grupo | CPF/CNPJ | Status | Data Cadastro. Decisão
// do usuário (13/10/2026): todas são CLIENTE.
//
// O QUE ENTRA:
//   - quem já existe no MavisONE (pelo CPF/CNPJ) ganha o papel Cliente, e
//     mais nada muda — nome, endereço e os outros papéis ficam como estão
//     (ALEXANDRE WOSNIAK aqui, WOSNIACK lá: o daqui fica);
//   - quem não existe é cadastrado com nome, fantasia, tipo, documento,
//     situação e o papel Cliente.
//
// O CPF/CNPJ é a chave, e não o código: o código do Viper (004335) não é o do
// MavisONE (4340) para a mesma pessoa.
'use strict';

const CABECALHO = ['Código', 'Nome', 'Nome Fantasia/Apelido', 'Tipo', 'Grupo', 'CPF/CNPJ', 'Status', 'Data Cadastro'];

const digitos = (v) => String(v ?? '').replace(/\D/g, '');
const texto = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();

/**
 * Lê a planilha (saída de lib/xlsx-leitor). Recusa planilha sem o cabeçalho
 * esperado: coluna fora do lugar gravaria o nome no documento sem erro nenhum.
 */
function lerPlanilha(abas) {
  const aba = Array.isArray(abas) ? abas[0] : null;
  const linhas = (Array.isArray(aba) ? aba : (aba && aba.linhas)) || [];
  const posCab = linhas.findIndex((l) => Array.isArray(l) && texto(l[0]) === 'Código' && texto(l[5]) === 'CPF/CNPJ');
  if (posCab < 0) throw new Error('Cabeçalho "Código | Nome | ... | CPF/CNPJ" não encontrado. É a planilha "Pessoas" do Viper?');
  const cab = linhas[posCab].map(texto);
  const fora = CABECALHO.filter((c, i) => cab[i] !== c);
  if (fora.length) throw new Error(`Colunas fora do lugar esperado: ${fora.join(', ')}. Esperado: ${CABECALHO.join(' | ')}.`);
  const empresa = texto((linhas.slice(0, posCab).find((l) => /LTDA|S\/A|EIRELI/i.test(String(l[0]))) || [''])[0]);

  const itens = [];
  const ignorados = [];
  const vistos = new Set();
  for (const l of linhas.slice(posCab + 1)) {
    const codigo = texto(l[0]);
    if (!codigo) continue;
    const documento = digitos(l[5]);
    const nome = texto(l[1]).toLocaleUpperCase('pt-BR');
    if (!nome) { ignorados.push({ codigo, motivo: 'sem nome' }); continue; }
    if (documento.length !== 11 && documento.length !== 14) { ignorados.push({ codigo, nome, motivo: `CPF/CNPJ "${texto(l[5])}" incompleto` }); continue; }
    if (vistos.has(documento)) { ignorados.push({ codigo, nome, motivo: 'CPF/CNPJ repetido na planilha' }); continue; }
    vistos.add(documento);
    const fantasia = texto(l[2]).toLocaleUpperCase('pt-BR');
    itens.push({
      codigo,
      nome,
      // Fantasia igual ao nome é só o Viper repetindo; não vira dado.
      fantasia: fantasia && fantasia !== nome ? fantasia : '',
      tipo: documento.length === 14 ? 'pessoa-juridica' : 'pessoa-fisica',
      documento,
      ativo: !/inativ/i.test(texto(l[6]))
    });
  }
  return { empresa, itens, ignorados };
}

/**
 * O que fazer com cada item. `existentes` é a lista de cadastros do MavisONE
 * ({ id, tabela, document, roles }). Puro: a gravação está em
 * lib/db/pessoas-importadas.js.
 */
function planejar(itens, existentes, papel) {
  const porDocumento = new Map();
  for (const e of existentes || []) {
    const d = digitos(e.document);
    if (d && !porDocumento.has(d)) porDocumento.set(d, e);
  }
  const novos = [];
  const ganhamPapel = [];
  let jaTinham = 0;
  for (const item of itens || []) {
    const atual = porDocumento.get(digitos(item.documento));
    if (!atual) { novos.push(item); continue; }
    const papeis = Array.isArray(atual.roles) ? atual.roles : [];
    if (papeis.includes(papel)) { jaTinham += 1; continue; }
    ganhamPapel.push({ id: atual.id, tabela: atual.tabela || 'people', nome: atual.name, codigo: item.codigo, papeis: [...papeis, papel] });
  }
  return { novos, ganhamPapel, jaTinham };
}

module.exports = { lerPlanilha, planejar, CABECALHO };
