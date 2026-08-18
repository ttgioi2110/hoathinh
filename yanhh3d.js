import { chromium } from 'playwright';
import * as cheerio from 'cheerio';

const cache = new Map();
const baseCache = new Map();
const TTL = 5 * 60 * 1000;
const BASE_TTL = 10 * 60 * 1000;
const RESOLVE_TTL = 2 * 60 * 60 * 1000;
const BROWSER_ENABLED = process.env.RESOLVER_BROWSER !== '0';

const FALLBACK_PATHS = {
  'yanhh3d-new': ['/phim-dang-cap-nhat/', '/'],
  'yanhh3d-3d': ['/the-loai-phim/hoat-hinh-3d/', '/hoat-hinh-3d/', '/phim-bo/'],
  'yanhh3d-2d': ['/the-loai-phim/hoat-hinh-2d/', '/hoat-hinh-2d/'],
  'yanhh3d-4k': ['/the-loai-phim/4k/', '/4k/', '/phim-4k/'],
  'yanhh3d-ai': ['/the-loai-phim/ai/', '/ai/', '/hoat-hinh-ai/'],
  'yanhh3d-complete': ['/phim-bo/', '/hoan-thanh/', '/phim-bo-da-hoan-thanh/'],
  'yanhh3d-airing': ['/phim-dang-cap-nhat/', '/dang-chieu/', '/phim-dang-chieu/']
};

const GENRES = new Set(['Huyền Huyễn','Xuyên Không','Trùng Sinh','Tiên Hiệp','Cổ Trang','Hài Hước','Kiếm Hiệp','Hiện Đại','Tu Tiên','Đô Thị','Hoạt Hình 3D','Hoạt Hình 2D']);

function abs(base, href) {
  try { return new URL(href, base).href; } catch { return null; }
}
function normalizeText(s) { return (s || '').replace(/\s+/g, ' ').trim(); }
function slugFromUrl(u) {
  try {
    const parts = new URL(u).pathname.replace(/\/+$/, '').split('/').filter(Boolean);
    return parts.at(-1) || null;
  } catch { return null; }
}
function idFor(slug) { return `yanhh3d:${slug}`; }
function cleanSlug(s) { return String(s || '').toLowerCase().replace(/\/+$/, '').split('/').filter(Boolean).pop() || ''; }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchText(url) {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.time < TTL) return hit.value;
  const r = await fetch(url, {
    redirect: 'follow',
    headers: {
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/151 Safari/537.36',
      'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'accept-language': 'vi-VN,vi;q=0.9,en;q=0.7'
    }
  });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
  const value = await r.text();
  cache.set(url, { time: Date.now(), value });
  return value;
}

async function chooseBase(bases) {
  const cached = baseCache.get('active');
  if (cached && Date.now() - cached.time < BASE_TTL) return cached.base;
  for (const base of bases) {
    try {
      const html = await fetchText(base + '/');
      if (html.length > 1000 && /Yanhh3d|YanHH3D|Hoạt Hình|Tiên Nghịch/i.test(html)) {
        baseCache.set('active', { time: Date.now(), base });
        return base;
      }
    } catch {}
  }
  return bases[0];
}

function pageVariants(path, page) {
  if (page <= 1) return [path];
  const p = String(page);
  return [
    `${path.replace(/\/$/, '')}/page/${p}/`,
    `${path.replace(/\/$/, '')}?page=${p}`,
    `${path.replace(/\/$/, '')}?paged=${p}`
  ];
}

function findPoster($, scope, base) {
  const img = scope.find('img').first();
  if (!img.length) return null;
  return abs(base, img.attr('data-src') || img.attr('data-lazy-src') || img.attr('data-original') || img.attr('src'));
}

function extractCardName($, a) {
  const scope = $(a).closest('article, .item, .film_list-wrap, .film-poster-ahref, .col, .post, li, .movie-item, .film-poster').first();
  const name = normalizeText(scope.find('h2,h3,h4,.film-name,.title,.name').first().text() || $(a).attr('title') || $(a).attr('aria-label') || $(a).text());
  return { name, scope: scope.length ? scope : $(a).parent() };
}

function parseCatalogHtml(html, base) {
  const $ = cheerio.load(html);
  const seen = new Set();
  const metas = [];
  $('a[href]').each((_i, a) => {
    const href = abs(base, $(a).attr('href'));
    if (!href || !href.startsWith(base)) return;
    const path = new URL(href).pathname;
    if (/\/(tap-|episode-|ep-?\d+)/i.test(path)) return;
    const slug = cleanSlug(slugFromUrl(href));
    if (!slug || seen.has(slug) || slug.length < 2) return;
    const { name, scope } = extractCardName($, a);
    if (!name || name.length > 160) return;
    const text = normalizeText(scope.text());
    const hasPoster = !!findPoster($, scope, base);
    const likelyMovie = hasPoster && (scope.find('h2,h3,h4,.film-name,.title,.name').length || /\d+\s*\/\s*\d+|\d+\/\d+|\[4K\]|TM-VS|Vietsub|Thuyết Minh/i.test(text));
    if (!likelyMovie) return;
    seen.add(slug);
    metas.push({
      id: idFor(slug),
      type: 'series',
      name: name.replace(/\s+/g, ' '),
      poster: findPoster($, scope, base) || findPoster($, $(a), base),
      description: text.slice(0, 500),
      links: [{ name: 'YanHH3D', category: 'official', url: href }]
    });
  });
  return metas;
}

function categoryPathFromHome(html, base, catalogId) {
  const $ = cheerio.load(html);
  const terms = {
    'yanhh3d-3d': ['Hoạt Hình 3D', '3D'],
    'yanhh3d-2d': ['Hoạt Hình 2D', '2D'],
    'yanhh3d-4k': ['4K'],
    'yanhh3d-ai': ['AI'],
    'yanhh3d-complete': ['Đã hoàn thành', 'Hoàn thành', 'Full Bộ'],
    'yanhh3d-airing': ['Đang chiếu', 'Đang Cập Nhật', 'Phim đang cập nhật']
  }[catalogId] || [];
  for (const a of $('a[href]').toArray()) {
    const t = normalizeText($(a).text());
    if (terms.some(term => t === term || t.toLowerCase().includes(term.toLowerCase()))) {
      const u = abs(base, $(a).attr('href'));
      if (u) return new URL(u).pathname || '/';
    }
  }
  return null;
}

export async function scrapeCatalog(bases, catalogId, { skip = 0, search = '' } = {}) {
  const base = await chooseBase(bases);
  const pageSize = 100;
  const firstPage = Math.floor(skip / pageSize) + 1;
  let path = FALLBACK_PATHS[catalogId]?.[0] || '/';
  try {
    if (catalogId !== 'yanhh3d-new' && !search) {
      const home = await fetchText(base + '/');
      path = categoryPathFromHome(home, base, catalogId) || path;
    }
  } catch {}

  if (search) {
    const q = encodeURIComponent(search);
    const candidates = [`${base}/?s=${q}`, `${base}/search/${q}/`, `${base}/tim-kiem/?q=${q}`];
    for (const c of candidates) {
      try {
        const html = await fetchText(c);
        if (html.length > 1000) return parseCatalogHtml(html, base).slice(0, pageSize);
      } catch {}
    }
    return [];
  }

  const all = [];
  const seen = new Set();
  // Stremio normally asks in chunks of 100. Many WordPress-like sites expose ~20 cards/page,
  // so collect up to five pages and return one Stremio-sized page.
  for (let i = 0; i < 5; i++) {
    const page = firstPage + i;
    const variants = pageVariants(path, page);
    let html = null;
    for (const v of variants) {
      try {
        const candidate = await fetchText(base + v);
        if (candidate.length > 1000) { html = candidate; break; }
      } catch {}
    }
    if (!html) break;
    const metas = parseCatalogHtml(html, base);
    if (!metas.length) break;
    for (const meta of metas) {
      if (!seen.has(meta.id)) {
        seen.add(meta.id);
        all.push(meta);
      }
    }
    if (metas.length < 10) break;
  }
  return all.slice(0, pageSize);
}

function parseEpisodeLinks($, base, slug) {
  const videos = [];
  const seen = new Set();
  $('a[href]').each((_i, a) => {
    const href = abs(base, $(a).attr('href'));
    if (!href || !href.startsWith(base)) return;
    const m = new URL(href).pathname.match(/(?:tap-|episode-|ep-?)(\d+)/i);
    if (!m) return;
    const ep = Number(m[1]);
    if (!Number.isFinite(ep) || seen.has(ep)) return;
    seen.add(ep);
    videos.push({ id: `${idFor(slug)}:ep${ep}`, title: `Tập ${ep}`, season: 1, episode: ep });
  });
  videos.sort((a,b) => a.episode - b.episode);
  return videos;
}

async function findDetailUrl(base, slug) {
  const candidates = [`${base}/phim-bo/${slug}/`, `${base}/${slug}/`, `${base}/phim/${slug}/`, `${base}/anime/${slug}/`];
  for (const url of candidates) {
    try {
      const html = await fetchText(url);
      if (html.length > 1000 && new RegExp(`<h1[^>]*>[^<]*${slug.replace(/-/g,'[^<]*')}|${slug.replace(/-/g,'[^<]*')}`, 'i').test(html)) return url;
    } catch {}
  }
  return candidates[0];
}

export async function scrapeMeta(bases, slug) {
  const base = await chooseBase(bases);
  const url = await findDetailUrl(base, slug);
  const html = await fetchText(url);
  const $ = cheerio.load(html);
  const title = normalizeText($('h1').first().text()) || normalizeText($('meta[property="og:title"]').attr('content')) || slug.replace(/-/g, ' ');
  const posterUrl = abs(base, $('meta[property="og:image"]').attr('content') || $('meta[name="twitter:image"]').attr('content') || $('img').first().attr('src'));
  const description = normalizeText($('meta[name="description"]').attr('content') || $('.description,.content,.film-description,.summary').first().text());
  const genres = [];
  $('a').each((_i, a) => {
    const t = normalizeText($(a).text());
    if (GENRES.has(t)) genres.push(t);
  });
  const videos = parseEpisodeLinks($, base, slug);
  return {
    id: idFor(slug),
    type: videos.length ? 'series' : 'movie',
    name: title.replace(/\s+-\s*Tập.*$/i, ''),
    poster: posterUrl,
    background: posterUrl,
    description,
    genres: [...new Set(genres)],
    videos
  };
}

function looksLikeVideoUrl(u) {
  return /^https?:/i.test(u) && (/\.(m3u8|mp4)(?:[?#]|$)/i.test(u) || /m3u8|master|playlist|manifest|\/hls(?:[/?]|$)|\/stream(?:[/?]|$)|\/video(?:[/?]|$)/i.test(decodeURIComponent(u)));
}
function addCandidate(map, url, extra = {}) {
  if (!url || typeof url !== 'string') return;
  let u = url.trim().replace(/["'<>),;]+$/g, '');
  if (u.startsWith('//')) u = 'https:' + u;
  if (!/^https?:/i.test(u)) return;
  if (!looksLikeVideoUrl(u)) return;
  const type = /m3u8|playlist|hls/i.test(u) ? 'hls' : 'mp4';
  map.set(u, { url: u, type, ...extra });
}

function decodeLooseText(text) {
  return String(text || '')
    .replace(/\\u002F/g, '/')
    .replace(/\\u003A/g, ':')
    .replace(/\\x2F/gi, '/')
    .replace(/\\x3A/gi, ':')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#x2F;/gi, '/')
    .replace(/&#47;/g, '/');
}

function scanTextForUrls(text, map) {
  if (!text) return;
  const decoded = decodeLooseText(text);
  const matches = decoded.match(/https?:\/\/[^\s"'<>\\]+/g) || [];
  for (const u of matches) addCandidate(map, u);
  const keyed = decoded.match(/(?:file|url|src|source|stream|playlist|m3u8)\s*[:=]\s*["'](https?:\/\/[^"']+)["']/gi) || [];
  for (const item of keyed) {
    const m = item.match(/https?:\/\/[^"']+/i);
    if (m) addCandidate(map, m[0]);
  }
}

async function browserResolve(pageUrl) {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/151 Safari/537.36',
      viewport: { width: 1365, height: 900 },
      javaScriptEnabled: true
    });
    const page = await context.newPage();
    const candidates = new Map();
    const interesting = /m3u8|\.mp4(?:[?#]|$)|master\.json|playlist|manifest|video|stream|source|api/i;

    const capture = (url, extra = {}) => {
      if (!looksLikeVideoUrl(url)) return;
      addCandidate(candidates, url, extra);
    };

    page.on('request', req => {
      const u = req.url();
      if (interesting.test(u)) {
        const h = req.headers();
        capture(u, {
          headers: {
            ...(h.referer ? { Referer: h.referer } : {}),
            ...(h.origin ? { Origin: h.origin } : {})
          }
        });
      }
    });

    page.on('response', async res => {
      const u = res.url();
      const ct = res.headers()['content-type'] || '';
      if (looksLikeVideoUrl(u) || /mpegurl|mp4|video\//i.test(ct)) {
        let reqHeaders = {};
        try {
          const h = res.request().headers();
          reqHeaders = {
            ...(h.referer ? { Referer: h.referer } : {}),
            ...(h.origin ? { Origin: h.origin } : {})
          };
        } catch {}
        capture(u, { headers: reqHeaders });
      }
      if (/json|javascript|text\//i.test(ct) && interesting.test(u)) {
        try { scanTextForUrls(await res.text(), candidates); } catch {}
      }
    });

    await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await sleep(2500);

    // Prefer explicit server controls; do not click arbitrary elements unless needed.
    const serverSelectors = [
      'button:has-text("Server 1")',
      'a:has-text("Server 1")',
      '[data-server="1"]',
      '[data-server="server1"]',
      '[class*="server"] button',
      '[class*="server"] a'
    ];
    for (const selector of serverSelectors) {
      try {
        const loc = page.locator(selector).first();
        if (await loc.count()) {
          await loc.click({ timeout: 2500 });
          await sleep(1200);
          break;
        }
      } catch {}
    }

    // Trigger playback. A blob: currentSrc is intentionally ignored; the network
    // events above are the authoritative place to find the underlying media URL.
    try {
      const video = page.locator('video').first();
      if (await video.count()) {
        await video.evaluate(v => { try { v.muted = true; } catch {} });
        await video.click({ timeout: 2500 }).catch(() => {});
        await video.evaluate(v => { try { v.play(); } catch {} }).catch(() => {});
      }
    } catch {}
    await sleep(10000);

    const dom = await page.evaluate(() => ({
      resources: performance.getEntriesByType('resource').map(r => r.name),
      video: [...document.querySelectorAll('video')].map(v => ({ src: v.currentSrc || v.src || '', poster: v.poster || '' })),
      sources: [...document.querySelectorAll('video source')].map(s => s.src || ''),
      iframes: [...document.querySelectorAll('iframe')].map(f => f.src || ''),
      scripts: [...document.scripts].map(s => s.textContent || '').join('\n')
    }));
    for (const r of dom.resources || []) capture(r, { headers: { Referer: pageUrl } });
    for (const v of dom.video || []) capture(v.src);
    for (const u of dom.sources || []) capture(u);
    for (const u of dom.iframes || []) scanTextForUrls(u, candidates);
    scanTextForUrls(dom.scripts, candidates);

    // Rank HLS above MP4; prefer master/playlist URLs and sources with useful headers.
    return [...candidates.values()].sort((a, b) => {
      const score = x => (x.type === 'hls' ? 100 : 50) + (/master|playlist/i.test(x.url) ? 10 : 0) + (x.headers && Object.keys(x.headers).length ? 5 : 0);
      return score(b) - score(a);
    });
  } finally {
    await browser.close();
  }
}
export async function resolveEpisode(bases, slug, episode) {
  const base = await chooseBase(bases);
  const pageCandidates = [
    `${base}/${slug}/tap-${episode}/`,
    `${base}/phim-bo/${slug}/tap-${episode}/`,
    `${base}/${slug}/episode-${episode}/`,
    `${base}/${slug}/ep-${episode}/`
  ];
  const pageUrl = pageCandidates[0];
  let html = null;
  let resolvedPageUrl = pageUrl;
  for (const candidate of pageCandidates) {
    try {
      const candidateHtml = await fetchText(candidate);
      if (candidateHtml.length > 1000) { html = candidateHtml; resolvedPageUrl = candidate; break; }
    } catch {}
  }
  if (!html) return null;
  const $ = cheerio.load(html);
  const direct = new Map();
  scanTextForUrls(html, direct);
  $('video, video source').each((_i, el) => addCandidate(direct, $(el).attr('src')));
  $('iframe').each((_i, el) => {
    const src = abs(base, $(el).attr('src'));
    if (src) scanTextForUrls(src, direct);
  });
  if (direct.size) return { pageUrl: resolvedPageUrl, sources: [...direct.values()] };

  if (!BROWSER_ENABLED) return { pageUrl: resolvedPageUrl, sources: [] };
  try {
    const cached = cache.get(`resolved:${resolvedPageUrl}`);
    if (cached && Date.now() - cached.time < RESOLVE_TTL) return cached.value;
    const sources = await browserResolve(resolvedPageUrl);
    const value = { pageUrl: resolvedPageUrl, sources };
    if (sources.length) cache.set(`resolved:${resolvedPageUrl}`, { time: Date.now(), value });
    if (sources.length) return value;
  } catch (e) {
    console.error('YanHH3D browser resolver failed:', e.message);
  }
  return { pageUrl: resolvedPageUrl, sources: [] };
}
