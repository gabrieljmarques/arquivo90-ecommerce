// Fetches admin-configured announcement text and rebuilds the scrolling bar.
// Import and call initAnnouncement() on every page that has #ann-inner.

const FALLBACK_TEXT = 'Entrega para todo o Brasil · Algodão 210g · DTF 300dpi';
const CACHE_KEY     = 'a90_ann_text';

function buildBar(text) {
  const annInner = document.getElementById('ann-inner');
  if (!annInner) return;
  const parts   = text.split(/\s*·\s*/).filter(Boolean);
  const items   = parts.flatMap(t => [t, '·']);
  const doubled = [...items, ...items];
  annInner.innerHTML = doubled.map(t => `<span class="ann-item">${t}</span>`).join('');
}

export async function initAnnouncement() {
  // Use cached text from previous visit (no flash) or fallback
  const cached = localStorage.getItem(CACHE_KEY);
  buildBar(cached || FALLBACK_TEXT);

  try {
    const r = await fetch('/api/site-settings');
    if (!r.ok) return;
    const { settings } = await r.json();
    const text = settings?.announcement?.text?.trim();
    if (text) {
      if (text !== (cached || FALLBACK_TEXT)) buildBar(text); // only re-render if changed
      localStorage.setItem(CACHE_KEY, text);
    }
  } catch { /* leave cached/fallback */ }
}
