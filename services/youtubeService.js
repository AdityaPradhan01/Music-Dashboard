// YouTube Data API v3 integration.
//
// This is the official video-content and audience-discussion data source for
// this project. It is NOT a "YouTube Music API" — YouTube does not expose one
// publicly; we use the general Data API's search/videos/commentThreads
// resources.

const API_BASE = "https://www.googleapis.com/youtube/v3";

export class YouTubeServiceError extends Error {}

export class YouTubeService {
  constructor() {
    this.apiKey = (process.env.YOUTUBE_API_KEY || "").trim();
  }

  get isConfigured() {
    return Boolean(this.apiKey);
  }

  async _get(path, params) {
    if (!this.isConfigured) {
      throw new YouTubeServiceError("YouTube API key not configured");
    }
    const qs = new URLSearchParams({ ...params, key: this.apiKey }).toString();
    let resp;
    try {
      resp = await fetch(`${API_BASE}${path}?${qs}`, { signal: AbortSignal.timeout(8000) });
    } catch (exc) {
      throw new YouTubeServiceError(`YouTube API request failed: ${exc.message}`);
    }
    if (resp.status === 403 || resp.status === 429) {
      throw new YouTubeServiceError("YouTube API quota exceeded or access forbidden");
    }
    if (!resp.ok) {
      throw new YouTubeServiceError(`YouTube API request failed: HTTP ${resp.status}`);
    }
    return resp.json();
  }

  async searchVideos(query, maxResults = 5) {
    const data = await this._get("/search", {
      part: "snippet",
      q: `${query} official music video`,
      type: "video",
      maxResults,
    });
    const videoIds = (data.items || []).map((item) => item.id.videoId);
    return videoIds.length ? this.getVideoStats(videoIds) : [];
  }

  async getVideoStats(videoIds) {
    const ids = Array.isArray(videoIds) ? videoIds : [videoIds];
    const data = await this._get("/videos", { part: "snippet,statistics", id: ids.join(",") });
    return (data.items || []).map((item) => {
      const snippet = item.snippet;
      const stats = item.statistics || {};
      return {
        video_id: item.id,
        title: snippet.title,
        channel: snippet.channelTitle,
        channel_id: snippet.channelId,
        published_at: (snippet.publishedAt || "").slice(0, 10),
        views: parseInt(stats.viewCount || "0", 10),
        likes: parseInt(stats.likeCount || "0", 10),
        comment_count: parseInt(stats.commentCount || "0", 10),
      };
    });
  }

  /**
   * Real channel-level audience size — subscriber count, channel-wide view
   * count and upload count. Used as the YouTube side of the Spotify-vs-
   * YouTube comparison (audience size vs. Spotify catalog activity), since
   * individual video stats alone don't represent "the artist's YouTube
   * audience" the way a channel's subscriber count does.
   */
  async getChannelStats(channelIds) {
    const ids = [...new Set((Array.isArray(channelIds) ? channelIds : [channelIds]).filter(Boolean))];
    if (!ids.length) return [];
    const data = await this._get("/channels", { part: "statistics", id: ids.join(",") });
    return (data.items || []).map((item) => {
      const stats = item.statistics || {};
      return {
        channel_id: item.id,
        subscriber_count: stats.hiddenSubscriberCount ? null : parseInt(stats.subscriberCount || "0", 10),
        channel_views: parseInt(stats.viewCount || "0", 10),
        channel_video_count: parseInt(stats.videoCount || "0", 10),
      };
    });
  }

  async getComments(videoId, maxResults = 50) {
    let data;
    try {
      data = await this._get("/commentThreads", {
        part: "snippet",
        videoId,
        maxResults: Math.min(maxResults, 100),
        order: "relevance",
        textFormat: "plainText",
      });
    } catch (exc) {
      if (exc instanceof YouTubeServiceError) return [];
      throw exc;
    }
    return (data.items || []).map((item) => {
      const top = item.snippet.topLevelComment.snippet;
      return {
        text: top.textDisplay || "",
        published_at: (top.publishedAt || "").slice(0, 10),
      };
    });
  }
}
