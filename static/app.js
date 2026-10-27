/* ===================================================================
   Music Intelligence Dashboard — frontend application logic
   Vanilla JS. Visuals are hand-rolled HTML/CSS/SVG (no chart library)
   to match the Modernist/Bauhaus design spec exactly.
   =================================================================== */

const PALETTE = { green: "#1FDB6A", pink: "#FF2E93", ink: "#0B0B0B", ground: "#F4F4EF", panel: "#E6E7E1" };
const CYCLE_BG = ["bg-green", "bg-pink", "bg-ink"];

const PAGES = {
  artists: ["Music analytics", "Artists", "Browse analyzed artists and open their full performance profile."],
  tracks: ["Music analytics", "Tracks", "Every track in the catalog with its Spotify and YouTube figures side by side."],
  trends: ["Music analytics", "Music Trend Intelligence", "30% Spotify Popularity + 30% Estimated Growth + 20% Engagement + 20% Discussion Growth. Growth and Status are modeled estimates, not real historical data.", "Calculated metric"],
  sentiment: ["Audience intelligence", "Audience Sentiment", "Positive, neutral and negative reaction across the selected artist's YouTube comments."],
  keywords: ["Audience intelligence", "Keywords", "Terms the audience repeats most, extracted from YouTube comments."],
  topics: ["Audience intelligence", "Discussion Topics", "Conversation themes found by unsupervised topic modelling of YouTube comments."],
  comments: ["Audience intelligence", "Comments", "Individual YouTube comments with their sentiment label and confidence score."],
  artistcmp: ["Comparisons", "Artist Comparison", "Two artists, measured on the same scale."],
  trackcmp: ["Comparisons", "Track Comparison", "Two tracks from anywhere in the catalog, measured on the same scale."],
  svy: ["Comparisons", "Spotify vs YouTube", "Does Spotify catalog activity line up with YouTube audience size? Spotify popularity isn't available at this app's access tier, so this compares real catalog and audience data instead.", "Calculated metric"],
  insights: ["Analysis", "Audience Insights", "A consolidated view of sentiment, keywords and topics for the selected artist."],
  settings: ["System", "Settings", "Data source, NLP engines and refresh preferences."],
  api: ["System", "API Status", "Connection state of each data source."],
  about: ["System", "About", "What the platform measures and how."],
};

const DEFAULT_ARTISTS = ["The Weeknd", "Taylor Swift", "Drake", "Billie Eilish", "Dua Lipa"];

const state = {
  selectedArtist: null,
  currentView: "dashboard",
  status: null,
  suggestedArtists: [],
  visitedArtists: [],
  cache: {},
  spSort: "newest",
  ytMetric: "views",
  trackSort: "newest",
  trendScope: "artist",
  kwMode: "frequency",
  topicMethod: "lda",
  topicK: 4,
  cmpA: null,
  cmpB: null,
  trackCmpA: 0,
  trackCmpB: 1,
  svyXMetric: "spotify_total_releases",
  svyMetric: "youtube_subscribers",
  autoRefresh: false,
  autoRefreshTimer: null,
};

/* ----------------------------------------------------------------- API -- */
const API = {
  async get(path) {
    let res, data;
    try {
      res = await fetch(path);
      data = await res.json();
    } catch (e) {
      showToast("Network error — the server could not be reached.", "error");
      throw e;
    }
    if (!res.ok) {
      showToast(data.error || "Something went wrong.", "error");
      throw new Error(data.error || "request failed");
    }
    return data;
  },
};

/* --------------------------------------------------------------- utils -- */
function qs(id) { return document.getElementById(id); }
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function fmtNum(n) {
  n = Number(n) || 0;
  if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return String(Math.round(n));
}
function fmtPct(n) { return `${Number(n) >= 0 ? "+" : ""}${Number(n).toFixed(1)}%`; }
// A track with no YouTube match (API quota hit, or genuinely no video found)
// has views/likes/comments left at a default 0 — show that as unavailable
// rather than a real zero, same reasoning as fmtPop above.
function fmtYt(track, value) { return track.youtube_data_available === false ? "N/A" : fmtNum(value); }
function fmtDuration(ms) {
  const totalSec = Math.round((Number(ms) || 0) / 1000);
  const m = Math.floor(totalSec / 60), s = totalSec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
function fmtDate(d) {
  if (!d) return "—";
  try { return new Date(d).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }); }
  catch { return d; }
}
function readR(r) {
  if (r === null || r === undefined || Number.isNaN(r)) return "Not enough data yet";
  const a = Math.abs(r);
  const s = a < 0.1 ? "No meaningful" : a < 0.3 ? "Weak" : a < 0.5 ? "Moderate" : "Strong";
  return s + (a < 0.1 ? " correlation" : r < 0 ? " negative correlation" : " positive correlation");
}
function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}
function showToast(message, type = "error") {
  const stack = qs("toastStack");
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.textContent = message;
  stack.appendChild(el);
  setTimeout(() => el.remove(), 5000);
}
function suggestedOrDefault() {
  return state.suggestedArtists.length ? state.suggestedArtists : DEFAULT_ARTISTS;
}
function wireSegment(id, onChange) {
  const el = qs(id);
  if (!el) return;
  el.querySelectorAll("button").forEach((btn) => {
    btn.onclick = () => {
      el.querySelectorAll("button").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      onChange(btn.dataset.val);
    };
  });
}

/* --------------------------------------------------------- navigation -- */
function switchView(view) {
  document.querySelectorAll(".view").forEach((v) => v.classList.add("hidden"));
  const target = qs(`view-${view}`);
  if (target) target.classList.remove("hidden");
  document.querySelectorAll(".nav-link[data-view]").forEach((l) => l.classList.toggle("active", l.dataset.view === view));

  const header = qs("pageHeader");
  if (view === "dashboard") {
    header.classList.add("hidden");
  } else {
    header.classList.remove("hidden");
    const p = PAGES[view] || ["", "", ""];
    qs("pageHeaderGroup").textContent = p[0];
    qs("pageHeaderTitle").textContent = p[1];
    qs("pageHeaderSub").textContent = p[2] || "";
    const badge = qs("pageHeaderBadge");
    if (p[3]) { badge.textContent = p[3]; badge.classList.remove("hidden"); }
    else { badge.classList.add("hidden"); }
  }

  state.currentView = view;
  qs("sidebar").classList.remove("mobile-open");
  loadView(view);
  window.scrollTo({ top: 0, behavior: "instant" });
}

function loadView(view) {
  const loaders = {
    dashboard: loadDashboard, artists: loadArtistsList, tracks: loadTracksList,
    trends: loadTrends, sentiment: loadSentimentView,
    keywords: () => loadKeywordsView(state.kwMode), topics: loadTopicsView, comments: loadCommentsView,
    artistcmp: loadCompareArtists, trackcmp: loadCompareTracks,
    svy: loadScatterView,
    insights: loadAudienceView, settings: loadSettingsView, api: loadApiStatusView, about: () => {},
  };
  (loaders[view] || (() => {}))();
}

function setSelectedArtist(name) {
  state.selectedArtist = name;
  qs("topbarSelected").textContent = name;
  if (!state.visitedArtists.some((n) => n.toLowerCase() === name.toLowerCase())) {
    state.visitedArtists.push(name);
    populateArtistList([...suggestedOrDefault(), ...state.visitedArtists]);
    // A newly searched artist changes the known-artist pool, so any cached
    // cross-artist track list (Tracks / Track Comparison pages) is stale.
    delete state.cache.allTracksFull;
  }
}

function goDashboardFor(artistName) {
  setSelectedArtist(artistName);
  switchView("dashboard");
}

function renderArtistNotFoundState(container, name, message) {
  const names = suggestedOrDefault();
  container.innerHTML = `
    <div class="empty-state">
      <h2>No data for "${esc(name)}"</h2>
      <p>${esc(message || "No matching Spotify artist was found — check the spelling and try again.")}</p>
      <div class="hero-chips" style="justify-content:center;margin-top:16px;">
        ${names.map((n) => `<button class="chip-select" data-artist="${esc(n)}">${esc(n)}</button>`).join("")}
      </div>
    </div>`;
  container.querySelectorAll("[data-artist]").forEach((c) => c.onclick = () => goDashboardFor(c.dataset.artist));
}

/** Shared guard for every per-artist page: nothing to show until an artist is picked. */
function needsArtistSelection(container) {
  if (state.selectedArtist) return false;
  container.innerHTML = `<div class="empty-state">Select an artist from the Dashboard first.</div>`;
  return true;
}

function renderDashboardWelcomeState(container) {
  const names = suggestedOrDefault();
  container.innerHTML = `
    <div class="empty-state">
      <h2>No artist selected yet</h2>
      <p>Search an artist above (or pick one below) to see live Spotify + YouTube data.</p>
      <div class="hero-chips" style="justify-content:center;margin-top:16px;">
        ${names.map((n) => `<button class="chip-select" data-artist="${esc(n)}">${esc(n)}</button>`).join("")}
      </div>
    </div>`;
  container.querySelectorAll("[data-artist]").forEach((c) => c.onclick = () => goDashboardFor(c.dataset.artist));
}

/* ------------------------------------------------------------- widgets -- */
function renderKpiGrid(container, items) {
  container.innerHTML = items.map((item) => `
    <div class="kpi-card ${item.bgClass || ""}">
      <div class="corner"></div>
      <span class="kpi-label">${esc(item.label)}</span>
      <span class="kpi-value">${esc(item.value)}</span>
      <span class="kpi-delta">${esc(item.delta || "")}</span>
    </div>`).join("");
}

function buildDonutSegs(counts) {
  const total = counts.reduce((s, c) => s + c.value, 0) || 1;
  const C = 2 * Math.PI * 70;
  let cum = 0;
  return counts.map((c) => {
    const len = (c.value / total) * C;
    const seg = { ...c, pct: `${c.value} · ${((c.value / total) * 100).toFixed(1)}%`, dash: `${Math.max(len - 3, 0)} ${C}`, off: -cum };
    cum += len;
    return seg;
  });
}
function renderDonut(container, summary, small = false) {
  if (!summary || !summary.total) { container.innerHTML = `<div class="empty-state">No comment data available yet.</div>`; return; }
  const segs = buildDonutSegs([
    { label: "Positive", color: PALETTE.green, value: summary.positive },
    { label: "Neutral", color: PALETTE.pink, value: summary.neutral },
    { label: "Negative", color: PALETTE.ink, value: summary.negative },
  ]);
  container.innerHTML = `
    <div class="donut-wrap${small ? " small" : ""}">
      <svg viewBox="0 0 200 200">
        ${segs.map((s) => `<circle cx="100" cy="100" r="70" fill="none" style="stroke:${s.color};stroke-width:34;stroke-dasharray:${s.dash};stroke-dashoffset:${s.off}"></circle>`).join("")}
      </svg>
      <div class="donut-center"><span class="num">${summary.total}</span><span>comments</span></div>
    </div>
    <div class="donut-legend">
      ${segs.map((s) => `<div class="donut-legend-row"><span class="swatch" style="background:${s.color}"></span><span class="lbl">${esc(s.label)}</span><span>${s.pct}</span></div>`).join("")}
    </div>`;
}

function renderTopicCards(container, topics, small = false) {
  if (!topics || !topics.length) { container.innerHTML = `<div class="empty-state">Not enough comment data to discover topics yet.</div>`; return; }
  const bgs = [PALETTE.green, PALETTE.panel, PALETTE.ink, PALETTE.pink];
  container.classList.toggle("small", small);
  container.innerHTML = topics.map((t, i) => {
    const bg = small ? "transparent" : bgs[i % bgs.length];
    const fg = !small && bgs[i % bgs.length] === PALETTE.ink ? PALETTE.ground : PALETTE.ink;
    const dot = [PALETTE.pink, PALETTE.green, PALETTE.green, PALETTE.ground][i % 4];
    return `
    <div class="topic-card" style="background:${bg};color:${fg}">
      <div class="topic-card-head">
        <span class="name">${esc(t.topic_name)}</span>
        <div class="topic-pct" style="background:${dot}">${t.percentage !== undefined ? t.percentage + "%" : ""}</div>
      </div>
      <span class="kw">${t.keywords.slice(0, 6).map(esc).join(", ")}</span>
      <span class="count">${t.comment_count} comments</span>
    </div>`;
  }).join("");
}

function renderKeywordPills(container, keywords) {
  if (!keywords || !keywords.length) { container.innerHTML = `<span class="empty-state">No keyword data yet.</span>`; return; }
  container.innerHTML = keywords.slice(0, 12).map((k) => `
    <span class="kw-pill">${esc(k.keyword)}<span class="count">${k.frequency ?? k.tfidf_score}</span></span>`).join("");
}

function updateModeBadge(mode) {
  const badge = qs("modeBadge");
  badge.textContent = mode === "live" ? "Live data" : "Not configured";
  qs("lastUpdated").textContent = `Updated ${new Date().toLocaleTimeString("en-GB")}`;
}

function populateArtistList(names) {
  qs("artistList").innerHTML = names.map((n) => `<option value="${esc(n)}">`).join("");
}
function populateTrackList(trendRows) {
  const seen = new Set();
  const opts = [];
  for (const r of trendRows) {
    if (seen.has(r.track_name)) continue;
    seen.add(r.track_name);
    opts.push(`<option value="${esc(r.track_name)}">`);
  }
  qs("trackList").innerHTML = opts.join("");
}

/** Fetches full track objects (incl. likes) for every known artist (suggested + searched), cached. */
async function getAllTracksFull() {
  if (state.cache.allTracksFull) return state.cache.allTracksFull;
  if (!state.visitedArtists.length) return [];
  const names = state.visitedArtists;
  const bundles = await Promise.all(names.map((n) => API.get(`/api/artist/${encodeURIComponent(n)}`).catch(() => null)));
  const tracks = [];
  bundles.filter(Boolean).forEach((b) => tracks.push(...b.tracks));
  state.cache.allTracksFull = tracks;
  return tracks;
}

/* ============================================================= DASHBOARD */
async function loadDashboard() {
  if (!state.selectedArtist) {
    qs("dashboardResults").classList.add("hidden");
    qs("dashboardEmptyState").classList.remove("hidden");
    renderDashboardWelcomeState(qs("dashboardEmptyState"));
    return;
  }
  const grid = qs("kpiGrid");
  grid.innerHTML = Array.from({ length: 7 }).map(() => `<div class="skeleton skel-card"></div>`).join("");
  // Fetching a new artist makes several real Spotify + YouTube API calls
  // (catalog, channel stats, per-track video search) and can take a few
  // seconds — mark the whole results area as loading so the user can see
  // the previous artist's numbers are stale, instead of silently leaving
  // them on screen looking current while the real fetch is still in flight.
  qs("dashboardResults").classList.add("loading");
  let bundle;
  try { bundle = await API.get(`/api/artist/${encodeURIComponent(state.selectedArtist)}`); }
  catch (err) {
    qs("dashboardResults").classList.remove("loading");
    qs("dashboardResults").classList.add("hidden");
    qs("dashboardEmptyState").classList.remove("hidden");
    renderArtistNotFoundState(qs("dashboardEmptyState"), state.selectedArtist, err.message);
    return;
  }
  qs("dashboardEmptyState").classList.add("hidden");
  qs("dashboardResults").classList.remove("hidden");
  qs("dashboardResults").classList.remove("loading");
  updateModeBadge(bundle.mode);

  const quotaBanner = qs("youtubeQuotaBanner");
  if (bundle.youtube_quota_exceeded) {
    quotaBanner.className = "quota-banner";
    quotaBanner.textContent = "YouTube's daily API quota is exhausted for this app — views, likes, comments and subscriber counts below are showing as 0 because that data couldn't be fetched, not because it's actually zero. This resets automatically (quotas reset daily); Spotify data is unaffected.";
  } else {
    quotaBanner.className = "hidden";
  }

  const avgGrowth = bundle.trend.length ? bundle.trend.reduce((s, r) => s + r.view_growth_pct, 0) / bundle.trend.length : 0;
  const topTrack = bundle.trend.length ? bundle.trend[0].track_name : "";

  renderKpiGrid(grid, [
    { label: "Tracks analyzed", value: bundle.kpis.tracks_analyzed, delta: `In ${bundle.artist.name}'s profile` },
    { label: "YouTube views", value: fmtNum(bundle.kpis.youtube_views), delta: `${avgGrowth >= 0 ? "↑" : "↓"} ${Math.abs(avgGrowth).toFixed(1)}% growth (est.)` },
    { label: "YouTube comments", value: fmtNum(bundle.kpis.youtube_comments), delta: "Across all tracks" },
    { label: "Avg engagement rate", value: `${bundle.kpis.avg_engagement_rate}%`, delta: "(Likes + Comments) / Views", bgClass: "bg-ink" },
    { label: "Current trend score", value: bundle.kpis.top_trend_score, delta: topTrack ? `Top: ${topTrack}` : "", bgClass: "bg-green" },
    bundle.spotify_catalog
      ? { label: "Spotify catalog", value: fmtNum(bundle.spotify_catalog.total_releases), delta: bundle.spotify_catalog.avg_release_gap_days ? `New release every ~${bundle.spotify_catalog.avg_release_gap_days}d avg` : "Total releases" }
      : { label: "Spotify catalog", value: "N/A", delta: "Could not fetch album data" },
    bundle.youtube_channel && bundle.youtube_channel.subscriber_count !== null
      ? { label: "YouTube subscribers", value: fmtNum(bundle.youtube_channel.subscriber_count), delta: `${fmtNum(bundle.youtube_channel.channel_video_count)} videos on channel` }
      : { label: "YouTube subscribers", value: "N/A", delta: bundle.youtube_channel ? "Channel hides subscriber count" : "No matched channel found" },
  ]);

  renderSuggestedChips();
  renderSpotifyBars(bundle.tracks);
  wireSegment("spSortSeg", (v) => { state.spSort = v; renderSpotifyBars(bundle.tracks); });
  renderYoutubeLollipop(bundle.tracks);
  wireSegment("ytMetricSeg", (v) => { state.ytMetric = v; renderYoutubeLollipop(bundle.tracks); });

  try {
    const svy = await API.get("/api/spotify-youtube");
    renderDashboardSvy(svy);
  } catch {}
}

function renderSuggestedChips() {
  const el = qs("suggestedArtists");
  const names = suggestedOrDefault();
  el.innerHTML = names.map((n) => `<button class="chip-select${n === state.selectedArtist ? " active" : ""}" data-artist="${esc(n)}">${esc(n)}</button>`).join("");
  el.querySelectorAll("[data-artist]").forEach((c) => c.onclick = () => goDashboardFor(c.dataset.artist));
}

function renderSpotifyBars(tracks) {
  const sorted = [...tracks].sort((a, b) => state.spSort === "name"
    ? a.name.localeCompare(b.name)
    : new Date(b.release_date || 0) - new Date(a.release_date || 0));
  qs("spBars").innerHTML = sorted.map((t) => `
    <div class="bar-row">
      <div class="bar-row-head"><b>${esc(t.name)}</b><span>${fmtDate(t.release_date)}</span></div>
      <div style="font-size:12px;color:var(--muted)">${esc(t.album_name || "—")} · ${fmtDuration(t.duration_ms)}${t.explicit ? " · Explicit" : ""}</div>
    </div>`).join("");
}

function renderYoutubeLollipop(tracks) {
  const metric = state.ytMetric;
  const max = Math.max(...tracks.map((t) => t[metric] || 0), 1);
  qs("ytLollipop").innerHTML = tracks.map((t) => {
    const h = Math.max(4, (t[metric] || 0) / max * 190);
    return `<div class="lollipop"><div class="lollipop-ball">${fmtYt(t, t[metric])}</div><div class="lollipop-stem" style="height:${h}px"></div></div>`;
  }).join("");
  qs("ytLollipopLabels").innerHTML = tracks.map((t) => `<span>${esc(t.name)}</span>`).join("");
}

function renderDashboardSvy(svy) {
  const r = svy.correlation.pearson;
  const scatter = qs("dashMiniScatter");
  qs("dashCorrR").textContent = r === null || r === undefined ? "—" : r.toFixed(2);

  const points = svy.points;
  if (points.length < 2) {
    const stillLoading = state.visitedArtists.length > points.length;
    if (stillLoading) {
      qs("dashCorrDesc").textContent = "Still fetching real catalog/channel data for a recently searched artist — give it a moment, then check this again.";
    } else {
      const needed = points.length === 0 ? "two" : "one more";
      qs("dashCorrDesc").textContent = `A correlation needs at least 2 artists to compare — visit ${needed} artist${needed === "one more" ? "" : "s"} on the Dashboard to see a real Spotify-catalog vs. YouTube-audience comparison.`;
    }
    scatter.innerHTML = `<span class="axis-label">Spotify total releases →</span>`;
    qs("dashSvyBtn").onclick = () => switchView("svy");
    return;
  }
  qs("dashCorrDesc").textContent = `Pearson correlation between Spotify total releases and YouTube subscribers across ${svy.correlation.n} artists. ${readR(r)}.`;

  const xs = points.map((p) => p.spotify_total_releases), ys = points.map((p) => p.youtube_subscribers);
  const xmin = Math.min(...xs, 0) - 1, xmax = Math.max(...xs, 1) + 1;
  const ymax = Math.max(...ys, 1) * 1.12;
  const dotsHtml = points.map((p) => {
    const x = ((p.spotify_total_releases - xmin) / (xmax - xmin || 1)) * 100;
    const y = (p.youtube_subscribers / (ymax || 1)) * 100;
    const bg = p.artist === state.selectedArtist ? PALETTE.ink : PALETTE.pink;
    return `<div class="dot" title="${esc(p.artist)} · ${fmtNum(p.spotify_total_releases)} releases · ${fmtNum(p.youtube_subscribers)} subs" style="left:${x}%;bottom:${y}%;background:${bg}"></div>`;
  }).join("");
  scatter.innerHTML = dotsHtml + `<span class="axis-label">Spotify total releases →</span>`;

  qs("dashSvyBtn").onclick = () => switchView("svy");
}

/* =============================================================== ARTISTS */
async function loadArtistsList() {
  const grid = qs("artistGrid");
  if (!state.visitedArtists.length) {
    renderDashboardWelcomeState(grid);
    return;
  }
  grid.innerHTML = Array.from({ length: 5 }).map(() => `<div class="skeleton skel-card"></div>`).join("");
  const names = state.visitedArtists;
  const bgCycle = [PALETTE.green, PALETTE.pink, PALETTE.ink, PALETTE.green, PALETTE.pink];
  try {
    const bundles = await Promise.all(names.map((n) => API.get(`/api/artist/${encodeURIComponent(n)}`).catch(() => null)));
    grid.innerHTML = bundles.filter(Boolean).map((b, i) => {
      const bg = bgCycle[i % bgCycle.length];
      const fg = bg === PALETTE.ink ? PALETTE.ground : PALETTE.ink;
      const initials = b.artist.name.split(" ").map((w) => w[0]).slice(0, 2).join("");
      const selected = b.artist.name === state.selectedArtist;
      return `
      <button class="artist-card${selected ? " selected" : ""}" data-artist="${esc(b.artist.name)}">
        <div class="artist-avatar-wrap">
          <div class="artist-avatar-circle" style="background:${bg};color:${fg}">${esc(initials)}</div>
          <div class="artist-pop-badge">${b.youtube_channel && b.youtube_channel.subscriber_count !== null ? fmtNum(b.youtube_channel.subscriber_count) : "N/A"}</div>
        </div>
        <span class="name">${esc(b.artist.name)}</span>
        <span class="meta-line">${b.spotify_catalog ? `${fmtNum(b.spotify_catalog.total_releases)} releases` : "Catalog N/A"} · ${b.tracks.length} tracks</span>
      </button>`;
    }).join("");
    grid.querySelectorAll("[data-artist]").forEach((c) => c.onclick = () => goDashboardFor(c.dataset.artist));
  } catch { grid.innerHTML = ""; }
}

/* ================================================================ TRACKS */
async function loadTracksList() {
  const wrap = qs("tracksRows");
  if (!state.visitedArtists.length) {
    renderDashboardWelcomeState(wrap);
    return;
  }
  wrap.innerHTML = `<div class="skeleton skel-line" style="margin:8px 22px;"></div>`;
  let tracks;
  try { tracks = await getAllTracksFull(); } catch { return; }
  renderTracksRows(tracks);
  wireSegment("trackSortSeg", (v) => { state.trackSort = v; renderTracksRows(tracks); });
}

function trackEngagement(t) { return t.views ? ((t.likes + t.comment_count) / t.views) * 100 : 0; }

function renderTracksRows(tracks) {
  const sorted = [...tracks].sort((a, b) => {
    if (state.trackSort === "views") return b.views - a.views;
    if (state.trackSort === "engagement") return trackEngagement(b) - trackEngagement(a);
    return new Date(b.release_date || 0) - new Date(a.release_date || 0);
  });
  qs("tracksRows").innerHTML = sorted.map((t) => `
    <div class="row-item cols-tracks${t.artist_name === state.selectedArtist ? " mine" : ""}" data-artist="${esc(t.artist_name)}">
      <span style="font-weight:700">${esc(t.name)}</span>
      <span>${esc(t.artist_name)}</span>
      <span>${esc(t.album_name || "—")}</span>
      <span>${fmtYt(t, t.views)}</span>
      <span>${fmtYt(t, t.likes)}</span>
      <span>${fmtYt(t, t.comment_count)}</span>
      <span>${t.youtube_data_available === false ? "N/A" : trackEngagement(t).toFixed(3) + "%"}</span>
    </div>`).join("");
  qs("tracksRows").querySelectorAll("[data-artist]").forEach((row) => row.onclick = () => goDashboardFor(row.dataset.artist));
}

/* ================================================================ TRENDS */
const STATUS_MAP = {
  Trending: ["status-rising", "Rising"], Rising: ["status-rising", "Rising"],
  Stable: ["status-stable", "Stable"], Declining: ["status-falling", "Falling"],
};
async function loadTrends() {
  wireSegment("trendScopeSeg", (v) => { state.trendScope = v; loadTrends(); });
  if (state.trendScope === "artist" && needsArtistSelection(qs("trendsRows"))) return;
  const url = state.trendScope === "artist" ? `/api/trends?artist=${encodeURIComponent(state.selectedArtist)}` : "/api/trends";
  let data;
  try { data = await API.get(url); } catch { return; }
  if (state.trendScope === "all") { state.cache.allTracksTrend = data.trends; populateTrackList(data.trends); }
  qs("pageHeaderSub").textContent = data.spotify_weighted
    ? "30% Spotify Popularity + 30% Estimated Growth + 20% Engagement + 20% Discussion Growth. Growth and Status are modeled estimates (neither Spotify nor YouTube expose real historical trend data) — not fetched metrics."
    : "Spotify popularity isn't available for this app right now, so its 30% weight is redistributed across the real YouTube signals: ~43% estimated growth + ~29% engagement + ~29% discussion. Growth and Status are modeled estimates, not fetched metrics.";
  const maxScore = Math.max(...data.trends.map((r) => r.trend_score), 1);
  qs("trendsRows").innerHTML = data.trends.map((r) => {
    const [cls, label] = STATUS_MAP[r.trend_direction] || ["status-stable", r.trend_direction];
    return `
    <div class="row-item cols-trends" data-artist="${esc(r.artist_name || state.selectedArtist)}">
      <span class="rank-num">#${r.rank}</span>
      <span class="track-cell"><strong>${esc(r.track_name)}</strong><span class="sub">${esc(r.artist_name || state.selectedArtist)}</span></span>
      <span>${fmtNum(r.youtube_views)}</span>
      <span>${r.engagement_rate}%</span>
      <span>${fmtNum(r.discussion_volume)}</span>
      <span class="score-cell"><b>${r.trend_score}</b><span class="score-bar"><span class="score-bar-fill" style="width:${(r.trend_score / maxScore) * 100}%"></span></span></span>
      <span class="status-tag ${cls}">${label}</span>
    </div>`;
  }).join("");
  qs("trendsRows").querySelectorAll("[data-artist]").forEach((row) => row.onclick = () => goDashboardFor(row.dataset.artist));
}

/* ============================================================= SENTIMENT */
async function loadSentimentView() {
  if (needsArtistSelection(qs("sentimentKpis"))) { qs("sentimentDonutFull").innerHTML = ""; qs("sentByTrack").innerHTML = ""; return; }
  let data;
  try { data = await API.get(`/api/sentiment/${encodeURIComponent(state.selectedArtist)}`); } catch { return; }
  if (!data.summary) {
    qs("sentimentKpis").innerHTML = `<div class="empty-state">No comment data available yet for ${esc(state.selectedArtist)}.</div>`;
    qs("sentimentDonutFull").innerHTML = "";
    qs("sentByTrack").innerHTML = "";
    return;
  }
  renderKpiGrid(qs("sentimentKpis"), [
    { label: "Total comments", value: data.summary.total },
    { label: "Positive", value: data.summary.positive, bgClass: "bg-green" },
    { label: "Neutral", value: data.summary.neutral, bgClass: "bg-pink" },
    { label: "Negative", value: data.summary.negative, bgClass: "bg-ink" },
  ]);
  renderDonut(qs("sentimentDonutFull"), data.summary);
  qs("sentByTrack").innerHTML = data.by_track.map((t) => {
    const segs = [
      { v: t.positive_pct, bg: PALETTE.green, fg: PALETTE.ink },
      { v: t.neutral_pct, bg: PALETTE.pink, fg: PALETTE.ink },
      { v: t.negative_pct, bg: PALETTE.ink, fg: PALETTE.ground },
    ].filter((s) => s.v > 0);
    return `
    <div>
      <div class="name" style="margin-bottom:8px">${esc(t.track_name)}</div>
      <div class="sent-bar">${segs.map((s) => `<div class="sent-seg" style="width:${s.v}%;background:${s.bg};color:${s.fg}">${s.v.toFixed(0)}%</div>`).join("")}</div>
    </div>`;
  }).join("");
}

/* ============================================================== KEYWORDS */
async function loadKeywordsView(mode = "frequency") {
  state.kwMode = mode;
  wireSegment("kwModeSeg", (v) => loadKeywordsView(v));
  if (needsArtistSelection(qs("kwCloud"))) { qs("kwListBody").innerHTML = ""; return; }
  let data;
  try { data = await API.get(`/api/keywords/${encodeURIComponent(state.selectedArtist)}?mode=${mode}&n=2`); } catch { return; }
  const kws = data.keywords;
  if (!kws.length) {
    qs("kwCloud").innerHTML = `<span style="color:${PALETTE.ground}">Not enough comment data yet.</span>`;
    qs("kwListBody").innerHTML = "";
    return;
  }
  const valueOf = (k) => mode === "tfidf" ? k.tfidf_score : k.frequency;
  const max = Math.max(...kws.map(valueOf), 1);
  const cloudColors = [PALETTE.green, PALETTE.ground, PALETTE.pink];
  qs("kwCloud").innerHTML = kws.map((k, i) => {
    const fs = 18 + (valueOf(k) / max) * 46;
    return `<span class="word" style="font-size:${fs}px;color:${cloudColors[i % 3]}">${esc(k.keyword)}</span>`;
  }).join("");

  const heads = { tfidf: ["Term", "TF-IDF"], ngram: ["Bigram", "Count"], frequency: ["Term", "Frequency"] };
  const [ha, hb] = heads[mode] || heads.frequency;
  qs("kwListHead").innerHTML = `<span>${ha}</span><span>${hb}</span>`;
  qs("kwListBody").innerHTML = kws.slice(0, 10).map((k) => `
    <div class="kw-list-item">
      <span class="word">${esc(k.keyword)}</span>
      <span class="kw-list-bar"><span class="kw-list-bar-fill" style="width:${(valueOf(k) / max) * 100}%"></span></span>
      <span class="value">${mode === "tfidf" ? k.tfidf_score : k.frequency}</span>
    </div>`).join("");
}

/* ================================================================ TOPICS */
async function loadTopicsView() {
  wireSegment("topicMethodSeg", (v) => { state.topicMethod = v; loadTopicsView(); });
  wireSegment("topicKSeg", (v) => { state.topicK = v; loadTopicsView(); });
  if (needsArtistSelection(qs("topicGridFull"))) return;
  let data;
  try { data = await API.get(`/api/topics/${encodeURIComponent(state.selectedArtist)}?method=${state.topicMethod}&k=${state.topicK}`); } catch { return; }
  renderTopicCards(qs("topicGridFull"), data.topics, false);
}

/* ============================================================== COMMENTS */
let commentsState = { videoId: null, sentiment: "", page: 1, q: "" };
const SENT_COLORS = { positive: [PALETTE.green, PALETTE.ink], neutral: [PALETTE.pink, PALETTE.ink], negative: [PALETTE.ink, PALETTE.ground] };
const USER_POOL = ["nightdrive", "mira.k", "lofi_ben", "sasha", "j.okafor", "rainyday", "leo_m", "tunehunter", "ivy", "markus", "noor", "el.gomez"];

async function loadCommentsView() {
  if (needsArtistSelection(qs("commentFeed"))) { qs("commentsKpis").innerHTML = ""; qs("commentTrackSelect").innerHTML = ""; return; }
  let bundle;
  try { bundle = await API.get(`/api/artist/${encodeURIComponent(state.selectedArtist)}`); } catch { return; }
  const select = qs("commentTrackSelect");
  select.innerHTML = bundle.tracks.map((t) => `<option value="${esc(t.video_id)}">${esc(t.name)}</option>`).join("");
  commentsState = { videoId: bundle.tracks[0]?.video_id, sentiment: "", page: 1, q: "" };
  select.value = commentsState.videoId || "";
  select.onchange = () => { commentsState.videoId = select.value; commentsState.page = 1; fetchAndRenderComments(); };
  qs("commentSearch").value = "";
  qs("commentSearch").oninput = debounce(() => { commentsState.q = qs("commentSearch").value; commentsState.page = 1; fetchAndRenderComments(); }, 250);
  wireSegment("commentSentSeg", (v) => { commentsState.sentiment = v; commentsState.page = 1; fetchAndRenderComments(); });
  await fetchAndRenderComments();
}

async function fetchAndRenderComments() {
  if (!commentsState.videoId) { qs("commentFeed").innerHTML = `<div class="empty-state">No videos available.</div>`; return; }
  const params = new URLSearchParams({ sentiment: commentsState.sentiment, q: commentsState.q, page: commentsState.page, page_size: 8 });
  let data;
  try { data = await API.get(`/api/comments/${encodeURIComponent(commentsState.videoId)}?${params}`); } catch { return; }

  if (data.sentiment_summary) {
    renderKpiGrid(qs("commentsKpis"), [
      { label: "Comments analyzed", value: data.sentiment_summary.total },
      { label: "Positive", value: data.sentiment_summary.positive, bgClass: "bg-green" },
      { label: "Neutral", value: data.sentiment_summary.neutral, bgClass: "bg-pink" },
      { label: "Negative", value: data.sentiment_summary.negative, bgClass: "bg-ink" },
    ]);
  }

  const feed = qs("commentFeed");
  if (!data.comments.length) { feed.innerHTML = `<div class="empty-state">No comments match your filters.</div>`; }
  else {
    feed.innerHTML = data.comments.map((c, i) => {
      const seed = commentsState.page * 8 + i;
      const user = USER_POOL[seed % USER_POOL.length];
      const [bg, fg] = SENT_COLORS[c.sentiment] || SENT_COLORS.neutral;
      return `
      <div class="comment-card">
        <div class="comment-avatar" style="background:${bg};color:${fg}">${user[0].toUpperCase()}</div>
        <div class="comment-body">
          <div class="comment-user-row"><strong>@${esc(user)}</strong><span class="on">${fmtDate(c.published_at)}</span></div>
          <p class="comment-text">${esc(c.text)}</p>
          <div class="comment-foot">
            <span class="sent-tag" style="background:${bg};color:${fg}">${c.sentiment[0].toUpperCase() + c.sentiment.slice(1)} · ${c.confidence}%</span>
          </div>
        </div>
      </div>`;
    }).join("");
  }

  const totalPages = Math.max(1, Math.ceil(data.total / data.page_size));
  qs("commentPagination").innerHTML = `
    <button ${data.page <= 1 ? "disabled" : ""} id="pgPrev">Prev</button>
    <span class="page-info">Page ${data.page} of ${totalPages}</span>
    <button ${data.page >= totalPages ? "disabled" : ""} id="pgNext">Next</button>`;
  qs("pgPrev").onclick = () => { commentsState.page--; fetchAndRenderComments(); };
  qs("pgNext").onclick = () => { commentsState.page++; fetchAndRenderComments(); };
}

/* ====================================================== ARTIST COMPARISON */
const fmtNumOrNA = (v) => (v === null || v === undefined ? "N/A" : fmtNum(v));
const CMP_ROWS_DEF = [
  ["Spotify total releases", "spotify_total_releases", fmtNumOrNA],
  ["YouTube subscribers", "youtube_subscribers", fmtNumOrNA],
  ["YouTube views", "youtube_views", fmtNum],
  ["YouTube comments", "comment_volume", fmtNum],
  ["Engagement rate", "avg_engagement_rate", (v) => v.toFixed(2) + "%"],
  ["Trend score", "trend_score", (v) => v.toFixed(1)],
  ["Positive sentiment", "positive_sentiment_pct", (v) => v.toFixed(0) + "%"],
];

async function loadCompareArtists() {
  const names = state.visitedArtists;
  if (!state.selectedArtist || names.length < 2) {
    qs("cmpAOpts").innerHTML = "";
    qs("cmpBSelect").innerHTML = "";
    qs("cmpNameA").textContent = "";
    qs("cmpNameB").textContent = "";
    renderDashboardWelcomeState(qs("cmpRows"));
    return;
  }
  // Artist A always follows whatever artist is currently loaded on the
  // Dashboard — only Artist B is picked here, via the dropdown.
  state.cmpA = state.selectedArtist;
  const otherNames = names.filter((n) => n !== state.cmpA);
  if (!state.cmpB || !otherNames.includes(state.cmpB)) state.cmpB = otherNames[0];

  qs("cmpAOpts").innerHTML = `<span class="cmp-chip active">${esc(state.cmpA)}</span>`;
  const select = qs("cmpBSelect");
  select.innerHTML = otherNames.map((n) => `<option value="${esc(n)}"${n === state.cmpB ? " selected" : ""}>${esc(n)}</option>`).join("");
  select.onchange = () => { state.cmpB = select.value; loadCompareArtists(); };

  let data;
  try { data = await API.get(`/api/compare?a=${encodeURIComponent(state.cmpA)}&b=${encodeURIComponent(state.cmpB)}`); } catch { return; }
  const A = data.artist_a, B = data.artist_b;
  qs("cmpNameA").textContent = A.name;
  qs("cmpNameB").textContent = B.name;
  qs("cmpRows").innerHTML = CMP_ROWS_DEF.map(([label, key, fmt]) => renderCmpRow(label, A[key], B[key], fmt)).join("");
}
function renderCmpRow(label, va, vb, fmt) {
  const m = Math.max(va, vb) || 1;
  return `
  <div class="cmp-row">
    <div class="cmp-bar-wrap-a"><div class="cmp-bar a" style="width:${(va / m) * 100}%">${fmt(va)}</div></div>
    <span class="cmp-row-label">${label}</span>
    <div class="cmp-bar-wrap-b"><div class="cmp-bar b" style="width:${(vb / m) * 100}%">${fmt(vb)}</div></div>
  </div>`;
}

/* ======================================================= TRACK COMPARISON */
async function loadCompareTracks() {
  if (!state.visitedArtists.length) {
    qs("trackCmpNameA").textContent = "";
    qs("trackCmpNameB").textContent = "";
    renderDashboardWelcomeState(qs("trackCmpRows"));
    return;
  }
  let tracks;
  try { tracks = await getAllTracksFull(); } catch { tracks = []; }
  if (!tracks.length) return;
  state.trackCmpA = Math.min(state.trackCmpA, tracks.length - 1);
  state.trackCmpB = Math.min(state.trackCmpB, tracks.length - 1);
  const opts = tracks.map((t, i) => `<option value="${i}">${esc(t.name)} — ${esc(t.artist_name)}</option>`).join("");
  const selA = qs("trackCmpASelect"), selB = qs("trackCmpBSelect");
  selA.innerHTML = opts; selB.innerHTML = opts;
  selA.value = state.trackCmpA; selB.value = state.trackCmpB;
  selA.onchange = () => { state.trackCmpA = +selA.value; renderTrackComparison(tracks); };
  selB.onchange = () => { state.trackCmpB = +selB.value; renderTrackComparison(tracks); };
  await renderTrackComparison(tracks);
}

async function renderTrackComparison(tracks) {
  const a = tracks[state.trackCmpA], b = tracks[state.trackCmpB];
  if (!a || !b) return;
  let data;
  try {
    data = await API.get(`/api/compare/tracks?a=${encodeURIComponent(a.name)}&artist_a=${encodeURIComponent(a.artist_name)}&b=${encodeURIComponent(b.name)}&artist_b=${encodeURIComponent(b.artist_name)}`);
  } catch { return; }
  const A = data.track_a, B = data.track_b;
  qs("trackCmpNameA").textContent = A.name;
  qs("trackCmpNameB").textContent = B.name;
  const rows = [
    ["Track duration", A.duration_sec, B.duration_sec, (v) => fmtDuration(v * 1000)],
    ["YouTube views", A.youtube_views, B.youtube_views, fmtNum],
    ["YouTube likes", A.youtube_likes, B.youtube_likes, fmtNum],
    ["YouTube comments", A.youtube_comments, B.youtube_comments, fmtNum],
    ["Engagement rate", A.engagement_rate, B.engagement_rate, (v) => v.toFixed(2) + "%"],
    ["Trend score", A.trend_score, B.trend_score, (v) => v.toFixed(1)],
    ["Positive sentiment", A.sentiment?.positive_pct || 0, B.sentiment?.positive_pct || 0, (v) => v.toFixed(0) + "%"],
  ];
  qs("trackCmpRows").innerHTML = rows.map(([label, va, vb, fmt]) => renderCmpRow(label, va, vb, fmt)).join("");
}

/* =========================================================== SCATTER PAGE */
const SVY_LABELS = {
  spotify_total_releases: "Spotify total releases",
  spotify_avg_release_gap_days: "Avg. days between Spotify releases",
  youtube_subscribers: "YouTube subscribers",
  youtube_channel_views: "YouTube channel views",
  youtube_channel_videos: "YouTube channel videos",
};

async function loadScatterView() {
  wireSegment("svyXMetricSeg", (v) => { state.svyXMetric = v; loadScatterView(); });
  wireSegment("svyMetricSeg", (v) => { state.svyMetric = v; loadScatterView(); });

  const url = `/api/spotify-youtube?x=${encodeURIComponent(state.svyXMetric)}&y=${encodeURIComponent(state.svyMetric)}`;
  let data;
  try { data = await API.get(url); } catch { return; }
  renderSvyPlot(data.points, data.correlation, state.svyXMetric, state.svyMetric);
}

function renderSvyPlot(points, correlation, xKey, yKey) {
  qs("svyXAxisLabel").textContent = SVY_LABELS[xKey];
  if (points.length < 2) {
    qs("svyXTicks").innerHTML = "";
    qs("svyYTicks").innerHTML = "";
    qs("svyDots").innerHTML = "";
    qs("svyPearsonR").textContent = "—";
    qs("svySpearman").textContent = "—";
    qs("svyPearsonRead").textContent = "";
    qs("svyN").textContent = `${points.length} artist${points.length === 1 ? "" : "s"}`;
    const stillLoading = state.visitedArtists.length > points.length;
    qs("svyHint").textContent = stillLoading
      ? `Still fetching real data for ${state.visitedArtists.length - points.length} recently searched artist${state.visitedArtists.length - points.length === 1 ? "" : "s"} (catalog + channel stats take a few seconds) — give it a moment and revisit this page.`
      : points.length === 0
        ? "Visit a few artists on the Dashboard first — each needs both real Spotify catalog data and a matched YouTube channel to appear here."
        : "Only one artist has both real Spotify catalog data and a matched YouTube channel so far — visit one more to see a real correlation.";
    return;
  }

  const xs = points.map((p) => p[xKey]), ys = points.map((p) => p[yKey]);
  const xmin = Math.min(...xs, 0) - 1, xmax = Math.max(...xs, 1) + 1;
  const ymax = Math.max(...ys, 1) * 1.12;
  const step = points.length > 6 ? 2 : 1;

  const xTicks = [];
  for (let v = Math.ceil(xmin); v <= xmax; v += step * Math.max(1, Math.round((xmax - xmin) / 10))) xTicks.push({ x: ((v - xmin) / (xmax - xmin)) * 100, label: fmtNum(v) });
  qs("svyXTicks").innerHTML = xTicks.map((t) => `<span class="svy-xtick" style="left:${t.x}%">${t.label}</span>`).join("");
  qs("svyYTicks").innerHTML = [4, 3, 2, 1, 0].map((i) => `<div class="svy-ytick"><span>${fmtNum((ymax * i) / 4)}</span></div>`).join("");

  qs("svyDots").innerHTML = points.map((p) => {
    const x = ((p[xKey] - xmin) / (xmax - xmin || 1)) * 100;
    const y = (p[yKey] / (ymax || 1)) * 100;
    const bg = p.artist === state.selectedArtist ? PALETTE.ink : PALETTE.pink;
    return `<div class="svy-dot" title="${esc(p.artist)} · ${esc(SVY_LABELS[xKey])} ${fmtNum(p[xKey])} · ${esc(SVY_LABELS[yKey])} ${fmtNum(p[yKey])}" style="left:${x}%;bottom:${y}%;background:${bg}"></div>`;
  }).join("");

  const r = correlation.pearson, rho = correlation.spearman;
  qs("svyPearsonR").textContent = r === null || r === undefined ? "—" : r.toFixed(2);
  qs("svyPearsonRead").textContent = readR(r);
  qs("svySpearman").textContent = rho === null || rho === undefined ? "—" : rho.toFixed(2);
  qs("svyN").textContent = `${correlation.n} artist${correlation.n === 1 ? "" : "s"} · y = ${SVY_LABELS[yKey]}`;
  qs("svyHint").textContent = state.selectedArtist
    ? `Each dot is one artist. The dark dot is ${state.selectedArtist}.`
    : "Each dot is one artist.";
}

/* ========================================================== AUDIENCE === */
async function loadAudienceView() {
  if (needsArtistSelection(qs("insightsDonut"))) { qs("insightsKeywords").innerHTML = ""; qs("insightsTopics").innerHTML = ""; return; }
  try {
    const sentimentData = await API.get(`/api/sentiment/${encodeURIComponent(state.selectedArtist)}`);
    renderDonut(qs("insightsDonut"), sentimentData.summary, true);
  } catch {}
  try {
    const kwData = await API.get(`/api/keywords/${encodeURIComponent(state.selectedArtist)}?mode=frequency`);
    renderKeywordPills(qs("insightsKeywords"), kwData.keywords);
  } catch {}
  try {
    const topicData = await API.get(`/api/topics/${encodeURIComponent(state.selectedArtist)}?k=4&method=${state.topicMethod}`);
    renderTopicCards(qs("insightsTopics"), topicData.topics, true);
  } catch {}
}

/* ========================================================== SETTINGS === */
async function loadSettingsView() {
  let status;
  try { status = await API.get("/api/status"); } catch { return; }
  const modeBtn = qs("settingsModeBtn");
  modeBtn.textContent = status.mode === "live" ? "Live" : "Not configured";
  qs("settingsModeNote").textContent = status.mode === "live"
    ? "Live mode is active — real Spotify and YouTube data is being used."
    : "Add SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET and YOUTUBE_API_KEY to your .env file to enable Live mode — no data can be shown without them.";

  wireSegment("settingsTopicSeg", (v) => { state.topicMethod = v; });
  qs("settingsTopicSeg").querySelectorAll("button").forEach((b) => b.classList.toggle("active", b.dataset.val === state.topicMethod));

  const toggle = qs("autoRefreshToggle");
  toggle.classList.toggle("on", state.autoRefresh);
  toggle.onclick = () => {
    state.autoRefresh = !state.autoRefresh;
    toggle.classList.toggle("on", state.autoRefresh);
    if (state.autoRefreshTimer) { clearInterval(state.autoRefreshTimer); state.autoRefreshTimer = null; }
    if (state.autoRefresh) {
      state.autoRefreshTimer = setInterval(() => loadView(state.currentView), 5 * 60 * 1000);
      showToast("Auto-refresh enabled — every 5 minutes.", "success");
    }
  };

  const known = [
    ["SPOTIFY_CLIENT_ID", status.spotify_configured], ["SPOTIFY_CLIENT_SECRET", status.spotify_configured],
    ["YOUTUBE_API_KEY", status.youtube_configured],
  ];
  const unverified = ["DB_HOST", "DB_PORT", "DB_USER", "DB_PASSWORD", "DB_NAME", "PORT"];
  qs("envVarsList").innerHTML =
    known.map(([key, set]) => `
      <div class="env-row"><code>${key}</code><span class="env-status ${set ? "set" : "notset"}">${set ? "Set" : "Not set"}</span></div>`).join("") +
    unverified.map((key) => `
      <div class="env-row"><code>${key}</code><span class="env-status default">From .env</span></div>`).join("");
}

/* ======================================================= API STATUS === */
async function loadApiStatusView() {
  let status;
  try { status = await API.get("/api/status"); } catch { return; }
  const cards = [
    {
      name: "Spotify Web API", bg: PALETTE.green, fg: PALETTE.ink, dot: PALETTE.pink,
      note: "Client Credentials flow. Supplies track and artist popularity.",
      statusText: status.spotify_configured ? "Configured" : "Not configured",
    },
    {
      name: "YouTube Data API v3", bg: PALETTE.ink, fg: PALETTE.ground, dot: PALETTE.green,
      note: "Video statistics and comment threads.",
      statusText: status.youtube_configured ? "Configured" : "Not configured",
    },
    {
      name: "MySQL", bg: PALETTE.panel, fg: PALETTE.ink, dot: PALETTE.pink,
      note: "Optional persistence. The app runs in memory without it.",
      statusText: status.db_connected ? "Connected" : "Not connected · In-memory",
    },
  ];
  qs("apiStatusCards").innerHTML = cards.map((c) => `
    <div class="api-card" style="background:${c.bg};color:${c.fg}">
      <div class="api-dot" style="background:${c.dot}"></div>
      <span class="name">${c.name}</span>
      <span class="note">${c.note}</span>
      <span class="status">${c.statusText}</span>
    </div>`).join("");
}

/* ================================================================= INIT */
async function initSearch(inputEl, suggEl, onArtist) {
  inputEl.addEventListener("input", debounce(async () => {
    const q = inputEl.value.trim();
    if (!q) { suggEl.innerHTML = ""; return; }
    try {
      const data = await API.get(`/api/search?q=${encodeURIComponent(q)}`);
      const items = [
        ...data.artists.map((a) => ({ label: a, type: "Artist", artist: a })),
        ...data.tracks.map((t) => ({ label: `${t.track} — ${t.artist}`, type: "Track", artist: t.artist })),
      ];
      suggEl.innerHTML = items.map((it, i) => `<div class="sugg-item" data-idx="${i}"><span>${esc(it.label)}</span><span class="sugg-type">${it.type}</span></div>`).join("");
      suggEl.querySelectorAll(".sugg-item").forEach((el) => {
        const item = items[+el.dataset.idx];
        el.onclick = () => { suggEl.innerHTML = ""; inputEl.value = ""; onArtist(item.artist); };
      });
    } catch { /* handled by API.get toast */ }
  }, 250));
  inputEl.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const q = inputEl.value.trim();
    if (!q) return;
    suggEl.innerHTML = ""; inputEl.value = "";
    onArtist(q);
  });
  document.addEventListener("click", (e) => { if (!inputEl.contains(e.target) && !suggEl.contains(e.target)) suggEl.innerHTML = ""; });
}

function initNav() {
  document.querySelectorAll(".nav-link[data-view]").forEach((link) => link.addEventListener("click", () => switchView(link.dataset.view)));
  qs("mobileMenuBtn").onclick = () => qs("sidebar").classList.toggle("mobile-open");
  qs("refreshBtn").onclick = () => { showToast("Data refreshed.", "success"); loadView(state.currentView); };
  qs("settingsBtn").onclick = () => switchView("settings");
}

async function init() {
  initNav();
  try {
    const status = await API.get("/api/status");
    state.status = status;
    state.suggestedArtists = status.suggested_artists || [];
    populateArtistList(state.suggestedArtists);
    updateModeBadge(status.mode);
  } catch { /* toast already shown */ }

  const globalSearch = qs("globalSearch");
  initSearch(globalSearch, qs("searchSuggestions"), (artist) => goDashboardFor(artist));
  qs("globalSearchForm").addEventListener("submit", (e) => { e.preventDefault(); });

  qs("heroSearchForm").addEventListener("submit", (e) => { e.preventDefault(); runHeroSearch(); });

  renderSuggestedChips();
  switchView("dashboard");
}

function runHeroSearch() {
  const q = qs("heroSearch").value.trim();
  if (!q) return;
  qs("heroSearch").value = "";
  goDashboardFor(q);
}

document.addEventListener("DOMContentLoaded", init);
