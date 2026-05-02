import { redis } from './redis.js';

export async function rateLimit(key, limit, windowSeconds) {
  const windowKey = `rl:${key}:${Math.floor(Date.now() / 1000 / windowSeconds)}`;

  const count = await redis.incr(windowKey);
  if (count === 1) {
    await redis.expire(windowKey, windowSeconds * 2);
  }

  return count <= limit;
}

export function getClientIp(req) {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    'unknown'
  );
}
