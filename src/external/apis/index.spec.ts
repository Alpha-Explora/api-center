import { ConfigService } from '../../config/config.service';
import {
  buildExternalApis,
  createGeolocationApi,
  createGeotaggingApi,
  createGeofencingApi,
} from './index';

describe('external api builders', () => {
  const config = {
    external: {
      geolocation: {
        url: 'https://geo.example.com',
        key: 'geo-key',
      },
      geotagging: {
        url: 'https://tag.example.com',
        key: 'tag-key',
      },
      geofencing: {
        url: 'https://fence.example.com',
        key: 'fence-key',
      },
    },
  } as unknown as ConfigService;

  it('should build all external api configs from ConfigService', () => {
    const apis = buildExternalApis(config);

    expect(Object.keys(apis).sort()).toEqual(['geofencing', 'geolocation', 'geotagging']);
    expect(apis.geolocation.baseUrl).toBe('https://geo.example.com');
    expect(apis.geotagging.baseUrl).toBe('https://tag.example.com');
    expect(apis.geofencing.baseUrl).toBe('https://fence.example.com');
  });

  it('should create geolocation api config with api-key auth contract', () => {
    const api = createGeolocationApi(config);

    expect(api).toEqual(
      expect.objectContaining({
        name: 'geolocation',
        displayName: 'Geolocation API',
        authType: 'apiKey',
        authHeader: 'X-Goog-Api-Key',
        authValue: 'geo-key',
        healthEndpoint: '/geolocation/v1/geolocate',
        timeout: 10_000,
      }),
    );
  });

  it('should create geotagging api config with X-API-Key header contract', () => {
    const api = createGeotaggingApi(config);

    expect(api).toEqual(
      expect.objectContaining({
        name: 'geotagging',
        authType: 'apiKey',
        authHeader: 'X-API-Key',
        authValue: 'tag-key',
      }),
    );
  });

  it('should create geofencing api config with bearer auth contract', () => {
    const api = createGeofencingApi(config);

    expect(api).toEqual(
      expect.objectContaining({
        name: 'geofencing',
        authType: 'bearer',
        authHeader: 'Authorization',
        authValue: 'fence-key',
      }),
    );
  });

});
