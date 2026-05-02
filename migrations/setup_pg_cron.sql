-- Roda no Supabase SQL Editor
-- Requer que pg_cron e pg_net estejam habilitados (vão por padrão no Supabase)

-- Habilita extensões se ainda não estiverem ativas
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Remove job anterior se existir
SELECT cron.unschedule('expire-reservations');

-- Agenda expire-reservations a cada 5 minutos
SELECT cron.schedule(
  'expire-reservations',
  '*/5 * * * *',
  $$
    SELECT net.http_post(
      url    := 'https://arquivo90.vercel.app/api/cron/expire-reservations',
      body   := '{}',
      headers := '{"Content-Type": "application/json"}'::jsonb
    );
  $$
);
