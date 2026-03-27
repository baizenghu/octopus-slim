// SLIM STUB: native memory module removed.
// extractKeywords and isQueryStopWordToken are used by compaction-safeguard.

const STOP_WORDS = new Set([
  "a", "an", "the", "this", "that", "these", "those",
  "i", "me", "my", "we", "our", "you", "your", "he", "she", "it", "they", "them",
  "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did",
  "will", "would", "could", "should", "can", "may", "might",
  "in", "on", "at", "to", "for", "of", "with", "by", "from", "about",
  "and", "or", "but", "if", "then", "because", "as", "while",
  "when", "where", "what", "which", "who", "how", "why",
  "yesterday", "today", "tomorrow", "earlier", "later", "recently",
  "before", "ago", "just", "now",
  "thing", "things", "stuff", "something", "anything", "everything", "nothing",
  "please", "help", "find", "show", "get", "tell", "give",
]);

export function isQueryStopWordToken(token: string): boolean {
  return STOP_WORDS.has(token.toLowerCase());
}

export function extractKeywords(query: string): string[] {
  const tokens = query
    .toLowerCase()
    .trim()
    .split(/[\s\p{P}]+/u)
    .filter(Boolean);
  const keywords: string[] = [];
  const seen = new Set<string>();
  for (const token of tokens) {
    if (STOP_WORDS.has(token) || seen.has(token) || token.length < 2) {
      continue;
    }
    seen.add(token);
    keywords.push(token);
  }
  return keywords;
}
