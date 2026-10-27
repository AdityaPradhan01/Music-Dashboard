// Core quantitative analytics: engagement, trend scoring, correlation, genres, events.
//
// All formulas here are explicitly CALCULATED PROJECT METRICS — none of them
// are official Spotify or YouTube metrics.

export function engagementRate(likes, comments, views) {
  if (!views) return 0.0;
  return Math.round(((likes + comments) / views) * 100 * 10000) / 10000;
}

export function normalizeSeries(values) {
  if (values.length === 0) return [];
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  if (hi === lo) return values.map(() => 50.0);
  return values.map((v) => ((v - lo) / (hi - lo)) * 100);
}

function mean(values) {
  return values.reduce((s, v) => s + v, 0) / (values.length || 1);
}

function rank(values) {
  // Average ranks for ties, matching scipy's rankdata default.
  const order = values.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
  const ranks = new Array(values.length);
  let i = 0;
  while (i < order.length) {
    let j = i;
    while (j + 1 < order.length && order[j + 1][0] === order[i][0]) j += 1;
    const avgRank = (i + j) / 2 + 1;
    for (let x = i; x <= j; x++) ranks[order[x][1]] = avgRank;
    i = j + 1;
  }
  return ranks;
}

function pearsonR(x, y) {
  const n = x.length;
  const mx = mean(x);
  const my = mean(y);
  let num = 0;
  let dx2 = 0;
  let dy2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - mx;
    const dy = y[i] - my;
    num += dx * dy;
    dx2 += dx * dx;
    dy2 += dy * dy;
  }
  const denom = Math.sqrt(dx2 * dy2);
  return denom === 0 ? 0 : num / denom;
}

// Two-tailed p-value for a correlation coefficient via Student's t
// approximation, using the standard incomplete-beta-based formula.
function correlationPValue(r, n) {
  if (n <= 2) return 1.0;
  const rClamped = Math.max(-0.999999, Math.min(0.999999, r));
  const t = rClamped * Math.sqrt((n - 2) / (1 - rClamped * rClamped));
  return studentTTwoTailedP(Math.abs(t), n - 2);
}

// Regularized incomplete beta function (continued fraction), used to derive
// the Student's t-distribution CDF for a p-value.
function betacf(x, a, b) {
  const MAXIT = 200;
  const EPS = 3e-9;
  const FPMIN = 1e-30;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= MAXIT; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

function logBeta(a, b) {
  const logGamma = (z) => {
    const g = 7;
    const c = [
      0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
      -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
      1.5056327351493116e-7,
    ];
    if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - logGamma(1 - z);
    z -= 1;
    let x = c[0];
    for (let i = 1; i < g + 2; i++) x += c[i] / (z + i);
    const t = z + g + 0.5;
    return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
  };
  return logGamma(a) + logGamma(b) - logGamma(a + b);
}

function incompleteBeta(x, a, b) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(-logBeta(a, b) + a * Math.log(x) + b * Math.log(1 - x));
  if (x < (a + 1) / (a + b + 2)) {
    return (bt * betacf(x, a, b)) / a;
  }
  return 1 - (bt * betacf(1 - x, b, a)) / b;
}

function studentTTwoTailedP(absT, df) {
  if (!Number.isFinite(absT) || df <= 0) return 1.0;
  const x = df / (df + absT * absT);
  return incompleteBeta(x, df / 2, 0.5);
}

export function correlationAnalysis(x, y) {
  if (x.length < 2 || y.length < 2) {
    return { pearson: null, spearman: null, n: x.length };
  }
  const n = x.length;
  const pearson = pearsonR(x, y);
  const pearsonP = correlationPValue(pearson, n);
  const spearman = pearsonR(rank(x), rank(y));
  const spearmanP = correlationPValue(spearman, n);
  return {
    pearson: Math.round(pearson * 1000) / 1000,
    pearson_p: Math.round(pearsonP * 10000) / 10000,
    spearman: Math.round(spearman * 1000) / 1000,
    spearman_p: Math.round(spearmanP * 10000) / 10000,
    n,
  };
}

// Neither Spotify nor YouTube expose historical trend data over an API, so
// `series` here is always the synthetic estimate built in dataStore.js
// (`syntheticMonthlySeries`), not a real fetched history. growthFromSeries()
// and trendDirection() are therefore display estimates, not real metrics —
// callers must label them as such (see the "(estimated)" UI copy).
function growthFromSeries(series) {
  if (!series || series.length < 2) return 0.0;
  const start = series[0] || 1;
  const end = series[series.length - 1];
  return Math.round(((end - start) / start) * 100 * 100) / 100;
}

export function trendDirection(series) {
  if (!series || series.length < 3) return "Stable";
  const recent = mean(series.slice(-3));
  const prior = series.length > 3 ? mean(series.slice(0, -3)) : series[0];
  if (prior === 0) return "Stable";
  const change = ((recent - prior) / prior) * 100;
  if (change > 8) return "Trending";
  if (change > 2) return "Rising";
  if (change < -5) return "Declining";
  return "Stable";
}

export function computeTrackMetrics(track, commentCountOverride = null) {
  const views = track.views || 0;
  const likes = track.likes || 0;
  const comments = commentCountOverride !== null ? commentCountOverride : track.comment_count || 0;
  return {
    spotify_popularity: track.popularity || 0,
    youtube_views: views,
    youtube_likes: likes,
    youtube_comments: comments,
    engagement_rate: engagementRate(likes, comments, views),
    view_growth_pct: growthFromSeries(track.monthly_popularity || []),
  };
}

/**
 * Custom Music Trend Score (NOT an official Spotify/YouTube score).
 * Trend Score = 30% Spotify Popularity + 30% Estimated View Growth
 *             + 20% YouTube Engagement + 20% Audience Discussion Growth
 * All four components are min-max normalized across the given track set first.
 *
 * "Estimated View Growth" is NOT real view history — neither Spotify nor
 * YouTube expose one over an API, so it's derived from the synthetic series
 * in dataStore.js. Callers must label it as an estimate in the UI, same as
 * trend_direction below.
 *
 * Spotify withholds the popularity field from apps without Extended Quota
 * Mode, so when every track in the set reads 0, that's "no data" rather
 * than "everyone is unpopular" — min-max normalizing an all-zero array
 * would give every track the same flat 50, which doesn't bias any single
 * track's rank but does spend 30% of the score on a constant instead of a
 * real signal. When that happens, redistribute Spotify's weight across
 * the other three components (proportional to their existing 30/20/20 split)
 * instead of silently diluting the score.
 */
export function computeTrendScores(tracks) {
  if (!tracks || tracks.length === 0) return [];

  const spotifyScores = tracks.map((t) => t.popularity || 0);
  const engagementScores = tracks.map((t) =>
    engagementRate(t.likes || 0, t.comment_count || 0, t.views || 0)
  );
  const viewGrowth = tracks.map((t) => growthFromSeries(t.monthly_popularity || []));
  const discussionGrowth = tracks.map((t) => Math.max(t.comment_count || 0, 1));

  const normSpotify = normalizeSeries(spotifyScores);
  const normEngagement = normalizeSeries(engagementScores);
  const normGrowth = normalizeSeries(viewGrowth);
  const normDiscussion = normalizeSeries(discussionGrowth.map((v) => Math.log1p(v)));

  const spotifyAvailable = spotifyScores.some((v) => v > 0);
  const weights = spotifyAvailable
    ? { spotify: 0.3, growth: 0.3, engagement: 0.2, discussion: 0.2 }
    : { spotify: 0, growth: 30 / 70, engagement: 20 / 70, discussion: 20 / 70 };

  const results = tracks.map((track, i) => ({
    track_id: track.id,
    track_name: track.name,
    artist_name: track.artist_name,
    spotify_popularity: track.popularity || 0,
    youtube_views: track.views || 0,
    engagement_rate: Math.round(engagementScores[i] * 10000) / 10000,
    discussion_volume: track.comment_count || 0,
    view_growth_pct: viewGrowth[i],
    trend_score:
      Math.round(
        (weights.spotify * normSpotify[i] +
          weights.growth * normGrowth[i] +
          weights.engagement * normEngagement[i] +
          weights.discussion * normDiscussion[i]) *
          100
      ) / 100,
    trend_direction: trendDirection(track.monthly_popularity || []),
  }));

  results.sort((a, b) => b.trend_score - a.trend_score);
  results.forEach((r, i) => {
    r.rank = i + 1;
  });
  return results;
}

/** Whether any track in the set actually has a Spotify popularity value (see computeTrendScores). */
export function spotifyPopularityAvailable(tracks) {
  return (tracks || []).some((t) => (t.popularity || 0) > 0);
}

