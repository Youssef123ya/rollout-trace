const NEBIUS_URL = "https://api.tokenfactory.nebius.com/v1/chat/completions";
const TAVILY_URL = "https://api.tavily.com/search";

export function providerConfig(env = process.env) {
  return {
    nebiusKey: env.NEBIUS_API_KEY?.trim() ?? "",
    tavilyKey: env.TAVILY_API_KEY?.trim() ?? "",
    model: env.NEBIUS_MODEL?.trim() || "openai/gpt-oss-120b",
  };
}

export class ProviderError extends Error {}

function statusMessage(service, status) {
  if (status === 401 || status === 403) {
    return service + " denied access. Check that its API key is valid and has permission.";
  }
  if (status === 402 || status === 429 || status === 432 || status === 433) {
    return service + " reached a limit. Check credits or rate limits and try again.";
  }
  if (service === "Nebius Token Factory" && (status === 400 || status === 404)) {
    return "Nebius rejected the request. Check NEBIUS_MODEL and its JSON output support.";
  }
  return service + " returned HTTP " + status + ". Try again shortly.";
}

async function postJson(service, url, key, body, timeout, signal) {
  const deadline = AbortSignal.timeout(timeout);
  try {
    const response = await fetch(url, {
      method: "POST",
      redirect: "error",
      headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: signal ? AbortSignal.any([signal, deadline]) : deadline,
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      throw new ProviderError(statusMessage(service, response.status));
    }
    return await response.json();
  } catch (error) {
    if (signal?.aborted || error instanceof ProviderError) throw error;
    if (deadline.aborted) throw new ProviderError(service + " timed out. Please retry.");
    if (error instanceof SyntaxError) throw new ProviderError(service + " returned unreadable JSON.");
    throw new ProviderError("Could not reach " + service + ". Check the connection and retry.");
  }
}

export function createProviders(config) {
  return {
    async search(query, signal) {
      const result = await postJson("Tavily", TAVILY_URL, config.tavilyKey, {
        query,
        search_depth: "advanced",
        chunks_per_source: 2,
        max_results: 4,
        topic: "general",
        include_answer: false,
        include_raw_content: false,
        auto_parameters: false,
      }, 16_000, signal);
      if (!Array.isArray(result?.results)) {
        throw new ProviderError("Tavily did not return a list of sources.");
      }
      return result.results;
    },
    async complete(system, input, { maxTokens, signal }) {
      const body = {
        model: config.model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: JSON.stringify(input) },
        ],
        temperature: 0.15,
        max_tokens: maxTokens,
        response_format: { type: "json_object" },
      };
      if (config.model.startsWith("openai/gpt-oss-")) body.reasoning_effort = "low";
      const response = await postJson("Nebius Token Factory", NEBIUS_URL, config.nebiusKey, body, 32_000, signal);
      const choice = response?.choices?.[0];
      if (choice?.finish_reason === "length") {
        throw new ProviderError("Nebius reached the output limit. Try a narrower incident question.");
      }
      try {
        const data = JSON.parse(choice?.message?.content ?? "");
        if (!data || Array.isArray(data) || typeof data !== "object") throw new SyntaxError();
        return data;
      } catch {
        throw new ProviderError("Nebius did not return a usable research response. Please retry.");
      }
    },
  };
}
