import { redis } from './redis.js';

/**
 * Rate limit por chave com janela deslizante.
 * Retorna true se a requisição é permitida, false se excedeu o limite.
 */
export async function rateLimit(key, limit, windowSeconds) {
  const windowKey = `rl:${key}:${Math.floor(Date.now() / 1000 / windowSeconds)}`;

  const count = await redis.incr(windowKey);
  if (count === 1) {
    await redis.expire(windowKey, windowSeconds * 2); // TTL generoso para evitar stuck keys
  }

  return count <= limit;
}

export function getClientIp(req, context) {
  return (
    context?.ip ||
    req.headers.get('x-nf-client-connection-ip') ||
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    'unknown'
  );
}
