// Minimal CountVectorizer / TfidfVectorizer equivalents (bag-of-words over a
// small in-memory corpus) — just enough numerical machinery for the keyword
// and topic-discovery modules, without a native ML dependency.

/**
 * Builds a vocabulary from tokenized documents, mirroring sklearn's
 * max_features behaviour: when the raw vocabulary is larger than
 * max_features, keep the terms with the highest total corpus frequency.
 */
function buildVocab(docsTokens, { maxFeatures = null, minDf = 1 } = {}) {
  const termFreq = new Map();
  const docFreq = new Map();
  for (const tokens of docsTokens) {
    const seen = new Set();
    for (const tok of tokens) {
      termFreq.set(tok, (termFreq.get(tok) || 0) + 1);
      if (!seen.has(tok)) {
        docFreq.set(tok, (docFreq.get(tok) || 0) + 1);
        seen.add(tok);
      }
    }
  }

  let terms = [...termFreq.keys()].filter((t) => (docFreq.get(t) || 0) >= minDf);
  if (maxFeatures && terms.length > maxFeatures) {
    terms = terms
      .sort((a, b) => termFreq.get(b) - termFreq.get(a) || a.localeCompare(b))
      .slice(0, maxFeatures);
  }
  terms.sort();

  const index = new Map(terms.map((t, i) => [t, i]));
  return { vocab: terms, index, docFreq };
}

/** Returns { vocab, matrix } where matrix is docs x vocab raw term counts. */
export function countVectorize(docsTokens, opts = {}) {
  const { vocab, index, docFreq } = buildVocab(docsTokens, opts);
  const matrix = docsTokens.map((tokens) => {
    const row = new Array(vocab.length).fill(0);
    for (const tok of tokens) {
      const i = index.get(tok);
      if (i !== undefined) row[i] += 1;
    }
    return row;
  });
  return { vocab, matrix, docFreq };
}

/** Returns { vocab, matrix } where matrix is docs x vocab L2-normalized TF-IDF (sklearn-style smooth idf). */
export function tfidfVectorize(docsTokens, opts = {}) {
  const { vocab, matrix, docFreq } = countVectorize(docsTokens, opts);
  const nDocs = docsTokens.length;
  const idf = vocab.map((term) => Math.log((1 + nDocs) / (1 + (docFreq.get(term) || 0))) + 1);

  const tfidfMatrix = matrix.map((row) => {
    const weighted = row.map((count, i) => count * idf[i]);
    const norm = Math.sqrt(weighted.reduce((s, v) => s + v * v, 0)) || 1;
    return weighted.map((v) => v / norm);
  });

  return { vocab, matrix: tfidfMatrix, idf };
}

export function argSortDescending(values) {
  return values
    .map((v, i) => [v, i])
    .sort((a, b) => b[0] - a[0])
    .map(([, i]) => i);
}
