const select = id => document.getElementById(id);
const form = select("question-form");
const question = select("question");
const liveButton = select("investigate");
const replayButton = select("replay");
const exampleButton = select("load-example");
const reportBody = select("report");
const placeholder = select("placeholder");
const tracePanel = select("trace");
const steps = new Map();
let config;
let busy = false;
let currentReport;

function element(tag, className = "", text = "") {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function syncForm() {
  select("char-count").textContent = question.value.length + " / 900";
  question.readOnly = busy;
  liveButton.disabled = busy || !config?.liveReady || question.value.trim().length < 12;
  replayButton.disabled = busy || !config;
  exampleButton.disabled = busy || !config;
}

function connectionStatus(text, mode) {
  const status = select("connection");
  status.className = "status-pill " + mode;
  status.replaceChildren(element("span", "signal"), document.createTextNode(text));
}

async function loadConfig() {
  syncForm();
  try {
    const response = await fetch("/api/config");
    if (!response.ok) throw new Error();
    config = await response.json();
    if (config.liveReady) {
      connectionStatus("Live search available", "live");
      select("form-status").textContent = "Live questions use Tavily search and Nebius Token Factory.";
    } else {
      connectionStatus("Example replay available", "replay");
      const missing = [!config.nebiusReady && "Nebius", !config.tavilyReady && "Tavily"].filter(Boolean);
      select("form-status").textContent = "Add " + missing.join(" and ") + " API credentials to enable live search.";
    }
  } catch {
    connectionStatus("Local server unavailable", "replay");
    select("form-status").textContent = "Restart the local server and reload this page.";
  }
  syncForm();
}

function updateTrace(step) {
  steps.set(step.id, step);
  const items = [...steps.values()].map(entry => {
    const li = element("li", entry.state);
    li.append(element("span", "", entry.detail));
    for (const query of entry.queries ?? []) li.append(element("code", "", query));
    return li;
  });
  select("trace-list").replaceChildren(...items);
  const completed = [...steps.values()].filter(item => item.state !== "active").length;
  select("trace-count").textContent = completed + (completed === 1 ? " step" : " steps");
}

function sourceLink(source, label = source.title) {
  const link = element("a", "", label);
  link.href = source.url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  return link;
}

const findingLabels = {
  documented: ["Documented behavior", ""],
  inference: ["Incident inference", "cool"],
  conflict: ["Conflicting evidence", "warm"],
};

function renderFinding(finding, index, sourceById) {
  const item = element("article", "finding");
  const [label, tint] = findingLabels[finding.kind];
  item.append(element("span", "badge " + tint, label), element("p", "", finding.statement));
  const citations = element("div", "citation-list");
  const quoteBox = element("div", "quote");
  quoteBox.id = "finding-quote-" + index;
  quoteBox.hidden = true;
  let openId;
  for (const citation of finding.citations) {
    const source = sourceById.get(citation.sourceId);
    const button = element("button", "citation", source.id + " · " + source.domain);
    button.type = "button";
    button.setAttribute("aria-expanded", "false");
    button.setAttribute("aria-controls", quoteBox.id);
    button.addEventListener("click", () => {
      const opening = openId !== source.id;
      for (const other of citations.children) other.setAttribute("aria-expanded", "false");
      if (opening) {
        quoteBox.replaceChildren(element("blockquote", "", "“" + citation.quote + "”"),
          sourceLink(source, "Open source ↗"));
        button.setAttribute("aria-expanded", "true");
      }
      quoteBox.hidden = !opening;
      openId = opening ? source.id : undefined;
    });
    citations.append(button);
  }
  item.append(citations, quoteBox);
  return item;
}

function reportSection(title, items) {
  const section = element("section", "report-section");
  section.append(element("h3", "", title));
  const list = element("ul");
  for (const item of items) list.append(element("li", "", item));
  section.append(list);
  return section;
}

function renderReport(run) {
  const { report, sources } = run;
  const sourceById = new Map(sources.map(source => [source.id, source]));
  const heading = element("div", "report-heading");
  const title = {
    grounded: "Evidence found",
    mixed: "Evidence is mixed",
    insufficient: "Insufficient evidence",
  }[report.status];
  heading.append(element("h2", "", title),
    element("span", "badge " + (run.mode === "replay" ? "warm" : ""), run.mode === "replay" ? "EXAMPLE REPLAY" : "LIVE RESEARCH"));
  const quoteCount = report.findings.reduce((total, item) => total + item.citations.length, 0);
  const meta = element("div", "report-meta");
  meta.append(element("span", "", sources.length + " sources"), element("span", "", quoteCount + " matched citations"));
  if (run.mode === "live") meta.append(element("span", "", (run.elapsedMs / 1000).toFixed(1) + " s"));
  const query = element("p", "run-question", run.question);
  const findings = element("div", "findings");
  report.findings.forEach((finding, index) => findings.append(renderFinding(finding, index, sourceById)));
  if (!report.findings.length) {
    findings.append(element("p", "empty-evidence", "No finding had a matching excerpt. Try including the exact version and error message."));
  }
  const sections = element("div", "report-grid");
  if (report.gaps.length) sections.append(reportSection("Still uncertain", report.gaps));
  if (report.nextChecks.length) sections.append(reportSection("What to check next", report.nextChecks));
  const catalog = element("details", "sources");
  const used = new Set(report.findings.flatMap(item => item.citations.map(cite => cite.sourceId)));
  catalog.append(element("summary", "", "Source register · " + sources.length));
  const list = element("ul", "source-list");
  for (const source of sources) {
    const row = element("li");
    const details = element("div");
    details.append(sourceLink(source), element("span", "source-domain", source.domain + (used.has(source.id) ? " · cited" : " · retrieved")));
    row.append(element("span", "badge cool", source.id), details);
    list.append(row);
  }
  catalog.append(list);
  const foot = element("p", "subtle", run.mode === "replay"
    ? "Sample incident with saved excerpts and a prepared report."
    : "Quotes were matched to the search excerpts. Open a source to check whether it supports the finding.");
  reportBody.replaceChildren(heading, meta, query, findings, sections, catalog, foot);
  sections.hidden = sections.childElementCount === 0;
  catalog.hidden = sources.length === 0;
  if (report.omitted) foot.append(" " + report.omitted + " uncited finding(s) omitted.");
  placeholder.hidden = true;
  reportBody.hidden = false;
  select("export").hidden = false;
  currentReport = run;
}

async function readStream(response) {
  if (!response.ok) {
    const message = await response.json().catch(() => ({}));
    throw new Error(message.error || "The local app could not start the investigation.");
  }
  const stream = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let final;
  try {
    for (;;) {
      const { value, done } = await stream.read();
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split("\n");
      buffer = lines.pop();
      if (done && buffer.trim()) lines.push(buffer);
      for (const line of lines.filter(Boolean)) {
        const event = JSON.parse(line);
        if (event.type === "trace") updateTrace(event.data);
        else if (event.type === "result") final = event.data;
        else if (event.type === "error") throw new Error(event.data);
      }
      if (done) break;
    }
  } finally {
    stream.releaseLock();
  }
  if (!final) throw new Error("The investigation ended before a report was returned. Try again.");
  return final;
}

async function run(mode) {
  if (busy || !config) return;
  busy = true;
  currentReport = undefined;
  syncForm();
  steps.clear();
  updateTraceList();
  tracePanel.hidden = false;
  tracePanel.open = true;
  select("form-error").hidden = true;
  reportBody.hidden = true;
  select("export").hidden = true;
  placeholder.hidden = false;
  select("report-title").textContent = mode === "live" ? "Investigating…" : "Loading example…";
  placeholder.querySelector("p").textContent = "The investigation steps will update as results arrive.";
  try {
    const response = await fetch("/api/investigate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode, question: question.value }),
    });
    renderReport(await readStream(response));
  } catch (error) {
    const formError = select("form-error");
    formError.textContent = error.message || "The investigation did not complete.";
    formError.hidden = false;
    select("report-title").textContent = "Report unavailable";
    placeholder.querySelector("p").textContent = "Check the message below the incident question, then try again.";
    for (const step of steps.values()) {
      if (step.state === "active") updateTrace({ ...step, state: "warning", detail: "This step did not complete." });
    }
  } finally {
    busy = false;
    syncForm();
  }
}

function updateTraceList() {
  select("trace-list").replaceChildren();
  select("trace-count").textContent = "0 steps";
}

function markdownText(text) {
  return text.replace(/[\\[\]_*<>]/g, "\\$&");
}

function exportReport() {
  const run = currentReport;
  if (!run) return;
  const { report, sources } = run;
  const lines = [
    "# Rollout Trace report",
    "",
    "Mode: " + (run.mode === "replay" ? "Example replay (saved excerpts and prepared findings)" : "Live · Nebius Token Factory and Tavily"),
    "Completed: " + run.completedAt,
    "",
    "## Incident question",
    markdownText(run.question),
    "",
    "## Findings",
  ];
  if (!report.findings.length) lines.push("Insufficient evidence for a cited finding.");
  for (const finding of report.findings) {
    lines.push("", "**" + findingLabels[finding.kind][0] + "** — " + markdownText(finding.statement));
    for (const cite of finding.citations) {
      const source = sources.find(item => item.id === cite.sourceId);
      lines.push("", "> “" + markdownText(cite.quote) + "” — [" + source.id + "](<" + source.url + ">)");
    }
  }
  if (report.gaps.length) lines.push("", "## Still uncertain", ...report.gaps.map(item => "- " + markdownText(item)));
  if (report.nextChecks.length) lines.push("", "## What to check next", ...report.nextChecks.map(item => "- " + markdownText(item)));
  lines.push("", "## Source register", ...sources.map(source => "- " + source.id + " [" + markdownText(source.title) + "](<" + source.url + ">)"), "");
  const url = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/markdown;charset=utf-8" }));
  const link = element("a");
  link.href = url;
  link.download = "rollout-trace-report.md";
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

form.addEventListener("submit", event => {
  event.preventDefault();
  run("live");
});
question.addEventListener("input", syncForm);
exampleButton.addEventListener("click", () => {
  question.value = config.sampleQuestion;
  syncForm();
  question.focus();
});
replayButton.addEventListener("click", () => {
  question.value = config.sampleQuestion;
  run("replay");
});
select("export").addEventListener("click", exportReport);
loadConfig();
