const MAX_SOURCES = 10;
const TRACKING_PARAMS = /^(utm_|fbclid$|gclid$|mc_cid$|mc_eid$)/i;

export function cleanText(value, limit) {
  return typeof value === "string"
    ? value.normalize("NFC").replace(/[\u0000-\u001f\u007f\s]+/gu, " ").trim().slice(0, limit).trim()
    : "";
}

function readUrl(value) {
  if (typeof value !== "string" || value.length > 2_048) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return url;
  } catch {
    return null;
  }
}

function pageKey(url) {
  const canonical = new URL(url);
  canonical.hash = "";
  for (const key of [...canonical.searchParams.keys()]) {
    if (TRACKING_PARAMS.test(key)) canonical.searchParams.delete(key);
  }
  canonical.searchParams.sort();
  canonical.pathname = canonical.pathname.replace(/\/+$/, "") || "/";
  return canonical.href;
}

export function addSources(existing, results) {
  const sources = [...existing];
  const used = new Set(sources.map(source => pageKey(source.url)));
  for (const row of results) {
    if (sources.length >= MAX_SOURCES) break;
    const url = readUrl(row?.url);
    const excerpt = cleanText(row?.content, 2_000);
    if (!url || excerpt.length < 25 || used.has(pageKey(url))) continue;
    used.add(pageKey(url));
    sources.push({
      id: "S" + (sources.length + 1),
      title: cleanText(row.title, 165) || url.hostname,
      url: url.href,
      domain: url.hostname.replace(/^www\./, ""),
      excerpt,
    });
  }
  return sources;
}

const FINDING_KINDS = new Set(["documented", "inference", "conflict"]);

function matchCitation(raw, sources) {
  const source = sources.find(item => item.id === raw?.sourceId);
  const quote = cleanText(raw?.quote, 500);
  if (!source || quote.length < 15 || quote.length > 340) return null;
  if (!source.excerpt.includes(quote)) return null;
  return { sourceId: source.id, quote };
}

function textList(values, count, length) {
  return Array.isArray(values)
    ? [...new Set(values.map(value => cleanText(value, length)).filter(Boolean))].slice(0, count)
    : [];
}

export function checkReport(candidate, sources) {
  const findings = [];
  let omitted = 0;
  const proposed = Array.isArray(candidate?.findings) ? candidate.findings.slice(0, 5) : [];
  for (const raw of proposed) {
    const statement = cleanText(raw?.statement, 400);
    if (!statement || !FINDING_KINDS.has(raw?.kind) || !Array.isArray(raw?.citations)) {
      omitted++;
      continue;
    }
    const citations = raw.citations.slice(0, 3)
      .map(item => matchCitation(item, sources))
      .filter(Boolean)
      .filter((item, i, list) => list.findIndex(other => other.sourceId === item.sourceId) === i);
    if (citations.length === 0) {
      omitted++;
      continue;
    }
    findings.push({ kind: raw.kind, statement, citations });
  }
  const hasConflict = findings.some(item => item.kind === "conflict");
  return {
    status: findings.length === 0 ? "insufficient" : hasConflict ? "mixed" : "grounded",
    findings,
    gaps: textList(candidate?.gaps, 4, 260),
    nextChecks: findings.length ? textList(candidate?.nextChecks, 4, 260) : [],
    omitted,
  };
}
