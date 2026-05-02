import { getSupabase }          from '../../utils/supabase.js';
import { verifyAdmin, logAudit } from '../../utils/auth.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  const supabase = getSupabase();
  const user = await verifyAdmin(req);
  if (!user) { res.status(401).json({ error: 'Não autorizado' }); return; }

  const path     = req.url.split('?')[0];
  const segments = path.replace('/api/admin/products', '').split('/').filter(Boolean);
  const id       = segments[0] || null;
  const action   = segments[1] || null;

  if (req.method === 'GET' && !id) {
    const { data, error } = await supabase.from('products')
      .select(`id, slug, name, subtitle, price, display_order, active, featured, created_at,
        product_images(url, type, display_order), product_sizes(size, stock, reserved)`)
      .is('deleted_at', null).order('display_order', { ascending: true });
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.json({ products: data }); return;
  }

  if (req.method === 'GET' && id) {
    const { data, error } = await supabase.from('products')
      .select(`*, product_images(*), product_sizes(*)`).eq('id', id).is('deleted_at', null).single();
    if (error || !data) { res.status(404).json({ error: 'Produto não encontrado' }); return; }
    res.json({ product: data }); return;
  }

  if (req.method === 'POST' && !id) {
    const { name, slug, subtitle, description, price, display_order,
            tipo, modelagem, genero, esporte, subcategoria, cor,
            sku, peso_g, time_ref, ano_ref, tags,
            meta_title, meta_description, image_url, active, featured, colors } = req.body || {};

    if (!name?.trim() || !slug?.trim() || !price) { res.status(400).json({ error: 'Nome, slug e preço são obrigatórios' }); return; }

    const cleanSlug = slug.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-');
    const { data, error } = await supabase.from('products').insert({
      name: name.trim(), slug: cleanSlug, sku: sku?.trim() || null,
      subtitle: subtitle?.trim() || null, description: description?.trim() || null,
      price: parseFloat(price), display_order: display_order ?? 99,
      peso_g: peso_g ? parseInt(peso_g, 10) : null,
      tipo: tipo || null, modelagem: modelagem || null, genero: genero || null,
      esporte: esporte || null, subcategoria: subcategoria || null, cor: cor?.trim() || null,
      time_ref: time_ref?.trim() || null, ano_ref: ano_ref ? parseInt(ano_ref, 10) : null,
      tags: Array.isArray(tags) ? tags : null,
      meta_title: meta_title?.trim() || null, meta_description: meta_description?.trim() || null,
      image_url: image_url?.trim() || null, active: active ?? false, featured: featured ?? false
    }).select().single();

    if (error) {
      if (error.code === '23505') { res.status(409).json({ error: 'Slug já existe' }); return; }
      res.status(500).json({ error: error.message }); return;
    }

    const DEFAULT_SIZES = ['P','M','G','GG'];
    const colorList = Array.isArray(colors) && colors.length > 0 ? colors.map(c => c.trim()).filter(Boolean) : null;
    const sizeRows  = colorList
      ? colorList.flatMap(color => DEFAULT_SIZES.map(size => ({ product_id: data.id, size, color, stock: 0 })))
      : DEFAULT_SIZES.map(size => ({ product_id: data.id, size, color: null, stock: 0 }));
    await supabase.from('product_sizes').insert(sizeRows);

    await logAudit(supabase, { adminEmail: user.email, action: 'create_product', entity: 'product', entityId: data.id, after: data });
    res.status(201).json({ product: data }); return;
  }

  if (req.method === 'PUT' && id === 'reorder') {
    const { order } = req.body || {};
    if (!Array.isArray(order)) { res.status(400).json({ error: 'Formato inválido' }); return; }
    for (const item of order) await supabase.from('products').update({ display_order: item.display_order }).eq('id', item.id);
    await logAudit(supabase, { adminEmail: user.email, action: 'reorder_products', entity: 'product', after: { order } });
    res.json({ ok: true }); return;
  }

  if (req.method === 'PUT' && id && !action) {
    const { data: before } = await supabase.from('products').select('*').eq('id', id).single();
    if (!before) { res.status(404).json({ error: 'Produto não encontrado' }); return; }

    const allowed = ['name','slug','sku','subtitle','description','price','display_order','peso_g','tipo','modelagem','genero','esporte','subcategoria','cor','time_ref','ano_ref','tags','meta_title','meta_description','image_url','active','featured'];
    const updates = Object.fromEntries(Object.entries(req.body || {}).filter(([k]) => allowed.includes(k)));
    if (updates.slug)  updates.slug  = updates.slug.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-');
    if (updates.price) updates.price = parseFloat(updates.price);

    const { data: after, error } = await supabase.from('products').update(updates).eq('id', id).is('deleted_at', null).select().single();
    if (error) { res.status(500).json({ error: error.message }); return; }

    await logAudit(supabase, { adminEmail: user.email, action: 'update_product', entity: 'product', entityId: id, before, after });
    res.json({ product: after }); return;
  }

  if (req.method === 'DELETE' && id) {
    const { data: before } = await supabase.from('products').select('*').eq('id', id).single();
    if (!before) { res.status(404).json({ error: 'Produto não encontrado' }); return; }
    await supabase.from('products').update({ active: false, deleted_at: new Date().toISOString() }).eq('id', id);
    await logAudit(supabase, { adminEmail: user.email, action: 'delete_product', entity: 'product', entityId: id, before });
    res.json({ ok: true }); return;
  }

  res.status(404).json({ error: 'Not found' });
}
