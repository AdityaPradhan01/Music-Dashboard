// Comment sentiment classification: Positive / Neutral / Negative, via a
// small bundled lexicon (no external sentiment-data download required).
import { cleanText } from "./preprocessing.js";

const POSITIVE_WORDS = new Set([
  "love", "amazing", "incredible", "beautiful", "best", "great", "awesome", "perfect", "masterpiece",
  "favorite", "favourite", "legendary", "iconic", "fire", "banger", "goat", "smooth", "catchy",
  "emotional", "chills", "unforgettable", "unmatched", "flawless", "brilliant", "stunning",
  "good", "nice", "wonderful", "fun", "empowering", "relatable", "clever", "creative", "top",
  "satisfying", "deserved", "impressive", "energy",
]);
const NEGATIVE_WORDS = new Set([
  "bad", "boring", "annoying", "overrated", "overplayed", "repetitive", "tired", "weird", "dated",
  "hate", "worst", "meh", "mediocre", "disappointing", "generic", "thin", "simple", "confusing",
  "toxic", "sad", "cringe", "flop", "lazy", "awful", "terrible",
]);
const NEGATIONS = new Set(["not", "no", "never", "dont", "didnt", "cant", "wont", "isnt"]);
const NEGATION_PASSTHROUGH = new Set(["a", "the", "is", "so", "very", "kind", "of"]);

function lexiconScore(text) {
  const tokens = cleanText(text).split(" ").filter(Boolean);
  let score = 0;
  let negate = false;
  for (const tok of tokens) {
    if (NEGATIONS.has(tok)) {
      negate = true;
      continue;
    }
    let weight = 0;
    if (POSITIVE_WORDS.has(tok)) weight = 1;
    else if (NEGATIVE_WORDS.has(tok)) weight = -1;
    if (weight && negate) weight *= -1;
    score += weight;
    if (!NEGATION_PASSTHROUGH.has(tok)) negate = false;
  }
  const maxPossible = Math.max(1, tokens.length / 3);
  return Math.max(-1.0, Math.min(1.0, score / maxPossible));
}

/** Returns [label, score] where score is in [-1, 1]. */
export function analyze(text) {
  const compound = lexiconScore(text);
  let label;
  if (compound >= 0.15) label = "positive";
  else if (compound <= -0.15) label = "negative";
  else label = "neutral";
  return [label, Math.round(compound * 1000) / 1000];
}

export function analyzeBatch(texts) {
  return texts.map((t) => analyze(t));
}

export function sentimentDistribution(texts) {
  const results = analyzeBatch(texts);
  const counts = { positive: 0, neutral: 0, negative: 0 };
  for (const [label] of results) counts[label] += 1;
  const total = results.length || 1;
  return {
    total: results.length,
    positive: counts.positive,
    neutral: counts.neutral,
    negative: counts.negative,
    positive_pct: Math.round((counts.positive / total) * 1000) / 10,
    neutral_pct: Math.round((counts.neutral / total) * 1000) / 10,
    negative_pct: Math.round((counts.negative / total) * 1000) / 10,
  };
}
