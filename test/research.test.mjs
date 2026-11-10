import test from "node:test";
import assert from "node:assert/strict";
import { investigate, replay, validateQuestion } from "../src/agent.mjs";
import { addSources, checkReport } from "../src/evidence.mjs";

const oldBehavior = "The previous version enabled certificate discovery by default.";
const newBehavior = "Version 4 requires an explicit certificate bundle path.";
const initialResults = [{
  title: "Example runtime reference",
  url: "https://docs.example.com/runtime?utm_source=tracker",
  content: oldBehavior,
  score: 0.9,
}];
const followUpResult = {
  title: "Example release notes",
  url: "https://docs.example.com/v4",
  content: newBehavior,
};

test("a targeted follow-up changes the report using the newly retrieved source", async () => {
  const queries = [];
  const signals = [];
  const answer = await investigate("What changed in runtime version 4 certificate loading?", {
    async search(query) {
      queries.push(query);
      if (query === "runtime version 4 certificate bundle release notes") return [followUpResult];
      return initialResults;
    },
    async complete(_system, { sources, allowFollowUp }) {
      if (!sources) return { queries: ["runtime certificate error", "runtime vendor documentation"] };
      if (allowFollowUp) return { followUpQuery: "runtime version 4 certificate bundle release notes", findings: [] };
      assert.equal(sources.length, 2);
      return {
        findings: [{
          kind: "documented",
          statement: "Version 4 needs a configured CA bundle.",
          citations: [{ sourceId: "S2", quote: newBehavior }],
        }],
      };
    },
  }, { model: "test-model", onTrace: event => signals.push(event) });

  assert.equal(queries.length, 3);
  assert.equal(answer.mode, "live");
  assert.equal(answer.report.findings[0].citations[0].sourceId, "S2");
  assert.equal(answer.sources[1].url, followUpResult.url);
  assert.ok(signals.some(step => step.id === "follow-up" && step.state === "done"));
});

test("unknown IDs and invented quotes cannot become findings", () => {
  const sources = addSources([], initialResults);
  const candidate = { findings: [
    { kind: "documented", statement: "Forged evidence.", citations: [{ sourceId: "S8", quote: oldBehavior }] },
    { kind: "documented", statement: "Forged excerpt.", citations: [{ sourceId: "S1", quote: newBehavior }] },
  ] };
  const report = checkReport(candidate, sources);
  assert.equal(report.status, "insufficient");
  assert.deepEqual(report.findings, []);
  assert.equal(report.omitted, 2);
});

test("the example keeps sourced behavior and incident inference distinct", () => {
  const result = replay(() => {});
  assert.equal(result.mode, "replay");
  assert.deepEqual(result.report.findings.map(item => item.kind), ["documented", "inference", "documented"]);
  assert.equal(result.report.omitted, 0);
  assert.ok(result.report.gaps.some(item => item.includes("certificate chain")));
});

test("obvious credentials are rejected before the agent starts", () => {
  assert.match(validateQuestion("Why does this rollout fail? password=example-secret-123"), /Remove credentials/);
  assert.equal(validateQuestion("Why did certificate verification fail after the upgrade?"), "");
});
