import { supabase }             from '../../utils/supabase.js';
import { verifyAdmin, logAudit } from '../../utils/auth.js';

const VALID_STATUSES = ['pending','paid','preparing','shipped','delivered','cancelled','refunded'];

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  const user = await verifyAdmin(req);
  if (!user) { res.status(401).json({ error: 'Não autorizado' }); return; }

  const segments = Array.isArray(req.query.params) ? req.query.params : [req.query.params].filter(Boolean);
  const id = segments[0] || null;

  // GET /api/admin/orders/:id
  if (req.method === 'GET' && id) {
    const { data, error } = await supabase.from('orders')
      .select(`*, order_items(*, products(name, slug))`).eq('id', id).single();
    if (error || !data) { res.status(404).json({ error: 'Pedido não encontrado' }); return; }
    res.json({ order: data }); return;
  }

  // PUT /api/admin/orders/:id
  if (req.method === 'PUT' && id) {
    const { data: before } = await supabase.from('orders').select('*').eq('id', id).single();
    if (!before) { res.status(404).json({ error: 'Pedido não encontrado' }); return; }

    const body    = req.body || {};
    const updates = {};
    if (body.status) {
      if (!VALID_STATUSES.includes(body.status)) { res.status(400).json({ error: 'Status inválido' }); return; }
      updates.status = body.status;
      if (body.status === 'shipped') updates.shipped_at = new Date().toISOString();
    }
    if (body.tracking_code !== undefined) updates.tracking_code = body.tracking_code?.trim() || null;
    if (body.carrier       !== undefined) updates.carrier       = body.carrier?.trim()        || null;
    if (body.notes         !== undefined) updates.notes         = body.notes?.trim()          || null;

    if (!Object.keys(updates).length) { res.status(400).json({ error: 'Nenhum campo para atualizar' }); return; }

    const { data: after, error } = await supabase.from('orders').update(updates).eq('id', id).select().single();
    if (error) { res.status(500).json({ error: error.message }); return; }

    const CANCEL_STATUSES = ['cancelled','refunded'];
    if (updates.status && CANCEL_STATUSES.includes(updates.status) && !CANCEL_STATUSES.includes(before.status)) {
      const { data: items } = await supabase.from('order_items').select('product_id, size, color, quantity').eq('order_id', id);
      for (const item of (items || [])) {
        await supabase.rpc('release_stock', { p_product_id: item.product_id, p_size: item.size, p_quantity: item.quantity, p_color: item.color || null }).catch(() => {});
      }
      await supabase.from('stock_reservations').delete().eq('order_id', id);
    }

    await logAudit(supabase, { adminEmail: user.email, action: 'update_order', entity: 'order', entityId: id, before, after });
    res.json({ order: after }); return;
  }

  res.status(404).json({ error: 'Not found' });
}
