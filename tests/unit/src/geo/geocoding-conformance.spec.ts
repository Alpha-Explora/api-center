import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GeocodeService } from '../../../../apps/geo/src/features/geocode/geocode.service';
import {
  createGeocodingProvider, createMockGeocodingProvider, guarded, publicResult, type GeocodingProvider,
} from '../../../../apps/geo/src/shared/geocoding-provider';
import { createGoogleGeocodingAdapter } from '../../../../apps/geo/src/shared/google-geocoding-adapter';

const realFetch = global.fetch;

// A recorded Google Geocoding API result for a Makati address, trimmed to the fields the adapter reads.
const googleResult = {
  formatted_address: 'Ayala Center, Makati, Metro Manila, Philippines',
  place_id: 'ChIJb_2y',
  types: ['establishment', 'point_of_interest'],
  geometry: { location: { lat: 14.5519, lng: 121.0253 }, location_type: 'ROOFTOP' },
  address_components: [
    { long_name: 'San Lorenzo', short_name: 'San Lorenzo', types: ['sublocality_level_1', 'sublocality', 'political'] },
    { long_name: 'Makati', short_name: 'Makati', types: ['locality', 'political'] },
    { long_name: 'Metro Manila', short_name: 'Metro Manila', types: ['administrative_area_level_1', 'political'] },
    { long_name: 'Philippines', short_name: 'PH', types: ['country', 'political'] },
    { long_name: '1223', short_name: '1223', types: ['postal_code'] },
  ],
};

function google(status = 'OK'): GeocodingProvider {
  global.fetch = jest.fn(async () => new Response(JSON.stringify(status === 'OK'
    ? { status, results: [googleResult] } : { status, error_message: 'The provided API key is invalid.' }))) as typeof fetch;
  return createGoogleGeocodingAdapter({ GOOGLE_MAPS_API_KEY: 'key' } as NodeJS.ProcessEnv);
}

const adapters: Array<[string, () => GeocodingProvider]> = [['google', () => google()], ['mock', createMockGeocodingProvider]];

describe('geocoding conformance', () => {
  afterEach(() => { global.fetch = realFetch; });

  describe.each(adapters)('%s adapter', (_name, make) => {
    it('returns a neutral result for an address and for coordinates', async () => {
      const provider = make();
      for (const answer of [await provider.geocode({ address: 'Ayala Center' }),
        await provider.reverse({ latitude: 14.5519, longitude: 121.0253 })]) {
        expect(typeof answer.formattedAddress).toBe('string');
        expect(Number.isFinite(answer.latitude) && Number.isFinite(answer.longitude)).toBe(true);
        expect(answer.components.country).toMatch(/^[A-Z]{2}$/);
        expect(['exact', 'street', 'area', 'approximate']).toContain(answer.precision);
      }
    });
  });

  it('maps Philippine address parts and precision from the provider', async () => {
    const answer = await google().geocode({ address: 'Ayala Center' });
    expect(answer.components).toEqual({ barangay: 'San Lorenzo', city: 'Makati', region: 'Metro Manila',
      postalCode: '1223', country: 'PH' });
    expect(answer.precision).toBe('exact');
  });

  it('still returns placeId, types and raw while deprecated', async () => {
    const provider = google();
    expect(publicResult(provider, await provider.geocode({ address: 'Ayala Center' }))).toMatchObject({
      placeId: 'ChIJb_2y', types: ['establishment', 'point_of_interest'], provider: 'google-maps', raw: googleResult,
      components: { city: 'Makati' }, precision: 'exact' });
  });

  it('reports a provider failure without its message and records it once through the guard', async () => {
    const provider = guarded(google('REQUEST_DENIED'), {} as NodeJS.ProcessEnv);
    await expect(provider.geocode({ address: 'x' })).rejects.toThrow('Geocoding failed: REQUEST_DENIED');
    await expect(provider.geocode({ address: 'x' })).rejects.not.toThrow('API key');
  });

  it('sends the deprecated reverse hints only to the adapter', async () => {
    const provider = google();
    await provider.reverse({ latitude: 1, longitude: 2, hints: { resultType: 'street_address' } });
    expect(String((global.fetch as jest.Mock).mock.calls[0][0])).toContain('result_type=street_address');
  });

  it('services import no adapter directly', () => {
    for (const file of ['features/geocode/geocode.service.ts', 'features/reverse-geocode/reverse-geocode.service.ts', 'server.ts']) {
      expect(readFileSync(join(__dirname, '../../../../apps/geo/src', file), 'utf8')).not.toMatch(/google/i);
    }
  });

  it('uses the mock without a key outside production, and never in production', () => {
    expect(createGeocodingProvider({ NODE_ENV: 'test' } as NodeJS.ProcessEnv).name).toBe('mock');
    expect(createGeocodingProvider({ NODE_ENV: 'production' } as NodeJS.ProcessEnv).name).toBe('google-maps');
    expect(() => createGeocodingProvider({ NODE_ENV: 'production', GEOCODING_PROVIDER: 'mock' } as NodeJS.ProcessEnv)).toThrow();
  });

  it('caches the public result per request', async () => {
    const provider = createMockGeocodingProvider();
    const spy = jest.spyOn(provider, 'geocode');
    const service = new GeocodeService(provider);
    await service.execute({ address: `cache-${Date.now()}` });
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
