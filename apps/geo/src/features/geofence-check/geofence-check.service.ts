import { distanceMeters } from './geofence-check.model';

const defaultFences = [
  {
    fenceId: 'metro-manila',
    name: 'Metro Manila',
    latitude: 14.5995,
    longitude: 120.9842,
    radiusMeters: 50000,
  },
];

export class GeofenceCheckService {
  execute(input: { latitude: number; longitude: number; fenceId?: string; fences?: any[] }) {
    const { latitude, longitude, fenceId, fences: suppliedFences } = input;
    const sourceFences = Array.isArray(suppliedFences) && suppliedFences.length > 0 ? suppliedFences : defaultFences;
    const fences = fenceId
      ? sourceFences.filter((fence: any) => fence.fenceId === fenceId)
      : sourceFences;
    const point = { latitude, longitude };
    const distanceDetails = fences
      .filter((fence: any) => Number.isFinite(Number(fence.latitude)) && Number.isFinite(Number(fence.longitude)))
      .map((fence: any) => {
        const radiusMeters = Number(fence.radiusMeters);
        const distance = distanceMeters(point, {
          latitude: Number(fence.latitude),
          longitude: Number(fence.longitude),
        });

        return {
          fenceId: fence.fenceId,
          name: fence.name,
          inside: distance <= radiusMeters,
          distanceMeters: Math.round(distance),
          radiusMeters,
        };
      });

    return {
      inside: distanceDetails.some((detail: any) => detail.inside),
      distanceDetails,
      provider: 'local',
    };
  }
}
