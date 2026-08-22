export function normalizeMatchText(value = '') {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .replace(/[’']/g, '')
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function compactMatchText(value = '') {
  return normalizeMatchText(value).replace(/\s+/g, '');
}

/**
 * Metadata providers regularly disagree about word boundaries and punctuation:
 * "God Smack" vs "Godsmack", "Sick Man" vs "Sickman", hyphens, apostrophes,
 * accents, etc. Treat those formatting-only differences as near-exact matches
 * without broadly lowering NeedleDrop's normal title thresholds.
 */
export function titleSimilarity(a = '', b = '') {
  const left = normalizeMatchText(a);
  const right = normalizeMatchText(b);
  if (!left || !right) return 0;
  if (left === right) return 1;

  const compactLeft = left.replace(/\s+/g, '');
  const compactRight = right.replace(/\s+/g, '');
  if (compactLeft === compactRight) return 0.99;

  if (left.includes(right) || right.includes(left)) return 0.88;

  // Also tolerate a word-boundary difference combined with a short suffix or
  // prefix, but only when most of the compact title is shared. This keeps the
  // rule useful for metadata formatting while avoiding loose substring matches.
  const shorter = compactLeft.length <= compactRight.length ? compactLeft : compactRight;
  const longer = compactLeft.length > compactRight.length ? compactLeft : compactRight;
  if (shorter.length >= 5 && longer.includes(shorter) && shorter.length / longer.length >= 0.82) return 0.9;

  const l = new Set(left.split(' ').filter(Boolean));
  const r = new Set(right.split(' ').filter(Boolean));
  const intersection = [...l].filter((token) => r.has(token)).length;
  const union = new Set([...l, ...r]).size || 1;
  return intersection / union;
}
