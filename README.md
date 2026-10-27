# Music Intelligence Dashboard

A Music Web & Social Media Intelligence platform that combines Spotify music
data with YouTube video and audience data to analyze music popularity,
artist performance, audience engagement, comments, sentiment, keywords,
topics, genres, and emerging trends.

**Primary research question:** *Is Spotify popularity correlated with
YouTube audience engagement?* — answered on the Spotify vs YouTube page
using Pearson and Spearman correlation.

## Features

- Live data only — every artist, track and comment comes from the real
  Spotify Web API and YouTube Data API v3 at request time. There is no
  bundled/demo dataset; the app requires API credentials to show anything.
- NLP pipeline over YouTube comments: preprocessing, keyword extraction
  (frequency, TF-IDF, n-grams), topic discovery (LDA / NMF / TF-IDF+K-Means),
  and sentiment classification (positive / neutral / negative).
- Calculated Project Metrics: YouTube Engagement Rate and a custom Music
  Trend Score — clearly labelled as project metrics, not official
  Spotify/YouTube scores.
- 17-page dashboard: overview, artists, tracks, genres, trends, sentiment,
  keywords, topics, comments, artist/track comparison, Spotify vs YouTube
  correlation, event analysis, popularity timeline, audience insights,
  settings and about.
- Optional MySQL persistence — the app runs entirely in-memory if MySQL
  isn't configured or reachable.

## Tech Stack

Node.js, Express, MySQL (optional), HTML/CSS/JavaScript, Chart.js.

The NLP pipeline (preprocessing, TF-IDF, LDA/NMF/K-Means topic discovery,
sentiment scoring) and analytics (correlation, trend scoring) are
implemented in pure JavaScript — no native ML dependency required.

## Setup

```bash
npm install
```

Copy `.env.example` to `.env` and fill in credentials — **required**, the app has no fallback data:

```bash
cp .env.example .env
```

| Variable | Required for |
|---|---|
| `SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET` | **Required.** Spotify data (Client Credentials flow — [developer.spotify.com](https://developer.spotify.com/dashboard)) |
| `YOUTUBE_API_KEY` | **Required.** YouTube data ([console.cloud.google.com](https://console.cloud.google.com/apis/credentials)) |
| `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` | Optional MySQL persistence |

Without these credentials the server still runs, but every artist/track
lookup returns a "Live Mode is not configured" error instead of data.

### Optional: MySQL persistence

```bash
mysql -u root -p < database/schema.sql
```

If the database isn't reachable, the app logs a notice and continues
running with in-memory analytics only — no setup is required to try the
dashboard.

### Run

```bash
npm start
```

Or, for auto-restart on file changes during development:

```bash
npm run dev
```

Open **http://127.0.0.1:5000**.

## Deploying to Vercel

The app ships with `api/index.js` + `vercel.json` so it runs as a Vercel
serverless function with no code changes needed:

1. Import the GitHub repo at [vercel.com/new](https://vercel.com/new).
2. In **Project Settings → Environment Variables**, add `SPOTIFY_CLIENT_ID`,
   `SPOTIFY_CLIENT_SECRET`, `YOUTUBE_API_KEY` (and `DB_*` only if you have a
   publicly reachable MySQL instance — `localhost` won't work on Vercel).
3. Deploy. Framework preset can stay "Other" — no build step is required.

Note: serverless functions are stateless between invocations, so the
in-memory cache in `services/dataStore.js` is less effective there than on
a persistent server — each cold start/region starts with an empty cache.

## Project Structure

```text
music-intelligence-dashboard/
├── server.js                # Express app & API routes (exports `app` for Vercel)
├── api/index.js             # Vercel serverless entry point (re-exports server.js)
├── vercel.json               # Vercel routing + static file bundling config
├── services/
│   ├── spotifyService.js    # Spotify Web API client
│   ├── youtubeService.js    # YouTube Data API v3 client
│   ├── dataStore.js         # Live artist/track lookups, in-memory session cache
│   └── analyticsService.js  # Engagement rate, trend score, correlation, genres, events
├── nlp/
│   ├── preprocessing.js     # Clean, tokenize, stopword removal, lemmatize
│   ├── vectorize.js         # CountVectorizer / TfidfVectorizer equivalents
│   ├── keywords.js          # Frequency, TF-IDF, n-grams, co-occurrence network
│   ├── topics.js            # LDA (Gibbs) / NMF / TF-IDF+K-Means topic discovery
│   └── sentiment.js         # Bundled lexicon sentiment scoring
├── database/
│   ├── db.js                # MySQL connection layer (optional, fails soft)
│   └── schema.sql
├── templates/index.html
└── static/{style.css, app.js}
```

## Notes on Data & Metrics

- YouTube's Data API v3 is used purely as a video/audience-discussion data
  source — it is **not** described as an official "YouTube Music API".
- **Engagement Rate** = `(Likes + Comments) / Views × 100` — a Calculated
  Project Metric.
- **Music Trend Score** = `30% Spotify Popularity + 30% YouTube View Growth
  + 20% YouTube Engagement + 20% Audience Discussion Growth` (each component
  min-max normalized first) — a custom project metric, not an official
  Spotify or YouTube score.
- All API credentials are read from environment variables; none are
  hardcoded. All SQL is parameterized.
