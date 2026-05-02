import { getSupabase }          from '../../../../utils/supabase.js';
import { verifyAdmin, logAudit } from '../../../../utils/auth.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  const supabase = getSupabase();
  const user = await verifyAdmin(req);
  if (!user) { res.status(401).json({ error: 'Não autorizado' }); return; }

  const { id, imageId } = req.query;

  // DELETE /api/admin/products/:id/images/:imageId
  if (req.method === 'DELETE') {
    const { error } = await supabase.from('product_images').delete().eq('id', imageId).eq('product_id', id);
    if (error) { res.status(500).json({ error: error.message }); return; }
    await logAudit(supabase, { adminEmail: user.email, action: 'delete_product_image', entity: 'product_image', entityId: imageId });
    res.json({ ok: true }); return;
  }

  res.status(405).json({ error: 'Method not allowed' });
}
