import { getSupabase }          from './utils/supabase.js';
import { verifyAdmin, logAudit } from './utils/auth.js';

export default async (req, context) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204 });

  const supabase = getSupabase();
  const user = await verifyAdmin(req);
  if (!user) return Response.json({ error: 'Não autorizado' }, { status: 401 });

  const url      = new URL(req.url);
  const segments = url.pathname.replace('/api/admin/products', '').split('/').filter(Boolean);
  const id       = segments[0] || null;
  const action   = segments[1] || null; // ex: "reorder"

  // ── GET /api/admin/products — lista todos ──────────────────────────────────
  if (req.method === 'GET' && !id) {
    const { data, error } = await supabase
      .from('products')
      .select(`
        id, slug, name, subtitle, price, display_order, active, featured, created_at,
        product_images(url, type, display_order),
        product_sizes(size, stock, reserved)
      `)
      .is('deleted_at', null)
      .order('display_order', { ascending: true });

    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ products: data });
  }

  // ── GET /api/admin/products/:id ────────────────────────────────────────────
  if (req.method === 'GET' && id) {
    const { data, error } = await supabase
      .from('products')
      .select(`*, product_images(*), product_sizes(*)`)
      .eq('id', id)
      .is('deleted_at', null)
      .single();

    if (error || !data) return Response.json({ error: 'Produto não encontrado' }, { status: 404 });
    return Response.json({ product: data });
  }

  // ── POST /api/admin/products — criar ───────────────────────────────────────
  if (req.method === 'POST' && !id) {
    let body;
    try { body = await req.json(); } catch { return Response.json({ error: 'Payload inválido' }, { status: 400 }); }

    const { name, slug, subtitle, description, price, display_order,
            tipo, modelagem, genero, esporte, subcategoria, cor,
            sku, peso_g, time_ref, ano_ref, tags,
            meta_title, meta_description, image_url,
            active, featured, colors } = body;
    if (!name?.trim() || !slug?.trim() || !price)
      return Response.json({ error: 'Nome, slug e preço são obrigatórios' }, { status: 400 });

    const cleanSlug = slug.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-');

    const { data, error } = await supabase.from('products').insert({
      name:             name.trim(),
      slug:             cleanSlug,
      sku:              sku?.trim() || null,
      subtitle:         subtitle?.trim() || null,
      description:      description?.trim() || null,
      price:            parseFloat(price),
      display_order:    display_order ?? 99,
      peso_g:           peso_g ? parseInt(peso_g, 10) : null,
      tipo:             tipo || null,
      modelagem:        modelagem || null,
      genero:           genero || null,
      esporte:          esporte || null,
      subcategoria:     subcategoria || null,
      cor:              cor?.trim() || null,
      time_ref:         time_ref?.trim() || null,
      ano_ref:          ano_ref ? parseInt(ano_ref, 10) : null,
      tags:             Array.isArray(tags) ? tags : null,
      meta_title:       meta_title?.trim() || null,
      meta_description: meta_description?.trim() || null,
      image_url:        image_url?.trim() || null,
      active:           active  ?? false,
      featured:         featured ?? false
    }).select().single();

    if (error) {
      if (error.code === '23505') return Response.json({ error: 'Slug já existe' }, { status: 409 });
      return Response.json({ error: error.message }, { status: 500 });
    }

    // Cria tamanhos P/M/G/GG com estoque 0 (com cor, se informada)
    const DEFAULT_SIZES = ['P','M','G','GG'];
    const colorList = Array.isArray(colors) && colors.length > 0
      ? colors.map(c => c.trim()).filter(Boolean)
      : null;
    const sizeRows = colorList
      ? colorList.flatMap(color => DEFAULT_SIZES.map(size => ({ product_id: data.id, size, color, stock: 0 })))
      : DEFAULT_SIZES.map(size => ({ product_id: data.id, size, color: null, stock: 0 }));
    await supabase.from('product_sizes').insert(sizeRows);

    await logAudit(supabase, { adminEmail: user.email, action: 'create_product', entity: 'product', entityId: data.id, after: data });
    return Response.json({ product: data }, { status: 201 });
  }

  // ── PUT /api/admin/products/reorder ───────────────────────────────────────
  if (req.method === 'PUT' && id === 'reorder') {
    let body;
    try { body = await req.json(); } catch { return Response.json({ error: 'Payload inválido' }, { status: 400 }); }

    const { order } = body; // [{ id, display_order }]
    if (!Array.isArray(order)) return Response.json({ error: 'Formato inválido' }, { status: 400 });

    for (const item of order) {
      await supabase.from('products')
        .update({ display_order: item.display_order })
        .eq('id', item.id);
    }

    await logAudit(supabase, { adminEmail: user.email, action: 'reorder_products', entity: 'product', after: { order } });
    return Response.json({ ok: true });
  }

  // ── PUT /api/admin/products/:id — atualizar ────────────────────────────────
  if (req.method === 'PUT' && id && !action) {
    let body;
    try { body = await req.json(); } catch { return Response.json({ error: 'Payload inválido' }, { status: 400 }); }

    const { data: before } = await supabase.from('products').select('*').eq('id', id).single();
    if (!before) return Response.json({ error: 'Produto não encontrado' }, { status: 404 });

    const allowed = ['name','slug','sku','subtitle','description','price','display_order','peso_g','tipo','modelagem','genero','esporte','subcategoria','cor','time_ref','ano_ref','tags','meta_title','meta_description','image_url','active','featured'];
    const updates = Object.fromEntries(
      Object.entries(body).filter(([k]) => allowed.includes(k))
    );
    if (updates.slug) updates.slug = updates.slug.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-');
    if (updates.price) updates.price = parseFloat(updates.price);

    const { data: after, error } = await supabase.from('products')
      .update(updates).eq('id', id).is('deleted_at', null).select().single();

    if (error) return Response.json({ error: error.message }, { status: 500 });

    await logAudit(supabase, { adminEmail: user.email, action: 'update_product', entity: 'product', entityId: id, before, after });
    return Response.json({ product: after });
  }

  // ── DELETE /api/admin/products/:id — soft delete ───────────────────────────
  if (req.method === 'DELETE' && id) {
    const { data: before } = await supabase.from('products').select('*').eq('id', id).single();
    if (!before) return Response.json({ error: 'Produto não encontrado' }, { status: 404 });

    await supabase.from('products').update({ active: false, deleted_at: new Date().toISOString() }).eq('id', id);
    await logAudit(supabase, { adminEmail: user.email, action: 'delete_product', entity: 'product', entityId: id, before });
    return Response.json({ ok: true });
  }

  return Response.json({ error: 'Not found' }, { status: 404 });
};

export const config = { path: ['/api/admin/products', '/api/admin/products/*'] };
