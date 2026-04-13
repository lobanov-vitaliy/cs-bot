import { InlineKeyboard } from "grammy";

export function buildGatherKeyboard(gatherId: number): InlineKeyboard {
  return new InlineKeyboard()
    .text("✅ Я в ділі", `gather:join:${gatherId}`)
    .text("❌ Не можу", `gather:leave:${gatherId}`);
}
