window.MavisSubscreenRegistry = window.MavisSubscreenRegistry || {};
window.MavisSubscreenRegistry.purchases = window.MavisSubscreenRegistry.purchases || {};

// ENTRADA DE NF-e — o XML do fornecedor vira compra, estoque e conta a pagar.
//
// O DESENHO DA TELA: CONFERIR ANTES DE LANÇAR
// -------------------------------------------
// Soltar o arquivo NÃO lança nada. Ele é lido, e a tela mostra o que a nota diz
// e o que disso já existe aqui: o fornecedor está cadastrado? cada item é qual
// produto meu? O botão de lançar só aparece depois, e o que ele grava é o que
// está na tela — não uma segunda leitura escondida.
//
// Isso importa porque entrada de nota é irreversível na prática: entrou
// estoque, entrou conta a pagar, e a nota não pode ser apagada (documento
// fiscal não se apaga, se corrige por devolução). Um passo de conferência é
// barato; desfazer um lançamento errado, não.
//
// O FORNECEDOR NÃO CADASTRADO
// ---------------------------
// É o caso que mais aparece na primeira nota de um fornecedor novo, e a tela
// trata como um bloco em destaque, não como um aviso escondido: mostra os dados
// que vieram do XML — razão social, CNPJ, IE, endereço completo — e pergunta se
// é para cadastrar. Quem cadastra vê ANTES o que vai ser gravado.
//
// O cadastro em si vai para /api/cadastros/cnpjs (ou /pessoas, se for CPF), a
// mesma rota do formulário de Cadastros. Nada de rota paralela: a validação de
// CNPJ, a checagem de duplicidade e a permissão são as que já existem. Por isso
// mesmo, quem não tem o módulo Cadastros vê o bloco explicando que não pode
// cadastrar — em vez de um botão que falha ao ser clicado.
(function () {
  const moeda = (valor) => Number(valor || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const numero = (valor, casas = 4) => Number(valor || 0).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: casas });
  const dataBr = (iso) => {
    const texto = String(iso || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(texto)) return texto || '—';
    const [a, m, d] = texto.split('-');
    return `${d}/${m}/${a}`;
  };
  const mascaraDocumento = (valor) => {
    const d = String(valor || '').replace(/\D/g, '');
    if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
    if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
    return d;
  };
  const chaveEmBlocos = (chave) => String(chave || '').replace(/(\d{4})(?=\d)/g, '$1 ');

  // Como o item casou com o produto. O rótulo existe porque casar por código de
  // barras é fato e casar por descrição é palpite — e quem confere precisa ver
  // a diferença sem ter que adivinhar.
  const ORIGEM_DO_VINCULO = {
    historico: { texto: 'já vinculado antes', classe: 'finance-badge-success' },
    gtin: { texto: 'código de barras', classe: 'finance-badge-success' },
    codigo: { texto: 'código igual ao SKU', classe: 'finance-badge-info' },
    descricao: { texto: 'só pela descrição', classe: 'finance-badge-warning' },
    manual: { texto: 'escolhido por você', classe: 'finance-badge-info' }
  };

  /**
   * Lê o arquivo respeitando a codificação DECLARADA no próprio XML.
   *
   * A NF-e deveria ser sempre UTF-8, e a maioria é. Mas emissor antigo ainda
   * gera ISO-8859-1, e aí ler como UTF-8 transforma "SÃO JOSÉ" em caracteres
   * quebrados — que iriam para o cadastro do fornecedor e ficariam lá.
   */
  function lerArquivoXml(arquivo) {
    return new Promise((resolve, reject) => {
      const leitor = new FileReader();
      leitor.onerror = () => reject(new Error('Não consegui ler o arquivo.'));
      leitor.onload = () => {
        const bytes = new Uint8Array(leitor.result);
        let texto = new TextDecoder('utf-8').decode(bytes);
        const declarada = (texto.slice(0, 200).match(/encoding=["']([^"']+)["']/i) || [])[1] || '';
        if (/8859|latin|1252/i.test(declarada)) {
          texto = new TextDecoder('iso-8859-1').decode(bytes);
        }
        resolve(texto);
      };
      leitor.readAsArrayBuffer(arquivo);
    });
  }

  window.MavisSubscreenRegistry.purchases.entrada_nfe = async function renderEntradaNfe(ctx) {
    const { content, api, showToast, escapeHtml, confirmModal } = ctx;

    // Estado da tela. Vive aqui e não em `state` porque nada disto sobrevive a
    // sair da tela: uma conferência pela metade não é dado do sistema.
    const tela = {
      xml: '',
      conferencia: null,
      permissoes: {},
      produtos: [],
      depositos: [],
      escolhas: new Map(), // numero do item -> { produtoId, movimentarEstoque }
      depositoId: '',
      gerarFinanceiro: true,
      atualizarCusto: true,
      analisando: false,
      lancando: false,
      entradas: []
    };

    async function carregarEntradas() {
      try {
        const resposta = await api('/api/purchases/entrada-nfe');
        tela.entradas = resposta.entradas || [];
      } catch (erro) {
        // Sem a migração rodada, a lista não existe ainda. A tela continua
        // servindo para analisar um XML — o aviso aparece no lançamento.
        tela.entradas = [];
      }
    }

    // ---------------------------------------------------------------- desenho

    function blocoAvisos() {
      const c = tela.conferencia;
      if (!c) return '';
      const linhas = [
        ...c.bloqueios.map((b) => ({ ...b, tipo: 'bloqueio' })),
        ...c.avisos.map((a) => ({ ...a, tipo: 'aviso' }))
      ];
      if (!linhas.length) return '';
      return `
        <div class="entrada-avisos">
          ${linhas.map((linha) => `
            <p class="entrada-aviso ${linha.tipo === 'bloqueio' ? 'entrada-aviso-bloqueio' : ''}">
              <strong>${linha.tipo === 'bloqueio' ? 'Impede o lançamento:' : 'Atenção:'}</strong>
              ${escapeHtml(linha.mensagem)}
            </p>
          `).join('')}
        </div>
      `;
    }

    function blocoNota() {
      const n = tela.conferencia.nota;
      return `
        <div class="entrada-nota-head">
          <div>
            <h3>NF-e ${escapeHtml(n.numero)} · série ${escapeHtml(n.serie || '—')}</h3>
            <p class="muted">${escapeHtml(n.naturezaOperacao || 'Sem natureza de operação')}</p>
            <p class="muted entrada-chave">${escapeHtml(chaveEmBlocos(n.chave))}</p>
          </div>
          <div class="entrada-nota-numeros">
            <span class="muted">Emissão</span><strong>${dataBr(n.dataEmissao)}</strong>
            <span class="muted">Produtos</span><strong>${moeda(n.totais.produtos)}</strong>
            <span class="muted">Total da nota</span><strong>${moeda(n.totais.nota)}</strong>
          </div>
        </div>
      `;
    }

    function blocoFornecedor() {
      const f = tela.conferencia.fornecedor;
      const e = tela.conferencia.nota.emitente;
      const end = e.endereco || {};
      const enderecoTexto = [
        [end.logradouro, end.numero].filter(Boolean).join(', '),
        end.complemento,
        end.bairro,
        [end.municipio, end.uf].filter(Boolean).join('/'),
        end.cep ? `CEP ${end.cep}` : ''
      ].filter(Boolean).join(' · ');

      if (f.situacao === 'cadastrado') {
        return `
          <section class="panel entrada-fornecedor entrada-fornecedor-ok">
            <div class="entrada-fornecedor-topo">
              <span class="finance-badge finance-badge-success">Fornecedor cadastrado</span>
            </div>
            <h4>${escapeHtml(f.cadastro.name)}</h4>
            <p class="muted">
              ${escapeHtml(mascaraDocumento(e.documento))}
              ${f.cadastro.code ? ` · código ${escapeHtml(f.cadastro.code)}` : ''}
              ${e.inscricaoEstadual ? ` · IE ${escapeHtml(e.inscricaoEstadual)}` : ''}
            </p>
            <p class="muted">${escapeHtml(enderecoTexto)}</p>
          </section>
        `;
      }

      const podeCadastrar = tela.permissoes.cadastrarFornecedor;
      return `
        <section class="panel entrada-fornecedor entrada-fornecedor-novo">
          <div class="entrada-fornecedor-topo">
            <span class="finance-badge finance-badge-warning">Fornecedor não cadastrado</span>
          </div>
          <h4>${escapeHtml(e.nome || 'Sem razão social no XML')}</h4>
          <p class="muted">
            ${escapeHtml(mascaraDocumento(e.documento))}
            ${e.fantasia ? ` · ${escapeHtml(e.fantasia)}` : ''}
            ${e.inscricaoEstadual ? ` · IE ${escapeHtml(e.inscricaoEstadual)}` : ''}
          </p>
          <p class="muted">${escapeHtml(enderecoTexto)}</p>
          ${podeCadastrar ? `
            <p class="entrada-fornecedor-pergunta">
              Quer cadastrar este fornecedor agora, com os dados que vieram da nota?
            </p>
            <div class="entrada-fornecedor-acoes">
              <button type="button" class="btn btn-primary" id="entradaCadastrarFornecedor">
                Cadastrar com os dados do XML
              </button>
              <span class="muted">Razão social, CNPJ, inscrição estadual e endereço vêm prontos. Dá para ajustar depois em Cadastros.</span>
            </div>
          ` : `
            <p class="entrada-fornecedor-pergunta">
              Você não tem acesso ao módulo Cadastros, então não dá para cadastrar por aqui.
              A entrada pode ser lançada assim mesmo — o nome do fornecedor fica gravado na nota —,
              mas ela não ficará vinculada a um cadastro.
            </p>
          `}
        </section>
      `;
    }

    function opcoesDeProduto() {
      return [
        { value: '', label: '— sem produto —' },
        ...tela.produtos.map((p) => ({ value: p.id, label: p.sku ? `${p.name} (${p.sku})` : p.name }))
      ];
    }

    function escolhaDoItem(item) {
      const guardada = tela.escolhas.get(item.numero);
      if (guardada) return guardada;
      const inicial = {
        produtoId: item.vinculo ? item.vinculo.produtoId : '',
        movimentarEstoque: Boolean(item.vinculo)
      };
      tela.escolhas.set(item.numero, inicial);
      return inicial;
    }

    function blocoItens() {
      const itens = tela.conferencia.itens;
      return `
        <section class="panel">
          <h4>Itens da nota (${itens.length})</h4>
          <p class="muted">
            Cada item precisa apontar para um produto seu para movimentar estoque.
            Item sem produto é gravado na nota do mesmo jeito — a entrada fica marcada como “a revisar”.
          </p>
          <!-- SEM .table-scroll aqui, de propósito: aquele container tem
               overflow-x: auto, e overflow em um eixo faz o navegador recortar
               o outro também. O dropdown do campo de busca de produto é
               posicionado por absolute e ficaria cortado na borda da tabela —
               justo na última linha, onde ele mais precisa aparecer. A tabela
               encolhe em tela estreita em vez de rolar. -->
          <div class="entrada-itens-wrap">
            <table class="table entrada-itens">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Descrição na nota</th>
                  <th>NCM / CFOP</th>
                  <th class="entrada-col-num">Qtd</th>
                  <th class="entrada-col-num">Unitário</th>
                  <th class="entrada-col-num">Total</th>
                  <th>Produto no estoque</th>
                  <th class="entrada-col-check">Estoque</th>
                </tr>
              </thead>
              <tbody>
                ${itens.map((item) => {
                  const escolha = escolhaDoItem(item);
                  const selo = item.vinculo ? ORIGEM_DO_VINCULO[item.vinculo.por] : null;
                  return `
                    <tr>
                      <td>${item.numero}</td>
                      <td>
                        <strong>${escapeHtml(item.descricao)}</strong>
                        <span class="muted entrada-item-codigo">
                          cód. fornecedor ${escapeHtml(item.codigo || '—')}${item.ean ? ` · GTIN ${escapeHtml(item.ean)}` : ''}
                        </span>
                      </td>
                      <td class="muted">${escapeHtml(item.ncm || '—')}<br />${escapeHtml(item.cfop || '—')}</td>
                      <td class="entrada-col-num">${numero(item.quantidade)} ${escapeHtml(item.unidade || '')}</td>
                      <td class="entrada-col-num">${moeda(item.valorUnitario)}</td>
                      <td class="entrada-col-num">${moeda(item.valorTotal)}</td>
                      <td class="entrada-col-produto">
                        ${renderSearchableSelect({
                          id: `entradaItem${item.numero}`,
                          name: `produto_${item.numero}`,
                          options: opcoesDeProduto(),
                          selectedValue: escolha.produtoId,
                          placeholder: 'Buscar produto...'
                        })}
                        ${selo ? `<span class="finance-badge ${selo.classe} entrada-selo">${selo.texto}</span>` : ''}
                        ${!item.vinculo && tela.permissoes.cadastrarProduto ? `
                          <button type="button" class="btn btn-muted entrada-btn-produto" data-cadastrar-produto="${item.numero}">
                            Cadastrar produto do XML
                          </button>
                        ` : ''}
                        ${!item.vinculo && !tela.permissoes.cadastrarProduto ? '<span class="muted entrada-selo">sem produto — precisa do módulo Estoque para cadastrar</span>' : ''}
                      </td>
                      <td class="entrada-col-check">
                        <input type="checkbox" data-mov-estoque="${item.numero}"
                          ${escolha.movimentarEstoque ? 'checked' : ''}
                          ${escolha.produtoId ? '' : 'disabled'} />
                      </td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
        </section>
      `;
    }

    function blocoFinanceiro() {
      const duplicatas = tela.conferencia.nota.duplicatas;
      const total = tela.conferencia.nota.totais.nota;
      return `
        <section class="panel">
          <h4>Contas a pagar</h4>
          ${duplicatas.length ? `
            <div class="table-scroll">
              <table class="table entrada-duplicatas">
                <thead><tr><th>Parcela</th><th>Vencimento</th><th class="entrada-col-num">Valor</th></tr></thead>
                <tbody>
                  ${duplicatas.map((d) => `
                    <tr>
                      <td>${escapeHtml(d.numero)}</td>
                      <td>${dataBr(d.vencimento)}</td>
                      <td class="entrada-col-num">${moeda(d.valor)}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          ` : `
            <p class="muted">
              A nota não traz duplicatas. Se você mandar gerar o financeiro, sai uma parcela
              única de ${moeda(total)} vencendo na data de emissão.
            </p>
          `}
          <label class="entrada-opcao">
            <input type="checkbox" id="entradaGerarFinanceiro" ${tela.gerarFinanceiro ? 'checked' : ''} />
            <span>Gerar contas a pagar a partir desta nota</span>
          </label>
        </section>
      `;
    }

    function blocoRodape() {
      const bloqueado = tela.conferencia.bloqueios.length > 0;
      const semDeposito = !tela.depositos.length;
      return `
        <section class="panel entrada-rodape">
          <div class="row">
            <label>Depósito da entrada
              <select id="entradaDeposito" ${semDeposito ? 'disabled' : ''}>
                ${semDeposito ? '<option value="">Nenhum depósito cadastrado</option>' : ''}
                ${tela.depositos.map((d) => `<option value="${escapeHtml(d.id)}" ${tela.depositoId === d.id ? 'selected' : ''}>${escapeHtml(d.name)}</option>`).join('')}
              </select>
            </label>
            <label class="entrada-opcao entrada-opcao-alinhada">
              <input type="checkbox" id="entradaAtualizarCusto" ${tela.atualizarCusto ? 'checked' : ''} />
              <span>Atualizar o custo dos produtos com o valor da nota</span>
            </label>
          </div>
          <p class="muted entrada-nota-custo">
            O custo gravado é o valor unitário da mercadoria (vUnCom). Não inclui frete, IPI nem ST —
            ratear isso é decisão de quem apura, não de quem lança a nota.
          </p>
          <div class="entrada-rodape-acoes">
            <button type="button" class="btn btn-muted" id="entradaCancelar">Descartar</button>
            <button type="button" class="btn btn-primary" id="entradaLancar" ${bloqueado ? 'disabled' : ''}>
              ${bloqueado ? 'Lançamento bloqueado' : 'Lançar entrada'}
            </button>
          </div>
        </section>
      `;
    }

    function blocoLista() {
      if (!tela.entradas.length) {
        return `
          <section class="panel">
            <h4>Últimas entradas</h4>
            <p class="muted">Nenhuma nota de entrada lançada ainda.</p>
          </section>
        `;
      }
      return `
        <section class="panel">
          <h4>Últimas entradas</h4>
          <div class="table-scroll">
            <table class="table">
              <thead>
                <tr><th>Nota</th><th>Fornecedor</th><th>Emissão</th><th class="entrada-col-num">Total</th><th>Situação</th><th>XML</th></tr>
              </thead>
              <tbody>
                ${tela.entradas.map((e) => `
                  <tr>
                    <td>${escapeHtml(e.numero)}/${escapeHtml(e.serie)}</td>
                    <td>${escapeHtml(e.emitenteNome)}<br /><span class="muted">${escapeHtml(mascaraDocumento(e.emitenteDocumento))}</span></td>
                    <td>${dataBr(e.dataEmissao)}</td>
                    <td class="entrada-col-num">${moeda(e.valorTotal)}</td>
                    <td>
                      <span class="finance-badge ${e.status === 'LANCADA' ? 'finance-badge-success' : 'finance-badge-warning'}">
                        ${e.status === 'LANCADA' ? 'Lançada' : 'A revisar'}
                      </span>
                      ${e.movimentouEstoque ? '<span class="finance-badge finance-badge-muted">estoque</span>' : ''}
                      ${e.gerouFinanceiro ? '<span class="finance-badge finance-badge-muted">financeiro</span>' : ''}
                    </td>
                    <td><button type="button" class="entrada-link" data-baixar-xml="${escapeHtml(e.id)}">baixar XML</button></td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </section>
      `;
    }

    function desenhar() {
      content.innerHTML = `
        <div class="entrada-nfe">
          <section class="panel">
            <h3>Entrada de NF-e</h3>
            <p class="muted">
              Solte aqui o XML que o fornecedor mandou. O sistema lê a nota, identifica o fornecedor
              e casa os itens com os seus produtos. Nada é gravado até você conferir e mandar lançar.
            </p>
            <div class="entrada-drop ${tela.analisando ? 'entrada-drop-ocupada' : ''}" id="entradaDrop">
              <input type="file" id="entradaArquivo" accept=".xml,text/xml,application/xml" hidden />
              <p>${tela.analisando ? 'Lendo a nota...' : 'Arraste o XML da NF-e ou <button type="button" class="entrada-link" id="entradaEscolher">escolha o arquivo</button>'}</p>
              ${tela.xml && !tela.analisando ? '<p class="muted">Um arquivo já está carregado. Soltar outro substitui a conferência atual.</p>' : ''}
            </div>
          </section>

          ${tela.conferencia ? `
            ${blocoAvisos()}
            <section class="panel">${blocoNota()}</section>
            ${blocoFornecedor()}
            ${blocoItens()}
            ${blocoFinanceiro()}
            ${blocoRodape()}
          ` : ''}

          ${blocoLista()}
        </div>
      `;
      ligarEventos();
    }

    // --------------------------------------------------------------- eventos

    function ligarEventos() {
      const zona = document.getElementById('entradaDrop');
      const campo = document.getElementById('entradaArquivo');
      document.getElementById('entradaEscolher')?.addEventListener('click', () => campo?.click());
      campo?.addEventListener('change', () => {
        if (campo.files && campo.files[0]) analisarArquivo(campo.files[0]);
      });
      if (zona) {
        ['dragenter', 'dragover'].forEach((evento) => zona.addEventListener(evento, (e) => {
          e.preventDefault();
          zona.classList.add('entrada-drop-ativa');
        }));
        ['dragleave', 'drop'].forEach((evento) => zona.addEventListener(evento, (e) => {
          e.preventDefault();
          zona.classList.remove('entrada-drop-ativa');
        }));
        zona.addEventListener('drop', (e) => {
          const arquivo = e.dataTransfer?.files?.[0];
          if (arquivo) analisarArquivo(arquivo);
        });
      }

      content.querySelectorAll('[data-baixar-xml]').forEach((botao) => {
        botao.addEventListener('click', () => baixarXml(botao.dataset.baixarXml));
      });

      if (!tela.conferencia) return;

      document.getElementById('entradaCadastrarFornecedor')?.addEventListener('click', cadastrarFornecedor);

      tela.conferencia.itens.forEach((item) => {
        attachSearchableSelect({
          id: `entradaItem${item.numero}`,
          options: opcoesDeProduto(),
          onSelect: (valor) => {
            const escolha = escolhaDoItem(item);
            escolha.produtoId = valor || '';
            // Sem produto não há estoque a movimentar: desmarca e desliga a
            // caixa, em vez de deixar marcada uma opção que o servidor
            // recusaria depois.
            const caixa = document.querySelector(`[data-mov-estoque="${item.numero}"]`);
            if (caixa) {
              caixa.disabled = !escolha.produtoId;
              if (!escolha.produtoId) {
                caixa.checked = false;
                escolha.movimentarEstoque = false;
              } else {
                caixa.checked = true;
                escolha.movimentarEstoque = true;
              }
            }
          }
        });
      });

      content.querySelectorAll('[data-mov-estoque]').forEach((caixa) => {
        caixa.addEventListener('change', () => {
          const item = Number(caixa.dataset.movEstoque);
          const escolha = tela.escolhas.get(item);
          if (escolha) escolha.movimentarEstoque = caixa.checked;
        });
      });

      content.querySelectorAll('[data-cadastrar-produto]').forEach((botao) => {
        botao.addEventListener('click', () => cadastrarProduto(Number(botao.dataset.cadastrarProduto)));
      });

      document.getElementById('entradaGerarFinanceiro')?.addEventListener('change', (e) => {
        tela.gerarFinanceiro = e.target.checked;
      });
      document.getElementById('entradaAtualizarCusto')?.addEventListener('change', (e) => {
        tela.atualizarCusto = e.target.checked;
      });
      document.getElementById('entradaDeposito')?.addEventListener('change', (e) => {
        tela.depositoId = e.target.value;
      });
      document.getElementById('entradaCancelar')?.addEventListener('click', () => {
        tela.xml = '';
        tela.conferencia = null;
        tela.escolhas.clear();
        desenhar();
      });
      document.getElementById('entradaLancar')?.addEventListener('click', lancar);
    }

    // -------------------------------------------------------------- ações

    /**
     * O XML é baixado por fetch, e não por um <a href>, porque a sessão vive no
     * cabeçalho x-auth-token: um link comum chegaria ao servidor sem sessão e
     * voltaria 403. Mesmo caminho que a tela de NF-e Emitidas usa.
     */
    async function baixarXml(id) {
      let url = null;
      try {
        const resposta = await fetch(`/api/purchases/entrada-nfe/${encodeURIComponent(id)}/xml`, {
          headers: { 'x-auth-token': getSessionToken() || '' }
        });
        if (!resposta.ok) {
          const corpo = await resposta.json().catch(() => ({}));
          showToast(corpo.error || `Não consegui baixar o XML (HTTP ${resposta.status}).`, 'error');
          return;
        }
        const blob = await resposta.blob();
        url = URL.createObjectURL(blob);
        const entrada = tela.entradas.find((e) => e.id === id);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${(entrada && entrada.chave) || id}.xml`;
        document.body.appendChild(link);
        link.click();
        link.remove();
      } catch (erro) {
        showToast(erro.message || 'Não consegui baixar o XML.', 'error');
      } finally {
        if (url) setTimeout(() => URL.revokeObjectURL(url), 10000);
      }
    }

    async function analisarArquivo(arquivo) {
      try {
        tela.analisando = true;
        desenhar();
        const xml = await lerArquivoXml(arquivo);
        await analisarXml(xml);
      } catch (erro) {
        tela.analisando = false;
        tela.conferencia = null;
        desenhar();
        showToast(erro.message || 'Não consegui ler o XML.', 'error');
      }
    }

    async function analisarXml(xml) {
      const resposta = await api('/api/purchases/entrada-nfe/analisar', {
        method: 'POST',
        body: JSON.stringify({ xml })
      });
      tela.xml = xml;
      tela.conferencia = { nota: resposta.nota, fornecedor: resposta.fornecedor, itens: resposta.itens, bloqueios: resposta.bloqueios, avisos: resposta.avisos };
      tela.produtos = resposta.produtos || [];
      tela.depositos = resposta.depositos || [];
      tela.permissoes = resposta.permissoes || {};
      tela.escolhas.clear();
      if (!tela.depositoId && tela.depositos.length) tela.depositoId = tela.depositos[0].id;
      tela.analisando = false;
      desenhar();
    }

    async function cadastrarFornecedor() {
      const sugestao = tela.conferencia.fornecedor.sugestao;
      if (!sugestao) return;
      const confirmado = await confirmModal(
        `Cadastrar "${sugestao.name}" (${mascaraDocumento(sugestao.document)}) como fornecedor, com os dados desta nota?`
      );
      if (!confirmado) return;

      // `tipo` é só o roteamento; o resto do objeto já vem com os nomes de
      // campo do formulário de Cadastros e vai inteiro.
      const { tipo, ...payload } = sugestao;
      try {
        // Rota do próprio módulo Cadastros — ver o cabeçalho deste arquivo.
        const destino = tipo === 'cnpj' ? '/api/cadastros/cnpjs' : '/api/cadastros/pessoas';
        await api(destino, { method: 'POST', body: JSON.stringify(payload) });
        showToast('Fornecedor cadastrado.', 'success');
        // Reanalisa a MESMA nota: o fornecedor agora existe, e a conferência
        // inteira precisa refletir isso (inclusive o vínculo da entrada).
        await analisarXml(tela.xml);
      } catch (erro) {
        showToast(erro.message || 'Não consegui cadastrar o fornecedor.', 'error');
      }
    }

    async function cadastrarProduto(numeroItem) {
      const item = tela.conferencia.itens.find((i) => i.numero === numeroItem);
      if (!item || !item.sugestaoProduto) return;
      const s = item.sugestaoProduto;
      if (!s.sku) {
        showToast('Este item não tem código no XML. Cadastre o produto pelo Estoque e volte para vincular.', 'warning');
        return;
      }
      const confirmado = await confirmModal(
        `Cadastrar "${s.name}" como produto novo? NCM, unidade e código de barras vêm da nota; o preço de venda fica zerado.`
      );
      if (!confirmado) return;
      try {
        const resposta = await api('/api/stock/products', {
          method: 'POST',
          body: JSON.stringify({
            name: s.name,
            sku: s.sku,
            ean: s.ean,
            ncm: s.ncm,
            cest: s.cest,
            unit: s.unidadeComercial,
            unidadeTributavel: s.unidadeTributavel,
            origem: s.origem,
            costPrice: s.costPrice,
            salePrice: 0,
            stockQuantity: 0
          })
        });
        showToast('Produto cadastrado.', 'success');
        // Reanalisa: o produto novo entra na lista e o item volta já vinculado
        // (casa pelo GTIN, ou pelo SKU que veio do código do fornecedor).
        await analisarXml(tela.xml);
      } catch (erro) {
        showToast(erro.message || 'Não consegui cadastrar o produto.', 'error');
      }
    }

    async function lancar() {
      if (tela.lancando) return;
      const itens = tela.conferencia.itens.map((item) => {
        const escolha = escolhaDoItem(item);
        return {
          numero: item.numero,
          produtoId: escolha.produtoId,
          movimentarEstoque: escolha.movimentarEstoque,
          depositoId: tela.depositoId
        };
      });
      const semProduto = itens.filter((i) => !i.produtoId).length;
      const pergunta = semProduto
        ? `${semProduto} ${semProduto === 1 ? 'item ficará sem produto vinculado' : 'itens ficarão sem produto vinculado'} e a entrada será marcada como “a revisar”. Lançar assim mesmo?`
        : 'Lançar esta entrada? Nota fiscal não pode ser apagada depois — correção se faz por devolução.';
      if (!await confirmModal(pergunta)) return;

      try {
        tela.lancando = true;
        const resposta = await api('/api/purchases/entrada-nfe', {
          method: 'POST',
          body: JSON.stringify({
            xml: tela.xml,
            itens,
            depositoId: tela.depositoId,
            gerarFinanceiro: tela.gerarFinanceiro,
            atualizarCusto: tela.atualizarCusto
          })
        });
        const partes = [`Entrada lançada (${resposta.status === 'LANCADA' ? 'completa' : 'a revisar'})`];
        if (resposta.estoque?.length) partes.push(`${resposta.estoque.length} ${resposta.estoque.length === 1 ? 'item entrou' : 'itens entraram'} no estoque`);
        if (resposta.financeiro?.length) partes.push(`${resposta.financeiro.length} ${resposta.financeiro.length === 1 ? 'conta a pagar criada' : 'contas a pagar criadas'}`);
        showToast(`${partes.join(' · ')}.`, 'success');
        tela.xml = '';
        tela.conferencia = null;
        tela.escolhas.clear();
        await carregarEntradas();
        desenhar();
      } catch (erro) {
        showToast(erro.message || 'Não consegui lançar a entrada.', 'error');
      } finally {
        tela.lancando = false;
      }
    }

    await carregarEntradas();
    desenhar();
  };
})();
