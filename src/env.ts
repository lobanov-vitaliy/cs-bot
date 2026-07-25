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
  DATABASE_PATH: process.env.DATABASE_PATH ?? "./data/cs-bot.db",
  DEFAULT_MAX_PLAYERS: parseInt(process.env.DEFAULT_MAX_PLAYERS ?? "5", 10),
  TIMEZONE: process.env.TIMEZONE ?? "Europe/Kyiv",
};
