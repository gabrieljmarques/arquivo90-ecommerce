import { getSupabase } from '../utils/supabase.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const { slug } = req.query;
  if (!slug) { res.status(404).json({ error: 'Produto não encontrado' }); return; }

  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('products')
      .select(`
        id, slug, name, subtitle, description, price,
        product_images(url, type, display_order, color),
        product_sizes(size, color, stock, reserved)
      `)
      .eq('slug', slug)
      .eq('active', true)
      .is('deleted_at', null)
      .single();

    if (error || !data) { res.status(404).json({ error: 'Produto não encontrado' }); return; }

    const SIZE_ORDER = ['PP','P','M','G','GG','XG','XGG','XL','XXL'];

    const product = {
      ...data,
      product_images: data.product_images.sort((a, b) => a.display_order - b.display_order),
      product_sizes:  data.product_sizes
        .map(s => ({ size: s.size, color: s.color || null, available: Math.max(0, s.stock - s.reserved) }))
        .sort((a, b) => {
          if (a.color === b.color) return SIZE_ORDER.indexOf(a.size) - SIZE_ORDER.indexOf(b.size);
          if (a.color === null) return 1;
          if (b.color === null) return -1;
          return a.color.localeCompare(b.color) || SIZE_ORDER.indexOf(a.size) - SIZE_ORDER.indexOf(b.size);
        })
    };

    res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=120');
    res.json({ product });
  } catch (e) {
    console.error('product error:', e.message);
    res.status(500).json({ error: e.message });
  }
}
