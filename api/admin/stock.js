import { json } from '../utils/response.js';
import { supabase }             from '../utils/supabase.js';
import { verifyAdmin, logAudit } from '../utils/auth.js';

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204 });

  const user = await verifyAdmin(req);
  if (!user) return json({ error: 'Não autorizado' }, { status: 401 });

  if (req.method === 'GET') {
    const [sizesResult, ordersResult] = await Promise.all([
      supabase
        .from('product_sizes')
        .select('id, size, color, stock, reserved, products!inner(id, name, slug, active, deleted_at)')
        .is('products.deleted_at', null)
        .order('size', { ascending: true }),
      supabase
        .from('orders')
        .select('id')
        .in('status', ['paid', 'preparing', 'shipped', 'delivered'])
    ]);

    if (sizesResult.error) return json({ error: sizesResult.error.message }, { status: 500 });

    const soldMap = {};
    const orderIds = (ordersResult.data || []).map(o => o.id);
    if (orderIds.length) {
      const { data: items } = await supabase
        .from('order_items')
        .select('product_id, size, color, quantity')
        .in('order_id', orderIds);
      (items || []).forEach(i => {
        const k = `${i.product_id}:${i.size}:${i.color||''}`;
        soldMap[k] = (soldMap[k] || 0) + i.quantity;
      });
    }

    const stock = (sizesResult.data || []).map(s => ({
      ...s,
      color: s.color || null,
      sold:  soldMap[`${s.products.id}:${s.size}:${s.color||''}`] || 0
    }));

    return json({ stock });
  }

  if (req.method === 'PUT') {
    let body;
    try { body = await req.json(); } catch { return json({ error: 'Payload inválido' }, { status: 400 }); }

    const { product_size_id, new_stock, reason, notes } = body;
    if (!product_size_id || new_stock == null || isNaN(new_stock) || new_stock < 0)
      return json({ error: 'Dados inválidos' }, { status: 400 });

    const { data: ps } = await supabase
      .from('product_sizes')
      .select('id, stock, reserved')
      .eq('id', product_size_id)
      .single();

    if (!ps) return json({ error: 'Tamanho não encontrado' }, { status: 404 });

    const newStock = parseInt(new_stock, 10);
    if (newStock < ps.reserved)
      return json({ error: `Estoque não pode ser menor que o reservado (${ps.reserved})` }, { status: 409 });

    const delta = newStock - ps.stock;

    const { error } = await supabase
      .from('product_sizes')
      .update({ stock: newStock })
      .eq('id', product_size_id);

    if (error) return json({ error: error.message }, { status: 500 });

    await supabase.from('stock_transactions').insert({
      product_size_id,
      delta,
      reason:     reason || 'adjustment',
      created_by: user.email
    });

    await logAudit(supabase, {
      adminEmail: user.email,
      action:     'update_stock',
      entity:     'product_size',
      entityId:   product_size_id,
      before:     { stock: ps.stock },
      after:      { stock: newStock, reason, notes }
    });

    return json({ ok: true, new_stock: newStock });
  }

  return json({ error: 'Method not allowed' }, { status: 405 });
};
