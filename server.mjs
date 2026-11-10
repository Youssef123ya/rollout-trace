import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { investigate, replay, validateQuestion } from "./src/agent.mjs";
import { createProviders, providerConfig, ProviderError } from "./src/providers.mjs";
import { sampleQuestion } from "./src/replay.mjs";

const config = providerConfig();
const providers = createProviders(config);
const liveReady = Boolean(config.nebiusKey && config.tavilyKey);
const port = Number(process.env.PORT || 4173);
if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  throw new Error("PORT must be an integer between 1024 and 65535.");
}

const localHosts = new Set(["127.0.0.1:" + port, "localhost:" + port]);
const localOrigins = new Set([...localHosts].map(host => "http://" + host));
const assetFiles = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/app.js": ["app.js", "text/javascript; charset=utf-8"],
  "/style.css": ["style.css", "text/css; charset=utf-8"],
  "/mark.svg": ["mark.svg", "image/svg+xml"],
};
const assets = new Map(await Promise.all(Object.entries(assetFiles).map(async ([route, [name, type]]) => [
  route, { type, data: await readFile(new URL("./public/" + name, import.meta.url)) },
])));
let liveRunning = false;

function json(response, status, data) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(data));
}

async function readBody(request) {
  let bytes = 0;
  const chunks = [];
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > 8192) throw new Error("Request too large");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function serveInvestigation(request, response) {
  if (!/^application\/json(?:;|$)/i.test(request.headers["content-type"] ?? "")) {
    json(response, 415, { error: "Send the incident question as JSON." });
    return;
  }
  let input;
  try {
    input = await readBody(request);
  } catch {
    json(response, 400, { error: "Invalid or oversized incident request." });
    return;
  }
  if (input?.mode !== "live" && input?.mode !== "replay") {
    json(response, 400, { error: "Select live search or the example replay." });
    return;
  }

  const isLive = input.mode === "live";
  if (isLive) {
    const issue = validateQuestion(input.question);
    if (issue) return json(response, 400, { error: issue });
    if (!liveReady) return json(response, 503, { error: "Add both provider API keys and restart the app to enable live search." });
    if (liveRunning) return json(response, 409, { error: "A live run is already in progress." });
    liveRunning = true;
  }

  const abort = new AbortController();
  response.on("close", () => {
    if (!response.writableEnded) abort.abort();
  });
  response.writeHead(200, { "Content-Type": "application/x-ndjson; charset=utf-8" });
  response.flushHeaders();

  const send = (type, data) => {
    if (!response.destroyed) response.write(JSON.stringify({ type, data }) + "\n");
  };

  try {
    const onTrace = step => send("trace", step);
    const result = isLive
      ? await investigate(input.question.trim(), providers, { model: config.model, signal: abort.signal, onTrace })
      : replay(onTrace);
    send("result", result);
  } catch (error) {
    if (!abort.signal.aborted) {
      if (!(error instanceof ProviderError)) console.error("Investigation failed:", error?.name);
      send("error", error instanceof ProviderError ? error.message : "The investigation could not finish. Please try again.");
    }
  } finally {
    if (isLive) liveRunning = false;
    if (!response.destroyed) response.end();
  }
}

async function route(request, response) {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  if (!localHosts.has(request.headers.host) ||
      (request.headers.origin && !localOrigins.has(request.headers.origin))) {
    return json(response, 403, { error: "Open Rollout Trace from its local address." });
  }

  const path = new URL(request.url, "http://localhost").pathname;
  if (request.method === "GET" && assets.has(path)) {
    const asset = assets.get(path);
    response.writeHead(200, { "Content-Type": asset.type });
    response.end(asset.data);
    return;
  }
  if (request.method === "GET" && path === "/api/config") {
    return json(response, 200, {
      liveReady,
      nebiusReady: Boolean(config.nebiusKey),
      tavilyReady: Boolean(config.tavilyKey),
      model: config.model,
      sampleQuestion,
    });
  }
  if (request.method === "POST" && path === "/api/investigate") {
    await serveInvestigation(request, response);
    return;
  }
  json(response, 404, { error: "This route does not exist." });
}

const server = createServer({ headersTimeout: 15_000, requestTimeout: 20_000 }, (request, response) => {
  route(request, response).catch(error => {
    console.error("Request failed:", error?.name);
    if (!response.headersSent) json(response, 500, { error: "Could not process this request." });
    else response.end();
  });
});
server.listen(port, "127.0.0.1", () => {
  console.log("Rollout Trace is running at http://127.0.0.1:" + port);
  console.log(liveReady ? "Live providers configured." : "Replay available. Add .env keys for live search.");
});
