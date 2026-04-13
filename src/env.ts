import "dotenv/config";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export const env = {
  BOT_TOKEN: requireEnv("BOT_TOKEN"),
  OPENAI_API_KEY: requireEnv("OPENAI_API_KEY"),
  OPENAI_MODEL: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
  DATABASE_PATH: process.env.DATABASE_PATH ?? "./data/cs-bot.db",
  DEFAULT_MAX_PLAYERS: parseInt(process.env.DEFAULT_MAX_PLAYERS ?? "5", 10),
  TIMEZONE: process.env.TIMEZONE ?? "Europe/Kyiv",
};
