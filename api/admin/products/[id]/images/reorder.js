import { getSupabase } from '../../../../utils/supabase.js';
import { verifyAdmin }  from '../../../../utils/auth.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  const supabase = getSupabase();
  const user = await verifyAdmin(req);
  if (!user) { res.status(401).json({ error: 'Não autorizado' }); return; }

  const { id } = req.query;

  // PUT /api/admin/products/:id/images/reorder
  if (req.method === 'PUT') {
    const { order } = req.body || {};
    if (!Array.isArray(order)) { res.status(400).json({ error: 'Formato inválido' }); return; }
    for (const item of order) {
      await supabase.from('product_images').update({ display_order: item.display_order }).eq('id', item.id).eq('product_id', id);
    }
    res.json({ ok: true }); return;
  }

  res.status(405).json({ error: 'Method not allowed' });
}
