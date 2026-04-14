import OpenAI from "openai";
import type { ChatCompletionMessageParam, ChatCompletionTool } from "openai/resources/chat/completions.js";
import { env } from "../env.js";
import {
  getActiveGathersWithPlayers,
  getLatestActiveGather,
  cancelGather,
  updateGatherTime,
  joinGather,
  leaveGather,
} from "./gather.js";
import type { InferSelectModel } from "drizzle-orm";
import type { gathers, gatherPlayers } from "../db/schema.js";

type GatherWithPlayers = InferSelectModel<typeof gathers> & {
  players: InferSelectModel<typeof gatherPlayers>[];
};

export type AiAction =
  | { type: "cancelled"; gatherId: number; gather: InferSelectModel<typeof gathers> }
  | { type: "time_changed"; gatherId: number; gather: InferSelectModel<typeof gathers>; players: InferSelectModel<typeof gatherPlayers>[] }
  | { type: "roster_changed"; gatherId: number; gather: InferSelectModel<typeof gathers>; players: InferSelectModel<typeof gatherPlayers>[]; teamReady?: boolean; promotedPlayer?: InferSelectModel<typeof gatherPlayers> | null; needsTagging?: boolean };

export interface AiResult {
  text: string;
  action?: AiAction;
}

const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });

const tools: ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "cancel_gather",
      description: "Скасувати ВЕСЬ збір команди цілком. Використовуй ТІЛЬКИ коли користувач хоче скасувати/відмінити весь збір, а НЕ коли хоче вийти зі списку.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "update_gather_time",
      description: "Змінити час збору. Використовуй коли користувач просить перенести/змінити час/перенос/давай о/зміни на іншу годину.",
      parameters: {
        type: "object",
        properties: {
          new_time: {
            type: "string",
            description: "Новий час у форматі HH:MM, наприклад 22:30",
          },
        },
        required: ["new_time"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "leave_gather",
      description: "Видалити СЕБЕ зі списку збору. Використовуй коли користувач хоче вийти/прибери мене/я не граю/убери меня/мінус/я пас.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "join_gather",
      description: "Додати СЕБЕ до збору. Використовуй коли користувач хоче приєднатися/я граю/буду/запиши мене/я в ділі/плюс.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
];

function serializeGatherContext(gathers: GatherWithPlayers[]): string {
  if (gathers.length === 0) return "Активних зборів немає.";

  return gathers
    .map((g) => {
      const max = g.maxPlayers;
      const playerList =
        g.players.length > 0
          ? g.players
              .map((p, i) => {
                const name = p.username ? `@${p.username}` : p.firstName;
                const status = p.status === "confirmed" ? "✅" : "⏳";
                return `  ${i + 1}/${max} ${name} ${status}`;
              })
              .join("\n")
          : "  (нікого)";
      return `Збір на ${g.time} (${g.players.length}/${max}, статус: ${g.status}):\n${playerList}`;
    })
    .join("\n\n");
}

function buildSystemPrompt(gatherContext: string): string {
  return `Ти — бот для збору команди CS2 у Telegram-чаті. Ти зухвалий, смішний тіммейт.

ПРАВИЛА:
1. Відповідай ЗАВЖДИ українською мовою, незалежно від мови повідомлення.
2. Відповідай з гумором та сарказмом, як справжній тіммейт.
3. Якщо до тебе звертаються грубо — відповідай грубо у відповідь, не соромся.
4. Ти відповідаєш ТІЛЬКИ на питання про збір команди CS2: хто грає, о котрій, скільки людей, статус збору.
5. На будь-які інші питання (погода, новини, математика, що завгодно) — відповідай у стилі "Пан Віталій створив мене не для того, щоб я відповідав на твої тупі питання" або подібне. Будь креативний у варіаціях цієї фрази.
6. Відповідай коротко, 1-2 речення максимум.
7. Не будь ввічливим — будь як свій пацан у чаті.
8. Коли питають про склад/хто грає — ЗАВЖДИ відповідай у форматі нумерованого списку:
   1/5 @username ✅
   2/5 @username ⏳
   і т.д.
   Додай час гри та короткий коментар з гумором.
9. Якщо користувач просить перенести час або скасувати збір — ЗАВЖДИ використай відповідну функцію (cancel_gather або update_gather_time). НЕ відмовляй сам — функція сама перевірить чи має користувач право.

Поточні збори:
${gatherContext}`;
}

function executeToolCall(
  toolName: string,
  args: Record<string, string>,
  chatId: string,
  userId: string,
  userUsername: string | null,
  userFirstName: string,
): { result: string; action?: AiAction } {
  if (toolName === "cancel_gather") {
    const gather = getLatestActiveGather(chatId);
    if (!gather) return { result: "Немає активних зборів." };

    console.log(`[cancel] gather #${gather.id} createdBy=${gather.createdBy}, userId=${userId}`);

    const res = cancelGather(gather.id, userId);
    if (!res) return { result: "Збір не знайдено." };
    if ("notOwner" in res) return { result: "Цей користувач НЕ є автором збору. Скасувати може тільки автор." };

    return {
      result: `Збір на ${gather.time} скасовано.`,
      action: { type: "cancelled", gatherId: gather.id, gather },
    };
  }

  if (toolName === "update_gather_time") {
    const newTime = args.new_time;
    if (!newTime || !/^\d{1,2}:\d{2}$/.test(newTime)) {
      return { result: "Невірний формат часу." };
    }

    const gather = getLatestActiveGather(chatId);
    if (!gather) return { result: "Немає активних зборів." };

    const res = updateGatherTime(gather.id, userId, newTime);
    if (!res) return { result: "Збір не знайдено." };
    if ("notOwner" in res) return { result: "Цей користувач НЕ є автором збору. Змінити час може тільки автор." };

    return {
      result: `Час збору змінено на ${newTime}.`,
      action: { type: "time_changed", gatherId: gather.id, gather: res.gather, players: res.players },
    };
  }

  if (toolName === "leave_gather") {
    const gather = getLatestActiveGather(chatId);
    if (!gather) return { result: "Немає активних зборів." };

    const res = leaveGather(gather.id, userId, userUsername);
    if (!res) return { result: "Збір не знайдено." };
    if ("notFound" in res) return { result: "Цього користувача немає у списку збору." };

    return {
      result: `Користувача видалено зі списку збору.`,
      action: { type: "roster_changed", gatherId: gather.id, gather: res.gather, players: res.players, promotedPlayer: res.promotedPlayer, needsTagging: res.needsTagging },
    };
  }

  if (toolName === "join_gather") {
    const gather = getLatestActiveGather(chatId);
    if (!gather) return { result: "Немає активних зборів." };

    const res = joinGather(gather.id, {
      userId,
      username: userUsername,
      firstName: userFirstName,
    });
    if (!res) return { result: "Збір закрито." };

    const statusMsg = res.joinedAsReserve
      ? "Користувача додано в заміну (основний склад повний)."
      : "Користувача додано до збору.";

    return {
      result: statusMsg,
      action: { type: "roster_changed", gatherId: gather.id, gather: res.gather, players: res.players, teamReady: res.teamReady },
    };
  }

  return { result: "Невідома функція." };
}

export async function askAboutGather(
  userMessage: string,
  chatId: string,
  userId: string,
  userUsername: string | null,
  userFirstName: string,
): Promise<AiResult> {
  const activeGathers = getActiveGathersWithPlayers(chatId);
  const context = serializeGatherContext(activeGathers);
  const systemPrompt = buildSystemPrompt(context);

  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userMessage },
  ];

  try {
    const response = await openai.chat.completions.create({
      model: env.OPENAI_MODEL,
      messages,
      tools,
      temperature: 0.9,
      max_tokens: 200,
    });

    const message = response.choices[0].message;

    // No tool calls — just return the text
    if (!message.tool_calls?.length) {
      return { text: message.content ?? "Шось пішло не так, братан." };
    }

    // Execute tool calls
    let action: AiAction | undefined;
    messages.push(message);

    for (const toolCall of message.tool_calls) {
      if (toolCall.type !== "function") continue;
      const args = JSON.parse(toolCall.function.arguments || "{}");
      const { result, action: toolAction } = executeToolCall(
        toolCall.function.name,
        args,
        chatId,
        userId,
        userUsername,
        userFirstName,
      );
      if (toolAction) action = toolAction;

      messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: result,
      });
    }

    // Second call to get a natural response
    const followUp = await openai.chat.completions.create({
      model: env.OPENAI_MODEL,
      messages,
      temperature: 0.9,
      max_tokens: 200,
    });

    const text = followUp.choices[0].message.content ?? "Готово, братан.";
    return { text, action };
  } catch (err) {
    console.error("OpenAI error:", err);
    return { text: "OpenAI ліг, як і наш мід. Спробуй пізніше." };
  }
}
