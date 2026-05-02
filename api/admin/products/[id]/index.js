import { getSupabase }          from '../../../utils/supabase.js';
import { verifyAdmin, logAudit } from '../../../utils/auth.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  const supabase = getSupabase();
  const user = await verifyAdmin(req);
  if (!user) { res.status(401).json({ error: 'Não autorizado' }); return; }

  const { id } = req.query;

  // GET /api/admin/products/:id
  if (req.method === 'GET') {
    const { data, error } = await supabase.from('products')
      .select(`*, product_images(*), product_sizes(*)`).eq('id', id).is('deleted_at', null).single();
    if (error || !data) { res.status(404).json({ error: 'Produto não encontrado' }); return; }
    res.json({ product: data }); return;
  }

  // PUT /api/admin/products/:id
  if (req.method === 'PUT') {
    const { data: before } = await supabase.from('products').select('*').eq('id', id).single();
    if (!before) { res.status(404).json({ error: 'Produto não encontrado' }); return; }

    const allowed = ['name','slug','sku','subtitle','description','price','display_order','peso_g','tipo','modelagem','genero','esporte','subcategoria','cor','time_ref','ano_ref','tags','meta_title','meta_description','image_url','active','featured'];
    const updates = Object.fromEntries(Object.entries(req.body || {}).filter(([k]) => allowed.includes(k)));
    if (updates.slug)  updates.slug  = updates.slug.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-');
    if (updates.price) updates.price = parseFloat(updates.price);

    if (!Object.keys(updates).length) { res.status(400).json({ error: 'Nenhum campo para atualizar' }); return; }

    const { data: after, error } = await supabase.from('products').update(updates).eq('id', id).is('deleted_at', null).select().single();
    if (error) { res.status(500).json({ error: error.message }); return; }
    await logAudit(supabase, { adminEmail: user.email, action: 'update_product', entity: 'product', entityId: id, before, after });
    res.json({ product: after }); return;
  }

  // DELETE /api/admin/products/:id
  if (req.method === 'DELETE') {
    const { data: before } = await supabase.from('products').select('*').eq('id', id).single();
    if (!before) { res.status(404).json({ error: 'Produto não encontrado' }); return; }
    await supabase.from('products').update({ active: false, deleted_at: new Date().toISOString() }).eq('id', id);
    await logAudit(supabase, { adminEmail: user.email, action: 'delete_product', entity: 'product', entityId: id, before });
    res.json({ ok: true }); return;
  }

  res.status(405).json({ error: 'Method not allowed' });
}
