import { supabase } from '../utils/supabase.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'GET')     { res.status(405).end(); return; }

  const id    = req.query.id;
  const email = (req.query.email || '').toLowerCase().trim();

  if (!id || !UUID_RE.test(id)) { res.status(400).json({ error: 'ID inválido' }); return; }
  if (!email)                   { res.status(400).json({ error: 'Email obrigatório' }); return; }

  const { data: order, error } = await supabase
    .from('orders')
    .select(`
      id, status, total, shipping_cost, discount_amount, coupon_code,
      customer_name, customer_email,
      shipping_address, shipping_service_name, carrier, shipping_deadline,
      tracking_code, created_at, paid_at,
      order_items(product_name, size, color, quantity, unit_price)
    `)
    .eq('id', id)
    .single();

  if (error || !order) { res.status(404).json({ error: 'Pedido não encontrado' }); return; }

  // Ownership check — email must match (case-insensitive)
  if (order.customer_email.toLowerCase() !== email) {
    res.status(403).json({ error: 'Pedido não encontrado' }); return; // same message, no info leak
  }

  res.json({ order });
}
