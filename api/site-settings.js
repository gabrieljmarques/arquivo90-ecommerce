import { getSupabase } from './utils/supabase.js';

const DEFAULTS = {
  announcement: { text: 'Entrega para todo o Brasil · Algodão 210g · DTF 300dpi' },
  hero: {
    title: 'ARQUIVO 90',
    tagline: 'MEMÓRIA EM TECIDO',
    cta_text: 'VER PRODUTOS',
    cta_link: '/produtos'
  },
  marquee: {
    items: ['Arquivo 90','·','Memória em Tecido','·','São Paulo','·','Futebol Brasileiro','·','Algodão 210g','·','DTF 300dpi','·','Envio para todo o Brasil','·']
  },
  sobre: {
    quote: 'Alguns momentos do futebol não cabem em replay. Ficaram guardados na memória de quem estava lá — ou na de quem sonhou em estar. Arquivo 90 transforma esses instantes em peça de vestuário.',
    pillars: [
      { label: 'Qualidade',  content: 'Algodão 210g\nFio 30.1 penteado' },
      { label: 'Impressão',  content: 'DTF 300dpi\nCostura dupla' },
      { label: 'Entrega',    content: 'Todo o Brasil\nSão Paulo, BR' }
    ]
  }
};

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed' }); return; }

  try {
    const supabase = getSupabase();
    const { data } = await supabase.from('site_settings').select('key, value');
    const fromDb   = Object.fromEntries((data || []).map(r => [r.key, r.value]));
    // Merge DB values over defaults
    const settings = { ...DEFAULTS, ...fromDb };
    res.setHeader('Cache-Control', 'public, s-maxage=5, stale-while-revalidate=10');
    res.json({ settings });
  } catch {
    res.json({ settings: DEFAULTS });
  }
}
