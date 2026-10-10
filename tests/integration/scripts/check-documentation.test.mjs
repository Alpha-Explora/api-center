import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { auditDocumentation } from "../../../scripts/check-documentation.mjs";

const metadata = `---
title: Test concept
status: canonical
authority: informative
owner: platform-maintainers
audience: [engineers]
last_verified: "2026-10-10"
verification: repository
sources: [AGENTS.md]
---
`;

function fixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), "apicenter-docs-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const write = (file, content) => {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), content);
  };
  write("AGENTS.md", "# Instructions\n");
  write("docs/index.md", "# Index\n\n[Concept](concept.md#topic)\n");
  write("docs/concept.md", metadata + "# Concept\n\n## Topic\n");
  write("apps/docs/content/guides.json", JSON.stringify([{ slug: "intro", section: "Getting started", aliases: ["old-intro"] }]));
  write("apps/docs/content/docs/intro.mdx", '---\ntitle: Intro\ndescription: Start here\n---\n# Intro\n\n[Intro](/guides/intro#intro)\n');
  write("apps/docs/content/legacy-reference.json", '{"oldEndpoint":"intro"}');
  write("contracts/public/apicenter.openapi.yaml", "paths:\n  /api/v1/payments/example:\n    get:\n      operationId: getExample\n");
  return { root, write, audit: () => auditDocumentation(root).errors };
}

test("valid internal authorities and published guide aliases pass", (t) => {
  const { audit } = fixture(t);
  assert.deepEqual(audit(), []);
});

test("broken links and fragments fail while code samples are ignored", (t) => {
  const { write, audit } = fixture(t);
  write("docs/concept.md", metadata + '# Concept\n## Topic\n[Missing](absent.md)\n[Heading](concept.md#absent)\n```md\n[Sample](example.md)\n```\n');
  const errors = audit();
  assert.ok(errors.some((error) => error.includes("broken repository link: absent.md")));
  assert.ok(errors.some((error) => error.includes("missing heading anchor")));
  assert.ok(!errors.some((error) => error.includes("example.md")));
});

test("missing ownership, authority, and provenance fail", (t) => {
  const { write, audit } = fixture(t);
  write("docs/concept.md", metadata.replace("owner: platform-maintainers\n", "").replace("authority: informative", "authority: authoritative").replace("sources: [AGENTS.md]", "sources: [missing.ts]") + "# Concept\n## Topic\n");
  const errors = audit();
  assert.ok(errors.some((error) => error.includes("missing owner")));
  assert.ok(errors.some((error) => error.includes("invalid authority")));
  assert.ok(errors.some((error) => error.includes("missing or invalid source")));
});

test("unregistered or missing guide files and colliding aliases fail", (t) => {
  const { write, audit } = fixture(t);
  write("apps/docs/content/docs/orphan.mdx", "# Orphan\n");
  write("apps/docs/content/guides.json", JSON.stringify([{ slug: "intro", section: "Start", aliases: ["intro"] }, { slug: "missing", section: "Start" }]));
  const errors = audit();
  assert.ok(errors.some((error) => error.includes("not in the canonical registry")));
  assert.ok(errors.some((error) => error.includes("missing guide file")));
  assert.ok(errors.some((error) => error.includes("duplicate guide route")));
});

test("internal-only links cannot be published and public fragments must exist", (t) => {
  const { write, audit } = fixture(t);
  write("apps/docs/content/docs/intro.mdx", '---\ntitle: Intro\ndescription: Start here\n---\n# Intro\n[Operator](/operations/internal)\n[Wrong heading](/guides/intro#missing)\n[Repo](../../../../docs/concept.md)\n');
  const errors = audit();
  assert.ok(errors.some((error) => error.includes("unpublished public route")));
  assert.ok(errors.some((error) => error.includes("missing heading anchor")));
  assert.ok(errors.some((error) => error.includes("published absolute route")));
});

test("unreachable internal concepts and missing legacy targets fail", (t) => {
  const { write, audit } = fixture(t);
  write("docs/orphan.md", metadata + "# Orphan\n");
  write("apps/docs/content/legacy-reference.json", '{"oldEndpoint":"missing"}');
  const errors = audit();
  assert.ok(errors.some((error) => error.includes("unreachable from docs/index.md")));
  assert.ok(errors.some((error) => error.includes("missing target guide")));
});
