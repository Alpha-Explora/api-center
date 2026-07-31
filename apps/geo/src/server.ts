import path from 'node:path';
import { Request, Response } from 'express';
import {
  createSharedServiceApp,
  fail,
  ok,
  registerWithGateway as registerSharedServiceWithGateway,
} from '@apicenter/runtime';
import { GeocodeService } from './features/geocode/geocode.service';
import { ReverseGeocodeService } from './features/reverse-geocode/reverse-geocode.service';
import { GeofenceCheckService } from './features/geofence-check/geofence-check.service';
import { shouldUseMock } from './shared/google-maps-provider';

const port = Number(process.env.PORT || 4015);
const googleMapsApiKey = process.env.GOOGLE_MAPS_API_KEY || '';

const { app } = createSharedServiceApp({
  serviceId: 'geo-gateway',
  health: {
    status: 'ok',
    service: 'geo-gateway',
    googleMapsEnabled: Boolean(googleMapsApiKey),
    architecture: 'enterprise-feature-sliced',
    mode: shouldUseMock() ? 'mock' : 'google-maps',
  },
});

const geocodeService = new GeocodeService();
const reverseGeocodeService = new ReverseGeocodeService();
const geofenceCheckService = new GeofenceCheckService();

function assertGoogleMapsConfigured(res: Response): boolean {
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

app.post('/geocode', async (req: Request, res: Response) => {
  const { address } = req.body || {};
  if (!address || typeof address !== 'string') {
    return fail(res, 400, 'INVALID_REQUEST', 'address is required.');
  }

  if (!assertGoogleMapsConfigured(res)) {
    return undefined;
  }

  try {
    const data = await geocodeService.execute(req.body);
    return ok(res, data);
  } catch (error: any) {
    return fail(res, 502, 'GOOGLE_MAPS_GEOCODING_FAILED', error?.message || 'Geocoding failed');
  }
});

app.post('/reverse-geocode', async (req: Request, res: Response) => {
  const { latitude, longitude } = req.body || {};
  const lat = Number(latitude);
  const lng = Number(longitude);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return fail(res, 400, 'INVALID_REQUEST', 'latitude and longitude are required numbers.');
  }

  if (!assertGoogleMapsConfigured(res)) {
    return undefined;
  }

  try {
    const data = await reverseGeocodeService.execute({ ...req.body, latitude: lat, longitude: lng });
    return ok(res, data);
  } catch (error: any) {
    return fail(res, 502, 'GOOGLE_MAPS_REVERSE_GEOCODING_FAILED', error?.message || 'Reverse geocoding failed');
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

export async function registerWithGateway() {
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

export { app };
