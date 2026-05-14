import { getSupabase } from './utils/supabase.js';

const SITE = process.env.SITE_URL || 'https://arquivo90.com.br';

const staticPages = [
  { loc: '/',         priority: '1.0', changefreq: 'weekly' },
  { loc: '/produtos', priority: '0.9', changefreq: 'weekly' },
];

export default async function handler(req, res) {
  if (req.method !== 'GET') { res.status(405).end(); return; }

  let productRows = [];
  try {
    const supabase = getSupabase();
    const { data } = await supabase
      .from('products')
      .select('slug, updated_at')
      .eq('active', true)
      .is('deleted_at', null)
      .order('updated_at', { ascending: false })
      .limit(500);
    productRows = data || [];
  } catch (err) {
    console.error('sitemap products fetch:', err.message);
  }

  const urlTags = [
    ...staticPages.map(p => `
  <url>
    <loc>${SITE}${p.loc}</loc>
    <changefreq>${p.changefreq}</changefreq>
    <priority>${p.priority}</priority>
  </url>`),
    ...productRows.map(p => `
  <url>
    <loc>${SITE}/produto/${p.slug}</loc>
    <lastmod>${p.updated_at ? p.updated_at.slice(0, 10) : ''}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>`),
  ].join('');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urlTags}
</urlset>`;

  res.setHeader('Content-Type', 'application/xml');
  res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=600');
  res.send(xml);
}
