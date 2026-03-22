import crypto from "crypto";
import { gameService } from "../services/gameService.js";
import { redis } from "../config/redis.js";

class ArenaService {
  constructor() {
    this.io = null;
    this.timers = new Map();
  }

  setIo(io) {
    this.io = io;
  }

  async createArena(duration /* minutes */, timeControl = null) {
    const arenaId = crypto.randomUUID();
    const endTime = Date.now() + duration * 60 * 1000;

    await redis.hset(`arena:${arenaId}`, {
      endTime: endTime.toString(),
      timeControl: timeControl ? JSON.stringify(timeControl) : "",
    });

    const timer = setTimeout(
      () => this._expireArena(arenaId),
      duration * 60 * 1000,
    );
    this.timers.set(arenaId, timer);

    return { arenaId, endTime };
  }

  async _expireArena(arenaId) {
    const arenaData = await redis.hgetall(`arena:${arenaId}`);
    if (!arenaData || !arenaData.endTime) return;

    console.log(`[Arena] ${arenaId} expired. Force-closing active games.`);

    if (this.io) {
      this.io.to(`arena:${arenaId}`).emit("arena_expired", { arenaId });
    }

    const activeGames = await gameService.getGamesByArenaId(arenaId);
    for (const game of activeGames) {
      const { gameId } = game;
      if (this.io) {
        this.io.to(gameId).emit("arena_expired", { arenaId, gameId });
      }
      await gameService.removeGame(gameId);
      console.log(`[Arena] Force-closed game ${gameId} due to arena expiry.`);
    }

    if (this.timers.has(arenaId)) {
      clearTimeout(this.timers.get(arenaId));
      this.timers.delete(arenaId);
    }

    await redis.del(`arena:${arenaId}`);
    await redis.del(`arena_queue:timed:${arenaId}`);
  }

  async broadcastQueueUpdate(arenaId) {
    const arenaData = await redis.hgetall(`arena:${arenaId}`);
    if (!arenaData || !arenaData.endTime || !this.io) return;

    const queueData = await redis.lrange(`arena_queue:timed:${arenaId}`, 0, -1);
    const queue = queueData.map((item) => JSON.parse(item));

    this.io.to(`arena:${arenaId}`).emit("arena_queue_update", {
      queue: queue.map((p) => ({
        userName: p.user.userName,
        rating: p.user.rating,
      })),
      endTime: parseInt(arenaData.endTime, 10),
    });
  }

  async joinArena(arenaId, socket, user) {
    const arenaData = await redis.hgetall(`arena:${arenaId}`);
    if (!arenaData || !arenaData.endTime) return { error: "Arena not found" };
    if (Date.now() > parseInt(arenaData.endTime, 10)) return { error: "Arena time has expired" };

    const queueData = await redis.lrange(`arena_queue:timed:${arenaId}`, 0, -1);
    const inQueue = queueData.some((item) => JSON.parse(item).socketId === socket.id);
    if (inQueue) return { error: "Already in queue" };

    const payload = JSON.stringify({ socketId: socket.id, user });
    await redis.rpush(`arena_queue:timed:${arenaId}`, payload);
    const queueLength = await redis.llen(`arena_queue:timed:${arenaId}`);

    return { success: true, queueLength };
  }

  async removePlayerFromArena(arenaId, socketId) {
    const queueData = await redis.lrange(`arena_queue:timed:${arenaId}`, 0, -1);
    for (const item of queueData) {
      if (JSON.parse(item).socketId === socketId) {
        await redis.lrem(`arena_queue:timed:${arenaId}`, 0, item);
      }
    }
  }

  async removeSocketFromAllArenas(socketId) {
    const affectedArenas = [];
    const keys = await redis.keys("arena_queue:timed:*");
    for (const key of keys) {
      const arenaId = key.split(":").pop();
      const queueData = await redis.lrange(key, 0, -1);
      for (const item of queueData) {
        if (JSON.parse(item).socketId === socketId) {
          await redis.lrem(key, 0, item);
          affectedArenas.push(arenaId);
        }
      }
    }
    return affectedArenas;
  }

  async matchArena(arenaId) {
    const arenaData = await redis.hgetall(`arena:${arenaId}`);
    if (!arenaData || !arenaData.endTime) return false;

    if (Date.now() > parseInt(arenaData.endTime, 10)) return false;

    const len = await redis.llen(`arena_queue:timed:${arenaId}`);
    if (len < 2) return false;

    const p1Str = await redis.lpop(`arena_queue:timed:${arenaId}`);
    const p2Str = await redis.lpop(`arena_queue:timed:${arenaId}`);

    if (p1Str && p2Str) {
      const player1 = JSON.parse(p1Str);
      const player2 = JSON.parse(p2Str);

      if (this.io) {
        this.io.in(player1.socketId).socketsLeave(`arena:${arenaId}`);
        this.io.in(player2.socketId).socketsLeave(`arena:${arenaId}`);
      }

      await this.broadcastQueueUpdate(arenaId);

      const tc = arenaData.timeControl ? JSON.parse(arenaData.timeControl) : null;
      return await gameService.createGame(player1, player2, arenaId, tc);
    } else if (p1Str) {
      await redis.rpush(`arena_queue:timed:${arenaId}`, p1Str);
    }

    return false;
  }

  async getArenaEndTime(arenaId) {
    const endTime = await redis.hget(`arena:${arenaId}`, "endTime");
    return endTime ? parseInt(endTime, 10) : null;
  }
}

export const arenaService = new ArenaService();
