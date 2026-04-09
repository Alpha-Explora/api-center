const express = require('express');

const app = express();
app.use(express.json({ limit: '1mb' }));

const PORT = Number(process.env.PORT || 8085);

const FENCES = [
  {
    id: 'warehouse-zone',
    name: 'Warehouse Zone',
    center: { latitude: 13.7563, longitude: 100.5018 },
    radiusMeters: 5000,
    tags: ['ops', 'warehouse', 'bangkok'],
  },
  {
    id: 'airport-zone',
    name: 'Airport Zone',
    center: { latitude: 13.6900, longitude: 100.7501 },
    radiusMeters: 4000,
    tags: ['ops', 'airport'],
  },
  {
    id: 'port-zone',
    name: 'Port Zone',
    center: { latitude: 13.0827, longitude: 100.8830 },
    radiusMeters: 6000,
    tags: ['ops', 'port'],
  },
];

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeIp(ipRaw) {
  const ip = String(ipRaw || '').trim();
  if (!ip) return '127.0.0.1';
  if (ip === '::1') return '127.0.0.1';
  if (ip.startsWith('::ffff:')) return ip.slice('::ffff:'.length);
  return ip;
}

function hashToGeo(ip) {
  let hash = 0;
  for (const ch of ip) {
    hash = ((hash << 5) - hash + ch.charCodeAt(0)) | 0;
  }

  const positive = Math.abs(hash);
  const lat = ((positive % 12000) / 100) - 60;
  const lng = (((positive >> 4) % 36000) / 100) - 180;

  return {
    latitude: Number(lat.toFixed(6)),
    longitude: Number(lng.toFixed(6)),
  };
}

function haversineMeters(aLat, aLng, bLat, bLng) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const R = 6371e3;

  const phi1 = toRad(aLat);
  const phi2 = toRad(bLat);
  const deltaPhi = toRad(bLat - aLat);
  const deltaLambda = toRad(bLng - aLng);

  const x =
    Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) *
    Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);

  const y = 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  return R * y;
}

function evaluateFences(latitude, longitude, fenceId) {
  const source = fenceId ? FENCES.filter((f) => f.id === fenceId) : FENCES;

  const checks = source.map((fence) => {
    const distanceMeters = haversineMeters(
      latitude,
      longitude,
      fence.center.latitude,
      fence.center.longitude,
    );

    return {
      fenceId: fence.id,
      fenceName: fence.name,
      distanceMeters: Number(distanceMeters.toFixed(2)),
      inside: distanceMeters <= fence.radiusMeters,
      radiusMeters: fence.radiusMeters,
      tags: fence.tags,
    };
  });

  const matched = checks.filter((entry) => entry.inside);
  const nearest = checks.sort((a, b) => a.distanceMeters - b.distanceMeters)[0] || null;

  return {
    inside: matched.length > 0,
    matchedFences: matched,
    nearestFence: nearest,
    checkedCount: checks.length,
  };
}

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    provider: 'geo-provider-mock',
    timestamp: new Date().toISOString(),
  });
});

app.get('/lookup', (req, res) => {
  const ip = normalizeIp(req.query.ip || req.ip);
  const geo = hashToGeo(ip);

  res.json({
    ip,
    latitude: geo.latitude,
    longitude: geo.longitude,
    country: 'TH',
    region: 'Bangkok',
    city: 'Bangkok',
    source: 'geo-provider-mock',
  });
});

app.get('/v3/ipgeo', (req, res) => {
  const ip = normalizeIp(req.query.ip || req.ip);
  const geo = hashToGeo(ip);

  res.json({
    ip,
    location: {
      country_code2: 'TH',
      country_name: 'Thailand',
      state_prov: 'Bangkok',
      city: 'Bangkok',
      latitude: String(geo.latitude),
      longitude: String(geo.longitude),
    },
    time_zone: {
      name: 'Asia/Bangkok',
      offset: 7,
    },
    provider: 'geo-provider-mock',
  });
});

app.get('/v1/geofences', (_req, res) => {
  res.json({
    fences: FENCES,
    count: FENCES.length,
    provider: 'geo-provider-mock',
  });
});

app.get('/v1/geofences/:id', (req, res) => {
  const found = FENCES.find((fence) => fence.id === req.params.id);
  if (!found) {
    return res.status(404).json({
      message: `Fence '${req.params.id}' not found`,
      provider: 'geo-provider-mock',
    });
  }

  return res.json({
    fence: found,
    provider: 'geo-provider-mock',
  });
});

app.post('/v1/geofences/check', (req, res) => {
  const latitude = toNumber(req.body?.latitude, NaN);
  const longitude = toNumber(req.body?.longitude, NaN);
  const fenceId = req.body?.fenceId;

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return res.status(400).json({
      message: 'latitude and longitude are required numbers',
      provider: 'geo-provider-mock',
    });
  }

  const result = evaluateFences(latitude, longitude, fenceId);

  return res.json({
    latitude,
    longitude,
    ...result,
    provider: 'geo-provider-mock',
  });
});

app.get('/v1/geotags/:id', (req, res) => {
  res.json({
    geotag: {
      id: req.params.id,
      description: 'Mock geotag schema entry',
      keys: ['country', 'region', 'geo.bucket', 'fence.zone'],
    },
    provider: 'geo-provider-mock',
  });
});

app.post('/v1/geotags/resolve', (req, res) => {
  const ip = req.body?.ip ? normalizeIp(req.body.ip) : null;

  let latitude = toNumber(req.body?.latitude, NaN);
  let longitude = toNumber(req.body?.longitude, NaN);

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    const fallbackGeo = hashToGeo(ip || '127.0.0.1');
    latitude = fallbackGeo.latitude;
    longitude = fallbackGeo.longitude;
  }

  const geofence = evaluateFences(latitude, longitude, req.body?.fenceId);

  const baseTags = [
    { key: 'country', value: 'TH', confidence: 0.99 },
    { key: 'region', value: 'Bangkok', confidence: 0.95 },
    { key: 'geo.bucket', value: `${latitude.toFixed(2)},${longitude.toFixed(2)}`, confidence: 0.9 },
  ];

  const fenceTags = geofence.matchedFences.map((fence) => ({
    key: 'fence.zone',
    value: fence.fenceId,
    confidence: 1,
  }));

  res.json({
    input: { ip, latitude, longitude },
    tags: [...baseTags, ...fenceTags],
    geofence,
    provider: 'geo-provider-mock',
  });
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`geo-provider-mock listening on ${PORT}`);
});
