/**
 * EXIGÊNCIAS DE NF-e POR CLIENTE no banco (fase FB, 22/10/2026). Tabelas
 * `cliente_exigencia_nfe` (o perfil, pela chave CNPJ/CPF) e `nfe_email_envio`
 * (cada envio do XML por e-mail). As regras moram em
 * public/modules/shared/exigencias_nfe.js; aqui só se lê e grava.
 */
const { consultar } = require('./conexao');
const { MARCAS } = require('../../public/modules/shared/exigencias_nfe');

function mapPerfil(row) {
  if (!row) return null;
  const perfil = {
    cnpjCpf: row.cnpj_cpf,
    cadastroId: row.cadastro_id || '',
    nome: row.nome,
    ativo: row.ativo !== false,
    emailsXml: Array.isArray(row.emails_xml) ? row.emails_xml : [],
    rotuloMaterial: row.rotulo_material || 'MATERIAL',
    modeloInfcpl: row.modelo_infcpl || '',
    observacoes: row.observacoes || '',
    alteradoEm: row.alterado_em,
    alteradoPorNome: row.alterado_por_nome || ''
  };
  MARCAS.forEach((m) => { perfil[m.campo] = row[m.coluna] === true; });
  return perfil;
}

async function listar() {
  const r = await consultar('select * from cliente_exigencia_nfe order by nome');
  return r.rows.map(mapPerfil);
}

async function obter(cnpjCpf) {
  const r = await consultar('select * from cliente_exigencia_nfe where cnpj_cpf = $1', [String(cnpjCpf || '').replace(/\D/g, '')]);
  return mapPerfil(r.rows[0]);
}

/** Grava o perfil (já normalizado). `anterior`: a chave de antes, quando o documento mudou. */
async function salvar(perfil, { anterior = '', porNome = '' } = {}) {
  const colunas = ['cnpj_cpf', 'cadastro_id', 'nome', 'ativo', 'emails_xml', 'rotulo_material', 'modelo_infcpl', 'observacoes', ...MARCAS.map((m) => m.coluna)];
  const valores = [perfil.cnpjCpf, perfil.cadastroId, perfil.nome, perfil.ativo, perfil.emailsXml, perfil.rotuloMaterial, perfil.modeloInfcpl, perfil.observacoes, ...MARCAS.map((m) => perfil[m.campo] === true)];
  const marcadores = valores.map((_, i) => `$${i + 1}`);
  const atualizar = colunas.filter((c) => c !== 'cnpj_cpf').map((c) => `${c} = excluded.${c}`);
  const sql = `insert into cliente_exigencia_nfe (${colunas.join(', ')}, alterado_por_nome)
    values (${marcadores.join(', ')}, $${valores.length + 1})
    on conflict (cnpj_cpf) do update set ${atualizar.join(', ')}, alterado_em = now(), alterado_por_nome = excluded.alterado_por_nome
    returning *`;
  const anteriorLimpo = String(anterior || '').replace(/\D/g, '');
  if (anteriorLimpo && anteriorLimpo !== perfil.cnpjCpf) {
    await consultar('delete from cliente_exigencia_nfe where cnpj_cpf = $1', [anteriorLimpo]);
  }
  const r = await consultar(sql, [...valores, String(porNome || '')]);
  return mapPerfil(r.rows[0]);
}

async function excluir(cnpjCpf) {
  const r = await consultar('delete from cliente_exigencia_nfe where cnpj_cpf = $1', [String(cnpjCpf || '').replace(/\D/g, '')]);
  return r.rowCount > 0;
}

async function registrarEnvio({ nfeId, referencia, emails, status, erro = '', automatico = true, porNome = '' }) {
  await consultar(
    `insert into nfe_email_envio (nfe_id, referencia, emails, status, erro, automatico, enviado_por_nome)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [String(nfeId), String(referencia || ''), emails, status, String(erro || '').slice(0, 1000), automatico, String(porNome || '')]
  );
}

async function enviosDaNota(nfeId) {
  const r = await consultar('select * from nfe_email_envio where nfe_id = $1 order by criado_em desc', [String(nfeId)]);
  return r.rows.map((row) => ({
    emails: row.emails || [], status: row.status, erro: row.erro || '',
    automatico: row.automatico, enviadoPorNome: row.enviado_por_nome || '', criadoEm: row.criado_em
  }));
}

module.exports = { listar, obter, salvar, excluir, registrarEnvio, enviosDaNota, mapPerfil };
