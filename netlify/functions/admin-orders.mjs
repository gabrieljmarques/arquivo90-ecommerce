import { supabase }             from './utils/supabase.js';
import { verifyAdmin, logAudit } from './utils/auth.js';

const VALID_STATUSES = ['pending','paid','preparing','shipped','delivered','cancelled','refunded'];
const PAGE_SIZE      = 25;

export default async (req, context) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204 });

  const user = await verifyAdmin(req);
  if (!user) return Response.json({ error: 'Não autorizado' }, { status: 401 });

  const url      = new URL(req.url);
  const segments = url.pathname.replace('/api/admin/orders', '').split('/').filter(Boolean);
  const id       = segments[0] || null;

  // ── GET /api/admin/orders — lista paginada ────────────────────────────────
  if (req.method === 'GET' && !id) {
    const page    = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
    const status  = url.searchParams.get('status') || null;
    const search  = url.searchParams.get('q')?.trim() || null;
    const from    = (page - 1) * PAGE_SIZE;

    let query = supabase
      .from('orders')
      .select('id, status, customer_name, customer_email, total, tracking_code, created_at, paid_at', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, from + PAGE_SIZE - 1);

    if (status && VALID_STATUSES.includes(status)) query = query.eq('status', status);
    if (search) query = query.or(`customer_email.ilike.%${search}%,customer_name.ilike.%${search}%`);

    const { data, error, count } = await query;
    if (error) return Response.json({ error: error.message }, { status: 500 });

    return Response.json({ orders: data, total: count, page, pages: Math.ceil(count / PAGE_SIZE) });
  }

  // ── GET /api/admin/orders/:id — detalhe ───────────────────────────────────
  if (req.method === 'GET' && id) {
    const { data, error } = await supabase
      .from('orders')
      .select(`*, order_items(*, products(name, slug))`)
      .eq('id', id)
      .single();

    if (error || !data) return Response.json({ error: 'Pedido não encontrado' }, { status: 404 });
    return Response.json({ order: data });
  }

  // ── PUT /api/admin/orders/:id — atualiza status e/ou tracking ─────────────
  if (req.method === 'PUT' && id) {
    let body;
    try { body = await req.json(); } catch { return Response.json({ error: 'Payload inválido' }, { status: 400 }); }

    const { data: before } = await supabase.from('orders').select('*').eq('id', id).single();
    if (!before) return Response.json({ error: 'Pedido não encontrado' }, { status: 404 });

    const updates = {};
    if (body.status) {
      if (!VALID_STATUSES.includes(body.status))
        return Response.json({ error: 'Status inválido' }, { status: 400 });
      updates.status = body.status;
      if (body.status === 'shipped') updates.shipped_at = new Date().toISOString();
    }
    if (body.tracking_code !== undefined) updates.tracking_code = body.tracking_code?.trim() || null;
    if (body.carrier       !== undefined) updates.carrier       = body.carrier?.trim()        || null;
    if (body.notes         !== undefined) updates.notes         = body.notes?.trim()          || null;

    if (!Object.keys(updates).length)
      return Response.json({ error: 'Nenhum campo para atualizar' }, { status: 400 });

    const { data: after, error } = await supabase.from('orders').update(updates).eq('id', id).select().single();
    if (error) return Response.json({ error: error.message }, { status: 500 });

    await logAudit(supabase, { adminEmail: user.email, action: 'update_order', entity: 'order', entityId: id, before, after });
    return Response.json({ order: after });
  }

  return Response.json({ error: 'Not found' }, { status: 404 });
};

export const config = { path: ['/api/admin/orders', '/api/admin/orders/*'] };
