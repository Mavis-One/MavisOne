window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.fleet = window.MavisSubscreenRegistry.fleet || {};

// As seis telas de Frota montadas sobre as fábricas de lista e formulário
// (modules/cadastros/shared.js). Cada tela declara só suas colunas e campos.
//
// `module: 'fleet'` é o que faz salvar/cancelar/excluir voltarem para Frota —
// as fábricas nasceram dentro de Cadastros e voltavam para lá.
// `metaEndpoint` aponta para o apoio do próprio módulo: pedir o de Cadastros
// faria quem só tem acesso a Frota tomar um aviso de erro.
(function (C) {
  const R = window.MavisSubscreenRegistry.fleet;
  const base = { module: 'fleet', metaEndpoint: '/api/fleet/meta' };

  const STATUS_VEICULO = [
    { id: 'ativo', name: 'Ativo' },
    { id: 'manutencao', name: 'Em manutenção' },
    { id: 'inativo', name: 'Inativo' },
    { id: 'vendido', name: 'Vendido' }
  ];
  const TIPO_MANUTENCAO = [
    { id: 'preventiva', name: 'Preventiva' },
    { id: 'corretiva', name: 'Corretiva' }
  ];

  const nomeVeiculo = (item, meta) =>
    C.escape((meta.vehicles || []).find((v) => v.id === item.vehicleId)?.name || '-');

  const km = (valor) => (valor === null || valor === undefined || valor === '' ? '-' : `${Number(valor).toLocaleString('pt-BR')} km`);

  // Leitura de odômetro menor que a atual do veículo é quase sempre dígito
  // trocado (15.000 no lugar de 150.000). O registro é aceito — abastecimento
  // é fato passado e recusá-lo apagaria a despesa junto —, mas fica marcado
  // para alguém corrigir. Sem a marca, o erro só apareceria no consumo médio
  // absurdo três meses depois.
  const leituraOdometro = (item, meta) => {
    if (item.odometer === null || item.odometer === undefined || item.odometer === '') return '-';
    const veiculo = (meta.vehicles || []).find((v) => v.id === item.vehicleId);
    const atual = Number(veiculo?.odometer ?? 0);
    const suspeita = atual > 0 && Number(item.odometer) < atual;
    return suspeita
      ? `${km(item.odometer)} ${C.badge('abaixo do atual', 'warning')}`
      : km(item.odometer);
  };

  // Consumo entre DOIS abastecimentos: quilômetros rodados desde o
  // abastecimento anterior do mesmo veículo, divididos pelos litros deste.
  // É o número que justifica registrar litros e odômetro juntos — e o único
  // jeito de perceber que um veículo começou a beber.
  //
  // O primeiro abastecimento de cada veículo não tem anterior, então não tem
  // consumo. Mostrar um número ali seria inventar quilometragem.
  const consumoMedio = (item, todos) => {
    const leitura = Number(item.odometer || 0);
    const litros = Number(item.liters || 0);
    if (!(leitura > 0) || !(litros > 0)) return '-';
    const anteriores = (todos || [])
      .filter((r) => r.vehicleId === item.vehicleId && Number(r.odometer || 0) > 0 && Number(r.odometer) < leitura)
      .map((r) => Number(r.odometer));
    if (!anteriores.length) return '<span class="muted">primeiro</span>';
    const rodados = leitura - Math.max(...anteriores);
    if (!(rodados > 0)) return '-';
    return `<strong>${(rodados / litros).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} km/L</strong>`;
  };

  // ----------------------------------------------------------------- Veículos
  R.veiculos = C.makeListScreen({
    ...base,
    title: 'Veículos',
    subtitle: 'A frota cadastrada. O odômetro avança sozinho a cada abastecimento ou manutenção com leitura maior — o valor digitado aqui é só o ponto de partida.',
    tableTitle: 'Veículos',
    endpoint: '/api/fleet/vehicles',
    listKey: 'vehicles',
    newSub: 'novo_veiculo',
    newLabel: 'Novo veículo',
    editStateKey: 'fleetEditVehicleId',
    searchFields: ['plate', 'description', 'brand', 'model'],
    searchPlaceholder: 'Placa, descrição, marca',
    filters: [{ name: 'status', label: 'Situação', type: 'select', options: STATUS_VEICULO }],
    columns: [
      { label: 'Placa', render: (i) => `<strong>${C.escape(i.plate || '-')}</strong>` },
      { label: 'Descrição', render: (i) => C.escape(i.description || '-') },
      { label: 'Marca / Modelo', render: (i) => C.escape([i.brand, i.model].filter(Boolean).join(' ') || '-') },
      { label: 'Ano', render: (i) => C.escape(i.year || '-') },
      { label: 'Odômetro', render: (i) => km(i.odometer) },
      { label: 'Situação', render: (i) => C.statusBadge(i.status) }
    ]
  });

  R.novo_veiculo = C.makeFormScreen({
    ...base,
    title: 'Novo Veículo',
    subtitle: 'A placa não pode repetir, mesmo escrita em outra caixa.',
    entityLabel: 'veículo',
    endpoint: '/api/fleet/vehicles',
    itemKey: 'vehicle',
    listSub: 'veiculos',
    editStateKey: 'fleetEditVehicleId',
    sections: [
      {
        title: 'Identificação',
        fields: [
          { name: 'plate', label: 'Placa', required: true, hint: 'ABC1D23', mascara: 'placa' },
          { name: 'description', label: 'Descrição', hint: 'Como a equipe chama o veículo' },
          { name: 'status', label: 'Situação', type: 'select', empty: null, default: 'ativo', options: STATUS_VEICULO }
        ]
      },
      {
        title: 'Ficha',
        fields: [
          { name: 'brand', label: 'Marca' },
          { name: 'model', label: 'Modelo' },
          { name: 'year', label: 'Ano', type: 'number', min: 1900 },
          { name: 'odometer', label: 'Odômetro (km)', type: 'number', step: '0.1', min: 0, default: 0 }
        ]
      }
    ]
  });

  // -------------------------------------------------------------- Manutenções
  R.manutencoes = C.makeListScreen({
    ...base,
    title: 'Manutenções',
    subtitle: 'Preventivas e corretivas, com custo e oficina.',
    tableTitle: 'Manutenções registradas',
    endpoint: '/api/fleet/maintenances',
    listKey: 'maintenances',
    newSub: 'nova_manutencao',
    newLabel: 'Nova manutenção',
    editStateKey: 'fleetEditMaintenanceId',
    searchFields: ['description', 'supplierName'],
    searchPlaceholder: 'Descrição ou oficina',
    filters: [{ name: 'kind', label: 'Tipo', type: 'select', options: TIPO_MANUTENCAO }],
    columns: [
      { label: 'Data', render: (i) => C.formatDate(i.date) },
      { label: 'Veículo', render: nomeVeiculo },
      { label: 'Tipo', render: (i) => C.badge(i.kind === 'corretiva' ? 'Corretiva' : 'Preventiva', i.kind === 'corretiva' ? 'warning' : 'info') },
      { label: 'Descrição', render: (i) => C.escape(i.description || '-') },
      { label: 'Oficina', render: (i) => C.escape(i.supplierName || '-') },
      { label: 'Odômetro', render: leituraOdometro },
      { label: 'Custo', render: (i) => `<strong>${C.formatBRL(i.cost)}</strong>` }
    ]
  });

  R.nova_manutencao = C.makeFormScreen({
    ...base,
    title: 'Nova Manutenção',
    subtitle: 'O veículo é obrigatório: manutenção sem veículo não tem a quem pertencer.',
    entityLabel: 'manutenção',
    endpoint: '/api/fleet/maintenances',
    itemKey: 'maintenance',
    listSub: 'manutencoes',
    editStateKey: 'fleetEditMaintenanceId',
    sections: [
      {
        title: 'Serviço',
        fields: [
          { name: 'vehicleId', label: 'Veículo', type: 'select', required: true, options: (meta) => meta.vehicles || [] },
          { name: 'date', label: 'Data', type: 'date', required: true },
          { name: 'kind', label: 'Tipo', type: 'select', empty: null, default: 'preventiva', options: TIPO_MANUTENCAO }
        ]
      },
      {
        title: 'Detalhes',
        fields: [
          { name: 'supplierName', label: 'Oficina / fornecedor' },
          { name: 'cost', label: 'Custo (R$)', type: 'number', step: '0.01', min: 0, default: 0 },
          { name: 'odometer', label: 'Odômetro na data (km)', type: 'number', step: '0.1', min: 0 }
        ]
      },
      {
        title: 'Descrição',
        columns: 1,
        fields: [{ name: 'description', label: 'O que foi feito', type: 'textarea', full: true }]
      }
    ]
  });

  // ----------------------------------------------------------- Abastecimentos
  R.abastecimentos = C.makeListScreen({
    ...base,
    title: 'Abastecimentos',
    subtitle: 'Litros, valor e posto — a base para acompanhar o gasto por veículo.',
    tableTitle: 'Abastecimentos',
    endpoint: '/api/fleet/refuels',
    listKey: 'refuels',
    newSub: 'novo_abastecimento',
    newLabel: 'Novo abastecimento',
    editStateKey: 'fleetEditRefuelId',
    searchFields: ['station'],
    searchPlaceholder: 'Posto',
    columns: [
      { label: 'Data', render: (i) => C.formatDate(i.date) },
      { label: 'Veículo', render: nomeVeiculo },
      { label: 'Posto', render: (i) => C.escape(i.station || '-') },
      { label: 'Litros', render: (i) => `${Number(i.liters || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })} L` },
      { label: 'Odômetro', render: leituraOdometro },
      { label: 'Consumo', render: (i, meta, todos) => consumoMedio(i, todos) },
      // Preço por litro é derivado, não guardado: guardar os dois abriria a
      // chance de o total não bater com litros × preço.
      { label: 'R$/litro', render: (i) => (Number(i.liters) > 0 ? C.formatBRL(Number(i.total || 0) / Number(i.liters)) : '-') },
      { label: 'Total', render: (i) => `<strong>${C.formatBRL(i.total)}</strong>` }
    ]
  });

  R.novo_abastecimento = C.makeFormScreen({
    ...base,
    title: 'Novo Abastecimento',
    subtitle: 'O preço por litro é calculado a partir do total e dos litros.',
    entityLabel: 'abastecimento',
    endpoint: '/api/fleet/refuels',
    itemKey: 'refuel',
    listSub: 'abastecimentos',
    editStateKey: 'fleetEditRefuelId',
    sections: [
      {
        title: 'Abastecimento',
        fields: [
          { name: 'vehicleId', label: 'Veículo', type: 'select', required: true, options: (meta) => meta.vehicles || [] },
          { name: 'date', label: 'Data', type: 'date', required: true },
          { name: 'station', label: 'Posto' }
        ]
      },
      {
        title: 'Valores',
        fields: [
          { name: 'liters', label: 'Litros', type: 'number', step: '0.01', min: 0, default: 0 },
          { name: 'total', label: 'Total pago (R$)', type: 'number', step: '0.01', min: 0, default: 0 },
          { name: 'odometer', label: 'Odômetro (km)', type: 'number', step: '0.1', min: 0 }
        ]
      }
    ]
  });
})(window.MavisCadastros);
