// Live-only data access: fetches real Spotify + YouTube data and caches it
// in memory for the session. There is no bundled/demo dataset — every
// artist, track and comment shown by the app comes from the real APIs.
//
// An "artist bundle" always looks like:
// {
//   artist: {name, genres, popularity, image_url, followers, spotify_artist_id, external_url},
//   tracks: [ {id, name, release_date, duration_ms, popularity,
//              album_name, album_type, track_number, explicit, external_url,
//              video_id, youtube_title, channel, channel_id, views, likes,
//              comment_count, published_at, monthly_popularity, artist_name}, ... ],
//   spotify_catalog: {total_releases, avg_release_gap_days} | null,
//   youtube_channel: {channel_id, channel_name, subscriber_count, channel_views, channel_video_count} | null,
//   youtube_quota_exceeded: boolean (true if any YouTube call hit the daily quota — explains 0s that aren't "no data"),
//   mode: "live"
// }
import { SpotifyService, SpotifyServiceError } from "./spotifyService.js";
import { YouTubeService, YouTubeServiceError } from "./youtubeService.js";

export const spotifyService = new SpotifyService();
export const youtubeService = new YouTubeService();

const liveCache = new Map(); // artist name (lower) -> { bundle, timestamp }
const LIVE_CACHE_TTL_MS = 600 * 1000;

export function isLiveMode() {
  return spotifyService.isConfigured && youtubeService.isConfigured;
}

export function sourceStatus() {
  return {
    spotify_configured: spotifyService.isConfigured,
    youtube_configured: youtubeService.isConfigured,
    mode: isLiveMode() ? "live" : "not_configured",
  };
}

function requireLiveMode() {
  if (!isLiveMode()) {
    throw new SpotifyServiceError(
      "Live Mode is not configured — add SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET and YOUTUBE_API_KEY to your .env file."
    );
  }
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

function hashStr(s) {
  let h = 0;
  const str = String(s);
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h || 1;
}

/**
 * No API exposes historical popularity; approximate a smooth 12-point
 * trailing series ending at the current known value, purely so timeline
 * charts render. Clearly a display estimate, not fetched data.
 *
 * seedKey must be a stable per-track identity (track/video id), not the
 * popularity number itself — popularity is often 0 or missing (Spotify
 * withholds it from apps without Extended Quota Mode), and seeding off a
 * shared constant like that collapses every track's "random" series to
 * the exact same shape, which is what made Timeline/Events look identical
 * across different artists.
 */
function syntheticMonthlySeries(seedKey, currentPopularity) {
  const rand = seededRandom(hashStr(seedKey));
  const series = [];
  let value = Math.max(5, currentPopularity - (5 + Math.floor(rand() * 11)));
  for (let i = 0; i < 11; i++) {
    value += rand() * 5 - 2;
    value = Math.max(1, Math.min(99, value));
    series.push(Math.round(value * 10) / 10);
  }
  series.push(currentPopularity);
  return series;
}

function titleCase(s) {
  return s.replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());
}

/** Average days between consecutive release dates — a real derived metric (not fabricated), used as Spotify's side of the cross-platform comparison. */
function avgReleaseGapDays(dates) {
  const ms = (dates || [])
    .map((d) => new Date(d).getTime())
    .filter((n) => !Number.isNaN(n))
    .sort((a, b) => a - b);
  if (ms.length < 2) return null;
  let totalGap = 0;
  for (let i = 1; i < ms.length; i++) totalGap += ms[i] - ms[i - 1];
  return Math.round(totalGap / (ms.length - 1) / 86400000);
}

/** Most frequent value in a list — used to pick an artist's primary YouTube channel out of their matched videos. */
function mode(values) {
  const counts = new Map();
  let best = null;
  let bestCount = 0;
  for (const v of values) {
    const c = (counts.get(v) || 0) + 1;
    counts.set(v, c);
    if (c > bestCount) {
      best = v;
      bestCount = c;
    }
  }
  return best;
}

/**
 * Real Spotify catalog stats (total releases + release cadence) and real
 * YouTube channel stats (subscribers, channel views/videos) for an artist.
 * This is the data pair the Spotify-vs-YouTube comparison runs on, since
 * Spotify popularity/followers aren't available at this app's access tier.
 */
async function getCrossPlatformStats(artist, tracks) {
  let spotifyCatalog = null;
  if (artist.spotify_artist_id) {
    try {
      const stats = await spotifyService.getArtistCatalogStats(artist.spotify_artist_id);
      spotifyCatalog = {
        total_releases: stats.total_releases,
        avg_release_gap_days: avgReleaseGapDays(stats.sampled_release_dates),
      };
    } catch (exc) {
      if (!(exc instanceof SpotifyServiceError)) throw exc;
    }
  }

  let youtubeChannel = null;
  let youtubeQuotaExceeded = false;
  const channelIds = tracks.map((t) => t.channel_id).filter(Boolean);
  const primaryChannelId = mode(channelIds);
  if (primaryChannelId) {
    try {
      const [stats] = await youtubeService.getChannelStats([primaryChannelId]);
      if (stats) {
        youtubeChannel = {
          channel_id: stats.channel_id,
          channel_name: tracks.find((t) => t.channel_id === primaryChannelId)?.channel || null,
          subscriber_count: stats.subscriber_count,
          channel_views: stats.channel_views,
          channel_video_count: stats.channel_video_count,
        };
      }
    } catch (exc) {
      if (!(exc instanceof YouTubeServiceError)) throw exc;
      if (/quota/i.test(exc.message)) youtubeQuotaExceeded = true;
    }
  }

  return { spotifyCatalog, youtubeChannel, youtubeQuotaExceeded };
}

export async function getLiveBundle(artistQuery, maxTracks = 5) {
  const cacheKey = artistQuery.trim().toLowerCase();
  const cached = liveCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < LIVE_CACHE_TTL_MS) {
    return cached.bundle;
  }

  let artist, topTracks;
  try {
    const matches = await spotifyService.searchArtist(artistQuery, 1);
    if (!matches.length) {
      throw new SpotifyServiceError(`No Spotify artist found for '${artistQuery}'`);
    }
    artist = matches[0];
    try {
      topTracks = (await spotifyService.getArtistTopTracks(artist.spotify_artist_id)).slice(0, maxTracks);
    } catch (topTracksExc) {
      // Many Spotify apps (incl. anything without Extended Quota Mode) get a
      // 403 on this endpoint — retry via search instead of giving up on
      // Spotify data entirely for the whole bundle.
      if (!(topTracksExc instanceof SpotifyServiceError)) throw topTracksExc;
      topTracks = await spotifyService.getArtistTopTracksBySearch(artist.name, maxTracks);
    }
  } catch (exc) {
    // Spotify unavailable (e.g. app's account lacks Premium) — fall back to
    // a YouTube-only bundle so the dashboard still works end to end.
    if (!(exc instanceof SpotifyServiceError)) throw exc;
    const bundle = await getYoutubeOnlyBundle(artistQuery, maxTracks);
    liveCache.set(cacheKey, { bundle, timestamp: Date.now() });
    return bundle;
  }

  const tracks = [];
  let youtubeQuotaExceeded = false;
  for (const t of topTracks) {
    let videoId = null;
    let ytStats = {};
    try {
      const found = await youtubeService.searchVideos(`${artist.name} ${t.name}`, 1);
      if (found.length) {
        ytStats = found[0];
        videoId = ytStats.video_id;
      }
    } catch (exc) {
      if (!(exc instanceof YouTubeServiceError)) throw exc;
      // Don't fail the whole artist bundle over one track's YouTube match,
      // but don't swallow it invisibly either — this is what made a quota
      // outage look like missing/fake data instead of a diagnosable error.
      console.warn(`YouTube lookup failed for "${artist.name} - ${t.name}": ${exc.message}`);
      if (/quota/i.test(exc.message)) youtubeQuotaExceeded = true;
      ytStats = {};
    }

    tracks.push({
      id: t.spotify_track_id,
      spotify_track_id: t.spotify_track_id,
      name: t.name,
      release_date: t.release_date,
      duration_ms: t.duration_ms || 0,
      popularity: t.popularity || 0,
      album_name: t.album_name,
      explicit: t.explicit || false,
      track_number: t.track_number || null,
      album_type: t.album_type || null,
      external_url: t.external_url || null,
      video_id: videoId,
      youtube_data_available: videoId !== null,
      youtube_title: ytStats.title,
      channel: ytStats.channel,
      channel_id: ytStats.channel_id || null,
      views: ytStats.views || 0,
      likes: ytStats.likes || 0,
      comment_count: ytStats.comment_count || 0,
      published_at: ytStats.published_at,
      monthly_popularity: syntheticMonthlySeries(t.spotify_track_id || t.name, t.popularity || 50),
      artist_name: artist.name,
      artist_id: artist.spotify_artist_id,
    });
  }

  const crossStats = await getCrossPlatformStats(artist, tracks);
  const bundle = {
    artist,
    tracks,
    mode: "live",
    spotify_catalog: crossStats.spotifyCatalog,
    youtube_channel: crossStats.youtubeChannel,
    youtube_quota_exceeded: youtubeQuotaExceeded || crossStats.youtubeQuotaExceeded,
  };
  liveCache.set(cacheKey, { bundle, timestamp: Date.now() });
  return bundle;
}

/** Builds an artist bundle from YouTube search results alone — used when Spotify can't be reached. */
async function getYoutubeOnlyBundle(artistQuery, maxTracks) {
  const videos = await youtubeService.searchVideos(artistQuery, maxTracks);
  if (!videos.length) {
    throw new YouTubeServiceError(`No YouTube videos found for '${artistQuery}'`);
  }

  const artist = {
    spotify_artist_id: null,
    name: titleCase(artistQuery.trim()),
    popularity: 0,
    genres: [],
    image_url: null,
    followers: null,
    external_url: null,
  };

  const tracks = videos.map((v) => ({
    id: v.video_id,
    spotify_track_id: null,
    name: v.title,
    release_date: v.published_at,
    duration_ms: 0,
    popularity: 0,
    album_name: null,
    explicit: false,
    track_number: null,
    album_type: null,
    external_url: null,
    video_id: v.video_id,
    youtube_data_available: true,
    youtube_title: v.title,
    channel: v.channel,
    channel_id: v.channel_id || null,
    views: v.views || 0,
    likes: v.likes || 0,
    comment_count: v.comment_count || 0,
    published_at: v.published_at,
    monthly_popularity: syntheticMonthlySeries(v.video_id, 0),
    artist_name: artist.name,
    artist_id: null,
  }));

  const crossStats = await getCrossPlatformStats(artist, tracks);
  return {
    artist,
    tracks,
    mode: "youtube_only",
    spotify_catalog: null,
    youtube_channel: crossStats.youtubeChannel,
    youtube_quota_exceeded: crossStats.youtubeQuotaExceeded,
  };
}

/** Returns real Spotify/YouTube data for an artist. Throws if Live Mode isn't configured or the artist can't be found. */
export async function getArtistBundle(artistQuery) {
  requireLiveMode();
  return getLiveBundle(artistQuery);
}

/** Returns list of raw comment text strings for a track. */
export async function getTrackComments(track) {
  if (!track.video_id) return [];
  const comments = await youtubeService.getComments(track.video_id, 50);
  return comments.map((c) => c.text);
}

export async function getTrackCommentsFull(track) {
  if (!track.video_id) return [];
  return youtubeService.getComments(track.video_id, 50);
}

/** Aggregate track set used for cross-artist pages (trends/genres/network) — whatever has been fetched live this session. */
export function allTracksForTrends() {
  const tracks = [];
  for (const { bundle } of liveCache.values()) {
    tracks.push(...bundle.tracks);
  }
  return tracks;
}

/** Every artist bundle fetched live this session — used for the cross-artist Spotify-vs-YouTube comparison. */
export function allArtistBundles() {
  return Array.from(liveCache.values()).map(({ bundle }) => bundle);
}

export async function searchCatalog(query, limit = 8) {
  const queryTrimmed = query.trim();
  if (!queryTrimmed) return { artists: [], tracks: [] };
  requireLiveMode();

  try {
    const [artistMatches, trackMatches] = await Promise.all([
      spotifyService.searchArtist(queryTrimmed, limit),
      spotifyService.searchTracks(queryTrimmed, limit),
    ]);

    return {
      artists: artistMatches.map((a) => a.name).slice(0, limit),
      tracks: trackMatches
        .map((t) => ({ track: t.name, artist: t.artists?.[0]?.name || "" }))
        .slice(0, limit),
    };
  } catch (exc) {
    // Spotify unavailable — fall back to YouTube so typing any artist still
    // surfaces a usable suggestion instead of just the hardcoded presets.
    if (!(exc instanceof SpotifyServiceError)) throw exc;
    return searchCatalogYoutubeOnly(queryTrimmed, limit);
  }
}

async function searchCatalogYoutubeOnly(query, limit) {
  let videos = [];
  try {
    videos = await youtubeService.searchVideos(query, limit);
  } catch (exc) {
    if (!(exc instanceof YouTubeServiceError)) throw exc;
  }

  const tracks = videos.map((v) => ({
    track: v.title,
    artist: (v.channel || "").replace(/VEVO$/i, "").trim() || titleCase(query),
  }));
  const artists = [titleCase(query), ...new Set(tracks.map((t) => t.artist))];

  return { artists: [...new Set(artists)].slice(0, limit), tracks: tracks.slice(0, limit) };
}

/** Returns [track, artistBundle] for a track name, optionally scoped to an artist. */
export async function findTrack(trackQuery, artistQuery = null) {
  const trackL = trackQuery.trim().toLowerCase();

  for (const { bundle } of liveCache.values()) {
    if (artistQuery && !bundle.artist.name.toLowerCase().includes(artistQuery.trim().toLowerCase())) continue;
    for (const t of bundle.tracks) {
      if (t.name.toLowerCase().includes(trackL)) return [t, bundle];
    }
  }

  requireLiveMode();

  let artistName = artistQuery;
  if (!artistName) {
    const matches = await spotifyService.searchTracks(trackQuery, 1);
    artistName = matches[0]?.artists?.[0]?.name || null;
  }
  if (!artistName) return [null, null];

  try {
    const bundle = await getLiveBundle(artistName);
    for (const t of bundle.tracks) {
      if (t.name.toLowerCase().includes(trackL)) return [t, bundle];
    }
  } catch (exc) {
    if (!(exc instanceof SpotifyServiceError) && !(exc instanceof YouTubeServiceError)) throw exc;
  }

  return [null, null];
}
