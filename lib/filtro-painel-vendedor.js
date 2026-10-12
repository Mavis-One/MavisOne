// FILTROS DO PAINEL VENDEDOR (12/10/2026).
//
// O painel somava TODOS os pedidos de cada vendedor desde sempre — com o
// histórico do Viper, "Total vendido" virava um número de anos, sem como olhar
// o mês. O filtro recorta por período, situação e filial ANTES das contas: os
// cards, o seletor de vendedores e a lista de pedidos saem do mesmo recorte.
//
// A filial é a da categoria do pedido (lib/filial-da-venda.js), como em todo o
// resto de Vendas: `company_id` está vazio em todos os pedidos.
'use strict';

const filialDaVenda = require('./filial-da-venda');
const salesStatus = require('../public/modules/shared/sales_status');

const DATA = /^\d{4}-\d{2}-\d{2}$/;

/** O filtro a partir da query string; o que não for válido fica de fora. */
function lerFiltro(params) {
  const ler = (nome) => String((params && params.get(nome)) || '').trim();
  const de = ler('de');
  const ate = ler('ate');
  const status = ler('status');
  return {
    de: DATA.test(de) ? de : '',
    ate: DATA.test(ate) ? ate : '',
    status: salesStatus.CATALOGO.some((s) => s.value === status) ? status : '',
    filial: ler('filial')
  };
}

function temFiltro(filtro) {
  return Boolean(filtro && (filtro.de || filtro.ate || filtro.status || filtro.filial));
}

/** O registro entra no recorte? */
function passa(registro, filtro) {
  if (!temFiltro(filtro)) return true;
  const data = String(registro.date || '').slice(0, 10);
  if (filtro.de && (!data || data < filtro.de)) return false;
  if (filtro.ate && (!data || data > filtro.ate)) return false;
  if (filtro.status && salesStatus.normalizar(registro.status, registro.type) !== filtro.status) return false;
  if (filtro.filial && !filialDaVenda.daFilial(registro, filtro.filial)) return false;
  return true;
}

module.exports = { lerFiltro, temFiltro, passa };
