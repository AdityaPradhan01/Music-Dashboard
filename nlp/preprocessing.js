// Text preprocessing for YouTube comments: clean -> tokenize -> stopword
// removal -> lemmatize. Pure JS, no external NLP data downloads required.

const URL_RE = /https?:\/\/\S+|www\.\S+/g;
const NON_ALPHA_RE = /[^a-z0-9\s']/g;
const REPEAT_CHAR_RE = /(.)\1{2,}/g;
const WHITESPACE_RE = /\s+/g;

const STOPWORDS = new Set([
  "a", "about", "above", "after", "again", "all", "am", "an", "and", "any", "are", "as", "at",
  "be", "because", "been", "before", "being", "below", "between", "both", "but", "by",
  "can", "could", "did", "do", "does", "doing", "down", "during",
  "each", "few", "for", "from", "further",
  "had", "has", "have", "having", "he", "her", "here", "hers", "herself", "him", "himself", "his", "how",
  "i", "if", "in", "into", "is", "it", "its", "itself",
  "just", "me", "more", "most", "my", "myself",
  "no", "nor", "not", "now",
  "of", "off", "on", "once", "only", "or", "other", "our", "ours", "ourselves", "out", "over", "own",
  "same", "she", "should", "so", "some", "such",
  "than", "that", "the", "their", "theirs", "them", "themselves", "then", "there", "these", "they",
  "this", "those", "through", "to", "too",
  "under", "until", "up",
  "very", "was", "we", "were", "what", "when", "where", "which", "while", "who", "whom", "why", "will", "with",
  "you", "your", "yours", "yourself", "yourselves",
  "im", "youre", "dont", "didnt", "cant", "wasnt", "wont", "ive", "u", "ur", "get", "got",
]);

const LEMMA_SUFFIX_RULES = [
  ["ies", "y"], ["ying", "y"], ["ing", ""], ["edly", ""], ["ed", ""], ["es", ""], ["s", ""],
];

const VOWELS = new Set(["a", "e", "i", "o", "u"]);

export function cleanText(text) {
  let out = String(text).toLowerCase();
  out = out.replace(URL_RE, " ");
  out = out.replace(NON_ALPHA_RE, " ");
  out = out.replace(REPEAT_CHAR_RE, "$1$1");
  out = out.replace(WHITESPACE_RE, " ").trim();
  return out;
}

export function tokenize(text) {
  return text.split(" ").filter(Boolean);
}

function simpleLemmatize(token) {
  let strippedIngOrEd = false;
  for (const [suffix, replacement] of LEMMA_SUFFIX_RULES) {
    if (token.endsWith(suffix) && token.length - suffix.length + replacement.length >= 3) {
      token = token.slice(0, token.length - suffix.length) + replacement;
      strippedIngOrEd = suffix === "ing" || suffix === "ed";
      break;
    }
  }

  if (strippedIngOrEd && token.length >= 3) {
    const last = token[token.length - 1];
    const secondLast = token[token.length - 2];
    const thirdLast = token[token.length - 3];
    if (last === secondLast && !VOWELS.has(last)) {
      // doubled consonant from a dropped suffix, e.g. "runn" -> "run"
      token = token.slice(0, -1);
    } else if (
      !VOWELS.has(last) && last !== "y"
      && VOWELS.has(secondLast) && secondLast !== "e"
      && !VOWELS.has(thirdLast)
    ) {
      // silent-e was dropped before the suffix, e.g. "amaz" -> "amaze"
      token = token + "e";
    }
  }
  return token;
}

export function lemmatize(token) {
  return simpleLemmatize(token);
}

export function getStopwords() {
  return STOPWORDS;
}

export function preprocess(text, minLen = 2) {
  const cleaned = cleanText(text);
  const tokens = tokenize(cleaned);
  const stopwords = getStopwords();
  const result = [];
  for (const tok of tokens) {
    if (tok.length < minLen || stopwords.has(tok) || /^\d+$/.test(tok)) {
      continue;
    }
    const lemma = lemmatize(tok);
    if (stopwords.has(lemma)) {
      continue;
    }
    result.push(lemma);
  }
  return result;
}

export function preprocessToString(text) {
  return preprocess(text).join(" ");
}
