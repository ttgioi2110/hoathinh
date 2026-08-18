import express from 'express';
import cors from 'cors';
import { Readable } from 'node:stream';
import stremioAddonSdk from 'stremio-addon-sdk';
const { addonBuilder, getRouter } = stremioAddonSdk;
import { scrapeCatalog, scrapeMeta, resolveEpisode } from './yanhh3d.js';

const app = express();
app.use(cors());
const PORT = Number(process.env.PORT || 10000);
const BROWSER_ENABLED = process.env.RESOLVER_BROWSER !== '0';
const BASES = (process.env.YANHH3D_BASES || process.env.YANHH3D_BASE ||
  'https://yanhh3d.co,https://yanhh3d.dev,https://yanhh3d.ac,https://yanhh3d.pw,https://yanhh3d.love,https://yanhh3d.id,https://yanhh3d.net,https://yanhh3d.sh,https://yanhh3d.to,https://yanhh3d.cv')
  .split(',').map(x => x.trim().replace(/\/$/, '')).filter(Boolean);
const PUBLIC_URL = String(process.env.PUBLIC_URL || '').trim().replace(/\/$/, '');
const PROXY_STREAMS = process.env.PROXY_STREAMS !== '0';
const ALLOWED_PROXY_HOSTS = new Set(
  String(process.env.ALLOWED_PROXY_HOSTS || 'yanhh3d.co,yanhh3d.dev,yanhh3d.ac,yanhh3d.pw,yanhh3d.love,yanhh3d.id,yanhh3d.net,yanhh3d.sh,yanhh3d.to,yanhh3d.cv,kkphimplayer6.com,fbcdn.cloud')
    .split(',').map(x => x.trim().toLowerCase()).filter(Boolean)
);

function isAllowedProxyHost(hostname) {
  const host = String(hostname || '').toLowerCase();
  return [...ALLOWED_PROXY_HOSTS].some(allowed => host === allowed || host.endsWith(`.${allowed}`) || (allowed === 'fbcdn.cloud' && host.endsWith('.fbcdn.cloud')));
}

function proxyUrl(sourceUrl, headers = {}) {
  if (!PUBLIC_URL || !PROXY_STREAMS) return sourceUrl;
  const query = new URLSearchParams({ url: sourceUrl });
  if (headers.Referer) query.set('referer', headers.Referer);
  if (headers.Origin) query.set('origin', headers.Origin);
  return `${PUBLIC_URL}/proxy?${query.toString()}`;
}

const manifest = {
  id: 'community.yanhh3d',
  version: '0.5.1',
  name: 'YanHH3D',
  description: 'YanHH3D catalog, episodes and layered stream resolver for Chinese animation.',
  logo: 'https://yanhh3d.pw/favicon.ico',
  resources: ['catalog', 'meta', 'stream'],
  types: ['series', 'movie'],
  catalogs: [
    { type: 'series', id: 'yanhh3d-new', name: 'YanHH3D • Mới cập nhật', extra: [{ name: 'search', isRequired: false }, { name: 'skip', isRequired: false }] },
    { type: 'series', id: 'yanhh3d-3d', name: 'YanHH3D • Hoạt Hình 3D', extra: [{ name: 'search', isRequired: false }, { name: 'skip', isRequired: false }] },
    { type: 'series', id: 'yanhh3d-2d', name: 'YanHH3D • Hoạt Hình 2D', extra: [{ name: 'search', isRequired: false }, { name: 'skip', isRequired: false }] },
    { type: 'series', id: 'yanhh3d-4k', name: 'YanHH3D • 4K', extra: [{ name: 'search', isRequired: false }, { name: 'skip', isRequired: false }] },
    { type: 'series', id: 'yanhh3d-ai', name: 'YanHH3D • AI', extra: [{ name: 'search', isRequired: false }, { name: 'skip', isRequired: false }] },
    { type: 'series', id: 'yanhh3d-complete', name: 'YanHH3D • Đã hoàn thành', extra: [{ name: 'search', isRequired: false }, { name: 'skip', isRequired: false }] },
    { type: 'series', id: 'yanhh3d-airing', name: 'YanHH3D • Đang chiếu', extra: [{ name: 'search', isRequired: false }, { name: 'skip', isRequired: false }] }
  ],
  idPrefixes: ['yanhh3d:'],
  behaviorHints: { configurable: false, configurationRequired: false }
};

const builder = new addonBuilder(manifest);

builder.defineCatalogHandler(async ({ id, extra }) => {
  const skip = Math.max(0, Number(extra?.skip || 0));
  const search = typeof extra?.search === 'string' ? extra.search.trim() : '';
  const metas = await scrapeCatalog(BASES, id, { skip, search });
  return { metas };
});

builder.defineMetaHandler(async ({ id }) => {
  if (!id.startsWith('yanhh3d:')) return { meta: null };
  const slug = id.slice('yanhh3d:'.length).split(':')[0];
  return { meta: await scrapeMeta(BASES, slug) };
});

builder.defineStreamHandler(async ({ id }) => {
  if (!id.startsWith('yanhh3d:')) return { streams: [] };
  const raw = id.slice('yanhh3d:'.length);
  const m = raw.match(/^([^:]+)(?::ep(\d+))?$/);
  if (!m) return { streams: [] };
  const slug = m[1];
  const episode = Number(m[2] || 1);
  const result = await resolveEpisode(BASES, slug, episode);
  if (!result) return { streams: [] };

  const streams = (result.sources || []).map((s, i) => {
    const behaviorHints = {
      notWebReady: false,
      bingeGroup: `yanhh3d-${slug}`
    };
    if (s.headers && Object.keys(s.headers).length) behaviorHints.proxyHeaders = { request: s.headers };
    if (s.videoSize) behaviorHints.videoSize = s.videoSize;
    return {
      name: s.quality ? `YanHH3D ${s.quality}` : `YanHH3D Server ${i + 1}`,
      title: s.type === 'hls' ? 'Native HLS' : s.type === 'mp4' ? 'Native MP4' : 'Video source',
      url: proxyUrl(s.url, s.headers),
      behaviorHints
    };
  });

  if (!streams.length && result.pageUrl) {
    streams.push({
      name: 'YanHH3D',
      title: `Mở trang tập ${episode}`,
      externalUrl: result.pageUrl
    });
  }
  return { streams };
});

app.get('/health', (_req, res) => res.json({ ok: true, bases: BASES, browserResolver: BROWSER_ENABLED, proxyStreams: PROXY_STREAMS && Boolean(PUBLIC_URL) }));

app.get('/proxy', async (req, res) => {
  try {
    const rawUrl = typeof req.query.url === 'string' ? req.query.url : '';
    const target = new URL(rawUrl);
    if (target.protocol !== 'https:' || !isAllowedProxyHost(target.hostname)) {
      return res.status(403).json({ error: 'proxy host is not allowed' });
    }

    const referer = typeof req.query.referer === 'string' ? req.query.referer : `${target.origin}/`;
    const origin = typeof req.query.origin === 'string' ? req.query.origin : '';
    const upstreamHeaders = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36',
      Referer: referer
    };
    if (origin) upstreamHeaders.Origin = origin;
    if (req.headers.range) upstreamHeaders.Range = req.headers.range;

    const upstream = await fetch(target.href, { headers: upstreamHeaders, redirect: 'follow' });
    const contentType = upstream.headers.get('content-type') || '';
    const isPlaylist = /\.m3u8(?:$|[?#])|mpegurl/i.test(target.pathname + target.search + contentType);
    res.status(upstream.status);
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Cache-Control', 'no-store');
    if (!isPlaylist && contentType) res.set('Content-Type', contentType);

    if (isPlaylist) {
      const playlist = await upstream.text();
      const baseUrl = upstream.url || target.href;
      const rewritten = playlist.split(/\r?\n/).map(line => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) return line;
        try {
          const child = new URL(trimmed, baseUrl);
          if (child.protocol !== 'https:' || !isAllowedProxyHost(child.hostname)) return line;
          return proxyUrl(child.href, { Referer: baseUrl, Origin: new URL(baseUrl).origin });
        } catch {
          return line;
        }
      }).join('\n');
      res.set('Content-Type', 'application/vnd.apple.mpegurl; charset=utf-8');
      return res.send(rewritten);
    }

    if (!upstream.body) return res.end();
    return Readable.fromWeb(upstream.body).pipe(res);
  } catch (error) {
    return res.status(400).json({ error: error?.message || 'proxy request failed' });
  }
});
app.get('/debug/resolve/:slug/:episode', async (req, res) => {
  try {
    const episode = Number(req.params.episode);
    if (!/^[-a-z0-9]+$/i.test(req.params.slug) || !Number.isInteger(episode) || episode < 1 || episode > 10000) {
      return res.status(400).json({ error: 'invalid slug or episode' });
    }
    const result = await resolveEpisode(BASES, req.params.slug, episode);
    return res.json(result || { sources: [] });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});
app.get('/manifest.json', (_req, res) => res.json(manifest));
app.use(getRouter(builder.getInterface()));

app.listen(PORT, () => {
  console.log(`YanHH3D Stremio Addon v0.5.1 listening on ${PORT}`);
  console.log(`Bases: ${BASES.join(', ')}`);
});
