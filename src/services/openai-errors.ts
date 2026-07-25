import OpenAI from "openai";

export interface OpenAiErrorContext {
  /** Model the failing request targeted, e.g. "gpt-4o". */
  model: string;
  /** Per-request timeout in ms, surfaced in timeout messages. */
  timeoutMs: number;
}

/**
 * Turn an OpenAI SDK error into (1) an actionable log line for the operator and
 * (2) a short, in-character reply for the chat that hints at the real cause.
 *
 * Previously every failure — bad key, wrong model, rate limit, network, 5xx —
 * collapsed into the same opaque "OpenAI ліг" message, so "OpenAI не відповідає"
 * was impossible to triage from the chat or the logs alone.
 *
 * Pure function (no env/db access) so the diagnostic script can reuse it.
 */
export function describeOpenAiError(
  err: unknown,
  ctx: OpenAiErrorContext,
): { log: string; user: string } {
  if (err instanceof OpenAI.APIConnectionTimeoutError) {
    return {
      log: `OpenAI request timed out after ${ctx.timeoutMs}ms (model=${ctx.model}). Raise OPENAI_TIMEOUT_MS or check OpenAI status.`,
      user: "OpenAI думав довше за наш саппорт на клатчі й не відповів (timeout). Спробуй ще раз.",
    };
  }
  if (err instanceof OpenAI.APIConnectionError) {
    return {
      log: `Could not reach OpenAI (network/DNS/proxy). Underlying: ${err.message}`,
      user: "Не достукався до OpenAI — схоже на мережу. Спробуй трохи згодом.",
    };
  }
  if (err instanceof OpenAI.AuthenticationError) {
    return {
      log: "OpenAI rejected the API key (401). Check that OPENAI_API_KEY is set and still valid.",
      user: "OpenAI не пускає — щось з API-ключем (401). Треба перевірити OPENAI_API_KEY.",
    };
  }
  if (err instanceof OpenAI.PermissionDeniedError) {
    return {
      log: `OpenAI denied access (403) for model=${ctx.model}. The key may lack access to this model/project.`,
      user: `OpenAI не дає доступ до моделі (403). Перевір, чи має ключ доступ до «${ctx.model}».`,
    };
  }
  if (err instanceof OpenAI.NotFoundError) {
    return {
      log: `OpenAI returned 404 — model "${ctx.model}" not found or retired. Update OPENAI_MODEL.`,
      user: `OpenAI не знає модель «${ctx.model}» (404). Схоже, її прибрали — перевір OPENAI_MODEL.`,
    };
  }
  if (err instanceof OpenAI.RateLimitError) {
    return {
      log: `OpenAI rate limit / quota hit (429) for model=${ctx.model}. Check usage limits and billing.`,
      user: "OpenAI каже «занадто швидко» (429) — ліміт або закінчилась квота. Дай йому передихнути.",
    };
  }
  if (err instanceof OpenAI.BadRequestError) {
    return {
      log: `OpenAI rejected the request (400) for model=${ctx.model}: ${err.message}. Params (temperature/max_tokens/tools) may be incompatible with this model.`,
      user: "OpenAI відхилив запит (400) — схоже на несумісні параметри моделі. Глянь логи.",
    };
  }
  if (err instanceof OpenAI.InternalServerError) {
    return {
      log: `OpenAI server error (5xx): ${err.message}. This is on OpenAI's side.`,
      user: "У OpenAI щось впало на їхньому боці (5xx). Спробуй пізніше.",
    };
  }
  if (err instanceof OpenAI.APIError) {
    return {
      log: `OpenAI API error (status=${err.status ?? "?"}, code=${err.code ?? "?"}): ${err.message}`,
      user: "OpenAI ліг, як і наш мід. Спробуй пізніше.",
    };
  }
  return {
    log: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
    user: "OpenAI ліг, як і наш мід. Спробуй пізніше.",
  };
}
