import { openai } from "./openai-client.js";
import { env } from "../env.js";

/**
 * Live web search for CS2 news and data, powered by OpenAI's built-in
 * `web_search` tool (Responses API). Reuses OPENAI_API_KEY, so there's no
 * separate search provider to configure.
 *
 * Returns a plain-text, source-aware summary that the chat model then re-voices
 * in the bot's style. On any failure it returns a short human-readable string
 * (never throws) so the tool call always yields a usable result.
 */
export async function searchWeb(query: string): Promise<string> {
  const trimmed = query.trim();
  if (!trimmed) return "Порожній запит — нема що шукати.";

  if (!env.WEB_SEARCH_ENABLED) {
    return "Веб-пошук вимкнено (WEB_SEARCH_ENABLED=false).";
  }

  const instructions = [
    "Ти — пошуковий помічник для Telegram-бота про Counter-Strike 2 (CS2) та кіберспорт CS.",
    "Знайди в інтернеті свіжу та достовірну інформацію за запитом нижче.",
    "Відповідай стисло (до 6 речень), по фактах, українською мовою.",
    "Вказуй дати подій і назви джерел. Якщо дані суперечливі або застарілі — скажи це.",
    "Якщо нічого релевантного не знайшов — чесно напиши, що не знайшов.",
    "",
    `Запит: ${trimmed}`,
  ].join("\n");

  try {
    const res = await openai.responses.create(
      {
        model: env.WEB_SEARCH_MODEL,
        tools: [{ type: "web_search", search_context_size: "medium" }],
        input: instructions,
        max_output_tokens: 600,
      },
      { timeout: env.WEB_SEARCH_TIMEOUT_MS },
    );

    const text = res.output_text?.trim();
    if (!text) return "Пошук нічого не повернув. Спробуй переформулювати.";
    return text;
  } catch (err) {
    console.error("Web search error:", err);
    return "Не вдалося виконати веб-пошук зараз (помилка або таймаут). Спробуй пізніше.";
  }
}
