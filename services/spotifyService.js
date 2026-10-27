// Spotify Web API integration (Client Credentials flow).
//
// Read-only, app-level access — no user login required. All calls fail
// by throwing SpotifyServiceError, which callers catch to surface a clear
// error instead of crashing the request.

const TOKEN_URL = "https://accounts.spotify.com/api/token";
const API_BASE = "https://api.spotify.com/v1";

export class SpotifyServiceError extends Error {}

export class SpotifyService {
  constructor() {
    this.clientId = (process.env.SPOTIFY_CLIENT_ID || "").trim();
    this.clientSecret = (process.env.SPOTIFY_CLIENT_SECRET || "").trim();
    this._token = null;
    this._tokenExpiresAt = 0;
  }

  get isConfigured() {
    return Boolean(this.clientId && this.clientSecret);
  }

  async _getToken() {
    if (!this.isConfigured) {
      throw new SpotifyServiceError("Spotify credentials not configured");
    }
    if (this._token && Date.now() / 1000 < this._tokenExpiresAt - 30) {
      return this._token;
    }
    let resp;
    try {
      resp = await fetch(TOKEN_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: "Basic " + Buffer.from(`${this.clientId}:${this.clientSecret}`).toString("base64"),
        },
        body: "grant_type=client_credentials",
        signal: AbortSignal.timeout(8000),
      });
    } catch (exc) {
      throw new SpotifyServiceError(`Could not authenticate with Spotify: ${exc.message}`);
    }
    if (!resp.ok) {
      throw new SpotifyServiceError(`Could not authenticate with Spotify: HTTP ${resp.status}`);
    }
    const payload = await resp.json();
    this._token = payload.access_token;
    this._tokenExpiresAt = Date.now() / 1000 + (payload.expires_in || 3600);
    return this._token;
  }

  async _get(path, params = {}) {
    const token = await this._getToken();
    const qs = new URLSearchParams(params).toString();
    let resp;
    try {
      resp = await fetch(`${API_BASE}${path}${qs ? `?${qs}` : ""}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(8000),
      });
    } catch (exc) {
      throw new SpotifyServiceError(`Spotify API request failed: ${exc.message}`);
    }
    if (resp.status === 429) {
      throw new SpotifyServiceError("Spotify API rate limit reached");
    }
    if (!resp.ok) {
      throw new SpotifyServiceError(`Spotify API request failed: HTTP ${resp.status}`);
    }
    return resp.json();
  }

  async searchArtist(name, limit = 5) {
    const data = await this._get("/search", { q: name, type: "artist", limit });
    const items = data.artists?.items || [];
    return items.map(formatArtist);
  }

  async searchTracks(query, limit = 5) {
    const data = await this._get("/search", { q: query, type: "track", limit });
    return data.tracks?.items || [];
  }

  async getArtist(artistId) {
    return formatArtist(await this._get(`/artists/${artistId}`));
  }

  async getArtistAlbums(artistId, limit = 10) {
    const data = await this._get(`/artists/${artistId}/albums`, { include_groups: "album,single", limit });
    return (data.items || []).map((a) => ({
      id: a.id,
      spotify_album_id: a.id,
      name: a.name,
      release_date: a.release_date,
      image_url: (a.images || [])[0]?.url,
    }));
  }

  /**
   * Real, available catalog metrics — total release count (`total` from the
   * API, not just the sampled page) and the release dates of a recent
   * sample, used to derive release cadence. This stands in for Spotify
   * "popularity", which this app's access tier never receives.
   *
   * Caps limit at 10 — this restricted tier rejects /artists/{id}/albums
   * with "Invalid limit" above that, same restriction as /search (see
   * getArtistTopTracksBySearch above), well under the documented max of 50.
   */
  async getArtistCatalogStats(artistId) {
    const data = await this._get(`/artists/${artistId}/albums`, {
      include_groups: "album,single",
      limit: 10,
    });
    const items = data.items || [];
    const releaseDates = items.map((a) => a.release_date).filter(Boolean).sort();
    return {
      total_releases: typeof data.total === "number" ? data.total : items.length,
      sampled_release_dates: releaseDates,
    };
  }

  async getArtistTopTracks(artistId, market = "US") {
    const data = await this._get(`/artists/${artistId}/top-tracks`, { market });
    return (data.tracks || []).map(formatTrack);
  }

  /**
   * Fallback for artist top tracks. Spotify apps without "Extended Quota
   * Mode" get a 403 Forbidden on GET /artists/{id}/top-tracks — dataStore
   * calls this when that happens, so the dashboard still gets the artist's
   * real catalog instead of falling back to a YouTube-only search guess.
   * Caps limit at 10: this same restricted tier rejects /search with
   * "Invalid limit" above that, well under the documented max of 50.
   */
  async getArtistTopTracksBySearch(artistName, limit = 5) {
    const data = await this._get("/search", { q: `artist:"${artistName}"`, type: "track", limit: 10 });
    const nameLower = artistName.toLowerCase();
    const items = (data.tracks?.items || []).filter((t) =>
      (t.artists || []).some((a) => a.name.toLowerCase() === nameLower)
    );
    const seen = new Set();
    const deduped = [];
    for (const t of items) {
      const key = t.name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(t);
    }
    deduped.sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
    return deduped.slice(0, limit).map(formatTrack);
  }

  async getRelatedArtists(artistId) {
    try {
      const data = await this._get(`/artists/${artistId}/related-artists`);
      return (data.artists || []).slice(0, 5).map(formatArtist);
    } catch (exc) {
      if (exc instanceof SpotifyServiceError) return [];
      throw exc;
    }
  }
}

function formatArtist(a) {
  return {
    spotify_artist_id: a.id,
    name: a.name,
    popularity: a.popularity || 0,
    genres: a.genres || [],
    image_url: (a.images || [])[0]?.url,
    // Apps without Extended Quota Mode never get a `followers` key back at
    // all, so a plain `|| 0` would report a confident, fake zero instead of
    // "not available" — same reasoning as popularity/genres above.
    followers: a.followers?.total ?? null,
    external_url: a.external_urls?.spotify || null,
  };
}

function formatTrack(t) {
  return {
    spotify_track_id: t.id,
    name: t.name,
    album_name: t.album?.name,
    release_date: t.album?.release_date,
    image_url: (t.album?.images || [])[0]?.url,
    duration_ms: t.duration_ms || 0,
    popularity: t.popularity || 0,
    explicit: Boolean(t.explicit),
    track_number: t.track_number || null,
    album_type: t.album?.album_type || null,
    external_url: t.external_urls?.spotify || null,
  };
}
