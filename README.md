# Rollout Trace

Rollout Trace helps on-call engineers research a deployment failure. Enter a symptom and a version change, inspect what the public sources say, and export a Markdown handoff with the evidence and remaining checks.

Built for the [ODSC × Nebius Hackathon](https://hackathon.odsc.ai/).

## Run locally

Install [Node.js](https://nodejs.org/) 22.9 or newer. No dependencies are needed.

```sh
npm start
```

Open [http://127.0.0.1:4173](http://127.0.0.1:4173/). **Run example replay** loads a synthetic Lambda-to-RDS incident with saved excerpts from AWS documentation and prepared findings. The app labels the replay and makes no provider calls in this mode.

For **Investigate live**:

1. Create a [Nebius Token Factory API key](https://docs.tokenfactory.nebius.com/quickstart) and a [Tavily API key](https://app.tavily.com/).
2. Copy `.env.example` to `.env` in this folder and fill in both keys locally. On Windows, `powershell -ExecutionPolicy Bypass -File .\setup-keys.ps1` prompts for them with masked input.
3. Restart the server. Load the example question or enter a public deployment symptom, then select **Investigate live**.

The server binds to loopback. It does not serve `.env`, put keys in reports, or persist incident questions. In live mode, the question goes to Nebius and public search queries go to Tavily. Enter only information you can share with those services.

## Try a representative incident

The example asks why a ZIP-deployed Lambda function can no longer connect to RDS over TLS after a Node.js 18 to 20 upgrade. Inspect the AWS documentation citation for the certificate-loading change, then compare the **Incident inference** and **Still uncertain** sections. The case does not include the actual client configuration or certificate chain.

Select a source badge to reveal the quoted passage and its link. The exported Markdown report includes the question, findings, quotes, uncertainties, next checks, and source register.

## How the agent works

1. **Plan.** Nebius Token Factory uses an open-weight model, `openai/gpt-oss-120b` by default, to generate distinct searches for the symptom and the changed behavior.
2. **Search.** Tavily retrieves public excerpts for the two queries in parallel. The server deduplicates sources and gives them stable IDs.
3. **Compare.** Nebius uses the excerpts to produce structured findings, inferences, and gaps. It can request one additional targeted search if a missing fact could change the answer.
4. **Check citations.** The server checks that the cited source exists and that the quote is present in the retrieved excerpt. Findings without a matching quote are omitted. Matching a quote does not prove that the claim follows from it. The interface makes the original source easy to inspect.
5. **Hand off.** The report distinguishes documented facts, inferences, and conflicting evidence. The trace shows the queries and the source count for the run.

Each live run is limited to three Tavily requests and three model calls. The server runs one live investigation at a time. If a follow-up fails, it preserves the earlier evidence and marks the gap. It does not modify cloud resources.

## Checks

```sh
npm test
```

The tests cover a follow-up that changes the evidence, rejection of invented citations, the distinction between facts and inference in the replay, and rejection of input containing obvious credentials. Test fixtures do not call the external providers.

Provider references: [Nebius JSON output](https://docs.tokenfactory.nebius.com/ai-models-inference/json) and [Tavily Search API](https://docs.tavily.com/documentation/api-reference/endpoint/search).
