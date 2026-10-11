import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const markdownFiles = (root, directory) => !existsSync(path.join(root, directory)) ? [] :
  readdirSync(path.join(root, directory), { withFileTypes: true }).flatMap((entry) => {
    const file = path.posix.join(directory, entry.name);
    return entry.isDirectory() ? markdownFiles(root, file) : /\.mdx?$/.test(file) ? [file] : [];
  });

export function readMarkdown(text) {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  const metadata = frontmatter ? parse(frontmatter[1]) ?? {} : {};
  const body = frontmatter ? text.slice(frontmatter[0].length) : text;
  const prose = body.replace(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, "").replace(/`[^`\n]+`/g, "");
  const links = [...prose.matchAll(/\[[^\]\n]+\]\(\s*(?:<([^>]+)>|([^\s)]+))(?:\s+["'][^"']*["'])?\s*\)/g)]
    .map((match) => match[1] ?? match[2]);
  links.push(...[...prose.matchAll(/^\s*\[[^\]]+\]:\s*(?:<([^>]+)>|(\S+))/gm)].map((match) => match[1] ?? match[2]));
  const anchors = new Set();
  const duplicates = new Map();
  for (const match of prose.matchAll(/^#{1,6}\s+(.+?)(?:\s+#+)?\s*$/gm)) {
    const base = match[1].toLowerCase().replace(/<[^>]*>/g, "").replace(/[^\p{L}\p{N}_\-\s]/gu, "").replace(/\s/g, "-");
    const count = duplicates.get(base) ?? 0;
    anchors.add(count ? `${base}-${count}` : base);
    duplicates.set(base, count + 1);
  }
  return { metadata, links, anchors };
}

export function auditDocumentation(root = repository) {
  const errors = [];
  const report = (file, message) => errors.push(`${file}: ${message}`);
  const read = (file) => readFileSync(path.join(root, file), "utf8");
  const parsed = new Map();
  const documents = markdownFiles(root, "docs");
  const guides = markdownFiles(root, "apps/docs/content/docs");
  const entrypoints = ["README.md", "AGENTS.md", "CLAUDE.md", "CHANGELOG.md"];
  for (const file of [...documents, ...guides, ...entrypoints.filter((file) => existsSync(path.join(root, file)))]) {
    try { parsed.set(file, readMarkdown(read(file))); }
    catch (error) { report(file, `invalid Markdown metadata: ${error.message}`); }
  }
  if (!existsSync(path.join(root, "docs/index.md"))) report("docs/index.md", "canonical index is missing");

  for (const file of documents) {
    if (["index.md", "log.md"].includes(path.posix.basename(file)) || file === "docs/superpowers/plans/README.md") continue;
    const metadata = parsed.get(file)?.metadata ?? {};
    for (const field of ["title", "owner"]) if (typeof metadata[field] !== "string" || !metadata[field].trim()) report(file, `missing ${field}`);
    if (!["canonical", "active", "reference"].includes(metadata.status)) report(file, "status must be canonical, active, or reference");
    if (!["normative", "informative", "operational", "reference"].includes(metadata.authority)) report(file, "invalid authority");
    if (!["repository", "runtime", "unverified"].includes(metadata.verification)) report(file, "invalid verification scope");
    if (!Array.isArray(metadata.audience) || !metadata.audience.length || metadata.audience.some((item) => typeof item !== "string" || !item.trim())) report(file, "audience must be a nonempty list");
    if (typeof metadata.last_verified !== "string" || !/^(unverified|\d{4}-\d{2}-\d{2})$/.test(metadata.last_verified)) report(file, "last_verified must be a quoted ISO date or unverified");
    if (metadata.verification === "unverified" && metadata.last_verified !== "unverified") report(file, "unverified documents must not claim a verification date");
    if (!Array.isArray(metadata.sources) || !metadata.sources.length) report(file, "sources must be a nonempty repository path list");
    for (const source of Array.isArray(metadata.sources) ? metadata.sources : []) {
      if (typeof source !== "string" || !withinRoot(root, path.resolve(root, source)) || !existsSync(path.resolve(root, source))) report(file, `missing or invalid source: ${source}`);
    }
  }

  let registry = [];
  try {
    registry = JSON.parse(read("apps/docs/content/guides.json"));
    if (!Array.isArray(registry)) throw new Error("registry must be an array");
  } catch (error) { report("apps/docs/content/guides.json", error.message); registry = []; }
  const registeredFiles = new Set();
  const routes = new Set(["/", "/api/openapi.json", "/reference/api", "/reference/api/sandbox", "/reference/events"]);
  const guideNames = new Set();
  const routeFiles = new Map();
  for (const entry of registry) {
    if (!entry || typeof entry.slug !== "string" || !/^[a-z0-9-]+(?:\/[a-z0-9-]+)*$/.test(entry.slug)) { report("guides.json", "invalid guide slug"); continue; }
    if (typeof entry.section !== "string" || !entry.section.trim()) report("guides.json", `missing section: ${entry.slug}`);
    const file = `apps/docs/content/docs/${entry.slug}.mdx`;
    registeredFiles.add(file);
    if (!existsSync(path.join(root, file))) report("guides.json", `missing guide file: ${file}`);
    const metadata = parsed.get(file)?.metadata ?? {};
    if (typeof metadata.title !== "string" || typeof metadata.description !== "string" || !metadata.title.trim() || !metadata.description.trim()) report(file, "public guide requires title and description");
    if (entry.aliases !== undefined && (!Array.isArray(entry.aliases) || entry.aliases.some((alias) => typeof alias !== "string"))) { report("guides.json", `invalid aliases: ${entry.slug}`); continue; }
    for (const slug of [entry.slug, ...(entry.aliases ?? [])]) {
      if (!/^[a-z0-9-]+(?:\/[a-z0-9-]+)*$/.test(slug)) report("guides.json", `invalid alias: ${slug}`);
      if (guideNames.has(slug)) report("guides.json", `duplicate guide route: ${slug}`);
      guideNames.add(slug);
      routes.add(`/guides/${slug}`);
      routeFiles.set(`/guides/${slug}`, file);
    }
  }
  for (const file of guides) if (!registeredFiles.has(file)) report(file, "guide is not in the canonical registry");
  try {
    const contract = parse(read("contracts/public/apicenter.openapi.yaml"));
    const operationIds = new Set();
    for (const item of Object.values(contract.paths ?? {})) {
      for (const method of ["get", "post", "put", "patch", "delete"]) {
        const operation = item[method];
        if (!operation) continue;
        if (!operation.operationId || operationIds.has(operation.operationId)) report("OpenAPI", "missing or duplicate operationId");
        operationIds.add(operation.operationId);
        routes.add(`/reference/api/${operation.operationId}`);
      }
    }
    const legacy = JSON.parse(read("apps/docs/content/legacy-reference.json"));
    for (const [operationId, guide] of Object.entries(legacy)) {
      if (operationIds.has(operationId)) report("legacy-reference.json", `alias conflicts with contract operation: ${operationId}`);
      if (!guideNames.has(guide)) report("legacy-reference.json", `missing target guide: ${guide}`);
      routes.add(`/reference/api/${operationId}`);
    }
  } catch (error) { report("public references", error.message); }

  const graph = new Map();
  for (const [file, document] of parsed) {
    const edges = [];
    for (const target of document.links) {
      if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("//")) continue;
      let decoded;
      try { decoded = decodeURIComponent(target); } catch { report(file, `invalid link encoding: ${target}`); continue; }
      const [pathname, fragment] = decoded.split("#", 2);
      const route = pathname.split("?", 1)[0].replace(/\/$/, "") || "/";
      if (file.startsWith("apps/docs/content/") && pathname.startsWith("/")) {
        if (!routes.has(route)) report(file, `unpublished public route: ${target}`);
        const targetFile = routeFiles.get(route);
        if (fragment && targetFile && !parsed.get(targetFile)?.anchors.has(fragment)) report(file, `missing heading anchor: ${target}`);
        continue;
      }
      if (file.startsWith("apps/docs/content/") && pathname) {
        report(file, `public link must use a published absolute route: ${target}`);
        continue;
      }
      const resolved = pathname ? path.resolve(path.dirname(path.join(root, file)), pathname.split("?", 1)[0]) : path.join(root, file);
      if (!withinRoot(root, resolved) || !existsSync(resolved)) { report(file, `broken repository link: ${target}`); continue; }
      const relative = path.relative(root, resolved).replace(/\\/g, "/");
      edges.push(relative);
      if (fragment && statSync(resolved).isFile() && /\.mdx?$/.test(relative)) {
        const linked = parsed.get(relative) ?? readMarkdown(read(relative));
        if (!linked.anchors.has(fragment)) report(file, `missing heading anchor: ${target}`);
      }
    }
    graph.set(file, edges);
  }
  const reachable = new Set();
  const pending = ["docs/index.md"];
  while (pending.length) {
    const file = pending.pop();
    if (reachable.has(file)) continue;
    reachable.add(file);
    pending.push(...(graph.get(file) ?? []));
  }
  for (const file of documents) if (!reachable.has(file)) report(file, "internal document is unreachable from docs/index.md");
  return { errors, documents: documents.length, guides: guides.length, routes: routes.size };
}

function withinRoot(root, target) {
  const relative = path.relative(path.resolve(root), target);
  return relative !== ".." && !relative.startsWith(".." + path.sep) && !path.isAbsolute(relative);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = auditDocumentation();
  if (result.errors.length) {
    console.error(result.errors.join("\n"));
    process.exitCode = 1;
  } else console.log(`Documentation valid: ${result.documents} internal documents, ${result.guides} guides, ${result.routes} public routes.`);
}
