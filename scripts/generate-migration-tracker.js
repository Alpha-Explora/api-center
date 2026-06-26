const fs = require("node:fs");
const planPath =
  "docs/superpowers/plans/2026-06-25-apicenter-enterprise-supabase-migration.md";
const outPath =
  "docs/visualizations/enterprise-supabase-migration-tracker.html";
const markdown = fs.readFileSync(planPath, "utf8");
const lines = markdown.split(/\r?\n/);

function escapeHtml(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function inlineMarkdown(value) {
  let html = escapeHtml(value.trim());
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  return html;
}

function anchor(line) {
  return `../superpowers/plans/2026-06-25-apicenter-enterprise-supabase-migration.md#L${line}`;
}

const sections = [];
let current = null;
let lastItem = null;
for (let index = 0; index < lines.length; index += 1) {
  const lineNo = index + 1;
  const line = lines[index];
  const heading = line.match(/^## (.+)$/);
  if (heading) {
    const title = heading[1].trim();
    if (
      title === "Progress Tracking Artifacts" ||
      title === "Pre-Live-Migration Requirements" ||
      title.startsWith("Task ") ||
      title === "Final Verification Checklist"
    ) {
      current = { title, line: lineNo, items: [] };
      sections.push(current);
    } else {
      current = null;
    }
    lastItem = null;
    continue;
  }

  if (!current) continue;
  const checkbox = line.match(/^- \[([ xX])\]\s+(.+)$/);
  if (checkbox) {
    const item = {
      done: checkbox[1].toLowerCase() === "x",
      text: checkbox[2].trim(),
      line: lineNo,
      note: "",
    };
    current.items.push(item);
    lastItem = item;
    continue;
  }

  if (lastItem && line.trim().startsWith("Verification recorded:")) {
    lastItem.note = line.trim();
  }
}

const tracked = sections.filter((section) => section.items.length > 0);
const total = tracked.reduce((sum, section) => sum + section.items.length, 0);
const done = tracked.reduce(
  (sum, section) => sum + section.items.filter((item) => item.done).length,
  0,
);
const completeSections = tracked.filter((section) =>
  section.items.every((item) => item.done),
);
const openSections = tracked.filter((section) =>
  section.items.some((item) => !item.done),
);
const pct = formatPercent(done, total);

function formatPercent(doneCount, totalCount) {
  if (!totalCount) return "0";
  if (doneCount === totalCount) return "100";
  const raw = (doneCount / totalCount) * 100;
  return Math.min(99.9, Number(raw.toFixed(1))).toString();
}

function sectionKind(title) {
  if (title === "Progress Tracking Artifacts") return "Tracking";
  if (title === "Pre-Live-Migration Requirements") return "Pre-live";
  if (title === "Final Verification Checklist") return "Final gate";
  return "Implementation";
}

function sectionCard(section) {
  const checked = section.items.filter((item) => item.done).length;
  const totalItems = section.items.length;
  const sectionPct = Math.round((checked / totalItems) * 100);
  const status =
    checked === totalItems ? "done" : checked > 0 ? "in-progress" : "open";
  const statusLabel =
    checked === totalItems ? "Done" : checked > 0 ? "In progress" : "Open";
  const openItems = section.items.filter((item) => !item.done);
  const doneItems = section.items.filter((item) => item.done);
  const openHtml = openItems.length
    ? openItems
        .map(
          (item) =>
            `<li><a href="${anchor(item.line)}">${inlineMarkdown(item.text)}</a></li>`,
        )
        .join("")
    : '<li class="empty">No open work in this slice.</li>';
  const doneHtml = doneItems.length
    ? doneItems
        .map(
          (item) =>
            `<li><a href="${anchor(item.line)}">${inlineMarkdown(item.text)}</a>${item.note ? `<p class="item-note">${inlineMarkdown(item.note)}</p>` : ""}</li>`,
        )
        .join("")
    : '<li class="empty">No checked work yet.</li>';

  return `<details class="task" ${status !== "done" ? "open" : ""}>
    <summary>
      <span class="task-title"><a href="${anchor(section.line)}">${escapeHtml(section.title)}</a></span>
      <span class="task-meta"><span class="kind">${sectionKind(section.title)}</span><span class="status ${status}">${statusLabel}</span>${checked}/${totalItems}</span>
    </summary>
    <div class="bar" aria-label="${sectionPct}% complete"><span style="width:${sectionPct}%"></span></div>
    <div class="task-body">
      <section>
        <h3>Open Work</h3>
        <ul>${openHtml}</ul>
      </section>
      <section>
        <h3>Checked Work</h3>
        <ul>${doneHtml}</ul>
      </section>
    </div>
  </details>`;
}

const openItems = tracked.flatMap((section) =>
  section.items.filter((item) => !item.done).map((item) => ({ section, item })),
);
const openPanel =
  openItems
    .slice(0, 18)
    .map(
      ({ section, item }) =>
        `<li><strong>${escapeHtml(section.title)}</strong><span><a href="${anchor(item.line)}">${inlineMarkdown(item.text)}</a></span></li>`,
    )
    .join("") ||
  "<li><strong>All tracked work is checked.</strong><span>No open items found.</span></li>";
const completedPanel =
  completeSections
    .map(
      (section) =>
        `<li><strong><a href="${anchor(section.line)}">${escapeHtml(section.title)}</a></strong><span>${section.items.length} tracked item${section.items.length === 1 ? "" : "s"} checked.</span></li>`,
    )
    .join("") ||
  "<li><strong>No completed slices yet.</strong><span>Complete all checkboxes in a slice to show it here.</span></li>";

const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>APICenter Enterprise Supabase Migration Tracker</title>
  <style>
    :root { color-scheme: light; --bg:#f7f7f5; --surface:#ffffff; --line:#d8d8d2; --text:#242421; --muted:#676762; --ok:#176b42; --warn:#8a5a00; --bad:#9b2c2c; --accent:#3f5f4b; --info:#315f72; }
    * { box-sizing: border-box; }
    body { margin: 0; background: var(--bg); color: var(--text); font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size: 14px; line-height: 1.45; }
    a { color: inherit; text-decoration: none; border-bottom: 1px solid #b8b8b1; }
    a:hover { border-bottom-color: var(--text); }
    code { background: #eeeeea; border: 1px solid #deded8; border-radius: 4px; padding: 1px 4px; font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 0.92em; }
    .layout { max-width: 1240px; margin: 0 auto; padding: 24px; }
    header { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; padding-bottom: 18px; border-bottom: 1px solid var(--line); }
    h1 { margin: 0 0 6px; font-size: 22px; line-height: 1.2; font-weight: 650; letter-spacing: 0; }
    .sub { color: var(--muted); max-width: 760px; }
    .meta { text-align: right; color: var(--muted); font-size: 13px; }
    .summary { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin: 18px 0; }
    .metric { background: var(--surface); border: 1px solid var(--line); border-radius: 8px; padding: 14px; }
    .metric b { display: block; font-size: 22px; line-height: 1; margin-bottom: 6px; }
    .metric span { color: var(--muted); }
    .columns { display: grid; grid-template-columns: minmax(0, 1fr) 360px; gap: 18px; align-items: start; }
    .panel { background: var(--surface); border: 1px solid var(--line); border-radius: 8px; margin-bottom: 14px; }
    .panel h2 { margin: 0; padding: 14px 16px; font-size: 15px; border-bottom: 1px solid var(--line); }
    .list { list-style: none; padding: 8px 16px 14px; margin: 0; }
    .list li { padding: 10px 0; border-bottom: 1px solid #ecece8; }
    .list li:last-child { border-bottom: 0; }
    .list strong { display: block; margin-bottom: 3px; }
    .list span { display: block; color: var(--muted); }
    .task { background: var(--surface); border: 1px solid var(--line); border-radius: 8px; margin-bottom: 10px; }
    .task summary { cursor: pointer; list-style: none; display: flex; justify-content: space-between; gap: 16px; align-items: center; padding: 12px 14px; }
    .task summary::-webkit-details-marker { display: none; }
    .task-title { font-weight: 620; }
    .task-meta { display: flex; align-items: center; gap: 8px; color: var(--muted); white-space: nowrap; }
    .kind, .status { display: inline-block; border: 1px solid var(--line); border-radius: 6px; padding: 2px 6px; font-size: 12px; background: #fafafa; }
    .kind { color: var(--info); border-color: #bfd1d8; background: #f2f7f8; }
    .status.done { color: var(--ok); border-color: #b7d2c3; background: #f1f7f3; }
    .status.in-progress { color: var(--warn); border-color: #dec98e; background: #fff8e8; }
    .status.open { color: var(--bad); border-color: #e1b2b2; background: #fff3f3; }
    .bar { height: 6px; background: #eeeeea; border-top: 1px solid #e2e2dd; }
    .bar span { display: block; height: 100%; background: var(--accent); }
    .task-body { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; padding: 14px; border-top: 1px solid #eeeeea; }
    h3 { margin: 0 0 8px; font-size: 13px; }
    ul { margin: 0; padding-left: 18px; }
    li { margin: 4px 0; }
    .empty { color: var(--muted); }
    .item-note { margin: 5px 0 0; color: var(--muted); font-size: 12px; }
    footer { margin-top: 18px; color: var(--muted); font-size: 13px; }
    @media (max-width: 900px) { .summary, .columns, .task-body { grid-template-columns: 1fr; } header { display: block; } .meta { text-align: left; margin-top: 10px; } .task summary { display: block; } .task-meta { margin-top: 8px; } }
  </style>
</head>
<body>
  <main class="layout">
    <header>
      <div>
        <h1>APICenter Enterprise Supabase Migration Tracker</h1>
        <div class="sub">Generated from the active migration plan checkboxes. The Markdown plan remains the source of truth; this page is the visual status board for completed slices and remaining work.</div>
      </div>
      <div class="meta">Generated ${new Date().toISOString()}<br><a href="../superpowers/plans/2026-06-25-apicenter-enterprise-supabase-migration.md">Open plan Markdown</a></div>
    </header>
    <section class="summary" aria-label="Plan summary">
      <div class="metric"><b>${pct}%</b><span>tracked step completion</span></div>
      <div class="metric"><b>${done}/${total}</b><span>checked items</span></div>
      <div class="metric"><b>${completeSections.length}</b><span>slices fully checked</span></div>
      <div class="metric"><b>${openSections.length}</b><span>slices with open work</span></div>
    </section>
    <section class="columns">
      <div>${tracked.map(sectionCard).join("\n")}</div>
      <aside>
        <section class="panel">
          <h2>Open Work</h2>
          <ul class="list">${openPanel}</ul>
        </section>
        <section class="panel">
          <h2>Completed Slices</h2>
          <ul class="list">${completedPanel}</ul>
        </section>
      </aside>
    </section>
    <footer>Regenerate this file after checking off plan tasks so the board stays aligned with the implementation record.</footer>
  </main>
</body>
</html>
`;

fs.writeFileSync(outPath, html, "utf8");
console.log(
  JSON.stringify({
    outPath,
    total,
    done,
    pct,
    sections: tracked.length,
    completeSections: completeSections.length,
  }),
);
