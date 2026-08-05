// Provider Celcoin (https://celcoin.com.br) — Open Finance / BaaS.
//
// Autenticação real da Celcoin ainda não foi validada com credenciais de
// teste neste projeto (o fluxo tipicamente documentado publicamente é
// OAuth2 client_credentials, mas o endpoint exato e o formato de cada
// recurso precisam ser confirmados contra uma conta de teste real antes
// deste provider sair do estado de esqueleto — ver
// lib/openfinance/providers/stubProvider.js.
const { createStubProvider } = require('./stubProvider');

const PROVIDER_NAME = 'celcoin';
const ENV_VARS = ['OPEN_FINANCE_CLIENT_ID', 'OPEN_FINANCE_CLIENT_SECRET', 'OPEN_FINANCE_API_URL'];

module.exports = createStubProvider(PROVIDER_NAME, ENV_VARS);
