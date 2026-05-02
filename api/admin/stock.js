import { supabase }             from '../utils/supabase.js';
import { verifyAdmin, logAudit } from '../utils/auth.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  const user = await verifyAdmin(req);
  if (!user) { res.status(401).json({ error: 'Não autorizado' }); return; }

  if (req.method === 'GET') {
    const [sizesResult, ordersResult] = await Promise.all([
      supabase.from('product_sizes')
        .select('id, size, color, stock, reserved, products!inner(id, name, slug, active, deleted_at)')
        .is('products.deleted_at', null).order('size', { ascending: true }),
      supabase.from('orders').select('id').in('status', ['paid','preparing','shipped','delivered'])
    ]);

    if (sizesResult.error) { res.status(500).json({ error: sizesResult.error.message }); return; }

    const soldMap  = {};
    const orderIds = (ordersResult.data || []).map(o => o.id);
    if (orderIds.length) {
      const { data: items } = await supabase.from('order_items').select('product_id, size, color, quantity').in('order_id', orderIds);
      (items || []).forEach(i => { const k = `${i.product_id}:${i.size}:${i.color||''}`; soldMap[k] = (soldMap[k] || 0) + i.quantity; });
    }

    const stock = (sizesResult.data || []).map(s => ({
      ...s, color: s.color || null,
      sold: soldMap[`${s.products.id}:${s.size}:${s.color||''}`] || 0
    }));
    res.json({ stock }); return;
  }

  if (req.method === 'PUT') {
    const { product_size_id, new_stock, reason, notes } = req.body || {};
    if (!product_size_id || new_stock == null || isNaN(new_stock) || new_stock < 0) { res.status(400).json({ error: 'Dados inválidos' }); return; }

    const { data: ps } = await supabase.from('product_sizes').select('id, stock, reserved').eq('id', product_size_id).single();
    if (!ps) { res.status(404).json({ error: 'Tamanho não encontrado' }); return; }

    const newStock = parseInt(new_stock, 10);
    if (newStock < ps.reserved) { res.status(409).json({ error: `Estoque não pode ser menor que o reservado (${ps.reserved})` }); return; }

    const { error } = await supabase.from('product_sizes').update({ stock: newStock }).eq('id', product_size_id);
    if (error) { res.status(500).json({ error: error.message }); return; }

    await supabase.from('stock_transactions').insert({ product_size_id, delta: newStock - ps.stock, reason: reason || 'adjustment', created_by: user.email });
    await logAudit(supabase, { adminEmail: user.email, action: 'update_stock', entity: 'product_size', entityId: product_size_id, before: { stock: ps.stock }, after: { stock: newStock, reason, notes } });
    res.json({ ok: true, new_stock: newStock }); return;
  }

  res.status(405).json({ error: 'Method not allowed' });
}
