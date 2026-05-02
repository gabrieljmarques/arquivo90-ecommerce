export default function handler(req, res) {
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  res.setHeader('Cache-Control', 'public, s-maxage=3600');
  res.json({
    supabaseUrl:     process.env.SUPABASE_URL,
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY
  });
}
