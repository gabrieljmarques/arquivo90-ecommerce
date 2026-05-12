// Fetches admin-configured announcement text and rebuilds the scrolling bar.
// Import and call initAnnouncement() on every page that has #ann-inner.

const FALLBACK_TEXT = 'Entrega para todo o Brasil · Algodão 210g · DTF 300dpi';

function buildBar(text) {
  const annInner = document.getElementById('ann-inner');
  if (!annInner) return;
  const parts  = text.split(/\s*·\s*/).filter(Boolean);
  const items  = parts.flatMap(t => [t, '·']);
  const doubled = [...items, ...items];
  annInner.innerHTML = doubled.map(t => `<span class="ann-item">${t}</span>`).join('');
}

export async function initAnnouncement() {
  // Render fallback immediately so bar is never empty
  buildBar(FALLBACK_TEXT);

  try {
    const r = await fetch('/api/site-settings');
    if (!r.ok) return;
    const { settings } = await r.json();
    const text = settings?.announcement?.text?.trim();
    if (text) buildBar(text);
  } catch { /* leave fallback */ }
}
