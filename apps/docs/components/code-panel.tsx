import { highlight } from "fumadocs-core/highlight";
import { CodeBlock, Pre } from "fumadocs-ui/components/codeblock";
import { Tab, Tabs } from "fumadocs-ui/components/tabs";
import { BookOpenIcon, FileJsonIcon, PlayIcon } from "lucide-react";
import type { DetailedOperation } from "@/lib/contracts";
import { getSdkOperations } from "@/lib/sdk-operations";
import { buildSdkSnippet, buildSnippet } from "@/lib/snippets";

/** Code highlighted at build time in the docs' light and dark themes, with a copy button; long lines scroll. */
async function Code({ code, lang, title }: { code: string; lang: "ts" | "bash" | "json"; title: string }) {
  const rendered = await highlight(code, {
    lang,
    components: { pre: (props) => <Pre {...props} /> },
  });
  return (
    <CodeBlock title={title} className="my-0">
      {rendered}
    </CodeBlock>
  );
}

/**
 * An operation's request in the SDK, fetch and curl (the chosen tab is remembered across pages), and its
 * example response.
 */
export async function CodePanel({ operation }: { operation: DetailedOperation }) {
  const sdk = getSdkOperations().get(operation.operationId);
  const success = operation.successResponses[0];
  const tabs = [...(sdk ? ["SDK"] : []), "fetch", "cURL"];
  return (
    <div className="flex flex-col gap-4">
      <Tabs groupId="code-language" persist items={tabs} className="my-0">
        {sdk ? (
          <Tab value="SDK">
            <Code code={buildSdkSnippet(operation, sdk)} lang="ts" title="server.ts" />
          </Tab>
        ) : null}
        <Tab value="fetch">
          <Code code={buildSnippet(operation, "fetch")} lang="ts" title="server.ts" />
        </Tab>
        <Tab value="cURL">
          <Code code={buildSnippet(operation, "cURL")} lang="bash" title="Terminal" />
        </Tab>
      </Tabs>

      {operation.sampleResponse ? (
        <Code code={JSON.stringify(operation.sampleResponse, null, 2)} lang="json" title={`Response${success ? ` · ${success.code}` : ""}`} />
      ) : (
        <p className="rounded-lg border bg-fd-card p-3 text-xs text-fd-muted-foreground">No example response. The response fields are listed on the left.</p>
      )}

      <nav aria-label="Related" className="flex flex-col gap-1 text-[13px]">
        {[
          { href: "/guides/sdk-usage", icon: BookOpenIcon, label: "Set up the SDK" },
          { href: "/reference/api/sandbox", icon: PlayIcon, label: "Try it in the browser" },
          { href: "/api/openapi.json", icon: FileJsonIcon, label: "OpenAPI contract (JSON)" },
        ].map(({ href, icon: Icon, label }) => (
          <a key={href} href={href} className="inline-flex items-center gap-2 rounded-md px-2 py-1.5 text-fd-muted-foreground transition-colors hover:bg-fd-accent hover:text-fd-foreground">
            <Icon className="size-3.5" /> {label}
          </a>
        ))}
      </nav>
    </div>
  );
}
