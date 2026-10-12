import type { GeocodeRequest } from '@alpha-explora/apicenter-contracts';
import { createGeoCache } from '../../shared/geo-cache';
import { shouldUseMock, mockGeocode, callGoogleGeocoding } from '../../shared/google-maps-provider';

const geoCache = createGeoCache();

export class GeocodeService {
  async execute(input: GeocodeRequest & { language?: string; region?: string }) {
    const { address, language, region } = input;
    return geoCache.getOrLoad(
      { type: 'geocode', address, language, region },
      async () => (shouldUseMock()
        ? mockGeocode(address)
        : callGoogleGeocoding({ address, language, region })),
    );
  }
}
