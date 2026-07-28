import { Injectable, Optional } from "@nestjs/common";
import { readFile } from "node:fs/promises";
import { z } from "zod";

import { PipelineHealthEnvironment } from "./pipeline-health.dto";
import {
  PhysicalPipelineEnvironment,
  toPhysicalPipelineEnvironment,
  toPublicPipelineEnvironment,
} from "./pipeline-environment";

export const EVENT_SCHEMA_COMPATIBILITY_MODES = [
  "backward",
  "forward",
  "full",
  "none-for-test-only",
] as const;

export type EventSchemaCompatibilityMode =
  (typeof EVENT_SCHEMA_COMPATIBILITY_MODES)[number];

export const EVENT_SCHEMA_STATUSES = [
  "approved",
  "pending_approval",
  "draft",
  "deprecated",
  "rejected",
] as const;

export type EventSchemaStatus = (typeof EVENT_SCHEMA_STATUSES)[number];

export type EventJsonSchema = {
  type?: "object";
  required?: string[];
  properties?: Record<string, { type?: string }>;
};

export interface EventSchemaRecord {
  tribeId: string;
  eventType: string;
  schemaVersion: string;
  environment: PipelineHealthEnvironment;
  physicalEnvironment: PhysicalPipelineEnvironment;
  owner: string;
  steward: string;
  jsonSchema: EventJsonSchema;
  compatibilityMode: EventSchemaCompatibilityMode;
  status: EventSchemaStatus;
  approvedBy?: string;
  approvedAt?: string;
}

export type EventSchemaValidationStatus =
  | "approved"
  | "test_discovery"
  | "rejected";

export interface EventSchemaValidationInput {
  environment: PipelineHealthEnvironment;
  tribeId: string;
  eventType: string;
  schemaVersion?: string;
  payload?: Record<string, unknown>;
  allowTestDiscovery?: boolean;
}

export interface EventSchemaValidationResult {
  accepted: boolean;
  schemaValidationStatus: EventSchemaValidationStatus;
  schemaRegistryVersion: string;
  schemaValidationError?: string;
  record?: EventSchemaRecord;
}

export interface EventSchemaRegistryServiceOptions {
  records?: EventSchemaRecord[];
  registryVersion?: string;
  registryFilePath?: string;
  allowTestDiscovery?: boolean;
}

export interface EventSchemaRegistryListFilter {
  environment?: PipelineHealthEnvironment;
  tribeId?: string;
}

type LoadedRegistry = {
  records: EventSchemaRecord[];
  registryVersion: string;
};

const DEFAULT_EVENT_SCHEMA_VERSION = "1.0.0";
const DEFAULT_REGISTRY_VERSION = "empty-registry";

const RawEventSchemaRecordSchema = z.object({
  tribeId: z.string().optional(),
  tribe_id: z.string().optional(),
  eventType: z.string().optional(),
  event_type: z.string().optional(),
  schemaVersion: z.string().optional(),
  schema_version: z.string().optional(),
  environment: z.enum(["test", "live", "prod"]),
  owner: z.string(),
  steward: z.string(),
  jsonSchema: z.unknown().optional(),
  json_schema: z.unknown().optional(),
  compatibilityMode: z.enum(EVENT_SCHEMA_COMPATIBILITY_MODES).optional(),
  compatibility_mode: z.enum(EVENT_SCHEMA_COMPATIBILITY_MODES).optional(),
  status: z.enum(EVENT_SCHEMA_STATUSES),
  approvedBy: z.string().optional(),
  approved_by: z.string().optional(),
  approvedAt: z.string().optional(),
  approved_at: z.string().optional(),
});

@Injectable()
export class EventSchemaRegistryService {
  constructor(
    @Optional()
    private readonly options: EventSchemaRegistryServiceOptions = {},
  ) {}

  async listRecords(
    filter: EventSchemaRegistryListFilter = {},
  ): Promise<EventSchemaRecord[]> {
    const registry = await this.loadRegistry();

    return registry.records.filter((record) => {
      if (filter.environment && record.environment !== filter.environment) {
        return false;
      }
      if (
        filter.tribeId &&
        record.tribeId !== this.normalizeId(filter.tribeId)
      ) {
        return false;
      }
      return true;
    });
  }

  async getRegistryVersion(): Promise<string> {
    return (await this.loadRegistry()).registryVersion;
  }

  async validateEvent(
    input: EventSchemaValidationInput,
  ): Promise<EventSchemaValidationResult> {
    const registry = await this.loadRegistry();
    const normalizedTribeId = this.normalizeId(input.tribeId);
    const schemaVersion =
      input.schemaVersion?.trim() || DEFAULT_EVENT_SCHEMA_VERSION;
    const physicalEnvironment = toPhysicalPipelineEnvironment(input.environment);
    const record = registry.records.find(
      (candidate) =>
        candidate.physicalEnvironment === physicalEnvironment &&
        candidate.tribeId === normalizedTribeId &&
        candidate.eventType === input.eventType &&
        candidate.schemaVersion === schemaVersion,
    );

    if (!record) {
      if (
        input.environment === "test" &&
        (input.allowTestDiscovery ?? this.resolveAllowTestDiscovery())
      ) {
        return {
          accepted: true,
          schemaValidationStatus: "test_discovery",
          schemaRegistryVersion: registry.registryVersion,
        };
      }

      return this.reject(
        registry.registryVersion,
        `No approved schema registered for ${input.environment}.${normalizedTribeId}.${input.eventType}@${schemaVersion}`,
      );
    }

    if (record.status !== "approved") {
      return this.reject(
        registry.registryVersion,
        `Schema ${record.eventType}@${record.schemaVersion} is ${record.status}, not approved.`,
        record,
      );
    }

    if (
      physicalEnvironment === "prod" &&
      record.compatibilityMode === "none-for-test-only"
    ) {
      return this.reject(
        registry.registryVersion,
        `Schema ${record.eventType}@${record.schemaVersion} uses none-for-test-only compatibility in prod.`,
        record,
      );
    }

    const payloadError = this.validatePayload(input.payload, record);
    if (payloadError) {
      return this.reject(registry.registryVersion, payloadError, record);
    }

    return {
      accepted: true,
      schemaValidationStatus: "approved",
      schemaRegistryVersion: registry.registryVersion,
      record,
    };
  }

  private reject(
    schemaRegistryVersion: string,
    schemaValidationError: string,
    record?: EventSchemaRecord,
  ): EventSchemaValidationResult {
    return {
      accepted: false,
      schemaValidationStatus: "rejected",
      schemaRegistryVersion,
      schemaValidationError,
      ...(record && { record }),
    };
  }

  private validatePayload(
    payload: Record<string, unknown> | undefined,
    record: EventSchemaRecord,
  ): string | undefined {
    const schema = record.jsonSchema;
    if (!schema || Object.keys(schema).length === 0) return undefined;

    if (schema.type === "object" && !this.isPlainObject(payload)) {
      return `Payload for ${record.eventType}@${record.schemaVersion} must be an object.`;
    }

    for (const requiredField of schema.required ?? []) {
      if (!payload || payload[requiredField] === undefined) {
        return `Payload for ${record.eventType}@${record.schemaVersion} is missing required field '${requiredField}'.`;
      }
    }

    for (const [field, fieldSchema] of Object.entries(
      schema.properties ?? {},
    )) {
      if (!payload || payload[field] === undefined || !fieldSchema.type) {
        continue;
      }
      const actualType = Array.isArray(payload[field])
        ? "array"
        : typeof payload[field];
      if (actualType !== fieldSchema.type) {
        return `Payload field '${field}' for ${record.eventType}@${record.schemaVersion} must be ${fieldSchema.type}.`;
      }
    }

    return undefined;
  }

  private async loadRegistry(): Promise<LoadedRegistry> {
    const filePath =
      this.options.registryFilePath ?? process.env.EVENT_SCHEMA_REGISTRY_FILE;
    if (filePath) {
      const raw = await readFile(filePath, "utf8");
      const parsed = JSON.parse(raw) as {
        registryVersion?: string;
        registry_version?: string;
        records?: unknown[];
      };
      return {
        records: (parsed.records ?? []).map((record) =>
          this.normalizeRecord(record),
        ),
        registryVersion:
          parsed.registryVersion ??
          parsed.registry_version ??
          this.options.registryVersion ??
          DEFAULT_REGISTRY_VERSION,
      };
    }

    return {
      records: (this.options.records ?? []).map((record) =>
        this.normalizeRecord(record),
      ),
      registryVersion:
        this.options.registryVersion ??
        process.env.EVENT_SCHEMA_REGISTRY_VERSION ??
        DEFAULT_REGISTRY_VERSION,
    };
  }

  private normalizeRecord(record: unknown): EventSchemaRecord {
    const parsed = RawEventSchemaRecordSchema.parse(record);
    const tribeId = parsed.tribeId ?? parsed.tribe_id;
    const eventType = parsed.eventType ?? parsed.event_type;
    const schemaVersion = parsed.schemaVersion ?? parsed.schema_version;
    const jsonSchema = parsed.jsonSchema ?? parsed.json_schema ?? {};
    const compatibilityMode =
      parsed.compatibilityMode ?? parsed.compatibility_mode;

    if (!tribeId) throw new Error("Event schema record is missing tribe_id.");
    if (!eventType)
      throw new Error("Event schema record is missing event_type.");
    if (!schemaVersion) {
      throw new Error("Event schema record is missing schema_version.");
    }
    if (!compatibilityMode) {
      throw new Error("Event schema record is missing compatibility_mode.");
    }

    return {
      tribeId: this.normalizeId(tribeId),
      eventType,
      schemaVersion,
      environment: toPublicPipelineEnvironment(parsed.environment),
      physicalEnvironment: toPhysicalPipelineEnvironment(parsed.environment),
      owner: parsed.owner,
      steward: parsed.steward,
      jsonSchema: this.normalizeJsonSchema(jsonSchema),
      compatibilityMode,
      status: parsed.status,
      approvedBy: parsed.approvedBy ?? parsed.approved_by,
      approvedAt: parsed.approvedAt ?? parsed.approved_at,
    };
  }

  private normalizeJsonSchema(value: unknown): EventJsonSchema {
    if (!this.isPlainObject(value)) return {};

    const schema = value as Record<string, unknown>;
    const properties = this.isPlainObject(schema.properties)
      ? Object.fromEntries(
          Object.entries(schema.properties).map(([field, fieldSchema]) => [
            field,
            this.isPlainObject(fieldSchema)
              ? { type: this.readOptionalString(fieldSchema.type) }
              : {},
          ]),
        )
      : undefined;

    return {
      ...(schema.type === "object" && { type: "object" as const }),
      ...(Array.isArray(schema.required) && {
        required: schema.required.filter(
          (field): field is string => typeof field === "string",
        ),
      }),
      ...(properties && { properties }),
    };
  }

  private resolveAllowTestDiscovery(): boolean {
    if (this.options.allowTestDiscovery !== undefined) {
      return this.options.allowTestDiscovery;
    }
    return process.env.EVENT_SCHEMA_TEST_DISCOVERY_ENABLED === "true";
  }

  private normalizeId(value: string): string {
    return value
      .trim()
      .toLowerCase()
      .replaceAll(/[^a-z0-9._-]/g, "-");
  }

  private isPlainObject(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === "object" && !Array.isArray(value);
  }

  private readOptionalString(value: unknown): string | undefined {
    return typeof value === "string" ? value : undefined;
  }
}
