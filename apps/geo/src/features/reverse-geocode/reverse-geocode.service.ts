import { createGeoCache } from '../../shared/geo-cache';
import { shouldUseMock, mockGeocode, callGoogleGeocoding } from '../../shared/google-maps-provider';

const geoCache = createGeoCache();

export class ReverseGeocodeService {
  async execute(input: { latitude: number; longitude: number; language?: string; resultType?: string; locationType?: string }) {
    const { latitude, longitude, language, resultType, locationType } = input;
    return geoCache.getOrLoad(
      {
        type: 'reverse',
        latitude,
        longitude,
        language,
        resultType,
        locationType,
      },
      async () => (shouldUseMock()
        ? mockGeocode('Manila, Philippines')
        : callGoogleGeocoding({
          latlng: `${latitude},${longitude}`,
          language,
          result_type: resultType,
          location_type: locationType,
        })),
    );
  }
}
