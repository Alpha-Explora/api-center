import type { GeocodeRequest } from '@alpha-explora/apicenter-contracts';
import { createGeoCache } from '../../shared/geo-cache';
import { createGeocodingProvider, publicResult, type GeocodingProvider } from '../../shared/geocoding-provider';

const geoCache = createGeoCache();

export class GeocodeService {
  constructor(private readonly provider: GeocodingProvider = createGeocodingProvider()) {}

  async execute(input: GeocodeRequest & { language?: string; region?: string }) {
    const { address, language, region } = input;
    return geoCache.getOrLoad(
      { type: 'geocode', address, language, region },
      async () => publicResult(this.provider, await this.provider.geocode({ address, language, region })),
    );
  }
}
