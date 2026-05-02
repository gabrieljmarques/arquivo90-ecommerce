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
        product_sizes(size, color, stock, reserved)
      `)
      .eq('slug', slug)
      .eq('active', true)
      .is('deleted_at', null)
      .single();

    if (error || !data) {
      return Response.json({ error: 'Produto não encontrado' }, { status: 404 });
    }

    const SIZE_ORDER = ['PP','P','M','G','GG','XG','XGG','XL','XXL'];

    const product = {
      ...data,
      product_images: data.product_images.sort((a, b) => a.display_order - b.display_order),
      product_sizes:  data.product_sizes
        .map(s => ({
          size:      s.size,
          color:     s.color || null,
          available: Math.max(0, s.stock - s.reserved)
        }))
        .sort((a, b) => {
          if (a.color === b.color) {
            return SIZE_ORDER.indexOf(a.size) - SIZE_ORDER.indexOf(b.size);
          }
          if (a.color === null) return 1;
          if (b.color === null) return -1;
          return a.color.localeCompare(b.color) || SIZE_ORDER.indexOf(a.size) - SIZE_ORDER.indexOf(b.size);
        })
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
