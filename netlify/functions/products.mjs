import { getSupabase } from './utils/supabase.js';

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (req.method !== 'GET')    return Response.json({ error: 'Method not allowed' }, { status: 405 });

  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('products')
      .select(`
        id, slug, name, subtitle, price, featured,
        product_images(url, type, display_order),
        product_sizes(size, stock, reserved)
      `)
      .eq('active', true)
      .is('deleted_at', null)
      .order('display_order', { ascending: true });

    if (error) {
      console.error('products fetch error:', error.message);
      return Response.json({ error: error.message }, { status: 500 });
    }

    const products = data.map(p => ({
      ...p,
      product_images: p.product_images.sort((a, b) => a.display_order - b.display_order),
      product_sizes:  p.product_sizes.map(s => ({
        size:      s.size,
        available: Math.max(0, s.stock - s.reserved)
      }))
    }));

    return Response.json({ products }, {
      headers: { 'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=120' }
    });
  } catch (e) {
    console.error('products error:', e.message);
    return Response.json({ error: e.message }, { status: 500 });
  }
};

export const config = { path: '/api/products' };
