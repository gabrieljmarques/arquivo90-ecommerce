import { supabase }             from './utils/supabase.js';
import { verifyAdmin, logAudit } from './utils/auth.js';

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204 });

  const user = await verifyAdmin(req);
  if (!user) return Response.json({ error: 'Não autorizado' }, { status: 401 });

  // ── GET — lista estoque de todos os produtos ───────────────────────────────
  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('product_sizes')
      .select(`
        id, size, stock, reserved,
        products!inner(id, name, slug, active, deleted_at)
      `)
      .is('products.deleted_at', null)
      .order('size', { ascending: true });

    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ stock: data });
  }

  // ── PUT — atualiza estoque de um tamanho específico ────────────────────────
  if (req.method === 'PUT') {
    let body;
    try { body = await req.json(); } catch { return Response.json({ error: 'Payload inválido' }, { status: 400 }); }

    const { product_size_id, new_stock, reason, notes } = body;
    if (!product_size_id || new_stock == null || isNaN(new_stock) || new_stock < 0)
      return Response.json({ error: 'Dados inválidos' }, { status: 400 });

    const { data: ps } = await supabase
      .from('product_sizes')
      .select('id, stock, reserved')
      .eq('id', product_size_id)
      .single();

    if (!ps) return Response.json({ error: 'Tamanho não encontrado' }, { status: 404 });

    const newStock = parseInt(new_stock, 10);
    if (newStock < ps.reserved)
      return Response.json({ error: `Estoque não pode ser menor que o reservado (${ps.reserved})` }, { status: 409 });

    const delta = newStock - ps.stock;

    const { error } = await supabase
      .from('product_sizes')
      .update({ stock: newStock })
      .eq('id', product_size_id);

    if (error) return Response.json({ error: error.message }, { status: 500 });

    // Registra transação de estoque
    await supabase.from('stock_transactions').insert({
      product_size_id,
      delta,
      reason:     reason || 'adjustment',
      created_by: user.email
    });

    await logAudit(supabase, {
      adminEmail: user.email,
      action:     'update_stock',
      entity:     'product_size',
      entityId:   product_size_id,
      before:     { stock: ps.stock },
      after:      { stock: newStock, reason, notes }
    });

    return Response.json({ ok: true, new_stock: newStock });
  }

  return Response.json({ error: 'Method not allowed' }, { status: 405 });
};

export const config = { path: '/api/admin/stock' };
