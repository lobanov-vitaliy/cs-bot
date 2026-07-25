// Standalone OpenAI connectivity check — run it where the bot actually runs:
//
//   npm run check:openai
//
// It uses the same OPENAI_* environment variables as the bot and makes one
// tiny chat completion, then prints a clear PASS/FAIL with the real cause
// (auth / model / rate-limit / network / timeout). Use this to answer
// "чому OpenAI не відповідає?" without digging through bot logs.
//
// Deliberately self-contained: it does NOT import the bot, the database, or
// require BOT_TOKEN — so you can check OpenAI in isolation.
import "dotenv/config";
import OpenAI from "openai";
import { describeOpenAiError } from "../services/openai-errors.js";

const apiKey = process.env.OPENAI_API_KEY;
const model = process.env.OPENAI_MODEL ?? "gpt-4o";
const timeoutMs = parseInt(process.env.OPENAI_TIMEOUT_MS ?? "30000", 10);
const maxRetries = parseInt(process.env.OPENAI_MAX_RETRIES ?? "2", 10);

function maskKey(key: string): string {
  if (key.length <= 12) return "sk-…(too short?)";
  return `${key.slice(0, 7)}…${key.slice(-4)}`;
}

async function main(): Promise<number> {
  console.log("=== OpenAI connectivity check ===");
  console.log(`model:      ${model}`);
  console.log(`timeout:    ${timeoutMs}ms`);
  console.log(`maxRetries: ${maxRetries}`);

  if (!apiKey) {
    console.error("\n❌ FAIL: OPENAI_API_KEY is not set. The bot cannot call OpenAI at all.");
    return 1;
  }
  console.log(`api key:    ${maskKey(apiKey)}`);

  const openai = new OpenAI({ apiKey, timeout: timeoutMs, maxRetries });

  const startedAt = Date.now();
  try {
    // Minimal request: isolates connectivity/auth/model from param quirks.
    const res = await openai.chat.completions.create({
      model,
      messages: [{ role: "user", content: "ping" }],
      max_tokens: 5,
    });
    const ms = Date.now() - startedAt;
    const reply = res.choices[0]?.message?.content?.trim() || "(empty)";
    console.log(`\n✅ PASS: OpenAI responded in ${ms}ms.`);
    console.log(`   model in response: ${res.model}`);
    console.log(`   reply: ${reply}`);
    return 0;
  } catch (err) {
    const ms = Date.now() - startedAt;
    const { log } = describeOpenAiError(err, { model, timeoutMs });
    console.error(`\n❌ FAIL after ${ms}ms: ${log}`);
    return 1;
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error("Unexpected error while checking OpenAI:", err);
    process.exit(1);
  });
