# Configuration

Non-secret configuration artifacts that are not tool-required root files.

- `event-schema-registry.json` - event schema registry data used by the application.
- `environments/` - environment-scoped runtime configuration snapshots.

Do not place secrets in this folder. Use environment variables or the platform secret manager.