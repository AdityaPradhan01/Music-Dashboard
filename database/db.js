// MySQL persistence layer.
//
// The dashboard runs fully in-memory even when no MySQL server is reachable.
// If a connection cannot be established this
// module flips DB_AVAILABLE to false and every write becomes a harmless
// no-op, so the rest of the app never needs to branch on database
// availability.
import mysql from "mysql2/promise";

export let DB_AVAILABLE = false;

const config = {
  host: process.env.DB_HOST || "localhost",
  port: parseInt(process.env.DB_PORT || "3306", 10),
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "music_intelligence",
  connectTimeout: 3000,
};

async function getConnection() {
  return mysql.createConnection(config);
}

export async function checkConnection() {
  try {
    const conn = await getConnection();
    await conn.end();
    DB_AVAILABLE = true;
  } catch (exc) {
    console.log(`MySQL not available, running in-memory only: ${exc.message}`);
    DB_AVAILABLE = false;
  }
  return DB_AVAILABLE;
}

/** Runs a parameterized query. fetch: null | 'one' | 'all'. Silently skips if DB is down. */
export async function execute(query, params = [], fetch = null) {
  if (!DB_AVAILABLE) return null;
  let conn;
  try {
    conn = await getConnection();
    const [rows] = await conn.execute(query, params);
    if (fetch === "one") return Array.isArray(rows) ? rows[0] ?? null : null;
    if (fetch === "all") return rows;
    if (query.trim().toUpperCase().startsWith("INSERT")) return rows.insertId;
    return null;
  } catch (exc) {
    console.warn(`Database query failed, continuing without persistence: ${exc.message}`);
    return null;
  } finally {
    if (conn) await conn.end();
  }
}

export async function upsertArtist(artist) {
  if (!DB_AVAILABLE) return null;
  return execute(
    `INSERT INTO artists (spotify_artist_id, name, popularity, genres, image_url)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       name=VALUES(name), popularity=VALUES(popularity),
       genres=VALUES(genres), image_url=VALUES(image_url)`,
    [
      artist.spotify_artist_id,
      artist.name,
      artist.popularity || 0,
      (artist.genres || []).join(","),
      artist.image_url,
    ]
  );
}

export async function saveTrendResult(artistRowId, trackRowId, result) {
  if (!DB_AVAILABLE) return null;
  return execute(
    `INSERT INTO trend_results
       (artist_id, track_id, spotify_score, youtube_growth, engagement_score, discussion_growth, trend_score)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      artistRowId,
      trackRowId,
      result.spotify_score || 0,
      result.youtube_growth || 0,
      result.engagement_score || 0,
      result.discussion_growth || 0,
      result.trend_score || 0,
    ]
  );
}
