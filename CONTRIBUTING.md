# Contributing to APICenter

[AGENTS.md](AGENTS.md) is the reference for the workspace layout, commands and conventions. This page covers the pull request workflow.

## Set up

```bash
npm install
npm run db:generate
```

`npm run typecheck` and `npm test` regenerate the Prisma client first, so a changed `prisma/schema.prisma` never leaves you with a stale client.

## Before you open a pull request

```bash
npm run typecheck
npm run lint
npm test                                        # gateway and runtime unit tests (Jest)
npm run test --workspace @apicenter/management  # console unit tests (Vitest)
npm run check:boundaries && npm run check:monorepo
```

For documentation or public contract changes, also run the checks listed under "Documentation workflow" in AGENTS.md.

## Checks on pull requests

- **PR checks** (`.github/workflows/pr-checks.yml`) run typecheck, lint, boundaries and both unit suites on every pull request that changes code, in about five minutes.
- **Documentation** (`.github/workflows/documentation.yml`) runs on pull requests to `main` that change docs or public contracts.
- **Full CI** (`.github/workflows/ci.yml`, including the Docker build) is manual: `gh workflow run ci.yml --ref <branch>`. Run it before merging changes to Dockerfiles, runtimes or deployment.

## Branches and commits

Branch from `main` as `feat/…`, `fix/…`, `refactor/…` or `docs/…`. Keep commit messages short and imperative (`feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`), one logical change per commit.

## Pull requests

- Keep each pull request to one change, and say what changed and why.
- Record user-visible changes in [CHANGELOG.md](CHANGELOG.md) under Unreleased.
- Update the maintained documentation the change affects (see [docs/index.md](docs/index.md)).
- A new provider-backed capability belongs in a runtime under `apps/`, exposed through `/api/v1/shared/:capability/*` and the SDK. Provider credentials never go to consumer applications.
