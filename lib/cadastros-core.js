// Núcleo dos cadastros auxiliares do módulo Cadastros.
//
// A tela de Pessoas (pessoa física/jurídica, em public/app.js) é a referência
// de qualidade: seções, validação de campo obrigatório, detecção de duplicidade
// e trava de exclusão quando o registro está em uso. Cada coleção aqui declara
// as mesmas coisas, para as telas novas herdarem esse comportamento.
//
// Pessoas e CNPJs continuam com as rotas próprias que já existiam — este
// arquivo cuida só do que foi criado depois (contatos, equipamentos, formas de
// pagamento, status de venda, cashback, agenda, agendamentos, contas bancárias
// e empresas).

function createId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function cadastroError(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function text(value, fallback = '') {
  return String(value ?? fallback ?? '').trim();
}

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeStatus(value, allowed, fallback) {
  const status = String(value ?? fallback).trim().toLowerCase();
  return allowed.includes(status) ? status : fallback;
}

function requireText(value, message) {
  const result = text(value);
  if (!result) throw cadastroError(message);
  return result;
}

function ensureCadastroCollections(data) {
  data.contacts = Array.isArray(data.contacts) ? data.contacts : [];
  data.equipments = Array.isArray(data.equipments) ? data.equipments : [];
  data.paymentMethods = Array.isArray(data.paymentMethods) ? data.paymentMethods : [];
  data.saleStatuses = Array.isArray(data.saleStatuses) ? data.saleStatuses : [];
  data.productCashbacks = Array.isArray(data.productCashbacks) ? data.productCashbacks : [];
  data.tasks = Array.isArray(data.tasks) ? data.tasks : [];
  data.appointments = Array.isArray(data.appointments) ? data.appointments : [];
  return data;
}

// Pessoas e CNPJs formam um diretório único de contrapartes, do mesmo jeito
// que o Financeiro já resolve cliente/fornecedor.
function directory(data) {
  return [
    ...(data.people || []).map((p) => ({ id: p.id, name: p.name, code: p.code, kind: 'pessoa', document: p.document })),
    ...(data.cnpjs || []).map((c) => ({ id: c.id, name: c.name, code: c.code, kind: 'empresa', document: c.document }))
  ];
}

function directoryName(data, id) {
  if (!id) return '';
  const found = directory(data).find((entry) => entry.id === id);
  return found ? found.name : '';
}

function userName(data, id) {
  if (!id) return '';
  const found = (data.users || []).find((user) => user.id === id);
  return found ? found.name : '';
}

function nameById(list, id) {
  if (!id) return '';
  const found = (list || []).find((item) => item.id === id);
  return found ? found.name : '';
}

// Só um registro da coleção pode ser o padrão.
function clearOtherDefaults(list, currentId) {
  list.forEach((item) => {
    if (item.id !== currentId) item.isDefault = false;
  });
}

function timeToMinutes(value) {
  const [h, m] = String(value || '').split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
}

const ACTIVE_STATUS = ['ativo', 'inativo'];

const CADASTRO_COLLECTIONS = {
  contacts: {
    key: 'contacts',
    prefix: 'cont',
    itemKey: 'contact',
    listKey: 'contacts',
    notFound: 'Contato não encontrado.',
    build(body, current, data) {
      const name = requireText(body.name ?? current?.name, 'Informe o nome do contato.');
      const personId = text(body.personId ?? current?.personId);
      if (personId && !directory(data).some((entry) => entry.id === personId)) {
        throw cadastroError('Pessoa/empresa vinculada não encontrada.', 404);
      }
      const email = text(body.email ?? current?.email);
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        throw cadastroError('E-mail inválido.');
      }
      return {
        name,
        personId,
        role: text(body.role ?? current?.role),
        department: text(body.department ?? current?.department),
        email,
        phone: text(body.phone ?? current?.phone),
        mobilePhone: text(body.mobilePhone ?? current?.mobilePhone),
        whatsapp: text(body.whatsapp ?? current?.whatsapp),
        birthDate: text(body.birthDate ?? current?.birthDate),
        status: normalizeStatus(body.status ?? current?.status, ACTIVE_STATUS, 'ativo'),
        notes: text(body.notes ?? current?.notes)
      };
    },
    duplicate(built, data, currentId) {
      const clash = data.contacts.some((item) => item.id !== currentId
        && item.name.toLowerCase() === built.name.toLowerCase()
        && (item.personId || '') === (built.personId || ''));
      return clash ? 'Já existe um contato com este nome vinculado à mesma pessoa/empresa.' : null;
    },
    serialize(item, data) {
      return { ...item, personName: directoryName(data, item.personId) };
    },
    inUse() {
      return null;
    }
  },

  equipments: {
    key: 'equipments',
    prefix: 'equip',
    itemKey: 'equipment',
    listKey: 'equipments',
    notFound: 'Equipamento não encontrado.',
    build(body, current, data) {
      const name = requireText(body.name ?? current?.name, 'Informe o nome do equipamento.');
      const personId = text(body.personId ?? current?.personId);
      if (personId && !directory(data).some((entry) => entry.id === personId)) {
        throw cadastroError('Cliente vinculado não encontrado.', 404);
      }
      const depositId = text(body.depositId ?? current?.depositId);
      if (depositId && !(data.deposits || []).some((d) => d.id === depositId)) {
        throw cadastroError('Depósito não encontrado.', 404);
      }
      const purchaseDate = text(body.purchaseDate ?? current?.purchaseDate);
      const warrantyUntil = text(body.warrantyUntil ?? current?.warrantyUntil);
      if (purchaseDate && warrantyUntil && warrantyUntil < purchaseDate) {
        throw cadastroError('A garantia não pode terminar antes da data de aquisição.');
      }
      return {
        name,
        code: text(body.code ?? current?.code),
        serialNumber: text(body.serialNumber ?? current?.serialNumber),
        model: text(body.model ?? current?.model),
        brand: text(body.brand ?? current?.brand),
        personId,
        depositId,
        location: text(body.location ?? current?.location),
        purchaseDate,
        warrantyUntil,
        purchaseValue: toNumber(body.purchaseValue ?? current?.purchaseValue),
        status: normalizeStatus(body.status ?? current?.status, ['ativo', 'inativo', 'manutencao', 'baixado'], 'ativo'),
        notes: text(body.notes ?? current?.notes)
      };
    },
    duplicate(built, data, currentId) {
      if (!built.serialNumber) return null;
      const clash = data.equipments.some((item) => item.id !== currentId
        && item.serialNumber
        && item.serialNumber.toLowerCase() === built.serialNumber.toLowerCase());
      return clash ? 'Já existe um equipamento com este número de série.' : null;
    },
    serialize(item, data) {
      return {
        ...item,
        personName: directoryName(data, item.personId),
        depositName: nameById(data.deposits, item.depositId)
      };
    },
    inUse() {
      return null;
    }
  },

  'payment-methods': {
    key: 'paymentMethods',
    prefix: 'paym',
    itemKey: 'paymentMethod',
    listKey: 'paymentMethods',
    notFound: 'Forma de pagamento não encontrada.',
    build(body, current, data) {
      const name = requireText(body.name ?? current?.name, 'Informe o nome da forma de pagamento.');
      const installmentsMax = toNumber(body.installmentsMax ?? current?.installmentsMax, 1);
      if (installmentsMax < 1) throw cadastroError('O número máximo de parcelas deve ser pelo menos 1.');
      const feePercent = toNumber(body.feePercent ?? current?.feePercent);
      if (feePercent < 0) throw cadastroError('A taxa não pode ser negativa.');
      const daysToReceive = toNumber(body.daysToReceive ?? current?.daysToReceive);
      if (daysToReceive < 0) throw cadastroError('O prazo de recebimento não pode ser negativo.');
      const bankAccountId = text(body.bankAccountId ?? current?.bankAccountId);
      if (bankAccountId && !(data.bankAccounts || []).some((a) => a.id === bankAccountId)) {
        throw cadastroError('Conta bancária não encontrada.', 404);
      }
      return {
        name,
        code: text(body.code ?? current?.code),
        type: normalizeStatus(
          body.type ?? current?.type,
          ['dinheiro', 'pix', 'cartao-credito', 'cartao-debito', 'boleto', 'transferencia', 'cheque', 'crediario', 'outro'],
          'dinheiro'
        ),
        installmentsMax,
        feePercent,
        daysToReceive,
        bankAccountId,
        isDefault: Boolean(body.isDefault ?? current?.isDefault),
        status: normalizeStatus(body.status ?? current?.status, ACTIVE_STATUS, 'ativo'),
        notes: text(body.notes ?? current?.notes)
      };
    },
    afterSave(item, data) {
      if (item.isDefault) clearOtherDefaults(data.paymentMethods, item.id);
    },
    serialize(item, data) {
      return { ...item, bankAccountName: nameById(data.bankAccounts, item.bankAccountId) };
    },
    inUse() {
      return null;
    }
  },

  'sale-statuses': {
    key: 'saleStatuses',
    prefix: 'sstat',
    itemKey: 'saleStatus',
    listKey: 'saleStatuses',
    notFound: 'Status de venda não encontrado.',
    build(body, current) {
      const name = requireText(body.name ?? current?.name, 'Informe o nome do status.');
      const color = text(body.color ?? current?.color, '#3b82f6');
      if (color && !/^#[0-9a-fA-F]{6}$/.test(color)) {
        throw cadastroError('Cor inválida. Use o formato #RRGGBB.');
      }
      return {
        name,
        code: text(body.code ?? current?.code),
        kind: normalizeStatus(body.kind ?? current?.kind, ['aberto', 'em-andamento', 'faturado', 'entregue', 'cancelado'], 'aberto'),
        color,
        order: toNumber(body.order ?? current?.order, 0),
        isDefault: Boolean(body.isDefault ?? current?.isDefault),
        status: normalizeStatus(body.status ?? current?.status, ACTIVE_STATUS, 'ativo'),
        notes: text(body.notes ?? current?.notes)
      };
    },
    afterSave(item, data) {
      if (item.isDefault) clearOtherDefaults(data.saleStatuses, item.id);
    },
    inUse() {
      return null;
    }
  },

  'product-cashbacks': {
    key: 'productCashbacks',
    prefix: 'cback',
    itemKey: 'cashback',
    listKey: 'cashbacks',
    notFound: 'Regra de cashback não encontrada.',
    build(body, current) {
      const productId = requireText(body.productId ?? current?.productId, 'Selecione o produto.');
      const type = normalizeStatus(body.type ?? current?.type, ['percentual', 'valor'], 'percentual');
      const value = toNumber(body.value ?? current?.value);
      if (!(value > 0)) throw cadastroError('Informe um valor de cashback maior que zero.');
      if (type === 'percentual' && value > 100) throw cadastroError('O cashback percentual não pode passar de 100%.');
      const validFrom = text(body.validFrom ?? current?.validFrom);
      const validTo = text(body.validTo ?? current?.validTo);
      if (validFrom && validTo && validTo < validFrom) {
        throw cadastroError('A vigência final não pode ser anterior à inicial.');
      }
      return {
        productId,
        type,
        value,
        minPurchase: toNumber(body.minPurchase ?? current?.minPurchase),
        validFrom,
        validTo,
        status: normalizeStatus(body.status ?? current?.status, ACTIVE_STATUS, 'ativo'),
        notes: text(body.notes ?? current?.notes)
      };
    },
    duplicate(built, data, currentId) {
      if (built.status !== 'ativo') return null;
      const clash = data.productCashbacks.some((item) => item.id !== currentId
        && item.productId === built.productId
        && item.status === 'ativo');
      return clash ? 'Já existe uma regra de cashback ativa para este produto. Inative a anterior antes de criar outra.' : null;
    },
    inUse() {
      return null;
    }
  },

  tasks: {
    key: 'tasks',
    prefix: 'task',
    itemKey: 'task',
    listKey: 'tasks',
    notFound: 'Tarefa não encontrada.',
    build(body, current, data) {
      const title = requireText(body.title ?? current?.title, 'Informe o título da tarefa.');
      const personId = text(body.personId ?? current?.personId);
      if (personId && !directory(data).some((entry) => entry.id === personId)) {
        throw cadastroError('Pessoa/empresa vinculada não encontrada.', 404);
      }
      const status = normalizeStatus(body.status ?? current?.status, ['pendente', 'em-andamento', 'concluida', 'cancelada'], 'pendente');
      return {
        title,
        description: text(body.description ?? current?.description),
        personId,
        responsibleId: text(body.responsibleId ?? current?.responsibleId),
        dueDate: text(body.dueDate ?? current?.dueDate),
        dueTime: text(body.dueTime ?? current?.dueTime),
        priority: normalizeStatus(body.priority ?? current?.priority, ['baixa', 'media', 'alta'], 'media'),
        status,
        // Guarda quando a tarefa foi concluída, para o histórico da agenda.
        completedAt: status === 'concluida'
          ? (current?.completedAt || new Date().toISOString())
          : null,
        notes: text(body.notes ?? current?.notes)
      };
    },
    serialize(item, data) {
      return {
        ...item,
        personName: directoryName(data, item.personId),
        responsibleName: userName(data, item.responsibleId)
      };
    },
    inUse() {
      return null;
    }
  },

  appointments: {
    key: 'appointments',
    prefix: 'agend',
    itemKey: 'appointment',
    listKey: 'appointments',
    notFound: 'Agendamento não encontrado.',
    build(body, current, data) {
      const title = requireText(body.title ?? current?.title, 'Informe o título do agendamento.');
      const date = requireText(body.date ?? current?.date, 'Informe a data do agendamento.');
      const personId = text(body.personId ?? current?.personId);
      if (personId && !directory(data).some((entry) => entry.id === personId)) {
        throw cadastroError('Pessoa/empresa vinculada não encontrada.', 404);
      }
      const startTime = text(body.startTime ?? current?.startTime);
      const endTime = text(body.endTime ?? current?.endTime);
      if (startTime && endTime) {
        const start = timeToMinutes(startTime);
        const end = timeToMinutes(endTime);
        if (start !== null && end !== null && end <= start) {
          throw cadastroError('O horário final precisa ser depois do inicial.');
        }
      }
      return {
        title,
        date,
        startTime,
        endTime,
        personId,
        responsibleId: text(body.responsibleId ?? current?.responsibleId),
        type: normalizeStatus(body.type ?? current?.type, ['visita', 'reuniao', 'instalacao', 'manutencao', 'entrega', 'outro'], 'visita'),
        location: text(body.location ?? current?.location),
        status: normalizeStatus(body.status ?? current?.status, ['agendado', 'confirmado', 'realizado', 'cancelado'], 'agendado'),
        notes: text(body.notes ?? current?.notes)
      };
    },
    // Dois compromissos do mesmo responsável no mesmo horário quase sempre são
    // erro de digitação — avisa antes de gravar.
    duplicate(built, data, currentId) {
      if (!built.responsibleId || !built.startTime || built.status === 'cancelado') return null;
      const start = timeToMinutes(built.startTime);
      const end = timeToMinutes(built.endTime) ?? (start + 60);
      const clash = data.appointments.some((item) => {
        if (item.id === currentId || item.status === 'cancelado') return false;
        if (item.responsibleId !== built.responsibleId || item.date !== built.date) return false;
        const itemStart = timeToMinutes(item.startTime);
        if (itemStart === null) return false;
        const itemEnd = timeToMinutes(item.endTime) ?? (itemStart + 60);
        return start < itemEnd && itemStart < end;
      });
      return clash ? 'O responsável já tem outro agendamento neste horário.' : null;
    },
    serialize(item, data) {
      return {
        ...item,
        personName: directoryName(data, item.personId),
        responsibleName: userName(data, item.responsibleId)
      };
    },
    inUse() {
      return null;
    }
  },

  'bank-accounts': {
    key: 'bankAccounts',
    prefix: 'bank',
    itemKey: 'bankAccount',
    listKey: 'bankAccounts',
    notFound: 'Conta bancária não encontrada.',
    build(body, current, data, helpers) {
      const name = requireText(body.name ?? current?.name, 'Informe o nome da conta.');
      const document = helpers.sanitizeDigits(body.document ?? current?.document ?? '');
      if (document && !helpers.isValidDocument(document)) {
        throw cadastroError('CPF/CNPJ do titular inválido.');
      }
      return {
        name,
        bank: text(body.bank ?? current?.bank),
        bankCode: text(body.bankCode ?? current?.bankCode),
        agency: text(body.agency ?? current?.agency),
        agencyDigit: text(body.agencyDigit ?? current?.agencyDigit),
        number: text(body.number ?? current?.number),
        numberDigit: text(body.numberDigit ?? current?.numberDigit),
        type: normalizeStatus(body.type ?? current?.type, ['corrente', 'poupanca', 'pagamento', 'caixa', 'investimento'], 'corrente'),
        holder: text(body.holder ?? current?.holder),
        document,
        pixKey: text(body.pixKey ?? current?.pixKey),
        initialBalance: toNumber(body.initialBalance ?? current?.initialBalance),
        status: normalizeStatus(body.status ?? current?.status, ACTIVE_STATUS, 'ativo'),
        notes: text(body.notes ?? current?.notes)
      };
    },
    duplicate(built, data, currentId) {
      if (!built.agency || !built.number) return null;
      const clash = data.bankAccounts.some((item) => item.id !== currentId
        && text(item.bank).toLowerCase() === built.bank.toLowerCase()
        && text(item.agency) === built.agency
        && text(item.number) === built.number);
      return clash ? 'Já existe uma conta com este banco, agência e número.' : null;
    },
    // Conta usada em lançamentos/baixas/extrato não pode sumir sem quebrar o
    // Financeiro.
    inUse(id, data) {
      if ((data.finance || []).some((entry) => entry.bankAccountId === id || entry.targetBankAccountId === id)) {
        return 'Existem lançamentos financeiros nesta conta.';
      }
      if ((data.financialPayments || []).some((payment) => payment.bankAccountId === id)) {
        return 'Existem baixas registradas nesta conta.';
      }
      if ((data.bankTransactions || []).some((tx) => tx.bankAccountId === id)) {
        return 'Existem transações importadas nesta conta.';
      }
      if ((data.paymentMethods || []).some((method) => method.bankAccountId === id)) {
        return 'Existem formas de pagamento vinculadas a esta conta.';
      }
      return null;
    }
  },

  companies: {
    key: 'companies',
    prefix: 'company',
    itemKey: 'company',
    listKey: 'companies',
    notFound: 'Empresa não encontrada.',
    build(body, current, data, helpers) {
      const name = requireText(body.name ?? current?.name, 'Informe a razão social da empresa.');
      const document = helpers.sanitizeDigits(body.document ?? current?.document ?? '');
      if (document && !helpers.isValidCnpj(document)) {
        throw cadastroError('CNPJ inválido.');
      }
      return {
        name,
        tradeName: text(body.tradeName ?? current?.tradeName),
        document,
        stateRegistration: text(body.stateRegistration ?? current?.stateRegistration),
        municipalRegistration: text(body.municipalRegistration ?? current?.municipalRegistration),
        taxRegime: normalizeStatus(body.taxRegime ?? current?.taxRegime, ['simples', 'presumido', 'real', 'mei'], 'simples'),
        email: text(body.email ?? current?.email),
        phone: text(body.phone ?? current?.phone),
        zipCode: text(body.zipCode ?? current?.zipCode),
        address: text(body.address ?? current?.address),
        addressNumber: text(body.addressNumber ?? current?.addressNumber),
        neighborhood: text(body.neighborhood ?? current?.neighborhood),
        city: text(body.city ?? current?.city),
        state: text(body.state ?? current?.state),
        status: normalizeStatus(body.status ?? current?.status, ACTIVE_STATUS, 'ativo'),
        notes: text(body.notes ?? current?.notes)
      };
    },
    duplicate(built, data, currentId) {
      if (!built.document) return null;
      const clash = data.companies.some((item) => item.id !== currentId && helpersDigits(item.document) === built.document);
      return clash ? 'Já existe uma empresa cadastrada com este CNPJ.' : null;
    },
    inUse(id, data) {
      const used = [...(data.orders || []), ...(data.quotes || []), ...(data.sales || [])]
        .some((doc) => doc.companyId === id);
      return used ? 'Existem documentos de venda vinculados a esta empresa.' : null;
    }
  }
};

function helpersDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

module.exports = {
  createId,
  cadastroError,
  ensureCadastroCollections,
  directory,
  directoryName,
  CADASTRO_COLLECTIONS
};
