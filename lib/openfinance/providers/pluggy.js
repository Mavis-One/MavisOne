// Provider Pluggy (https://pluggy.ai) — agregador de Open Finance.
//
// Autenticação real da Pluggy, conforme documentação pública (ainda NÃO
// validada com credenciais de teste neste projeto): troca clientId +
// clientSecret por um apiKey de curta duração, usado tanto pra chamadas de
// servidor quanto pra gerar um connect_token de uso único que abre o widget
// de conexão bancária no navegador. Os caminhos exatos de cada endpoint
// (contas, saldos, transações, cartões, webhook) precisam ser confirmados
// contra uma conta de teste real antes deste provider sair do estado de
// esqueleto — ver lib/openfinance/providers/stubProvider.js.
const { createStubProvider } = require('./stubProvider');

const PROVIDER_NAME = 'pluggy';
const ENV_VARS = ['OPEN_FINANCE_CLIENT_ID', 'OPEN_FINANCE_CLIENT_SECRET', 'OPEN_FINANCE_API_URL'];

module.exports = createStubProvider(PROVIDER_NAME, ENV_VARS);
