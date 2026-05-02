import crypto from 'crypto';
import { supabase } from './utils/supabase.js';

export default async (req) => {
  if (req.method !== 'POST') return new Response(null, { status: 405 });

  // ── Valida assinatura HMAC do Mercado Pago ────────────────────────────────
  // MP envia: x-signature: ts=...,v1=...
  // Manifesto: "id:{dataId};request-id:{xRequestId};ts:{ts};"
  const xSignature  = req.headers.get('x-signature')  || '';
  const xRequestId  = req.headers.get('x-request-id') || '';
  const url         = new URL(req.url);
  const dataId      = url.searchParams.get('data.id') || url.searchParams.get('id') || '';

  if (process.env.MP_WEBHOOK_SECRET && xSignature) {
    const parts = Object.fromEntries(
      xSignature.split(',').map(p => {
        const [k, ...v] = p.split('=');
        return [k.trim(), v.join('=').trim()];
      })
    );
    const ts = parts['ts'] || '';
    const v1 = parts['v1'] || '';

    const manifest  = `id:${dataId};request-id:${xRequestId};ts:${ts};`;
    const expected  = crypto
      .createHmac('sha256', process.env.MP_WEBHOOK_SECRET)
      .update(manifest)
      .digest('hex');

    // timingSafeEqual previne timing attacks
    const expBuf = Buffer.from(expected);
    const recBuf = Buffer.alloc(expBuf.length);
    Buffer.from(v1).copy(recBuf);

    if (!crypto.timingSafeEqual(expBuf, recBuf)) {
      console.warn('webhook signature mismatch');
      return new Response(null, { status: 401 });
    }
  }

  // ── Parse payload ─────────────────────────────────────────────────────────
  let payload;
  try { payload = await req.json(); }
  catch { return new Response(null, { status: 400 }); }

  // Apenas notificações de pagamento nos interessam
  if (payload.type !== 'payment') {
    return new Response(null, { status: 200 });
  }

  const notificationId = `payment:${payload.data?.id}`;

  // ── Insere na fila (idempotente via UNIQUE) ───────────────────────────────
  const { error } = await supabase.from('webhook_events').insert({
    mp_notification_id: notificationId,
    payload,
    status: 'pending'
  });

  if (error?.code === '23505') {
    // Notificação duplicada — MP está retentando, acusar recebimento
    return new Response(null, { status: 200 });
  }

  if (error) {
    console.error('webhook insert error:', error.message);
    // Retorna 500 para o MP retentar depois
    return new Response(null, { status: 500 });
  }

  // Responde 200 imediatamente; processamento ocorre em process-webhooks.mjs
  return new Response(null, { status: 200 });
};

export const config = { path: '/api/payment/webhook' };
