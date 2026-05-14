import { supabase } from '../utils/supabase.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'GET')     { res.status(405).end(); return; }

  const id = req.query.id;
  if (!id || !UUID_RE.test(id)) { res.status(400).json({ error: 'ID inválido' }); return; }

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

  // Only expose safe fields — never return CPF, phone, full address details beyond display
  res.json({ order });
}
