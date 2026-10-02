/**
 * RELATÓRIOS DE AGENDAMENTOS E TAREFAS.
 *
 * As duas coleções ainda moram no db.json (data.appointments e data.tasks; os
 * campos estão em lib/cadastros-core.js). Os nomes não: a pessoa (personId) é
 * people ou cnpjs, como no diretório do Cadastros, e o responsável
 * (responsibleId) é um usuário (users). Cada relatório faz UMA consulta para os
 * nomes de todas as linhas, e não uma por linha.
 *
 * A tarefa vence pelo prazo (dueDate); sem prazo ela só aparece quando nenhum
 * período foi pedido.
 */

const SITUACAO_AGENDAMENTO = { agendado: 'Agendado', confirmado: 'Confirmado', realizado: 'Realizado', cancelado: 'Cancelado' };
const SITUACAO_TAREFA = { pendente: 'Pendente', 'em-andamento': 'Em andamento', concluida: 'Concluída', cancelada: 'Cancelada' };
const PRIORIDADE = { baixa: 'Baixa', media: 'Média', alta: 'Alta' };
const ORDEM_PRIORIDADE = { alta: 0, media: 1, baixa: 2 };

const dataDe = (v) => {
  const s = String(v || '').trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
};
const noPeriodo = (dia, f) => (!f.de || (dia && dia >= f.de)) && (!f.ate || (dia && dia <= f.ate));

/** Nomes das pessoas e dos usuários citados, numa consulta só. */
async function nomesDe(sql, registros) {
  const pessoas = [...new Set(registros.map((r) => r.personId).filter(Boolean))];
  const usuarios = [...new Set(registros.map((r) => r.responsibleId).filter(Boolean))];
  const nomes = { pessoas: new Map(), usuarios: new Map() };
  if (!pessoas.length && !usuarios.length) return nomes;
  const linhas = await sql(`
    select 'p' as tipo, id, name from people where id = any($1::text[])
    union all
    select 'p', id, name from cnpjs where id = any($1::text[])
    union all
    select 'u', id, coalesce(nullif(name, ''), username) from users where id = any($2::text[])`, [pessoas, usuarios]);
  for (const l of linhas) (l.tipo === 'u' ? nomes.usuarios : nomes.pessoas).set(l.id, l.name || '');
  return nomes;
}

module.exports = [
  {
    key: 'agendamentos',
    grupo: 'agendamentos',
    titulo: 'Agendamentos',
    filtros: ['periodo'],
    periodoPadrao: 'mes',
    colunas: [
      { campo: 'data', rotulo: 'Data', tipo: 'data' },
      { campo: 'hora', rotulo: 'Hora', tipo: 'texto' },
      { campo: 'titulo', rotulo: 'Título', tipo: 'texto' },
      { campo: 'pessoa', rotulo: 'Pessoa', tipo: 'texto' },
      { campo: 'responsavel', rotulo: 'Responsável', tipo: 'texto' },
      { campo: 'situacao', rotulo: 'Situação', tipo: 'texto' }
    ],
    totais: [],
    async executar({ sql, f, data }) {
      const registros = ((data && data.appointments) || [])
        .filter((a) => a && noPeriodo(dataDe(a.date), f))
        .sort((a, b) => `${dataDe(a.date)} ${a.startTime || '99:99'}`.localeCompare(`${dataDe(b.date)} ${b.startTime || '99:99'}`));
      if (!registros.length) return [];
      const nomes = await nomesDe(sql, registros);
      return registros.map((a) => ({
        data: dataDe(a.date) || null,
        hora: [a.startTime, a.endTime].filter(Boolean).join(' - '),
        titulo: String(a.title || ''),
        pessoa: nomes.pessoas.get(a.personId) || '',
        responsavel: nomes.usuarios.get(a.responsibleId) || '',
        situacao: SITUACAO_AGENDAMENTO[a.status] || String(a.status || '')
      }));
    }
  },

  {
    key: 'tarefas',
    grupo: 'agendamentos',
    titulo: 'Tarefas',
    filtros: ['periodo'],
    colunas: [
      { campo: 'prazo', rotulo: 'Prazo', tipo: 'data' },
      { campo: 'titulo', rotulo: 'Título', tipo: 'texto' },
      { campo: 'pessoa', rotulo: 'Pessoa', tipo: 'texto' },
      { campo: 'responsavel', rotulo: 'Responsável', tipo: 'texto' },
      { campo: 'prioridade', rotulo: 'Prioridade', tipo: 'texto' },
      { campo: 'situacao', rotulo: 'Situação', tipo: 'texto' }
    ],
    totais: [],
    async executar({ sql, f, data }) {
      const registros = ((data && data.tasks) || [])
        .filter((t) => t && noPeriodo(dataDe(t.dueDate), f))
        .sort((a, b) => {
          const pa = `${dataDe(a.dueDate) || '9999-99-99'} ${a.dueTime || '99:99'}`;
          const pb = `${dataDe(b.dueDate) || '9999-99-99'} ${b.dueTime || '99:99'}`;
          return pa.localeCompare(pb) || (ORDEM_PRIORIDADE[a.priority] ?? 1) - (ORDEM_PRIORIDADE[b.priority] ?? 1);
        });
      if (!registros.length) return [];
      const nomes = await nomesDe(sql, registros);
      return registros.map((t) => ({
        prazo: dataDe(t.dueDate) || null,
        titulo: String(t.title || ''),
        pessoa: nomes.pessoas.get(t.personId) || '',
        responsavel: nomes.usuarios.get(t.responsibleId) || '',
        prioridade: PRIORIDADE[t.priority] || String(t.priority || ''),
        situacao: SITUACAO_TAREFA[t.status] || String(t.status || '')
      }));
    }
  }
];
