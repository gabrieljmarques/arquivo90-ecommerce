export default async (req) => {
  return new Response(JSON.stringify({
    hasSupabaseUrl:     !!process.env.SUPABASE_URL,
    hasAnonKey:         !!process.env.SUPABASE_ANON_KEY,
    hasServiceKey:      !!process.env.SUPABASE_SERVICE_KEY,
    hasMpToken:         !!process.env.MP_ACCESS_TOKEN,
    hasUpstash:         !!process.env.UPSTASH_REDIS_URL,
    hasAdminEmail:      !!process.env.ADMIN_EMAIL,
    nodeVersion:        process.version,
    totalEnvVars:       Object.keys(process.env).length,
    supabaseUrlPreview: (process.env.SUPABASE_URL || '').slice(0, 20) || 'EMPTY'
  }), {
    headers: { 'Content-Type': 'application/json' }
  });
};
