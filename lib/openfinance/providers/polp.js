// Provider Polp — agregador de Open Finance citado no documento técnico.
//
// Nenhuma documentação pública confiável foi localizada para "Polp" durante
// a pesquisa desta implementação. Este arquivo existe pra manter os três
// providers do documento com a mesma forma (contrato) — a chamada real só
// pode ser escrita quando existir uma URL de API e credenciais de teste
// confirmadas. Ver lib/openfinance/providers/stubProvider.js.
const { createStubProvider } = require('./stubProvider');

const PROVIDER_NAME = 'polp';
const ENV_VARS = ['OPEN_FINANCE_CLIENT_ID', 'OPEN_FINANCE_CLIENT_SECRET', 'OPEN_FINANCE_API_URL'];

module.exports = createStubProvider(PROVIDER_NAME, ENV_VARS);
