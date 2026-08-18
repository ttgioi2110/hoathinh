import express from 'express';
import cors from 'cors';
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
      url: s.url,
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

app.get('/health', (_req, res) => res.json({ ok: true, bases: BASES, browserResolver: BROWSER_ENABLED }));
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