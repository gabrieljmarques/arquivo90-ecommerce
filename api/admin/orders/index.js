import { supabase }             from '../../utils/supabase.js';
import { verifyAdmin }           from '../../utils/auth.js';

const VALID_STATUSES = ['pending','paid','preparing','shipped','delivered','cancelled','refunded'];
const PAGE_SIZE      = 25;

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  const user = await verifyAdmin(req);
  if (!user) { res.status(401).json({ error: 'Não autorizado' }); return; }

  if (req.method === 'GET') {
    const page   = Math.max(1, parseInt(req.query.page || '1', 10));
    const status = req.query.status || null;
    const search = req.query.q?.trim() || null;
    const from   = (page - 1) * PAGE_SIZE;

    let query = supabase.from('orders')
      .select('id, status, customer_name, customer_email, total, tracking_code, created_at, paid_at', { count: 'exact' })
      .order('created_at', { ascending: false }).range(from, from + PAGE_SIZE - 1);

    if (status && VALID_STATUSES.includes(status)) query = query.eq('status', status);
    if (search) query = query.or(`customer_email.ilike.%${search}%,customer_name.ilike.%${search}%`);

    const { data, error, count } = await query;
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.json({ orders: data, total: count, page, pages: Math.ceil(count / PAGE_SIZE) }); return;
  }

  res.status(405).json({ error: 'Method not allowed' });
}
