import { db } from "../db/index.js";
import { gathers, gatherPlayers } from "../db/schema.js";
import { eq, and, desc, or } from "drizzle-orm";
import { env } from "../env.js";

export function createGather(params: {
  chatId: string;
  createdBy: string;
  creatorUsername: string | null;
  creatorFirstName: string;
  time: string;
  initialPlayers?: string[];
}) {
  const [gather] = db
    .insert(gathers)
    .values({
      chatId: params.chatId,
      time: params.time,
      maxPlayers: env.DEFAULT_MAX_PLAYERS,
      createdBy: params.createdBy,
      createdAt: new Date().toISOString(),
    })
    .returning()
    .all();

  // Add the creator as the first confirmed player
  const creatorAlreadyInList = params.initialPlayers?.some(
    (u) => u.replace(/^@/, "").toLowerCase() === params.creatorUsername?.toLowerCase(),
  );

  if (!creatorAlreadyInList) {
    db.insert(gatherPlayers)
      .values({
        gatherId: gather.id,
        userId: params.createdBy,
        username: params.creatorUsername,
        firstName: params.creatorFirstName,
        status: "confirmed",
        joinedAt: new Date().toISOString(),
      })
      .run();
  }

  if (params.initialPlayers?.length) {
    const added = new Set<string>();
    // Mark creator as already added
    if (params.creatorUsername) {
      added.add(params.creatorUsername.toLowerCase());
    }

    for (const username of params.initialPlayers) {
      const clean = username.replace(/^@/, "");
      const key = clean.toLowerCase();

      // Skip duplicates
      if (added.has(key)) continue;
      added.add(key);

      // Skip if it's the creator (already added as confirmed above)
      if (key === params.creatorUsername?.toLowerCase()) continue;

      db.insert(gatherPlayers)
        .values({
          gatherId: gather.id,
          userId: "",
          username: clean,
          firstName: clean,
          status: "pending",
          joinedAt: new Date().toISOString(),
        })
        .run();
    }
  }

  return gather;
}

export function updateGatherMessageId(gatherId: number, messageId: string) {
  db.update(gathers)
    .set({ messageId })
    .where(eq(gathers.id, gatherId))
    .run();
}

function findGather(gatherId: number) {
  const results = db
    .select()
    .from(gathers)
    .where(eq(gathers.id, gatherId))
    .all();
  return results[0] ?? null;
}

function findPlayerByUserId(gatherId: number, userId: string) {
  const results = db
    .select()
    .from(gatherPlayers)
    .where(and(eq(gatherPlayers.gatherId, gatherId), eq(gatherPlayers.userId, userId)))
    .all();
  return results[0] ?? null;
}

function findPlayerByUsername(gatherId: number, username: string) {
  const results = db
    .select()
    .from(gatherPlayers)
    .where(
      and(
        eq(gatherPlayers.gatherId, gatherId),
        eq(gatherPlayers.username, username),
        eq(gatherPlayers.userId, ""),
      ),
    )
    .all();
  return results[0] ?? null;
}

export function joinGather(
  gatherId: number,
  user: { userId: string; username: string | null; firstName: string },
) {
  const gather = findGather(gatherId);
  if (!gather || gather.status === "cancelled" || gather.status === "expired") {
    return null;
  }

  const existing = findPlayerByUserId(gatherId, user.userId);
  const existingByUsername =
    user.username ? findPlayerByUsername(gatherId, user.username) : null;

  if (existing) {
    if (existing.status !== "confirmed") {
      db.update(gatherPlayers)
        .set({
          status: "confirmed",
          username: user.username,
          firstName: user.firstName,
        })
        .where(eq(gatherPlayers.id, existing.id))
        .run();
    }
  } else if (existingByUsername) {
    db.update(gatherPlayers)
      .set({
        userId: user.userId,
        firstName: user.firstName,
        status: "confirmed",
      })
      .where(eq(gatherPlayers.id, existingByUsername.id))
      .run();
  } else {
    const currentCount = getPlayersForGather(gatherId).length;
    if (currentCount >= gather.maxPlayers) {
      return { gather, players: getPlayersForGather(gatherId), full: true };
    }

    db.insert(gatherPlayers)
      .values({
        gatherId,
        userId: user.userId,
        username: user.username,
        firstName: user.firstName,
        status: "confirmed",
        joinedAt: new Date().toISOString(),
      })
      .run();
  }

  const players = getPlayersForGather(gatherId);
  const confirmedCount = players.filter((p) => p.status === "confirmed").length;

  if (confirmedCount >= gather.maxPlayers && gather.status !== "full") {
    db.update(gathers)
      .set({ status: "full" })
      .where(eq(gathers.id, gatherId))
      .run();
    const updatedGather = findGather(gatherId)!;
    return { gather: updatedGather, players, full: false, teamReady: true };
  }

  const updatedGather = findGather(gatherId)!;
  return { gather: updatedGather, players, full: false };
}

export function leaveGather(gatherId: number, userId: string, username: string | null) {
  const gather = findGather(gatherId);
  if (!gather) return null;

  let player = findPlayerByUserId(gatherId, userId);

  if (!player && username) {
    const results = db
      .select()
      .from(gatherPlayers)
      .where(
        and(
          eq(gatherPlayers.gatherId, gatherId),
          eq(gatherPlayers.username, username),
        ),
      )
      .all();
    player = results[0] ?? null;
  }

  if (!player) {
    return { gather, players: getPlayersForGather(gatherId), notFound: true as const };
  }

  db.delete(gatherPlayers).where(eq(gatherPlayers.id, player.id)).run();

  if (gather.status === "full") {
    db.update(gathers)
      .set({ status: "open" })
      .where(eq(gathers.id, gatherId))
      .run();
  }

  const updatedGather = findGather(gatherId)!;
  const players = getPlayersForGather(gatherId);
  return { gather: updatedGather, players };
}

export function cancelGather(gatherId: number, userId: string) {
  const gather = findGather(gatherId);
  if (!gather) return null;
  if (gather.createdBy !== userId) return { notOwner: true as const };

  db.update(gathers)
    .set({ status: "cancelled" })
    .where(eq(gathers.id, gatherId))
    .run();

  return { cancelled: true as const };
}

export function updateGatherTime(gatherId: number, userId: string, newTime: string) {
  const gather = findGather(gatherId);
  if (!gather) return null;
  if (gather.createdBy !== userId) return { notOwner: true as const };

  db.update(gathers)
    .set({ time: newTime })
    .where(eq(gathers.id, gatherId))
    .run();

  const updatedGather = findGather(gatherId)!;
  const players = getPlayersForGather(gatherId);
  return { gather: updatedGather, players };
}

export function getLatestActiveGather(chatId: string) {
  const results = db
    .select()
    .from(gathers)
    .where(
      and(
        eq(gathers.chatId, chatId),
        or(eq(gathers.status, "open"), eq(gathers.status, "full")),
      ),
    )
    .orderBy(desc(gathers.createdAt))
    .limit(1)
    .all();
  return results[0] ?? null;
}

export function getPlayersForGather(gatherId: number) {
  return db
    .select()
    .from(gatherPlayers)
    .where(eq(gatherPlayers.gatherId, gatherId))
    .orderBy(gatherPlayers.joinedAt)
    .all();
}

export function getActiveGathersForChat(chatId: string) {
  return db
    .select()
    .from(gathers)
    .where(
      and(
        eq(gathers.chatId, chatId),
        or(eq(gathers.status, "open"), eq(gathers.status, "full")),
      ),
    )
    .orderBy(desc(gathers.createdAt))
    .all();
}

export function getActiveGathersWithPlayers(chatId: string) {
  const allGathers = db
    .select()
    .from(gathers)
    .where(eq(gathers.chatId, chatId))
    .orderBy(desc(gathers.createdAt))
    .all();

  const today = new Date().toISOString().slice(0, 10);
  const todayGathers = allGathers.filter(
    (g) =>
      g.createdAt.startsWith(today) &&
      (g.status === "open" || g.status === "full"),
  );

  return todayGathers.map((g) => ({
    ...g,
    players: getPlayersForGather(g.id),
  }));
}

export function addPlayerByCreator(
  gatherId: number,
  creatorUserId: string,
  username: string,
) {
  const gather = findGather(gatherId);
  if (!gather || gather.status === "cancelled" || gather.status === "expired") {
    return null;
  }
  if (gather.createdBy !== creatorUserId) return { notOwner: true as const };

  // Check if player already in gather
  const existing = db
    .select()
    .from(gatherPlayers)
    .where(
      and(
        eq(gatherPlayers.gatherId, gatherId),
        eq(gatherPlayers.username, username),
      ),
    )
    .all();

  if (existing.length > 0) {
    return { alreadyIn: true as const };
  }

  const currentCount = getPlayersForGather(gatherId).length;
  if (currentCount >= gather.maxPlayers) {
    return { gather, players: getPlayersForGather(gatherId), full: true as const };
  }

  db.insert(gatherPlayers)
    .values({
      gatherId,
      userId: "",
      username,
      firstName: username,
      status: "pending",
      joinedAt: new Date().toISOString(),
    })
    .run();

  const updatedGather = findGather(gatherId)!;
  const players = getPlayersForGather(gatherId);
  return { gather: updatedGather, players };
}

export function removePlayerByCreator(
  gatherId: number,
  creatorUserId: string,
  username: string,
) {
  const gather = findGather(gatherId);
  if (!gather) return null;
  if (gather.createdBy !== creatorUserId) return { notOwner: true as const };

  const matched = db
    .select()
    .from(gatherPlayers)
    .where(
      and(
        eq(gatherPlayers.gatherId, gatherId),
        eq(gatherPlayers.username, username),
      ),
    )
    .all();

  if (matched.length === 0) {
    return { notFound: true as const };
  }

  db.delete(gatherPlayers).where(eq(gatherPlayers.id, matched[0].id)).run();

  if (gather.status === "full") {
    db.update(gathers)
      .set({ status: "open" })
      .where(eq(gathers.id, gatherId))
      .run();
  }

  const updatedGather = findGather(gatherId)!;
  const players = getPlayersForGather(gatherId);
  return { gather: updatedGather, players };
}
