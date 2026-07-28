const path = require('node:path');
const {
  createCircuitBreaker,
  createSharedServiceApp,
  fail,
  ok,
  recordProviderMetric,
  registerWithGateway: registerSharedServiceWithGateway,
  withProviderTimeout,
} = require('@apicenter/runtime');
const { createGeoCache } = require('./geoCache');

const port = Number(process.env.PORT || 4015);
const nodeEnv = process.env.NODE_ENV || 'development';
const googleMapsApiKey = process.env.GOOGLE_MAPS_API_KEY || '';
const providerTimeoutMs = Number(process.env.GEO_PROVIDER_TIMEOUT_MS || 1500);
const geocodingUrl =
  process.env.GOOGLE_MAPS_GEOCODING_URL ||
  'https://maps.googleapis.com/maps/api/geocode/json';
const geoCache = createGeoCache();
const googleMapsCircuit = createCircuitBreaker({
  provider: 'google_maps',
  failureThreshold: Number(process.env.GEO_PROVIDER_FAILURE_THRESHOLD || 5),
  resetAfterMs: Number(process.env.GEO_PROVIDER_CIRCUIT_RESET_MS || 30_000),
});
const { app } = createSharedServiceApp({
  serviceId: 'geo-gateway',
  health: {
    status: 'ok',
    service: 'geo-gateway',
    googleMapsEnabled: Boolean(googleMapsApiKey),
    mode: shouldUseMock() ? 'mock' : 'google-maps',
  },
});

const defaultFences = [
  {
    fenceId: 'metro-manila',
    name: 'Metro Manila',
    latitude: 14.5995,
    longitude: 120.9842,
    radiusMeters: 50000,
  },
];

function shouldUseMock() {
  return !googleMapsApiKey && nodeEnv !== 'production';
}

function assertGoogleMapsConfigured(res) {
  if (googleMapsApiKey || shouldUseMock()) {
    return true;
  }

  fail(
    res,
    500,
    'GOOGLE_MAPS_CONFIG_ERROR',
    'GOOGLE_MAPS_API_KEY is required in production.',
  );
  return false;
}

function normalizeGoogleGeocodeResult(result) {
  const location = result?.geometry?.location || {};

  return {
    formattedAddress: result?.formatted_address || '',
    latitude: Number(location.lat),
    longitude: Number(location.lng),
    placeId: result?.place_id,
    types: Array.isArray(result?.types) ? result.types : [],
    provider: 'google-maps',
    raw: result,
  };
}

function mockGeocode(address) {
  return {
    formattedAddress: address || 'Manila, Philippines',
    latitude: 14.5995,
    longitude: 120.9842,
    placeId: 'mock-place-id',
    types: ['locality', 'political'],
    provider: 'mock',
  };
}

async function callGoogleGeocoding(params) {
  const url = new URL(geocodingUrl);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') {
      url.searchParams.set(key, String(value));
    }
  }
  url.searchParams.set('key', googleMapsApiKey);

  const startedAt = Date.now();
  const response = await googleMapsCircuit.exec(() => withProviderTimeout(
    fetch(url),
    {
      timeoutMs: providerTimeoutMs,
      provider: 'google_maps',
      operation: params.latlng ? 'reverse_geocode' : 'geocode',
    },
  ));
  recordProviderMetric({
    serviceId: 'geo',
    provider: 'google_maps',
    operation: params.latlng ? 'reverse_geocode' : 'geocode',
    status: response.ok ? 'success' : 'error',
    latencyMs: Date.now() - startedAt,
  });
  const body = await response.json();

  if (!response.ok || body.status !== 'OK') {
    const message = body.error_message || body.status || `HTTP ${response.status}`;
    throw new Error(message);
  }

  const firstResult = Array.isArray(body.results) ? body.results[0] : undefined;
  if (!firstResult) {
    throw new Error('Google Maps returned no geocoding results.');
  }

  return normalizeGoogleGeocodeResult(firstResult);
}

function distanceMeters(a, b) {
  const earthRadiusMeters = 6371000;
  const lat1 = (a.latitude * Math.PI) / 180;
  const lat2 = (b.latitude * Math.PI) / 180;
  const deltaLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const deltaLng = ((b.longitude - a.longitude) * Math.PI) / 180;
  const sinLat = Math.sin(deltaLat / 2);
  const sinLng = Math.sin(deltaLng / 2);
  const h =
    sinLat * sinLat +
    Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng;

  return 2 * earthRadiusMeters * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

app.post('/geocode', async (req, res) => {
  const { address, language, region } = req.body || {};
  if (!address || typeof address !== 'string') {
    return fail(res, 400, 'INVALID_REQUEST', 'address is required.');
  }

  if (!assertGoogleMapsConfigured(res)) {
    return undefined;
  }

  try {
    const data = await geoCache.getOrLoad(
      { type: 'geocode', address, language, region },
      () => (shouldUseMock()
        ? mockGeocode(address)
        : callGoogleGeocoding({ address, language, region })),
    );
    return ok(res, data);
  } catch (error) {
    return fail(res, 502, 'GOOGLE_MAPS_GEOCODING_FAILED', error.message);
  }
});

app.post('/reverse-geocode', async (req, res) => {
  const { latitude, longitude, language, resultType, locationType } = req.body || {};
  const lat = Number(latitude);
  const lng = Number(longitude);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return fail(res, 400, 'INVALID_REQUEST', 'latitude and longitude are required numbers.');
  }

  if (!assertGoogleMapsConfigured(res)) {
    return undefined;
  }

  try {
    const data = await geoCache.getOrLoad(
      {
        type: 'reverse',
        latitude: lat,
        longitude: lng,
        language,
        resultType,
        locationType,
      },
      () => (shouldUseMock()
        ? mockGeocode('Manila, Philippines')
        : callGoogleGeocoding({
          latlng: `${lat},${lng}`,
          language,
          result_type: resultType,
          location_type: locationType,
        })),
    );
    return ok(res, data);
  } catch (error) {
    return fail(res, 502, 'GOOGLE_MAPS_REVERSE_GEOCODING_FAILED', error.message);
  }
});

app.post('/geofence/check', (req, res) => {
  const { latitude, longitude, fenceId } = req.body || {};
  const lat = Number(latitude);
  const lng = Number(longitude);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return fail(res, 400, 'INVALID_REQUEST', 'latitude and longitude are required numbers.');
  }

  const suppliedFences = Array.isArray(req.body?.fences) ? req.body.fences : [];
  const sourceFences = suppliedFences.length > 0 ? suppliedFences : defaultFences;
  const fences = fenceId
    ? sourceFences.filter((fence) => fence.fenceId === fenceId)
    : sourceFences;
  const point = { latitude: lat, longitude: lng };
  const distanceDetails = fences
    .filter((fence) => Number.isFinite(Number(fence.latitude)) && Number.isFinite(Number(fence.longitude)))
    .map((fence) => {
      const radiusMeters = Number(fence.radiusMeters);
      const distance = distanceMeters(point, {
        latitude: Number(fence.latitude),
        longitude: Number(fence.longitude),
      });

      return {
        fenceId: fence.fenceId,
        name: fence.name,
        inside: distance <= radiusMeters,
        distanceMeters: Math.round(distance),
        radiusMeters,
      };
    });

  return ok(res, {
    inside: distanceDetails.some((detail) => detail.inside),
    distanceDetails,
    provider: 'local',
  });
});

async function registerWithGateway() {
  return registerSharedServiceWithGateway({
    manifestPath: path.resolve(__dirname, '../service-manifest.json'),
    baseUrl: process.env.SERVICE_BASE_URL,
    serviceLabel: 'geo-gateway',
  });
}

if (require.main === module) {
  app.listen(port, () => {
    console.log(`[geo-gateway] listening on port ${port}`);
    registerWithGateway();
  });
}

module.exports = {
  app,
  callGoogleGeocoding,
  distanceMeters,
  registerWithGateway,
};
