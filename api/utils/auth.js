import { createClient } from '@supabase/supabase-js';

export async function verifyAdmin(req) {
  const authHeader = req.headers['authorization'];
  if (!authHeader?.startsWith('Bearer ')) return null;

  const token = authHeader.slice(7);

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY,
    { auth: { persistSession: false } }
  );

  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return null;

  if (user.email !== process.env.ADMIN_EMAIL) return null;

  return user;
}

export async function logAudit(supabase, { adminEmail, action, entity, entityId, before, after }) {
  await supabase.from('audit_log').insert({
    admin_email: adminEmail,
    action,
    entity,
    entity_id:  entityId || null,
    before:     before   || null,
    after:      after    || null
  });
}
