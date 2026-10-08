/** Lowercase slug, 1-64 characters. Matches the apic_catalog.tribes.tribe_id check constraint. */
export const TRIBE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** Lowercase slug, 1-80 characters, globally unique. Matches the apic_catalog.projects.project_id check constraint. */
export const PROJECT_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,79}$/;
