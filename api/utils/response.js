// Response.json() não está disponível em todas as versões do Node.js
export function json(data, init = {}) {
  const { headers = {}, ...rest } = init;
  return new Response(JSON.stringify(data), {
    ...rest,
    headers: { 'Content-Type': 'application/json', ...headers }
  });
}
