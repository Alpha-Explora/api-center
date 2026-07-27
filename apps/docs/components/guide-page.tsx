import type { GuideBlock } from "@/lib/guides";

function inline(value: string) {
  return value.split(/(`[^`]+`)/g).map((part, index) =>
    part.startsWith("`") && part.endsWith("`") ? <code key={index}>{part.slice(1, -1)}</code> : part,
  );
}

export function GuidePage({ blocks }: { blocks: GuideBlock[] }) {
  return (
    <div className="guide-content">
      {blocks.map((block, index) => {
        if (block.type === "heading") {
          const Tag = block.level === 1 ? "h1" : block.level === 2 ? "h2" : "h3";
          return <Tag key={index}>{inline(block.value)}</Tag>;
        }
        if (block.type === "code") {
          return <pre key={index} data-language={block.language}><code>{block.value}</code></pre>;
        }
        if (block.type === "list") {
          return <ul key={index}>{block.value.map((item) => <li key={item}>{inline(item)}</li>)}</ul>;
        }
        return <p key={index}>{inline(block.value)}</p>;
      })}
    </div>
  );
}