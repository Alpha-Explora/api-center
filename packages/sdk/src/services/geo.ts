import type { GeoAddressResult, GeoFenceCheckRequest, GeoFenceCheckResponse, GeoGeocodeRequest, GeoReverseGeocodeRequest } from '@apicenter/contracts';
import type { RequestOptions } from '../types';
import { ApiCenterTransport } from '../internal/transport';

export class GeoClient {
  constructor(private readonly transport: ApiCenterTransport) {}

  /** @sdk-operation geo.geocodeAddress POST /api/v1/shared/geo/geocode */
  geocodeAddress(input: GeoGeocodeRequest, options?: RequestOptions): Promise<GeoAddressResult> {
    return this.transport.request({
      path: '/api/v1/shared/geo/geocode', method: 'POST', credential: 'service', body: input, options,
    });
  }

  /** @sdk-operation geo.reverseGeocode POST /api/v1/shared/geo/reverse-geocode */
  reverseGeocode(input: GeoReverseGeocodeRequest, options?: RequestOptions): Promise<GeoAddressResult> {
    return this.transport.request({
      path: '/api/v1/shared/geo/reverse-geocode', method: 'POST', credential: 'service', body: input, options,
    });
  }

  /** @sdk-operation geo.checkFence POST /api/v1/shared/geo/geofence/check */
  checkFence(input: GeoFenceCheckRequest, options?: RequestOptions): Promise<GeoFenceCheckResponse> {
    return this.transport.request({
      path: '/api/v1/shared/geo/geofence/check', method: 'POST', credential: 'service', body: input, options,
    });
  }
}
