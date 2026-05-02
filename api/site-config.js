import { json } from './utils/response.js';

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204 });

  return json({
    supabaseUrl:     process.env.SUPABASE_URL,
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY
  }, {
    headers: { 'Cache-Control': 'public, s-maxage=3600' }
  });
};
