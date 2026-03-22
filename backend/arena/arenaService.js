import crypto from "crypto";
import { gameService } from "../services/gameService.js";

class ArenaService {
  constructor() {
    this.timedArenas = new Map();
    this.io = null;
  }

  setIo(io) {
    this.io = io;
  }

  createArena(duration /* minutes */, timeControl = null) {
    const arenaId = crypto.randomUUID();
    const endTime = Date.now() + duration * 60 * 1000;

    const timer = setTimeout(
      () => this._expireArena(arenaId),
      duration * 60 * 1000,
    );

    this.timedArenas.set(arenaId, {
      arenaId,
      endTime,
      queue: [],
      timer,
      timeControl,
    });
    return { arenaId, endTime };
  }

  _expireArena(arenaId) {
    const arena = this.timedArenas.get(arenaId);
    if (!arena) return;

    console.log(`[Arena] ${arenaId} expired. Force-closing active games.`);

    if (this.io) {
      this.io.to(`arena:${arenaId}`).emit("arena_expired", { arenaId });
    }

    const activeGames = gameService.getGamesByArenaId(arenaId);
    for (const game of activeGames) {
      const { gameId } = game;
      if (this.io) {
        this.io.to(gameId).emit("arena_expired", { arenaId, gameId });
      }
      gameService.removeGame(gameId);
      console.log(`[Arena] Force-closed game ${gameId} due to arena expiry.`);
    }

    clearTimeout(arena.timer);
    this.timedArenas.delete(arenaId);
  }

  broadcastQueueUpdate(arenaId) {
    const arena = this.timedArenas.get(arenaId);
    if (!arena || !this.io) return;

    this.io.to(`arena:${arenaId}`).emit("arena_queue_update", {
      queue: arena.queue.map((p) => ({
        userName: p.user.userName,
        rating: p.user.rating,
      })),
      endTime: arena.endTime,
    });
  }

  joinArena(arenaId, socket, user) {
    const arena = this.timedArenas.get(arenaId);
    if (!arena) return { error: "Arena not found" };
    if (Date.now() > arena.endTime) return { error: "Arena time has expired" };

    if (arena.queue.find((p) => p.socket.id === socket.id))
      return { error: "Already in queue" };

    arena.queue.push({ socket, user });
    return { success: true, queueLength: arena.queue.length };
  }

  removePlayerFromArena(arenaId, socketId) {
    const arena = this.timedArenas.get(arenaId);
    if (arena) {
      arena.queue = arena.queue.filter((p) => p.socket.id !== socketId);
    }
  }

  removeSocketFromAllArenas(socketId) {
    const affectedArenas = [];
    for (const arena of this.timedArenas.values()) {
      const before = arena.queue.length;
      arena.queue = arena.queue.filter((p) => p.socket.id !== socketId);
      if (arena.queue.length !== before) affectedArenas.push(arena.arenaId);
    }
    return affectedArenas;
  }

  matchArena(arenaId) {
    const arena = this.timedArenas.get(arenaId);
    if (!arena || arena.queue.length < 2) return false;

    if (Date.now() > arena.endTime) return false;

    const player1 = arena.queue.shift();
    const player2 = arena.queue.shift();

    player1.socket.leave(`arena:${arenaId}`);
    player2.socket.leave(`arena:${arenaId}`);

    this.broadcastQueueUpdate(arenaId);

    return gameService.createGame(player1, player2, arenaId, arena.timeControl);
  }

  getArenaEndTime(arenaId) {
    return this.timedArenas.get(arenaId)?.endTime ?? null;
  }
}

export const arenaService = new ArenaService();
