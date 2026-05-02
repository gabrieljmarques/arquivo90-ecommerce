import { getSupabase }          from '../utils/supabase.js';
import { verifyAdmin, logAudit } from '../utils/auth.js';

const VALID_STATUSES = ['pending','paid','preparing','shipped','delivered','cancelled','refunded'];
const PAGE_SIZE      = 25;

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  const supabase = getSupabase();
  const user = await verifyAdmin(req);
  if (!user) { res.status(401).json({ error: 'Não autorizado' }); return; }

  // Parse resource from URL path — IDs and sub-resources come from query params
  const { pathname } = new URL(req.url, 'http://localhost');
  const resource = pathname.replace(/^\/api\/admin\/?/, '').split('/')[0];

  // Query params carry all identifiers to avoid multi-segment routing issues
  const id      = req.query.id      || null;   // product/order UUID
  const sub     = req.query.sub     || null;   // 'images'
  const imageId = req.query.imageId || null;   // image UUID
  const action  = req.query.action  || null;   // 'reorder'

  // ── PRODUCTS ──────────────────────────────────────────────────────────────
  if (resource === 'products') {

    // GET /admin/products?page=N  (list, paginated)
    if (req.method === 'GET' && !id) {
      const page = Math.max(1, parseInt(req.query.page || '1', 10));
      const from = (page - 1) * PAGE_SIZE;
      const { data, error, count } = await supabase.from('products')
        .select(`id, slug, name, subtitle, price, display_order, active, featured, created_at,
          product_images(url, type, display_order), product_sizes(size, stock, reserved)`, { count: 'exact' })
        .is('deleted_at', null)
        .order('display_order', { ascending: true })
        .range(from, from + PAGE_SIZE - 1);
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json({ products: data, total: count, page, pages: Math.ceil(count / PAGE_SIZE) }); return;
    }

    // POST /admin/products  (create)
    if (req.method === 'POST' && !id && !sub) {
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

    // PUT /admin/products?action=reorder  (reorder display_order)
    if (req.method === 'PUT' && action === 'reorder' && !id) {
      const { order } = req.body || {};
      if (!Array.isArray(order)) { res.status(400).json({ error: 'Formato inválido' }); return; }
      for (const item of order) await supabase.from('products').update({ display_order: item.display_order }).eq('id', item.id);
      await logAudit(supabase, { adminEmail: user.email, action: 'reorder_products', entity: 'product', after: { order } });
      res.json({ ok: true }); return;
    }

    // GET /admin/products?id=UUID
    if (req.method === 'GET' && id && !sub) {
      const { data, error } = await supabase.from('products')
        .select(`*, product_images(*), product_sizes(*)`).eq('id', id).is('deleted_at', null).single();
      if (error || !data) { res.status(404).json({ error: 'Produto não encontrado' }); return; }
      res.json({ product: data }); return;
    }

    // PUT /admin/products?id=UUID  (update)
    if (req.method === 'PUT' && id && !sub && !action) {
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

    // DELETE /admin/products?id=UUID
    if (req.method === 'DELETE' && id && !sub) {
      const { data: before } = await supabase.from('products').select('*').eq('id', id).single();
      if (!before) { res.status(404).json({ error: 'Produto não encontrado' }); return; }
      await supabase.from('products').update({ active: false, deleted_at: new Date().toISOString() }).eq('id', id);
      await logAudit(supabase, { adminEmail: user.email, action: 'delete_product', entity: 'product', entityId: id, before });
      res.json({ ok: true }); return;
    }

    // POST /admin/products?id=UUID&sub=images
    if (req.method === 'POST' && id && sub === 'images') {
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

    // PUT /admin/products?id=UUID&sub=images&action=reorder
    if (req.method === 'PUT' && id && sub === 'images' && action === 'reorder') {
      const { order } = req.body || {};
      if (!Array.isArray(order)) { res.status(400).json({ error: 'Formato inválido' }); return; }
      for (const item of order) {
        await supabase.from('product_images').update({ display_order: item.display_order }).eq('id', item.id).eq('product_id', id);
      }
      res.json({ ok: true }); return;
    }

    // DELETE /admin/products?id=UUID&sub=images&imageId=IMGID
    if (req.method === 'DELETE' && id && sub === 'images' && imageId) {
      const { error } = await supabase.from('product_images').delete().eq('id', imageId).eq('product_id', id);
      if (error) { res.status(500).json({ error: error.message }); return; }
      await logAudit(supabase, { adminEmail: user.email, action: 'delete_product_image', entity: 'product_image', entityId: imageId });
      res.json({ ok: true }); return;
    }
  }

  // ── ORDERS ────────────────────────────────────────────────────────────────
  if (resource === 'orders') {

    // GET /admin/orders?page=N  (list)
    if (req.method === 'GET' && !id) {
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

    // GET /admin/orders?id=UUID
    if (req.method === 'GET' && id) {
      const { data, error } = await supabase.from('orders')
        .select(`*, order_items(*, products(name, slug))`).eq('id', id).single();
      if (error || !data) { res.status(404).json({ error: 'Pedido não encontrado' }); return; }
      res.json({ order: data }); return;
    }

    // PUT /admin/orders?id=UUID
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
  }

  // ── STOCK ─────────────────────────────────────────────────────────────────
  if (resource === 'stock') {

    if (req.method === 'GET') {
      const [sizesResult, ordersResult] = await Promise.all([
        supabase.from('product_sizes')
          .select('id, size, color, stock, reserved, products!inner(id, name, slug, active, deleted_at)')
          .is('products.deleted_at', null).order('size', { ascending: true }),
        supabase.from('orders').select('id').in('status', ['paid','preparing','shipped','delivered'])
      ]);

      if (sizesResult.error) { res.status(500).json({ error: sizesResult.error.message }); return; }

      const soldMap  = {};
      const orderIds = (ordersResult.data || []).map(o => o.id);
      if (orderIds.length) {
        const { data: items } = await supabase.from('order_items').select('product_id, size, color, quantity').in('order_id', orderIds);
        (items || []).forEach(i => { const k = `${i.product_id}:${i.size}:${i.color||''}`; soldMap[k] = (soldMap[k] || 0) + i.quantity; });
      }

      const stock = (sizesResult.data || []).map(s => ({
        ...s, color: s.color || null,
        sold: soldMap[`${s.products.id}:${s.size}:${s.color||''}`] || 0
      }));
      res.json({ stock }); return;
    }

    if (req.method === 'PUT') {
      const { product_size_id, new_stock, reason, notes } = req.body || {};
      if (!product_size_id || new_stock == null || isNaN(new_stock) || new_stock < 0) { res.status(400).json({ error: 'Dados inválidos' }); return; }

      const { data: ps } = await supabase.from('product_sizes').select('id, stock, reserved').eq('id', product_size_id).single();
      if (!ps) { res.status(404).json({ error: 'Tamanho não encontrado' }); return; }

      const newStock = parseInt(new_stock, 10);
      if (newStock < ps.reserved) { res.status(409).json({ error: `Estoque não pode ser menor que o reservado (${ps.reserved})` }); return; }

      const { error } = await supabase.from('product_sizes').update({ stock: newStock }).eq('id', product_size_id);
      if (error) { res.status(500).json({ error: error.message }); return; }

      await supabase.from('stock_transactions').insert({ product_size_id, delta: newStock - ps.stock, reason: reason || 'adjustment', created_by: user.email });
      await logAudit(supabase, { adminEmail: user.email, action: 'update_stock', entity: 'product_size', entityId: product_size_id, before: { stock: ps.stock }, after: { stock: newStock, reason, notes } });
      res.json({ ok: true, new_stock: newStock }); return;
    }
  }

  res.status(404).json({ error: 'Not found' });
}
