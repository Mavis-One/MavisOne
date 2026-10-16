#!/usr/bin/env node
/**
 * CONFERIR O VÍNCULO USUÁRIO ↔ VENDEDOR (16/10/2026). SÓ LÊ, não grava nada.
 *
 * Desde 16/10/2026 o vendedor só vê, em Pedidos e Orçamentos, as vendas em que
 * ELE é o vendedor ou que ELE criou (lib/venda-do-vendedor.js). Vendedor =
 * usuário não administrador com vendedor vinculado em Configurações › Usuários.
 * Lista vazia para um vendedor quase sempre é vínculo errado: o usuário ligado
 * a um cadastro e as vendas dele gravadas com outro (nome repetido no
 * cadastro, cadastro antigo do Viper).
 *
 *   node scripts/conferir-vinculo-vendedores.js          (na pasta do sistema)
 *
 * Para cada usuário ativo com vendedor vinculado: o cadastro ligado, quantas
 * vendas têm aquele vendedor, quantas ele criou, e os OUTROS cadastros com o
 * mesmo nome que têm vendas — é ali que costuma estar o vínculo certo.
 */
require('dotenv').config({ quiet: true });
const { consultar } = require('../lib/db/conexao');

(async () => {
  const { rows: usuarios } = await consultar(`
    select u.id, u.username, u.name, u.role, u.seller_id, u.pode_alterar_vendas_de_outros as colegas,
           p.name as vendedor,
           (select count(*) from orders o where o.seller_id = u.seller_id)::int
             + (select count(*) from quotes q where q.seller_id = u.seller_id)::int as vendas_do_vendedor,
           (select count(*) from orders o where o.created_by = u.id)::int
             + (select count(*) from quotes q where q.created_by = u.id)::int as criadas_por_ele
      from users u
      left join people p on p.id = u.seller_id
     where u.active is not false and coalesce(u.seller_id, '') <> ''
     order by u.name`);
  if (!usuarios.length) {
    console.log('Nenhum usuário ativo tem vendedor vinculado.');
    process.exit(0);
  }
  for (const u of usuarios) {
    const admin = u.role === 'admin';
    console.log(`\n${u.name} (${u.username})${admin ? ' — ADMINISTRADOR: vê todas as vendas' : ''}${u.colegas ? ' — vê as vendas dos colegas' : ''}`);
    console.log(`  vinculado a: ${u.vendedor || '(cadastro não encontrado!)'} [${u.seller_id}]`);
    console.log(`  vendas com este vendedor: ${u.vendas_do_vendedor} · criadas por este usuário: ${u.criadas_por_ele}`);
    if (u.vendedor) {
      const { rows: mesmos } = await consultar(`
        select p.id,
               (select count(*) from orders o where o.seller_id = p.id)::int
                 + (select count(*) from quotes q where q.seller_id = p.id)::int as vendas
          from people p
         where upper(trim(p.name)) = upper(trim($1)) and p.id <> $2`, [u.vendedor, u.seller_id]);
      const comVendas = mesmos.filter((m) => m.vendas > 0);
      if (comVendas.length) {
        console.log(`  ATENÇÃO: outro(s) cadastro(s) com o mesmo nome têm vendas: ${comVendas.map((m) => `${m.id} (${m.vendas})`).join(', ')}`);
      }
    }
    if (!admin && !u.colegas && u.vendas_do_vendedor === 0 && u.criadas_por_ele === 0) {
      console.log('  -> a lista de Pedidos e Orçamentos deste usuário fica VAZIA: confira o vínculo em Configurações › Usuários.');
    }
  }
  process.exit(0);
})().catch((erro) => { console.error('Erro:', erro.message); process.exit(1); });
