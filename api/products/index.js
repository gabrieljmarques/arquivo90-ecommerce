import { getSupabase } from '../utils/supabase.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed' }); return; }

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

    if (error) { res.status(500).json({ error: error.message }); return; }

    const products = data.map(p => ({
      ...p,
      product_images: p.product_images.sort((a, b) => a.display_order - b.display_order),
      product_sizes:  p.product_sizes.map(s => ({
        size:      s.size,
        available: Math.max(0, s.stock - s.reserved)
      }))
    }));

    res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=120');
    res.json({ products });
  } catch (e) {
    console.error('products error:', e.message);
    res.status(500).json({ error: e.message });
  }
}
