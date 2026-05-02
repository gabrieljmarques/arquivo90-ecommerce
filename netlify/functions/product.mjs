import { getSupabase } from './utils/supabase.js';

export default async (req, context) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (req.method !== 'GET')    return Response.json({ error: 'Method not allowed' }, { status: 405 });

  const slug = context.params?.slug;
  if (!slug) return Response.json({ error: 'Produto não encontrado' }, { status: 404 });

  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('products')
      .select(`
        id, slug, name, subtitle, description, price,
        product_images(url, type, display_order),
        product_sizes(size, stock, reserved)
      `)
      .eq('slug', slug)
      .eq('active', true)
      .is('deleted_at', null)
      .single();

    if (error || !data) {
      return Response.json({ error: 'Produto não encontrado' }, { status: 404 });
    }

    const product = {
      ...data,
      product_images: data.product_images.sort((a, b) => a.display_order - b.display_order),
      product_sizes:  data.product_sizes.map(s => ({
        size:      s.size,
        available: Math.max(0, s.stock - s.reserved)
      }))
    };

    return Response.json({ product }, {
      headers: { 'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=120' }
    });
  } catch (e) {
    console.error('product error:', e.message);
    return Response.json({ error: e.message }, { status: 500 });
  }
};

export const config = { path: '/api/products/:slug' };
