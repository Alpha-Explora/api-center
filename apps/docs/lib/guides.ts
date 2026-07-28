import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export type GuideBlock =
  | { type: "heading"; value: string; level: number }
  | { type: "paragraph"; value: string }
  | { type: "code"; value: string; language: string }
  | { type: "list"; value: string[] };

export const guideSlugs = [
  ["getting-started"],
  ["authentication"],
  ["idempotency"],
  ["payments", "overview"],
  ["events", "pubsub-delivery"],
  ["migration", "from-direct-paymongo"],
  ["consumer-runbook"],
] as const;

function guidePath(slug: readonly string[]): string {
  const fileName = `${slug.at(-1)}.mdx`;
  const candidates = [
    path.resolve(process.cwd(), "content/docs", ...slug.slice(0, -1), fileName),
    path.resolve(process.cwd(), "../../apps/docs/content/docs", ...slug.slice(0, -1), fileName),
  ];
  const match = candidates.find((candidate) => existsSync(candidate));
  if (!match) throw new Error(`Guide not found: ${slug.join("/")}`);
  return match;
}

export function readGuide(slug: readonly string[]): GuideBlock[] {
  const lines = readFileSync(guidePath(slug), "utf8").replace(/\r/g, "").split("\n");
  const blocks: GuideBlock[] = [];
  let paragraph: string[] = [];
  let list: string[] = [];
  let code: string[] | null = null;
  let codeLanguage = "text";

  const flush = () => {
    if (paragraph.length) blocks.push({ type: "paragraph", value: paragraph.join(" ") });
    if (list.length) blocks.push({ type: "list", value: [...list] });
    paragraph = [];
    list = [];
  };

  for (const line of lines) {
    if (line.startsWith("```")) {
      if (code) {
        blocks.push({ type: "code", value: code.join("\n"), language: codeLanguage });
        code = null;
      } else {
        flush();
        code = [];
        codeLanguage = line.slice(3).trim() || "text";
      }
      continue;
    }
    if (code) {
      code.push(line);
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      flush();
      blocks.push({ type: "heading", level: heading[1].length, value: heading[2] });
    } else if (/^[-*]\s+/.test(line)) {
      list.push(line.replace(/^[-*]\s+/, ""));
    } else {
      paragraph.push(line.trim());
    }
  }
  flush();
  return blocks;
}