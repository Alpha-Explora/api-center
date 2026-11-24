import { createGeoCache } from '../../shared/geo-cache';
import { createGeocodingProvider, publicResult, type GeocodingProvider } from '../../shared/geocoding-provider';

const geoCache = createGeoCache();

export class ReverseGeocodeService {
  constructor(private readonly provider: GeocodingProvider = createGeocodingProvider()) {}

  /** resultType and locationType are deprecated; they reach only providers that honour them. */
  async execute(input: { latitude: number; longitude: number; language?: string; resultType?: string; locationType?: string }) {
    const { latitude, longitude, language, resultType, locationType } = input;
    return geoCache.getOrLoad(
      { type: 'reverse', latitude, longitude, language, resultType, locationType },
      async () => publicResult(this.provider, await this.provider.reverse({ latitude, longitude, language,
        hints: { resultType, locationType } })),
    );
  }
}
