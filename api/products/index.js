import { getSupabase } from '../utils/supabase.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed' }); return; }

  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('products')
      .select(`
        id, slug, name, subtitle, price, featured, display_order,
        tipo, esporte, subcategoria, cor, genero, time_ref,
        product_images(url, type, display_order),
        product_sizes(size, color, stock, reserved)
      `)
      .eq('active', true)
      .is('deleted_at', null)
      .order('display_order', { ascending: true });

    if (error) { res.status(500).json({ error: error.message }); return; }

    const SIZE_ORDER = ['PP','P','M','G','GG','XG','XGG','XL','XXL'];

    const products = data.map(p => {
      // Deduplicate sizes: for each unique size, mark available if ANY color has stock
      const sizeMap = {};
      for (const s of p.product_sizes) {
        const avail = Math.max(0, s.stock - s.reserved);
        if (!(s.size in sizeMap) || avail > 0) sizeMap[s.size] = avail;
      }
      const sizes = SIZE_ORDER
        .filter(sz => sz in sizeMap)
        .map(sz => ({ size: sz, available: sizeMap[sz] }));

      return {
        ...p,
        product_images: p.product_images.sort((a, b) => a.display_order - b.display_order),
        product_sizes:  sizes,
        // Remove raw size data with colors (not needed on listing pages)
        _raw_sizes: undefined
      };
    });

    res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=120');
    res.json({ products });
  } catch (e) {
    console.error('products error:', e.message);
    res.status(500).json({ error: e.message });
  }
}
