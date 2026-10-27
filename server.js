// Music Intelligence Dashboard — Express application entry point.
import path from "node:path";
import { fileURLToPath } from "node:url";

import "dotenv/config";
import express from "express";

import * as db from "./database/db.js";
import * as dataStore from "./services/dataStore.js";
import { SpotifyServiceError } from "./services/spotifyService.js";
import { YouTubeServiceError } from "./services/youtubeService.js";
import * as analytics from "./services/analyticsService.js";
import * as kw from "./nlp/keywords.js";
import * as tp from "./nlp/topics.js";
import * as sent from "./nlp/sentiment.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Example search terms shown as chips on the hero/search UI — not analytics
// data, just prompts. Clicking one runs a real Live Mode lookup.
const SUGGESTED_ARTISTS = ["The Weeknd", "Taylor Swift", "Drake", "Billie Eilish", "Dua Lipa"];

const app = express();
app.set("json spaces", 0);

await db.checkConnection();

// ---------------------------------------------------------------- helpers --

function errorResponse(res, message, status = 400) {
  return res.status(status).json({ error: message });
}

function cleanParam(value, maxLen = 120) {
  if (value === undefined || value === null) return "";
  return String(value).trim().slice(0, maxLen);
}

/** Strips any internal bookkeeping fields (leading underscore) before serializing. */
function publicTrack(track) {
  const out = {};
  for (const [k, v] of Object.entries(track)) {
    if (!k.startsWith("_")) out[k] = v;
  }
  return out;
}

/**
 * Computes Trend Score for the given tracks, normalized against the full
 * known catalog (every live track fetched so far this session) rather than
 * just the given subset — scoring a track against only itself, or a handful
 * of others, isn't meaningful and would give the same track a different
 * score depending which page it's viewed from.
 *
 * Returns [rowsForTheseTracksSortedByScore, {track_id: row}].
 */
function trendScoresFor(tracks) {
  const corpus = dataStore.allTracksForTrends();
  const corpusIds = new Set(corpus.map((c) => c.id));
  const merged = corpus.concat(tracks.filter((t) => !corpusIds.has(t.id)));
  const trendById = new Map(analytics.computeTrendScores(merged).map((r) => [r.track_id, r]));
  const wantedIds = tracks.map((t) => t.id);
  const rows = wantedIds.filter((id) => trendById.has(id)).map((id) => trendById.get(id));
  rows.sort((a, b) => b.trend_score - a.trend_score);
  return [rows, trendById];
}

/** Returns [allTexts, perTrackTexts] for every track in an artist bundle. */
async function gatherArtistComments(bundle) {
  const allTexts = [];
  const perTrack = {};
  for (const track of bundle.tracks) {
    const texts = await dataStore.getTrackComments(track);
    perTrack[track.id] = texts;
    allTexts.push(...texts);
  }
  return [allTexts, perTrack];
}

async function requireArtistBundle(res, artistNameRaw) {
  const artistName = cleanParam(artistNameRaw);
  if (!artistName) {
    errorResponse(res, "Artist name is required.", 400);
    return null;
  }
  try {
    return await dataStore.getArtistBundle(artistName);
  } catch (exc) {
    if (!(exc instanceof SpotifyServiceError) && !(exc instanceof YouTubeServiceError)) throw exc;
    const notConfigured = exc.message.startsWith("Live Mode is not configured");
    errorResponse(res, notConfigured ? exc.message : `No Spotify artist found for '${artistName}'. Check the spelling and try again.`, notConfigured ? 503 : 404);
    return null;
  }
}

function asyncRoute(handler) {
  return (req, res, next) => handler(req, res, next).catch(next);
}

// --------------------------------------------------------------- frontend --

app.use("/static", express.static(path.join(__dirname, "static")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "templates", "index.html"));
});

// -------------------------------------------------------------- API core --

app.get(
  "/api/status",
  asyncRoute(async (req, res) => {
    const status = dataStore.sourceStatus();
    status.db_connected = db.DB_AVAILABLE;
    status.timestamp = new Date().toISOString();
    status.suggested_artists = SUGGESTED_ARTISTS;
    res.json(status);
  })
);

app.get(
  "/api/search",
  asyncRoute(async (req, res) => {
    const query = cleanParam(req.query.q || "");
    if (!query) {
      res.json({ artists: [], tracks: [] });
      return;
    }
    let results;
    try {
      results = await dataStore.searchCatalog(query);
    } catch (exc) {
      if (exc instanceof SpotifyServiceError && exc.message.startsWith("Live Mode is not configured")) {
        errorResponse(res, exc.message, 503);
        return;
      }
      console.error("Search failed", exc);
      errorResponse(res, "Search is temporarily unavailable.", 502);
      return;
    }
    res.json(results);
  })
);

app.get(
  "/api/artist/:artist",
  asyncRoute(async (req, res) => {
    const bundle = await requireArtistBundle(res, req.params.artist);
    if (!bundle) return;

    const tracks = bundle.tracks;
    const [trendRows] = trendScoresFor(tracks);

    const totalViews = tracks.reduce((s, t) => s + (t.views || 0), 0);
    const totalComments = tracks.reduce((s, t) => s + (t.comment_count || 0), 0);
    const avgEngagement = tracks.length
      ? Math.round(
          (tracks.reduce((s, t) => s + analytics.engagementRate(t.likes || 0, t.comment_count || 0, t.views || 0), 0) /
            tracks.length) *
            10000
        ) / 10000
      : 0;

    res.json({
      mode: bundle.mode,
      artist: bundle.artist,
      spotify_catalog: bundle.spotify_catalog,
      youtube_channel: bundle.youtube_channel,
      youtube_quota_exceeded: Boolean(bundle.youtube_quota_exceeded),
      tracks: tracks.map(publicTrack),
      kpis: {
        tracks_analyzed: tracks.length,
        youtube_views: totalViews,
        youtube_comments: totalComments,
        avg_engagement_rate: avgEngagement,
        top_trend_score: trendRows.length ? trendRows[0].trend_score : 0,
      },
      trend: trendRows,
    });
  })
);

app.get(
  "/api/track/:track",
  asyncRoute(async (req, res) => {
    const artistQuery = cleanParam(req.query.artist || "");
    const trackQuery = cleanParam(req.params.track);
    let result, bundle;
    try {
      [result, bundle] = await dataStore.findTrack(trackQuery, artistQuery || null);
    } catch (exc) {
      if (!(exc instanceof SpotifyServiceError) && !(exc instanceof YouTubeServiceError)) throw exc;
      errorResponse(res, exc.message, exc.message.startsWith("Live Mode is not configured") ? 503 : 404);
      return;
    }
    if (!result) {
      errorResponse(res, `Track '${trackQuery}' not found.`, 404);
      return;
    }

    const comments = await dataStore.getTrackComments(result);
    const sentimentDist = comments.length ? sent.sentimentDistribution(comments) : null;
    const keywordReport = comments.length ? kw.combinedKeywordReport(comments, 12) : [];
    const topicReport = comments.length >= 6 ? tp.discoverTopics(comments, 3) : [];
    const metrics = analytics.computeTrackMetrics(result);
    const [, trendById] = trendScoresFor([result]);
    const trend = trendById.get(result.id) || null;

    res.json({
      mode: bundle ? bundle.mode : "live",
      track: publicTrack(result),
      metrics,
      trend,
      sentiment: sentimentDist,
      keywords: keywordReport,
      topics: topicReport,
    });
  })
);

app.get(
  "/api/youtube/:videoId",
  asyncRoute(async (req, res) => {
    const videoId = cleanParam(req.params.videoId, 32);
    const tracks = dataStore.allTracksForTrends();
    const match = tracks.find((t) => t.video_id === videoId);
    if (!match) {
      errorResponse(res, "YouTube video not found.", 404);
      return;
    }
    res.json({
      video: match,
      engagement_rate: analytics.engagementRate(match.likes || 0, match.comment_count || 0, match.views || 0),
    });
  })
);

app.get(
  "/api/comments/:videoId",
  asyncRoute(async (req, res) => {
    const videoId = cleanParam(req.params.videoId, 32);
    const sentimentFilter = cleanParam(req.query.sentiment || "", 16).toLowerCase();
    const searchQ = cleanParam(req.query.q || "", 120).toLowerCase();

    let page = parseInt(req.query.page ?? "1", 10);
    let pageSize = parseInt(req.query.page_size ?? "10", 10);
    if (Number.isNaN(page) || Number.isNaN(pageSize)) {
      errorResponse(res, "Invalid pagination parameters.", 400);
      return;
    }
    page = Math.max(1, page);
    pageSize = Math.min(50, Math.max(1, pageSize));

    const tracks = dataStore.allTracksForTrends();
    const match = tracks.find((t) => t.video_id === videoId);
    if (!match) {
      errorResponse(res, "No comments found for this video.", 404);
      return;
    }

    const rawComments = await dataStore.getTrackCommentsFull(match);
    let enriched = rawComments.map((c) => {
      const [label, score] = sent.analyze(c.text);
      const confidence = Math.min(99.0, Math.round((55 + Math.abs(score) * 44) * 10) / 10);
      return { text: c.text, published_at: c.published_at, sentiment: label, confidence };
    });

    if (["positive", "neutral", "negative"].includes(sentimentFilter)) {
      enriched = enriched.filter((c) => c.sentiment === sentimentFilter);
    }
    if (searchQ) {
      enriched = enriched.filter((c) => c.text.toLowerCase().includes(searchQ));
    }

    const total = enriched.length;
    const start = (page - 1) * pageSize;
    const pageItems = enriched.slice(start, start + pageSize);

    const dist = rawComments.length ? sent.sentimentDistribution(rawComments.map((c) => c.text)) : null;

    res.json({
      video_id: videoId,
      total,
      page,
      page_size: pageSize,
      comments: pageItems,
      sentiment_summary: dist,
    });
  })
);

app.get(
  "/api/keywords/:artist",
  asyncRoute(async (req, res) => {
    const bundle = await requireArtistBundle(res, req.params.artist);
    if (!bundle) return;

    const mode = cleanParam(req.query.mode || "frequency");
    const nRaw = req.query.n ?? "2";
    const n = Math.max(1, Math.min(3, /^\d+$/.test(String(nRaw)) ? parseInt(nRaw, 10) : 2));

    const [allTexts] = await gatherArtistComments(bundle);
    if (!allTexts.length) {
      res.json({ keywords: [], mode });
      return;
    }

    let result;
    if (mode === "tfidf") result = kw.tfidfKeywords(allTexts, 15);
    else if (mode === "ngram") result = kw.ngrams(allTexts, n, 15);
    else result = kw.wordFrequency(allTexts, 15);

    res.json({ keywords: result, mode });
  })
);

app.get(
  "/api/topics/:artist",
  asyncRoute(async (req, res) => {
    const bundle = await requireArtistBundle(res, req.params.artist);
    if (!bundle) return;

    const method = cleanParam(req.query.method || "lda");
    let k = parseInt(req.query.k ?? "4", 10);
    if (Number.isNaN(k)) k = 4;
    k = Math.max(2, Math.min(8, k));

    const [allTexts] = await gatherArtistComments(bundle);
    let topics = allTexts.length ? tp.discoverTopics(allTexts, k, method) : [];
    topics = tp.topicDistributionPct(topics);
    res.json({ topics, method, comment_count: allTexts.length });
  })
);

app.get(
  "/api/sentiment/:artist",
  asyncRoute(async (req, res) => {
    const bundle = await requireArtistBundle(res, req.params.artist);
    if (!bundle) return;

    const [allTexts, perTrack] = await gatherArtistComments(bundle);
    if (!allTexts.length) {
      res.json({ summary: null, by_track: [] });
      return;
    }

    const summary = sent.sentimentDistribution(allTexts);
    const byTrack = [];
    for (const track of bundle.tracks) {
      const texts = perTrack[track.id] || [];
      if (texts.length) {
        byTrack.push({ track_name: track.name, ...sent.sentimentDistribution(texts) });
      }
    }
    res.json({ summary, by_track: byTrack });
  })
);

app.get(
  "/api/trends",
  asyncRoute(async (req, res) => {
    const artistFilter = cleanParam(req.query.artist || "");
    let trendRows;
    if (artistFilter) {
      const bundle = await requireArtistBundle(res, artistFilter);
      if (!bundle) return;
      [trendRows] = trendScoresFor(bundle.tracks);
      trendRows.sort((a, b) => b.trend_score - a.trend_score);
    } else {
      trendRows = analytics.computeTrendScores(dataStore.allTracksForTrends());
    }
    res.json({
      trends: trendRows,
      scope: artistFilter ? "artist" : "all",
      spotify_weighted: analytics.spotifyPopularityAvailable(trendRows.map((r) => ({ popularity: r.spotify_popularity }))),
    });
  })
);

app.get(
  "/api/compare",
  asyncRoute(async (req, res) => {
    const a = cleanParam(req.query.a || "");
    const b = cleanParam(req.query.b || "");
    if (!a || !b) {
      errorResponse(res, "Two artists ('a' and 'b') are required.", 400);
      return;
    }

    const bundleA = await requireArtistBundle(res, a);
    if (!bundleA) return;
    const bundleB = await requireArtistBundle(res, b);
    if (!bundleB) return;

    async function summarize(bundle) {
      const tracks = bundle.tracks;
      const [texts] = await gatherArtistComments(bundle);
      const dist = texts.length
        ? sent.sentimentDistribution(texts)
        : { positive_pct: 0, negative_pct: 0, neutral_pct: 0, total: 0 };
      const [trendRows] = trendScoresFor(tracks);
      return {
        name: bundle.artist.name,
        image_url: bundle.artist.image_url,
        spotify_total_releases: bundle.spotify_catalog ? bundle.spotify_catalog.total_releases : null,
        youtube_subscribers: bundle.youtube_channel ? bundle.youtube_channel.subscriber_count : null,
        track_count: tracks.length,
        youtube_views: tracks.reduce((s, t) => s + (t.views || 0), 0),
        avg_engagement_rate:
          Math.round(
            (tracks.reduce((s, t) => s + analytics.engagementRate(t.likes || 0, t.comment_count || 0, t.views || 0), 0) /
              (tracks.length || 1)) *
              10000
          ) / 10000,
        comment_volume: tracks.reduce((s, t) => s + (t.comment_count || 0), 0),
        positive_sentiment_pct: dist.positive_pct,
        negative_sentiment_pct: dist.negative_pct,
        trend_score: trendRows.length ? trendRows[0].trend_score : 0,
      };
    }

    const [summaryA, summaryB] = await Promise.all([summarize(bundleA), summarize(bundleB)]);
    const metrics = [
      "spotify_total_releases",
      "youtube_subscribers",
      "youtube_views",
      "avg_engagement_rate",
      "comment_volume",
      "positive_sentiment_pct",
      "trend_score",
    ];
    const winners = {};
    for (const m of metrics) winners[m] = summaryA[m] >= summaryB[m] ? "a" : "b";

    res.json({ artist_a: summaryA, artist_b: summaryB, winners });
  })
);

app.get(
  "/api/compare/tracks",
  asyncRoute(async (req, res) => {
    const trackA = cleanParam(req.query.a || "");
    const trackB = cleanParam(req.query.b || "");
    const artistA = cleanParam(req.query.artist_a || "");
    const artistB = cleanParam(req.query.artist_b || "");
    if (!trackA || !trackB) {
      errorResponse(res, "Two tracks ('a' and 'b') are required.", 400);
      return;
    }

    let tA, tB;
    try {
      [tA] = await dataStore.findTrack(trackA, artistA || null);
      [tB] = await dataStore.findTrack(trackB, artistB || null);
    } catch (exc) {
      if (!(exc instanceof SpotifyServiceError) && !(exc instanceof YouTubeServiceError)) throw exc;
      errorResponse(res, exc.message, exc.message.startsWith("Live Mode is not configured") ? 503 : 404);
      return;
    }
    if (!tA || !tB) {
      errorResponse(res, "One or both tracks could not be found.", 404);
      return;
    }

    const [, trendById] = trendScoresFor([tA, tB]);

    async function summarize(track) {
      const comments = await dataStore.getTrackComments(track);
      const dist = comments.length ? sent.sentimentDistribution(comments) : null;
      const trend = trendById.get(track.id) || null;
      return {
        name: track.name,
        artist_name: track.artist_name,
        duration_sec: Math.round((track.duration_ms || 0) / 1000),
        youtube_views: track.views || 0,
        youtube_likes: track.likes || 0,
        youtube_comments: track.comment_count || 0,
        engagement_rate: analytics.engagementRate(track.likes || 0, track.comment_count || 0, track.views || 0),
        sentiment: dist,
        trend_score: trend ? trend.trend_score : 0,
      };
    }

    const [summaryA, summaryB] = await Promise.all([summarize(tA), summarize(tB)]);
    res.json({ track_a: summaryA, track_b: summaryB });
  })
);

app.get(
  "/api/network/:artist",
  asyncRoute(async (req, res) => {
    const bundle = await requireArtistBundle(res, req.params.artist);
    if (!bundle) return;
    const [allTexts] = await gatherArtistComments(bundle);
    if (!allTexts.length) {
      res.json({ nodes: [], edges: [] });
      return;
    }
    res.json(kw.keywordCooccurrenceNetwork(allTexts));
  })
);

/**
 * Spotify vs YouTube comparison — one point per artist visited this session.
 *
 * Spotify "popularity" isn't available at this app's access tier (the field
 * is absent from every response, not just defaulted to 0), so the X-axis
 * can't be built on it. Instead this compares two things that ARE real and
 * fetched: Spotify catalog activity (total releases, release cadence) vs
 * YouTube audience size (channel subscribers/views/videos) — a genuine
 * cross-platform question ("do artists who release more on Spotify have
 * bigger YouTube followings?") backed entirely by live data on both sides.
 */
app.get(
  "/api/spotify-youtube",
  asyncRoute(async (req, res) => {
    const bundles = dataStore.allArtistBundles();

    const points = bundles
      .filter((b) => b.spotify_catalog && b.youtube_channel)
      .map((b) => {
        const totalViews = b.tracks.reduce((s, t) => s + (t.views || 0), 0);
        const totalComments = b.tracks.reduce((s, t) => s + (t.comment_count || 0), 0);
        const totalLikes = b.tracks.reduce((s, t) => s + (t.likes || 0), 0);
        return {
          artist: b.artist.name,
          spotify_total_releases: b.spotify_catalog.total_releases,
          spotify_avg_release_gap_days: b.spotify_catalog.avg_release_gap_days,
          youtube_subscribers: b.youtube_channel.subscriber_count,
          youtube_channel_views: b.youtube_channel.channel_views,
          youtube_channel_videos: b.youtube_channel.channel_video_count,
          youtube_track_views: totalViews,
          youtube_track_likes: totalLikes,
          youtube_track_comments: totalComments,
          engagement_rate: analytics.engagementRate(totalLikes, totalComments, totalViews),
        };
      });

    const xMetric = cleanParam(req.query.x || "spotify_total_releases");
    const yMetric = cleanParam(req.query.y || "youtube_subscribers");
    const xs = points.map((p) => p[xMetric]).filter((v) => v !== null && v !== undefined);
    const ys = points.map((p) => p[yMetric]).filter((v) => v !== null && v !== undefined);
    const correlation =
      xs.length === points.length && ys.length === points.length
        ? analytics.correlationAnalysis(xs, ys)
        : { pearson: null, spearman: null, n: points.length };

    res.json({ points, correlation, x_metric: xMetric, y_metric: yMetric });
  })
);

app.use((req, res) => {
  if (req.path.startsWith("/api/")) {
    errorResponse(res, "Resource not found.", 404);
    return;
  }
  res.sendFile(path.join(__dirname, "templates", "index.html"));
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error("Unhandled server error", err);
  errorResponse(res, "An unexpected error occurred. Please try again.", 500);
});

const PORT = parseInt(process.env.PORT || "5000", 10);
app.listen(PORT, "127.0.0.1", () => {
  console.log(`Music Intelligence Dashboard running at http://127.0.0.1:${PORT}`);
});
