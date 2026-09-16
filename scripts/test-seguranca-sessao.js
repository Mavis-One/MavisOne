#!/usr/bin/env node
/**
 * AS TRÊS PORTAS QUE A VARREDURA DE 11/09/2026 ENCONTROU ABERTAS (fase BZ).
 *
 * 1. O TOKEN DE SESSÃO TINHA ~31 BITS, DE `Math.random()`
 *    -----------------------------------------------------
 *    Era `createId('token')`:  token-1789128929199-a6ef5t
 *                                                  ^^^^^^ 6 chars base36
 *    36^6 = 2.176.782.336 combinações. Medido contra esta base: ~1.500
 *    tentativas/segundo de um único cliente, sem bloqueio nem atraso.
 *
 *    E `Math.random()` é xorshift128+, NÃO criptográfico — observando saídas
 *    reconstrói-se o estado. O agravante: `createId` assinava também os ids de
 *    pessoa, pedido e produto, então CADA resposta da API entregava amostras
 *    do mesmo fluxo que gerava os tokens.
 *
 * 2. HTML ENVIADO COMO ANEXO RODAVA NA ORIGEM DO ERP
 *    -----------------------------------------------
 *    Provado antes da correção:
 *      POST .../anexos {nome:"relatorio.html", tipo:"text/html"}
 *      GET  .../anexos/:id -> content-type: text/html
 *                             content-disposition: inline
 *                             corpo: <script>alert(document.domain)</script>
 *    Sem `nosniff`, sem CSP. O token vive em `sessionStorage`, que o navegador
 *    copia para a aba aberta a partir da página. Qualquer pessoa com o módulo
 *    Vendas plantava isso num pedido e esperava um administrador clicar.
 *
 * 3. LOGIN SEM LIMITE DE TENTATIVAS
 *    ------------------------------
 *    30 senhas erradas em 1.824 ms (~16/s), todas 401, nenhum bloqueio, e a
 *    conta seguia aceitando login. ~1.400.000 tentativas por dia de um cliente.
 *
 * O QUE ESTE TESTE NÃO COBRE: os achados médios da mesma varredura — o portão
 * de permissões ser fail-open para prefixo não mapeado, `/api/reports/overview`
 * ignorar as caixas de módulo, e o módulo Vendas dar acesso a todos os pedidos.
 * São decisões de escopo, não correções mecânicas, e ficaram para o usuário.
 */
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const ler = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');

let falhas = 0;
const check = (nome, cond, det) => {
  console.log(`${cond ? '  OK ' : '  XX '} ${nome}${det !== undefined ? ' -> ' + det : ''}`);
  if (!cond) falhas++;
};

const { createId } = require('../lib/db/client');
const { entregaDoAnexo } = require('../lib/db/anexos');
const { criarLimitador } = require('../lib/limite-tentativas');

console.log('--- 1. o token de sessão ---');
const src = ler('server.js');
// SEM OS COMENTARIOS para as buscas de "isto nao existe mais": o proprio
// comentario que explica a correcao cita o codigo antigo, e uma busca crua
// acusaria como se ele ainda estivesse la.
//
// A ORDEM DAS DUAS TROCAS NAO E' INDIFERENTE, e estava errada aqui: tirar os
// blocos `/* */` primeiro engole codigo de verdade. Existe no server.js uma
// linha de comentario `//` citando "public/modules/**", e o `/*` de dentro dela
// pareia com o `*/` do proximo bloco, levando as linhas entre os dois.
//
// Num teste que afirma "isto NAO existe mais", engolir codigo faz o check
// PASSAR por engano — some o trecho, some a evidencia. Tirando as linhas `//`
// primeiro, o `/*` que mora dentro delas vai junto.
const semComentarios = (texto) => texto
  .replace(/^\s*\/\/.*$/gm, '')
  .replace(/\/\*[\s\S]*?\*\//g, '');
const srcCodigo = semComentarios(src);
check('existe uma função só para o token', /function criarTokenDeSessao\(\) \{/.test(src));
// 32 bytes = 256 bits. base64url para caber num cabeçalho sem escapar nada.
check('  com 32 bytes de crypto', /crypto\.randomBytes\(32\)\.toString\('base64url'\)/.test(src));
check('o login usa ela', /const token = criarTokenDeSessao\(\);/.test(src));
// O que NÃO pode voltar: o token saindo do gerador de ids.
check('e NÃO usa mais createId', !/createId\('token'\)/.test(srcCodigo));
// Carimbo de tempo não é segredo — quem observa o sistema sabe quando alguém
// entrou. Ele só dava a impressão de acrescentar entropia.
const funcaoToken = (/function criarTokenDeSessao\(\) \{[\s\S]*?\n\}/.exec(src) || [''])[0];
check('  sem carimbo de tempo dentro', !/Date\.now\(\)/.test(funcaoToken));
check('  e sem Math.random', !/Math\.random/.test(funcaoToken));

// A PREOCUPAÇÃO ERA O PROTÓTIPO, e ela saiu de cena junto com o mapa.
//
// Enquanto a sessão vivia num objeto, `{}` herdaria de Object.prototype e
// `sessions['__proto__']` responderia algo truthy para um token que ninguém
// emitiu — daí o `Object.create(null)` que este check cobrava. Na fase CL a
// sessão passou a morar no banco: o lookup é `where token_hash = $1` com
// parâmetro, que não tem herança para consultar, e o que viaja não é nem o
// token — é o SHA-256 dele.
//
// O check não foi apagado, foi reapontado: o que precisa continuar verdadeiro é
// que o servidor não volte a guardar sessão na memória do processo (era o que
// deslogava o escritório a cada reinício) e que o token não seja gravado.
check('o servidor não guarda sessão em memória', !/let sessions = Object\.create\(null\)/.test(srcCodigo));
check('  e a procura pelo token vai ao banco', /db\.sessoes\.buscar\(/.test(srcCodigo));
const armazem = ler('lib/db/sessoes.js');
check('o que vai para o banco é o hash do token', /createHash\('sha256'\)/.test(armazem));
// O que o insert AMARRA na primeira posição, que é o `token_hash`: gravar o
// token cru ali anularia todo o resto, porque o banco sai da máquina nos
// backups. A prova de que nenhuma coluna guarda o token é comportamental e
// está em test-sessao-no-banco.js — aqui basta olhar o que é passado.
check('  e é ele que o insert amarra', /returning user_id[\s\S]{0,120}?\[hashDoToken\(token\)/.test(armazem));

console.log('--- 2. o gerador de ids também saiu do Math.random ---');
// O gerador virou FONTE ÚNICA (lib/criar-id.js) porque havia duas cópias e elas
// divergiram: esta checagem olhava só para lib/db/client.js, e a de
// lib/cadastros-core.js continuou no Math.random por meses, assinando contato,
// equipamento, conta bancária e agendamento.
const gerador = ler('lib/criar-id.js');
check('createId usa crypto', /crypto\.randomBytes\(8\)\.toString\('hex'\)/.test(gerador));
check('  e não Math.random', !/Math\.random/.test(semComentarios(gerador)));
check('lib/db/client.js usa a fonte única', /require\('\.\.\/criar-id'\)/.test(ler('lib/db/client.js')));
check('lib/cadastros-core.js também — sem cópia própria', /require\('\.\/criar-id'\)/.test(ler('lib/cadastros-core.js')));
check('  e sem Math.random sobrando lá', !/Math\.random/.test(semComentarios(ler('lib/cadastros-core.js'))));

// A PARTE ALEATÓRIA FOI DE 6 PARA 15 CARACTERES (24 -> 60 bits).
//
// Com 6, o teste dos 5000 ids falhava de vez em quando — e "de vez em quando"
// era o gerador colidindo de verdade: o timestamp tem resolução de
// milissegundo, então num laço apertado os 24 bits eram tudo o que separava um
// id do outro. Em produção isso não aparece como teste vermelho, e sim como
// chave duplicada no meio de uma importação.
//
// O prefixo e o carimbo de tempo continuam iguais: ids já gravados seguem
// válidos, e nada que os leia precisa saber da mudança.
const id = createId('pes');
check('o formato: prefixo, ms e 15 hex', /^pes-\d{13}-[0-9a-f]{15}$/.test(id), id);
const muitos = new Set(Array.from({ length: 5000 }, () => createId('x')));
check('  e 5000 ids seguidos não colidem', muitos.size === 5000, `${muitos.size} distintos`);
// Os 5000 acima cabem em poucos milissegundos; este laço força o pior caso —
// tudo no MESMO milissegundo, que é onde a versão de 6 caracteres quebrava.
const agora = Date.now();
const mesmoMs = new Set();
for (let i = 0; i < 20000; i++) mesmoMs.add(createId('x').split('-')[2]);
check('  e 20.000 aleatórios são distintos entre si', mesmoMs.size === 20000, `${mesmoMs.size} distintos em ${Date.now() - agora}ms`);

console.log('--- 3. o anexo: lista de PERMISSÃO, não de proibição ---');
// Bloquear "text/html" e esquecer "image/svg+xml" seria o tipo de lista que
// envelhece errado. O que não está na lista BAIXA.
const abre = (tipo) => entregaDoAnexo(tipo, 'a').disposicao.startsWith('inline');
check('PDF abre', abre('application/pdf'));
check('PNG abre', abre('image/png'));
check('JPEG abre', abre('image/jpeg'));
check('HTML NÃO abre', !abre('text/html'));
// SVG é XML, aceita <script>, e o navegador o executa ao exibir como imagem.
check('SVG NÃO abre (é XML com script dentro)', !abre('image/svg+xml'));
check('XML NÃO abre', !abre('application/xml'));
check('texto puro NÃO abre', !abre('text/plain'));
check('tipo desconhecido NÃO abre', !abre('inventado/qualquer'));
check('tipo malformado vira octet-stream', entregaDoAnexo('lixo', 'a').tipo === 'application/octet-stream');
// Cabeçalho com quebra de linha dentro é injeção — a peneira do tipo já existia.
check('  e continua peneirando injeção de cabeçalho',
  entregaDoAnexo('text/html\r\nX-Evil: 1', 'a').tipo === 'application/octet-stream');
check('o nome vai codificado (RFC 5987)',
  entregaDoAnexo('application/pdf', 'nota fiscal ção.pdf').disposicao.includes("filename*=UTF-8''"));
check('a rota usa a entrega segura', /const entrega = anexosDb\.entregaDoAnexo\(tipo, ficha\.nome\);/.test(src));
// Sem nosniff, um arquivo entregue como octet-stream ainda podia ser farejado
// como HTML pelo conteúdo — e a lista acima seria contornada pelo navegador.
check('  e manda nosniff', /'X-Content-Type-Options': 'nosniff'/.test(src));

console.log('--- 4. o limite de tentativas de login ---');
const t0 = 1_000_000;
const lim = criarLimitador();
const ip = '10.0.0.1';

// Quatro erros passam; o quinto tranca.
for (let i = 0; i < 4; i += 1) {
  const r = lim.falhou({ ip, usuario: 'admin' }, t0 + i);
  check(`  erro ${i + 1} ainda não bloqueia`, !r.bloqueado);
}
const quinto = lim.falhou({ ip, usuario: 'admin' }, t0 + 4);
check('o quinto erro bloqueia', quinto.bloqueado, quinto.escopo);
check('  e diz por quanto tempo', quinto.segundos === 300, `${quinto.segundos}s`);
check('  a conferência confirma', lim.conferir({ ip, usuario: 'admin' }, t0 + 5).bloqueado);
// A senha CERTA também é recusada durante o bloqueio — senão o limite seria
// contornável por quem estivesse justamente acertando na tentativa seguinte.
// A conferencia acontece ANTES de `authenticateUser`, entao nem a senha certa
// passa durante o bloqueio — senao o limite seria contornavel por quem
// estivesse justamente acertando na tentativa seguinte.
const posConferir = srcCodigo.indexOf('const trava = tentativasDeLogin.conferir(');
const posAutenticar = srcCodigo.indexOf('const user = await db.authenticateUser(');
check('  e vale mesmo para quem sabe a senha (a rota confere ANTES do bcrypt)',
  posConferir > -1 && posConferir < posAutenticar, `conferir ${posConferir}, autenticar ${posAutenticar}`);

// Contar só por usuário transformaria o limite em ARMA: qualquer um erraria a
// senha do administrador cinco vezes e o trancaria. Por isso OUTRO usuário do
// mesmo IP continua tentando — o limite de IP é bem mais largo.
check('outro usuário do mesmo IP não é atingido',
  !lim.conferir({ ip, usuario: 'maria' }, t0 + 5).bloqueado);

// Passado o bloqueio, volta ao normal — e NÃO tranca de novo no primeiro erro.
// A contagem parte do instante do QUINTO erro (t0 + 4), e não de t0.
const depois = t0 + 4 + 300_001;
check('passado o tempo, destrava', !lim.conferir({ ip, usuario: 'admin' }, depois).bloqueado);
check('  e o primeiro erro seguinte não tranca de novo',
  !lim.falhou({ ip, usuario: 'admin' }, depois).bloqueado);

// Erro de ontem não soma com o de hoje.
const lim2 = criarLimitador();
for (let i = 0; i < 4; i += 1) lim2.falhou({ ip, usuario: 'joao' }, t0 + i);
const foraDaJanela = lim2.falhou({ ip, usuario: 'joao' }, t0 + 5 * 60 * 1000 + 1);
check('falha fora da janela não conta', !foraDaJanela.bloqueado);

// Acertar zera: quem errou três vezes e lembrou a senha não carrega o placar.
const lim3 = criarLimitador();
for (let i = 0; i < 4; i += 1) lim3.falhou({ ip, usuario: 'ana' }, t0 + i);
lim3.acertou({ ip, usuario: 'ana' });
check('acertar a senha zera o contador', !lim3.falhou({ ip, usuario: 'ana' }, t0 + 5).bloqueado);

// A memória não cresce para sempre.
const lim4 = criarLimitador();
lim4.falhou({ ip: '1.1.1.1', usuario: 'x' }, t0);
check('a memória é varrida', lim4.limpar(t0 + 60 * 60 * 1000) === 0, `${lim4.tamanho()} entradas`);

console.log('--- 5. o login não conta mais quem existe pelo relógio ---');
const auth = ler('lib/db/auth.js');
// bcrypt custa ~100ms de propósito. Rodando só quando o usuário existe, a
// resposta a um nome inexistente voltava ~100ms mais cedo — e a mensagem
// genérica deixava de ser genérica.
check('há um hash de mentira', /const HASH_DE_MENTIRA = bcrypt\.hashSync\(/.test(auth));
check('  comparado quando o usuário não existe',
  /if \(!data\) \{\s*\n\s*bcrypt\.compareSync\(String\(password \|\| ''\), HASH_DE_MENTIRA\);/.test(auth));
check('  e nunca serve para autenticar', !/HASH_DE_MENTIRA[\s\S]{0,80}return mapUserRow/.test(auth));

console.log('--- 6. a resposta do bloqueio ---');
// 429 e não 401: a resposta não diz nada sobre a senha, e quem só errou
// precisa saber que é hora de esperar, não de tentar outra senha.
check('bloqueio responde 429', /\}, 429\);/.test(src));
check('  com Retry-After', /res\.setHeader\('Retry-After', String\(trava\.segundos\)\);/.test(src));
check('  e fica na auditoria', /motivo: 'limite de tentativas'/.test(src));

console.log(falhas ? `\n===== ${falhas} FALHA(S) =====` : '\n===== TODOS OS CHECKS PASSARAM =====');
process.exit(falhas ? 1 : 0);
