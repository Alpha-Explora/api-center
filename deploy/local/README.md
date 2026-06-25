# Local Runtime

Local Docker Compose stack for API Center development and sandbox checks.

Use the package scripts from the repository root:

```bash
npm run docker:up
npm run docker:scale-check
npm run docker:logs
npm run docker:down
```

Direct compose usage should include the relocated file:

```bash
docker compose -f deploy/local/docker-compose.yml up -d
```