export function pickWeightedKey<T extends string>(
  weights: Record<T, number>,
  explorationRate: number
): T {
  const keys = Object.keys(weights) as T[];
  if (Math.random() < explorationRate) {
    return keys[Math.floor(Math.random() * keys.length)];
  }
  const total = keys.reduce((acc, k) => acc + (weights[k] || 0), 0);
  let r = Math.random() * total;
  for (const k of keys) {
    r -= weights[k] || 0;
    if (r <= 0) return k;
  }
  return keys[0];
}

export function pickRandom<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

export function shuffle<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_m, code) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, '&');
}

export function htmlToText(html: string): string {
  return decodeHtmlEntities(
    html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<[^>]+>/g, '')
  )
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
