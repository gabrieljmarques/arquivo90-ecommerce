import { createClient } from '@supabase/supabase-js';

let _client = null;

export function getSupabase() {
  if (!_client) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_KEY;
    if (!url || !key) throw new Error('SUPABASE_URL or SUPABASE_SERVICE_KEY not set');
    _client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
      db:   { schema: 'public' }
    });
  }
  return _client;
}

// Proxy com bind correto para preservar `this` nos métodos do cliente
export const supabase = new Proxy({}, {
  get(_, prop) {
    const client = getSupabase();
    const value  = client[prop];
    return typeof value === 'function' ? value.bind(client) : value;
  }
});
