// Topic discovery over YouTube comments using LDA, NMF, or TF-IDF + K-Means.
// Pure-JS implementations (collapsed-Gibbs LDA, multiplicative-update NMF,
// k-means++ / Lloyd's algorithm) — no native ML dependency required.
import { preprocess } from "./preprocessing.js";
import { countVectorize, tfidfVectorize, argSortDescending } from "./vectorize.js";
import { analyze } from "./sentiment.js";

// Human-friendly labels applied when a discovered topic's top keywords match
// common music-discussion themes. Falls back to "General Discussion" otherwise.
const THEME_HINTS = [
  ["Concert & Live Performance", new Set(["concert", "live", "performance", "crowd", "stage", "tour", "singalong"])],
  ["Lyrics & Emotional Connection", new Set(["lyrics", "emotional", "feel", "relatable", "sad", "cry", "mood", "heartbreak"])],
  ["New Album Discussion", new Set(["album", "single", "release", "track", "record", "drop"])],
  ["Artist Popularity & Voice", new Set(["voice", "amazing", "best", "talent", "star", "legend", "iconic"])],
  ["Production & Sound", new Set(["beat", "production", "bassline", "sound", "mix", "instrumental", "synth"])],
  ["Video & Visuals", new Set(["video", "visual", "choreography", "dance", "concept", "scene"])],
];

function labelTopic(keywords) {
  const kwSet = new Set(keywords);
  let bestLabel = "General Discussion";
  let bestOverlap = 0;
  for (const [label, hints] of THEME_HINTS) {
    let overlap = 0;
    for (const k of kwSet) if (hints.has(k)) overlap += 1;
    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      bestLabel = label;
    }
  }
  return bestLabel;
}

function buildTopicEntry(keywords, memberPositions, validIdx, texts) {
  const originalIndices = memberPositions.map((p) => validIdx[p]);
  const memberTexts = originalIndices.map((i) => texts[i]);
  const sentiments = memberTexts.map((t) => analyze(t)[0]);
  const pos = sentiments.filter((s) => s === "positive").length;
  const total = sentiments.length || 1;
  return {
    topic_name: labelTopic(keywords),
    keywords,
    comment_count: memberTexts.length,
    positive_pct: Math.round((pos / total) * 1000) / 10,
  };
}

function mean(values) {
  return values.reduce((s, v) => s + v, 0) / (values.length || 1);
}

function dot(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

function euclideanSq(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    s += d * d;
  }
  return s;
}

function seededRandom(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

/** k-means++ initialization + Lloyd's algorithm, a few random restarts kept by lowest inertia. */
function kmeans(vectors, k, { restarts = 5, maxIter = 100, seed = 42 } = {}) {
  const rand = seededRandom(seed);
  const n = vectors.length;
  const dim = vectors[0].length;

  function initCentroids() {
    const centroids = [vectors[Math.floor(rand() * n)]];
    while (centroids.length < k) {
      const dists = vectors.map((v) => Math.min(...centroids.map((c) => euclideanSq(v, c))));
      const total = dists.reduce((s, d) => s + d, 0);
      if (total === 0) {
        centroids.push(vectors[Math.floor(rand() * n)]);
        continue;
      }
      let r = rand() * total;
      let idx = 0;
      for (; idx < n; idx++) {
        r -= dists[idx];
        if (r <= 0) break;
      }
      centroids.push(vectors[Math.min(idx, n - 1)]);
    }
    return centroids.map((c) => [...c]);
  }

  function run() {
    let centroids = initCentroids();
    let assignments = new Array(n).fill(0);

    for (let iter = 0; iter < maxIter; iter++) {
      let changed = false;
      for (let i = 0; i < n; i++) {
        let best = 0;
        let bestDist = Infinity;
        for (let c = 0; c < k; c++) {
          const d = euclideanSq(vectors[i], centroids[c]);
          if (d < bestDist) {
            bestDist = d;
            best = c;
          }
        }
        if (assignments[i] !== best) changed = true;
        assignments[i] = best;
      }

      const sums = Array.from({ length: k }, () => new Array(dim).fill(0));
      const counts = new Array(k).fill(0);
      for (let i = 0; i < n; i++) {
        const c = assignments[i];
        counts[c] += 1;
        for (let d = 0; d < dim; d++) sums[c][d] += vectors[i][d];
      }
      for (let c = 0; c < k; c++) {
        if (counts[c] === 0) continue;
        for (let d = 0; d < dim; d++) sums[c][d] /= counts[c];
      }
      centroids = sums.map((row, c) => (counts[c] > 0 ? row : centroids[c]));
      if (!changed) break;
    }

    let inertia = 0;
    for (let i = 0; i < n; i++) inertia += euclideanSq(vectors[i], centroids[assignments[i]]);
    return { centroids, assignments, inertia };
  }

  let best = run();
  for (let r = 1; r < restarts; r++) {
    const candidate = run();
    if (candidate.inertia < best.inertia) best = candidate;
  }
  return best;
}

/** Non-negative matrix factorization via Lee-Seung multiplicative updates. */
function nmf(matrix, k, { maxIter = 200, seed = 42 } = {}) {
  const rand = seededRandom(seed);
  const nDocs = matrix.length;
  const nTerms = matrix[0].length;

  let W = Array.from({ length: nDocs }, () => Array.from({ length: k }, () => rand() + 0.01));
  let H = Array.from({ length: k }, () => Array.from({ length: nTerms }, () => rand() + 0.01));

  const matMul = (A, B, rows, inner, cols) => {
    const out = Array.from({ length: rows }, () => new Array(cols).fill(0));
    for (let i = 0; i < rows; i++) {
      for (let p = 0; p < inner; p++) {
        const a = A[i][p];
        if (a === 0) continue;
        for (let j = 0; j < cols; j++) out[i][j] += a * B[p][j];
      }
    }
    return out;
  };

  for (let iter = 0; iter < maxIter; iter++) {
    // H update: H *= (W^T V) / (W^T W H)
    const WT = W[0].map((_, c) => W.map((row) => row[c])); // k x nDocs
    const WtV = matMul(WT, matrix, k, nDocs, nTerms);
    const WtW = matMul(WT, W, k, nDocs, k);
    const WtWH = matMul(WtW, H, k, k, nTerms);
    for (let a = 0; a < k; a++) {
      for (let j = 0; j < nTerms; j++) {
        H[a][j] *= WtV[a][j] / (WtWH[a][j] + 1e-12);
      }
    }

    // W update: W *= (V H^T) / (W H H^T)
    const HT = H[0].map((_, c) => H.map((row) => row[c])); // nTerms x k
    const VHt = matMul(matrix, HT, nDocs, nTerms, k);
    const HHt = matMul(H, HT, k, nTerms, k);
    const WHHt = matMul(W, HHt, nDocs, k, k);
    for (let i = 0; i < nDocs; i++) {
      for (let a = 0; a < k; a++) {
        W[i][a] *= VHt[i][a] / (WHHt[i][a] + 1e-12);
      }
    }
  }

  return { W, H };
}

/** Collapsed Gibbs sampling LDA. */
function ldaGibbs(tokenizedDocs, vocabSize, k, { iterations = 300, alpha = null, beta = 0.01, seed = 42 } = {}) {
  const rand = seededRandom(seed);
  const a = alpha ?? 50 / k;

  const docTopicCounts = Array.from({ length: tokenizedDocs.length }, () => new Array(k).fill(0));
  const topicTermCounts = Array.from({ length: k }, () => new Array(vocabSize).fill(0));
  const topicTotals = new Array(k).fill(0);
  const assignments = tokenizedDocs.map((doc) => new Array(doc.length).fill(0));

  for (let d = 0; d < tokenizedDocs.length; d++) {
    for (let i = 0; i < tokenizedDocs[d].length; i++) {
      const topic = Math.floor(rand() * k);
      assignments[d][i] = topic;
      const term = tokenizedDocs[d][i];
      docTopicCounts[d][topic] += 1;
      topicTermCounts[topic][term] += 1;
      topicTotals[topic] += 1;
    }
  }

  for (let iter = 0; iter < iterations; iter++) {
    for (let d = 0; d < tokenizedDocs.length; d++) {
      for (let i = 0; i < tokenizedDocs[d].length; i++) {
        const term = tokenizedDocs[d][i];
        const oldTopic = assignments[d][i];
        docTopicCounts[d][oldTopic] -= 1;
        topicTermCounts[oldTopic][term] -= 1;
        topicTotals[oldTopic] -= 1;

        const probs = new Array(k);
        let sum = 0;
        for (let t = 0; t < k; t++) {
          const p =
            ((topicTermCounts[t][term] + beta) / (topicTotals[t] + beta * vocabSize)) *
            (docTopicCounts[d][t] + a);
          probs[t] = p;
          sum += p;
        }
        let r = rand() * sum;
        let newTopic = k - 1;
        for (let t = 0; t < k; t++) {
          r -= probs[t];
          if (r <= 0) {
            newTopic = t;
            break;
          }
        }
        assignments[d][i] = newTopic;
        docTopicCounts[d][newTopic] += 1;
        topicTermCounts[newTopic][term] += 1;
        topicTotals[newTopic] += 1;
      }
    }
  }

  const dominantTopic = docTopicCounts.map((counts) => argSortDescending(counts)[0]);
  return { topicTermCounts, dominantTopic };
}

export function discoverTopics(texts, nTopics = 4, method = "lda") {
  const docs = texts.map((t) => preprocess(t));
  const validIdx = [];
  const docsClean = [];
  docs.forEach((tokens, i) => {
    if (tokens.length > 0) {
      validIdx.push(i);
      docsClean.push(tokens);
    }
  });

  if (docsClean.length < Math.max(3, nTopics)) return [];

  const k = Math.max(2, Math.min(nTopics, Math.floor(docsClean.length / 2), 8));

  if (method === "kmeans") {
    const { vocab, matrix } = tfidfVectorize(docsClean, { maxFeatures: 300, minDf: 1 });
    const { centroids, assignments } = kmeans(matrix, k, { seed: 42 });

    const topics = [];
    for (let c = 0; c < k; c++) {
      const centroid = centroids[c];
      const topIdx = argSortDescending(centroid).slice(0, 8);
      const keywords = topIdx.filter((i) => centroid[i] > 0).map((i) => vocab[i]);
      const memberPositions = assignments.map((a, j) => (a === c ? j : -1)).filter((j) => j >= 0);
      topics.push(buildTopicEntry(keywords, memberPositions, validIdx, texts));
    }
    return topics.sort((a, b) => b.comment_count - a.comment_count);
  }

  if (method === "nmf") {
    const { vocab, matrix } = tfidfVectorize(docsClean, { maxFeatures: 300, minDf: 1 });
    const { W, H } = nmf(matrix, k, { seed: 42 });

    const dominantTopic = W.map((row) => argSortDescending(row)[0]);
    const topics = [];
    for (let t = 0; t < k; t++) {
      const topIdx = argSortDescending(H[t]).slice(0, 8);
      const keywords = topIdx.map((i) => vocab[i]);
      const memberPositions = dominantTopic.map((d, j) => (d === t ? j : -1)).filter((j) => j >= 0);
      topics.push(buildTopicEntry(keywords, memberPositions, validIdx, texts));
    }
    return topics.sort((a, b) => b.comment_count - a.comment_count);
  }

  // lda (default)
  const { vocab } = countVectorize(docsClean, { maxFeatures: 300, minDf: 1 });
  const vocabIndex = new Map(vocab.map((term, i) => [term, i]));
  const tokenizedDocs = docsClean.map((tokens) =>
    tokens.map((tok) => vocabIndex.get(tok)).filter((i) => i !== undefined)
  );
  const { topicTermCounts, dominantTopic } = ldaGibbs(tokenizedDocs, vocab.length, k, { seed: 42 });

  const topics = [];
  for (let t = 0; t < k; t++) {
    const topIdx = argSortDescending(topicTermCounts[t]).slice(0, 8);
    const keywords = topIdx.map((i) => vocab[i]);
    const memberPositions = dominantTopic.map((d, j) => (d === t ? j : -1)).filter((j) => j >= 0);
    topics.push(buildTopicEntry(keywords, memberPositions, validIdx, texts));
  }
  return topics.sort((a, b) => b.comment_count - a.comment_count);
}

export function topicDistributionPct(topics) {
  const total = topics.reduce((s, t) => s + t.comment_count, 0) || 1;
  return topics.map((t) => ({ ...t, percentage: Math.round((t.comment_count / total) * 1000) / 10 }));
}
