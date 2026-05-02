import { getSupabase }          from '../../../../utils/supabase.js';
import { verifyAdmin, logAudit } from '../../../../utils/auth.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  const supabase = getSupabase();
  const user = await verifyAdmin(req);
  if (!user) { res.status(401).json({ error: 'Não autorizado' }); return; }

  const { id } = req.query;

  // POST /api/admin/products/:id/images
  if (req.method === 'POST') {
    const { url, type, display_order } = req.body || {};
    if (!url) { res.status(400).json({ error: 'URL obrigatória' }); return; }
    const VALID_TYPES = ['front', 'back', 'detail', 'preview_offwhite'];
    if (type && !VALID_TYPES.includes(type)) { res.status(400).json({ error: 'Tipo inválido' }); return; }
    const { data, error } = await supabase.from('product_images').insert({
      product_id: id, url, type: type || 'front', display_order: display_order ?? 0
    }).select().single();
    if (error) { res.status(500).json({ error: error.message }); return; }
    await logAudit(supabase, { adminEmail: user.email, action: 'add_product_image', entity: 'product_image', entityId: data.id, after: data });
    res.status(201).json({ image: data }); return;
  }

  res.status(405).json({ error: 'Method not allowed' });
}
