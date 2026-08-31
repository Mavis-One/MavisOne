// CRUD dos módulos Frota, RH, PCP e Contratos.
//
// São 11 recursos com o mesmo formato: listar, obter, criar, editar, excluir.
// Escrever onze arquivos quase idênticos garantiria que uma correção fosse
// aplicada em dez lugares e esquecida no décimo primeiro. Aqui cada recurso é
// uma DESCRIÇÃO, e as cinco operações são escritas uma vez só.
//
// O que fica de fora de propósito: regra de negócio. Isto aqui só traduz
// camelCase (que o navegador manda) para snake_case (que o Postgres usa) e
// devolve. Qualquer decisão — o que pode ser excluído, o que recalcula o quê —
// mora na rota, onde dá para ler.
const { banco, createId, assertNoError } = require('./client');

// Tipos de campo. O ponto de todos eles é o mesmo: campo vazio vindo de um
// <input> chega como '' — gravar isso numa coluna numérica ou de data é erro
// do Postgres, e o certo é null.
//
// EXCEÇÃO, e ela custou um teste vermelho: coluna NOT NULL DEFAULT não aceita
// null explícito. O DEFAULT do Postgres só vale quando a coluna é OMITIDA do
// INSERT — mandar null é uma escrita, e a recusa é imediata. Para essas
// colunas o descritor traz um terceiro elemento, o padrão, que substitui o
// vazio. Ele precisa espelhar o DEFAULT da migração; quando os dois divergem,
// é o teste de CRUD que acusa.
const CONVERSORES = {
  texto: (v) => (v === undefined || v === null || v === '' ? null : String(v)),
  numero: (v) => (v === undefined || v === null || v === '' ? null : Number(v)),
  inteiro: (v) => (v === undefined || v === null || v === '' ? null : parseInt(v, 10)),
  data: (v) => (v === undefined || v === null || v === '' ? null : String(v).slice(0, 10)),
  hora: (v) => (v === undefined || v === null || v === '' ? null : String(v)),
  booleano: (v) => v === true || v === 'true' || v === 'on' || v === 1
};

// prefixo: usado no id gerado, só para o registro ser reconhecível no banco.
const RECURSOS = {
  // ------------------------------------------------------------------ FROTA
  'fleet/vehicles': {
    tabela: 'fleet_vehicles', prefixo: 'veic', ordem: 'plate', lista: 'vehicles', item: 'vehicle',
    campos: {
      plate: ['plate', 'texto'], description: ['description', 'texto'], brand: ['brand', 'texto'],
      model: ['model', 'texto'], year: ['year', 'inteiro'], odometer: ['odometer', 'numero', 0],
      status: ['status', 'texto', 'ativo']
    }
  },
  'fleet/maintenances': {
    tabela: 'fleet_maintenances', prefixo: 'manut', ordem: 'date', desc: true, lista: 'maintenances', item: 'maintenance',
    campos: {
      vehicleId: ['vehicle_id', 'texto'], date: ['date', 'data'], kind: ['kind', 'texto', 'preventiva'],
      description: ['description', 'texto'], supplierName: ['supplier_name', 'texto'],
      cost: ['cost', 'numero', 0], odometer: ['odometer', 'numero']
    }
  },
  'fleet/refuels': {
    tabela: 'fleet_refuels', prefixo: 'abast', ordem: 'date', desc: true, lista: 'refuels', item: 'refuel',
    campos: {
      vehicleId: ['vehicle_id', 'texto'], date: ['date', 'data'], liters: ['liters', 'numero', 0],
      total: ['total', 'numero', 0], odometer: ['odometer', 'numero'], station: ['station', 'texto']
    }
  },

  // --------------------------------------------------------------------- RH
  // "Profissões" na tela; a tabela continua hr_positions, criada como Cargos na
  // Fase R. Renomear a tabela custaria uma migração de dados para trocar uma
  // palavra que só aparece na interface.
  'hr/positions': {
    tabela: 'hr_positions', prefixo: 'prof', ordem: 'name', lista: 'positions', item: 'position',
    campos: {
      name: ['name', 'texto'], description: ['description', 'texto'], cbo: ['cbo', 'texto'],
      salaryMin: ['salary_min', 'numero'], salaryMax: ['salary_max', 'numero'],
      active: ['active', 'booleano']
    }
  },
  'hr/departments': {
    tabela: 'hr_departments', prefixo: 'depto', ordem: 'name', lista: 'departments', item: 'department',
    campos: {
      name: ['name', 'texto'], description: ['description', 'texto'],
      managerId: ['manager_id', 'texto'], costCenter: ['cost_center', 'texto'],
      active: ['active', 'booleano']
    }
  },
  'hr/work-schedules': {
    tabela: 'hr_work_schedules', prefixo: 'exped', ordem: 'name', lista: 'workSchedules', item: 'workSchedule',
    campos: {
      name: ['name', 'texto'], description: ['description', 'texto'],
      diasSemana: ['dias_semana', 'texto'],
      entrada: ['entrada', 'hora'], saidaAlmoco: ['saida_almoco', 'hora'],
      voltaAlmoco: ['volta_almoco', 'hora'], saida: ['saida', 'hora'],
      cargaSemanal: ['carga_semanal', 'numero'],
      toleranciaMinutos: ['tolerancia_minutos', 'inteiro', 5],
      active: ['active', 'booleano']
    }
  },
  'hr/employee-types': {
    tabela: 'hr_employee_types', prefixo: 'tipocol', ordem: 'name', lista: 'employeeTypes', item: 'employeeType',
    campos: {
      name: ['name', 'texto'], description: ['description', 'texto'],
      registroClt: ['registro_clt', 'booleano'], active: ['active', 'booleano']
    }
  },
  'hr/employee-categories': {
    tabela: 'hr_employee_categories', prefixo: 'catcol', ordem: 'name', lista: 'employeeCategories', item: 'employeeCategory',
    campos: {
      name: ['name', 'texto'], description: ['description', 'texto'],
      baseCalculo: ['base_calculo', 'texto', 'mensal'], active: ['active', 'booleano']
    }
  },
  'hr/employees': {
    tabela: 'hr_employees', prefixo: 'colab', ordem: 'name', lista: 'employees', item: 'employee',
    campos: {
      name: ['name', 'texto'], document: ['document', 'texto'], positionId: ['position_id', 'texto'],
      departmentId: ['department_id', 'texto'], workScheduleId: ['work_schedule_id', 'texto'],
      employeeTypeId: ['employee_type_id', 'texto'], employeeCategoryId: ['employee_category_id', 'texto'],
      admittedAt: ['admitted_at', 'data'], dismissedAt: ['dismissed_at', 'data'],
      salary: ['salary', 'numero'], email: ['email', 'texto'], phone: ['phone', 'texto'],
      status: ['status', 'texto', 'ativo']
    }
  },
  'hr/leaves': {
    tabela: 'hr_leaves', prefixo: 'afast', ordem: 'start_date', desc: true, lista: 'leaves', item: 'leave',
    campos: {
      employeeId: ['employee_id', 'texto'], kind: ['kind', 'texto'],
      startDate: ['start_date', 'data'], endDate: ['end_date', 'data'], notes: ['notes', 'texto']
    }
  },
  'hr/time-entries': {
    tabela: 'hr_time_entries', prefixo: 'ponto', ordem: 'date', desc: true, lista: 'timeEntries', item: 'timeEntry',
    campos: {
      employeeId: ['employee_id', 'texto'], date: ['date', 'data'],
      entrada: ['entrada', 'hora'], saidaAlmoco: ['saida_almoco', 'hora'],
      voltaAlmoco: ['volta_almoco', 'hora'], saida: ['saida', 'hora'], notes: ['notes', 'texto']
    }
  },

  // -------------------------------------------------------------------- PCP
  'pcp/bom': {
    tabela: 'pcp_bom', prefixo: 'bom', ordem: 'product_id', lista: 'bom', item: 'bomItem',
    campos: {
      productId: ['product_id', 'texto'], componentId: ['component_id', 'texto'],
      quantity: ['quantity', 'numero', 1], lossPercent: ['loss_percent', 'numero', 0]
    }
  },
  'pcp/orders': {
    tabela: 'pcp_orders', prefixo: 'op', ordem: 'due_date', lista: 'orders', item: 'order',
    campos: {
      code: ['code', 'inteiro'], productId: ['product_id', 'texto'], quantity: ['quantity', 'numero', 0],
      quantityDone: ['quantity_done', 'numero', 0],
      // `status` é a ETAPA fixa que o código lê; `statusId` é o status
      // cadastrado pela empresa, que só rotula. Ver fase-w no banco/.
      status: ['status', 'texto', 'aberta'], statusId: ['status_id', 'texto'],
      sectorId: ['sector_id', 'texto'],
      startDate: ['start_date', 'data'], dueDate: ['due_date', 'data'],
      orderId: ['order_id', 'texto'], notes: ['notes', 'texto']
    }
  },
  'pcp/entries': {
    tabela: 'pcp_entries', prefixo: 'apont', ordem: 'date', desc: true, lista: 'entries', item: 'entry',
    campos: {
      orderId: ['order_id', 'texto'], date: ['date', 'data'], quantity: ['quantity', 'numero', 0],
      employeeId: ['employee_id', 'texto'], notes: ['notes', 'texto']
    }
  },
  'pcp/sectors': {
    tabela: 'pcp_sectors', prefixo: 'setor', ordem: 'sequencia', lista: 'sectors', item: 'sector',
    campos: {
      name: ['name', 'texto'], description: ['description', 'texto'],
      responsibleId: ['responsible_id', 'texto'], sequencia: ['sequencia', 'inteiro', 0],
      capacidadeHora: ['capacidade_hora', 'numero'], active: ['active', 'booleano']
    }
  },
  'pcp/statuses': {
    tabela: 'pcp_statuses', prefixo: 'stpcp', ordem: 'ordem', lista: 'statuses', item: 'status',
    campos: {
      name: ['name', 'texto'], etapa: ['etapa', 'texto', 'em_producao'],
      description: ['description', 'texto'], color: ['color', 'texto'],
      ordem: ['ordem', 'inteiro', 0], isDefault: ['is_default', 'booleano'],
      active: ['active', 'booleano']
    }
  },
  'pcp/quality-checks': {
    tabela: 'pcp_quality_checks', prefixo: 'qual', ordem: 'date', desc: true, lista: 'qualityChecks', item: 'qualityCheck',
    campos: {
      orderId: ['order_id', 'texto'], sectorId: ['sector_id', 'texto'], date: ['date', 'data'],
      inspectorId: ['inspector_id', 'texto'],
      quantidadeInspecionada: ['quantidade_inspecionada', 'numero', 0],
      quantidadeAprovada: ['quantidade_aprovada', 'numero', 0],
      resultado: ['resultado', 'texto', 'aprovado'],
      motivo: ['motivo', 'texto'], notes: ['notes', 'texto']
    }
  },

  // -------------------------------------------------------------- CONTRATOS
  'contracts/templates': {
    tabela: 'contract_templates', prefixo: 'modelo', ordem: 'name', lista: 'templates', item: 'template',
    campos: { name: ['name', 'texto'], body: ['body', 'texto'], active: ['active', 'booleano'] }
  },
  // TIPO é a classificação do contrato; MODELO é o texto que se reaproveita.
  // Coisas diferentes: um tipo pode ter vários modelos ao longo do tempo.
  'contracts/types': {
    tabela: 'contract_types', prefixo: 'tipoctr', ordem: 'ordem', lista: 'types', item: 'type',
    campos: {
      name: ['name', 'texto'], description: ['description', 'texto'],
      natureza: ['natureza', 'texto', 'receita'],
      avisoPreviaDias: ['aviso_previa_dias', 'inteiro', 30],
      templateId: ['template_id', 'texto'], ordem: ['ordem', 'inteiro', 0],
      active: ['active', 'booleano']
    }
  },
  'contracts/contracts': {
    tabela: 'contracts', prefixo: 'ctr', ordem: 'end_date', lista: 'contracts', item: 'contract',
    campos: {
      code: ['code', 'inteiro'], title: ['title', 'texto'], typeId: ['type_id', 'texto'],
      partyKind: ['party_kind', 'texto', 'cliente'],
      partyId: ['party_id', 'texto'], partyName: ['party_name', 'texto'],
      startDate: ['start_date', 'data'], endDate: ['end_date', 'data'], value: ['value', 'numero', 0],
      billingCycle: ['billing_cycle', 'texto', 'mensal'], autoRenew: ['auto_renew', 'booleano'],
      status: ['status', 'texto', 'ativo'], templateId: ['template_id', 'texto'], notes: ['notes', 'texto']
    }
  }
};

function descritor(recurso) {
  const def = RECURSOS[recurso];
  if (!def) throw new Error(`recurso desconhecido: ${recurso}`);
  return def;
}

// Linha do banco -> objeto do navegador.
function paraCliente(def, row) {
  if (!row) return null;
  const saida = { id: row.id };
  for (const [campo, [coluna]] of Object.entries(def.campos)) {
    saida[campo] = row[coluna];
  }
  if (row.created_at !== undefined) saida.createdAt = row.created_at;
  return saida;
}

// Objeto do navegador -> linha do banco. Campo ausente no payload NÃO entra:
// é o que permite um PUT parcial não zerar o que a tela não mandou.
function paraBanco(def, payload) {
  const linha = {};
  for (const [campo, [coluna, tipo, padrao]] of Object.entries(def.campos)) {
    if (payload[campo] === undefined) continue;
    const valor = (CONVERSORES[tipo] || CONVERSORES.texto)(payload[campo]);
    // Coluna NOT NULL: o vazio vira o padrão declarado, nunca null.
    linha[coluna] = valor === null && padrao !== undefined ? padrao : valor;
  }
  return linha;
}

async function listar(recurso) {
  const def = descritor(recurso);
  const { data, error } = await banco
    .from(def.tabela)
    .select('*')
    .order(def.ordem, { ascending: !def.desc, nullsFirst: false });
  assertNoError(error, `listar/${recurso}`);
  return (data || []).map((row) => paraCliente(def, row));
}

async function obter(recurso, id) {
  const def = descritor(recurso);
  const { data, error } = await banco.from(def.tabela).select('*').eq('id', id).maybeSingle();
  assertNoError(error, `obter/${recurso}`);
  return paraCliente(def, data);
}

async function criar(recurso, payload) {
  const def = descritor(recurso);
  const linha = { ...paraBanco(def, payload), id: createId(def.prefixo) };
  const { error } = await banco.from(def.tabela).insert(linha);
  assertNoError(error, `criar/${recurso}`);
  return obter(recurso, linha.id);
}

async function atualizar(recurso, id, payload) {
  const def = descritor(recurso);
  const linha = paraBanco(def, payload);
  // Sem nenhum campo conhecido, um update viraria "UPDATE ... SET" vazio, que o
  // PostgREST recusa com uma mensagem que não ajuda ninguém.
  if (!Object.keys(linha).length) return obter(recurso, id);
  const { error } = await banco.from(def.tabela).update(linha).eq('id', id);
  assertNoError(error, `atualizar/${recurso}`);
  return obter(recurso, id);
}

async function remover(recurso, id) {
  const def = descritor(recurso);
  const { error } = await banco.from(def.tabela).delete().eq('id', id);
  assertNoError(error, `remover/${recurso}`);
  return { ok: true };
}

module.exports = { RECURSOS, descritor, listar, obter, criar, atualizar, remover, paraCliente, paraBanco };
