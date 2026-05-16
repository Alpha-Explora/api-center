import { ServiceRegistryEntry, ServiceRegistryMap } from "../types";

export const REGISTRY_STORE = Symbol("REGISTRY_STORE");

export interface RegistryStore {
  loadAll(): Promise<ServiceRegistryMap>;
  upsert(entry: ServiceRegistryEntry): Promise<void>;
  remove(serviceId: string): Promise<void>;
}
