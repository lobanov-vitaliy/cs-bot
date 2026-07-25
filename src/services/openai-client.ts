import OpenAI from "openai";
import { env } from "../env.js";

// Single shared OpenAI client. Kept in its own module so both the chat flow
// (openai.ts) and the web search (web-search.ts) can import it without creating
// an import cycle between those two files.
//
// timeout/maxRetries bound each request so a slow or hung OpenAI call can't
// freeze the bot for the SDK's 10-minute default.
export const openai = new OpenAI({
  apiKey: env.OPENAI_API_KEY,
  timeout: env.OPENAI_TIMEOUT_MS,
  maxRetries: env.OPENAI_MAX_RETRIES,
});
