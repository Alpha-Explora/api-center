import type { GeoAddressResult, GeoFenceCheckRequest, GeoFenceCheckResponse, GeoGeocodeRequest, GeoReverseGeocodeRequest } from '@alpha-explora/apicenter-contracts';
import type { ApiCenterTransport } from '../internal/transport.js';
import type { RequestOptions } from '../types.js';

export class GeoClient {
  constructor(private readonly transport: ApiCenterTransport) {}

  /** @sdk-operation geo.geocode POST /api/v1/shared/geo/geocode */
  geocode(input: GeoGeocodeRequest, options?: RequestOptions): Promise<GeoAddressResult> {
    return this.transport.request({ path: '/api/v1/shared/geo/geocode', method: 'POST', body: input, options });
  }

  /** @sdk-operation geo.reverseGeocode POST /api/v1/shared/geo/reverse-geocode */
  reverseGeocode(input: GeoReverseGeocodeRequest, options?: RequestOptions): Promise<GeoAddressResult> {
    return this.transport.request({ path: '/api/v1/shared/geo/reverse-geocode', method: 'POST', body: input, options });
  }

  /** @sdk-operation geo.checkGeofence POST /api/v1/shared/geo/geofence/check */
  checkGeofence(input: GeoFenceCheckRequest, options?: RequestOptions): Promise<GeoFenceCheckResponse> {
    return this.transport.request({ path: '/api/v1/shared/geo/geofence/check', method: 'POST', body: input, options });
  }
}
