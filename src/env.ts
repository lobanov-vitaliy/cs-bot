import "dotenv/config";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export const env = {
  BOT_TOKEN: requireEnv("BOT_TOKEN"),
  OPENAI_API_KEY: requireEnv("OPENAI_API_KEY"),
  OPENAI_MODEL: process.env.OPENAI_MODEL ?? "gpt-4o",
  // Per-request timeout for OpenAI calls. Without this the SDK waits up to
  // 10 minutes per attempt, which makes the bot look "dead" when OpenAI is
  // slow. 30s is plenty for a short chat completion.
  OPENAI_TIMEOUT_MS: parseInt(process.env.OPENAI_TIMEOUT_MS ?? "30000", 10),
  // How many times the SDK retries transient failures (network, 429, 5xx).
  OPENAI_MAX_RETRIES: parseInt(process.env.OPENAI_MAX_RETRIES ?? "2", 10),
  // Web search (CS news / live data) via OpenAI's built-in web_search tool.
  // Reuses OPENAI_API_KEY — no separate search provider or key required.
  WEB_SEARCH_ENABLED:
    (process.env.WEB_SEARCH_ENABLED ?? "true").toLowerCase() !== "false",
  // Model used for the web search call. Must support the Responses web_search
  // tool (gpt-4o does). Defaults to OPENAI_MODEL.
  WEB_SEARCH_MODEL:
    process.env.WEB_SEARCH_MODEL || process.env.OPENAI_MODEL || "gpt-4o",
  // Web search can take longer than a plain completion — give it more room.
  WEB_SEARCH_TIMEOUT_MS: parseInt(process.env.WEB_SEARCH_TIMEOUT_MS ?? "45000", 10),
  // How many recent group messages to keep per chat for the
  // get_recent_messages tool. Older rows are pruned; this is not an archive.
  RECENT_MESSAGES_RETENTION: parseInt(
    process.env.RECENT_MESSAGES_RETENTION ?? "300",
    10,
  ),
  DATABASE_PATH: process.env.DATABASE_PATH ?? "./data/cs-bot.db",
  DEFAULT_MAX_PLAYERS: parseInt(process.env.DEFAULT_MAX_PLAYERS ?? "5", 10),
  TIMEZONE: process.env.TIMEZONE ?? "Europe/Kyiv",
};
