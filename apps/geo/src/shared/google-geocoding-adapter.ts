// Google Maps Platform geocoding, translated into APICenter's neutral result. Only this file knows Google's
// request parameters and response shape.
import type { AddressComponents, GeocodingAnswer, GeocodingPrecision, GeocodingProvider } from './geocoding-provider';

type GoogleComponent = { long_name?: string; short_name?: string; types?: string[] };

const PRECISION: Record<string, GeocodingPrecision> = {
  ROOFTOP: 'exact',
  RANGE_INTERPOLATED: 'street',
  GEOMETRIC_CENTER: 'area',
  APPROXIMATE: 'approximate',
};

/** Maps Google's address components onto Philippine address parts. */
export function addressComponents(components: GoogleComponent[] = []): AddressComponents {
  const find = (...types: string[]) => {
    for (const type of types) {
      const component = components.find((entry) => entry.types?.includes(type));
      if (component?.long_name) return component;
    }
    return undefined;
  };
  const part = (...types: string[]) => find(...types)?.long_name;
  return {
    ...(part('street_number') ? { streetNumber: part('street_number') } : {}),
    ...(part('route') ? { street: part('route') } : {}),
    ...(part('sublocality_level_1', 'administrative_area_level_5', 'neighborhood')
      ? { barangay: part('sublocality_level_1', 'administrative_area_level_5', 'neighborhood') } : {}),
    ...(part('locality', 'administrative_area_level_3') ? { city: part('locality', 'administrative_area_level_3') } : {}),
    ...(part('administrative_area_level_2') ? { province: part('administrative_area_level_2') } : {}),
    ...(part('administrative_area_level_1') ? { region: part('administrative_area_level_1') } : {}),
    ...(part('postal_code') ? { postalCode: part('postal_code') } : {}),
    country: find('country')?.short_name || 'PH',
  };
}

export function createGoogleGeocodingAdapter(env: NodeJS.ProcessEnv = process.env): GeocodingProvider {
  const apiKey = env.GOOGLE_MAPS_API_KEY || '';
  const endpoint = env.GOOGLE_MAPS_GEOCODING_URL || 'https://maps.googleapis.com/maps/api/geocode/json';

  async function lookup(params: Record<string, string | undefined>): Promise<GeocodingAnswer> {
    if (!apiKey) throw new Error('The geocoding provider is not configured');
    const url = new URL(endpoint);
    for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== '') url.searchParams.set(key, value);
    url.searchParams.set('key', apiKey);
    const response = await fetch(url.toString());
    const body: any = await response.json();
    if (!response.ok || body?.status !== 'OK') {
      throw new Error(`Geocoding failed: ${body?.status || `HTTP ${response.status}`}`);
    }
    const first = Array.isArray(body?.results) ? body.results[0] : undefined;
    if (!first) throw new Error('The geocoding provider returned no results');
    const location = first.geometry?.location || {};
    return {
      formattedAddress: first.formatted_address || '',
      latitude: Number(location.lat),
      longitude: Number(location.lng),
      components: addressComponents(first.address_components),
      precision: PRECISION[first.geometry?.location_type] ?? 'approximate',
      deprecated: { placeId: first.place_id, types: Array.isArray(first.types) ? first.types : [], raw: first },
    };
  }

  return {
    name: 'google-maps',
    configured: Boolean(apiKey),
    geocode: (input) => lookup({ address: input.address, language: input.language, region: input.region }),
    reverse: (input) => lookup({ latlng: `${input.latitude},${input.longitude}`, language: input.language,
      result_type: input.hints?.resultType, location_type: input.hints?.locationType }),
  };
}
