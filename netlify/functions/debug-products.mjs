export default async (req) => {
  try {
    const { getSupabase } = await import('./utils/supabase.js');
    const sb = getSupabase();
    const { data, error } = await sb
      .from('products')
      .select('id, name')
      .limit(3);
    return new Response(JSON.stringify({ ok: true, data, error }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, message: e.message, stack: e.stack?.slice(0, 300) }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
