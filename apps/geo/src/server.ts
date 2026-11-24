import { Request, Response } from 'express';
import {
  createSharedServiceApp,
  createRuntimeContextGate,
  fail,
  ok,
} from '@apicenter/runtime';
import { GeocodeService } from './features/geocode/geocode.service';
import { ReverseGeocodeService } from './features/reverse-geocode/reverse-geocode.service';
import { GeofenceCheckService } from './features/geofence-check/geofence-check.service';
import { createGeocodingProvider } from './shared/geocoding-provider';

const port = Number(process.env.PORT || 4015);
const geocoding = createGeocodingProvider();
const geocodingConfigured = geocoding.configured;

const { app } = createSharedServiceApp({
  serviceId: 'geo-gateway',
  health: {
    status: 'ok',
    service: 'geo-gateway',
    geocodingConfigured,
    architecture: 'enterprise-feature-sliced',
    mode: geocoding.name,
  },
});

const geocodeService = new GeocodeService(geocoding);
const reverseGeocodeService = new ReverseGeocodeService(geocoding);
const geofenceCheckService = new GeofenceCheckService();

function assertGeocodingConfigured(res: Response): boolean {
  if (geocodingConfigured) return true;
  fail(res, 503, 'GEOCODING_NOT_CONFIGURED', 'Geocoding is not configured.');
  return false;
}

/** Geocoding responses still carry placeId, types, provider and raw, which are deprecated (ADR-0010). */
function announceDeprecatedFields(res: Response) {
  res.setHeader('Deprecation', 'true');
  res.setHeader('Sunset', 'Mon, 01 Mar 2027 00:00:00 GMT');
}

/** The provider's error stays in the log; callers get APICenter's code and message (ADR-0010). */
function geocodingFailed(res: Response, operation: string, error: unknown) {
  console.warn(JSON.stringify({ type: 'apicenter_geocoding_failed', operation, provider: geocoding.name,
    message: error instanceof Error ? error.message : String(error) }));
  return fail(res, 502, 'GEOCODING_FAILED', 'The address could not be geocoded. Try again later.');
}

// Control-plane application calls carry a signed context; an invalid one is rejected.
app.use(createRuntimeContextGate('apicenter-runtime:geo'));

app.post('/geocode', async (req: Request, res: Response) => {
  const { address } = req.body || {};
  if (!address || typeof address !== 'string') {
    return fail(res, 400, 'INVALID_REQUEST', 'address is required.');
  }

  if (!assertGeocodingConfigured(res)) {
    return undefined;
  }

  try {
    const data = await geocodeService.execute(req.body);
    announceDeprecatedFields(res);
    return ok(res, data);
  } catch (error) {
    return geocodingFailed(res, 'geocode', error);
  }
});

app.post('/reverse-geocode', async (req: Request, res: Response) => {
  const { latitude, longitude } = req.body || {};
  const lat = Number(latitude);
  const lng = Number(longitude);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return fail(res, 400, 'INVALID_REQUEST', 'latitude and longitude are required numbers.');
  }

  if (!assertGeocodingConfigured(res)) {
    return undefined;
  }

  try {
    const data = await reverseGeocodeService.execute({ ...req.body, latitude: lat, longitude: lng });
    announceDeprecatedFields(res);
    return ok(res, data);
  } catch (error) {
    return geocodingFailed(res, 'reverse_geocode', error);
  }
});

app.post('/geofence/check', (req: Request, res: Response) => {
  const { latitude, longitude } = req.body || {};
  const lat = Number(latitude);
  const lng = Number(longitude);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return fail(res, 400, 'INVALID_REQUEST', 'latitude and longitude are required numbers.');
  }

  const data = geofenceCheckService.execute({ ...req.body, latitude: lat, longitude: lng });
  return ok(res, data);
});

if (require.main === module) {
  app.listen(port, () => {
    console.log(`[geo-gateway] listening on port ${port}`);
  });
}

export { app };
