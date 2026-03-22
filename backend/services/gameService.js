import { Chess } from "chess.js";
import crypto from "crypto";
import { redis } from "../config/redis.js";

class GameService {
  async addToQueue(socket, user, timeControl) {
    const queueKey = timeControl ? timeControl.label : "unlimited";
    const payload = JSON.stringify({ socketId: socket.id, user, timeControl });

    const currentQueue = await redis.lrange(`arena_queue:${queueKey}`, 0, -1);
    const inQueue = currentQueue.some(
      (item) => JSON.parse(item).socketId === socket.id,
    );
    if (inQueue) return false;

    await redis.rpush(`arena_queue:${queueKey}`, payload);
    return true;
  }

  async removeFromQueue(socketId) {
    const keys = await redis.keys("arena_queue:*");
    for (const key of keys) {
      const currentQueue = await redis.lrange(key, 0, -1);
      for (const itemStr of currentQueue) {
        if (JSON.parse(itemStr).socketId === socketId) {
          await redis.lrem(key, 0, itemStr);
        }
      }
    }
  }

  async getQueueLength() {
    const keys = await redis.keys("arena_queue:*");
    let total = 0;
    for (const key of keys) {
      total += await redis.llen(key);
    }
    return total;
  }

  async matchPlayers() {
    const keys = await redis.keys("arena_queue:*");
    for (const key of keys) {
      const len = await redis.llen(key);
      if (len >= 2) {
        const p1Str = await redis.lpop(key);
        const p2Str = await redis.lpop(key);
        if (p1Str && p2Str) {
          const p1 = JSON.parse(p1Str);
          const p2 = JSON.parse(p2Str);
          return await this.createGame(p1, p2, null, p1.timeControl);
        } else if (p1Str) {
          await redis.rpush(key, p1Str);
        }
      }
    }
    return false;
  }

  async createGame(player1, player2, arenaId = null, timeControl = null) {
    const gameId = crypto.randomUUID();
    const tc = timeControl || { label: "unlimited", initial: 0, increment: 0 };
    const initialMs = tc.initial * 60 * 1000;

    const playersData = {
      white: {
        user: player1.user,
        time: initialMs,
        socketId: player1.socketId,
      },
      black: {
        user: player2.user,
        time: initialMs,
        socketId: player2.socketId,
      },
    };

    const instance = new Chess();

    const gameData = {
      gameId,
      arenaId: arenaId || "",
      timeControl: JSON.stringify(tc),
      players: JSON.stringify(playersData),
      fen: instance.fen(),
      pgn: instance.pgn(),
      lastMoveTime: "",
    };

    await redis.hset(`game:${gameId}`, gameData);

    if (initialMs > 0) {
      await redis.set(`timer:${gameId}:white`, initialMs);
      await redis.set(`timer:${gameId}:black`, initialMs);
    }

    return this.getGame(gameId);
  }

  async getGame(gameId) {
    const data = await redis.hgetall(`game:${gameId}`);
    if (!data || !data.gameId) return null;

    const instance = new Chess(data.fen);
    if (data.pgn) {
      try {
        instance.loadPgn(data.pgn);
      } catch (e) {
        console.error("Failed to load PGN", e);
      }
    }

    const players = JSON.parse(data.players);
    const tc = data.timeControl ? JSON.parse(data.timeControl) : null;

    if (tc && tc.label !== "unlimited") {
      const whiteTime = await redis.get(`timer:${gameId}:white`);
      const blackTime = await redis.get(`timer:${gameId}:black`);
      if (whiteTime) players.white.time = parseInt(whiteTime, 10);
      if (blackTime) players.black.time = parseInt(blackTime, 10);
    }

    return {
      gameId: data.gameId,
      arenaId: data.arenaId,
      timeControl: tc,
      players,
      instance,
      lastMoveTime: data.lastMoveTime ? parseInt(data.lastMoveTime, 10) : null,
      timeoutTimer: null,
    };
  }

  async getGameByUserId(userId) {
    const keys = await redis.keys("game:*");
    for (const key of keys) {
      const data = await redis.hgetall(key);
      if (data && data.players) {
        const players = JSON.parse(data.players);
        const wId = players.white.user._id.toString();
        const bId = players.black.user._id.toString();
        if (wId === userId.toString() || bId === userId.toString()) {
          return this.getGame(data.gameId);
        }
      }
    }
    return null;
  }

  async rejoinGame(gameId, userId, newSocketId) {
    const game = await this.getGame(gameId);
    if (!game) return null;

    const uid = userId.toString();
    const { players } = game;
    let color = null;

    if (players.white.user._id.toString() === uid) {
      color = "white";
      players.white.socketId = newSocketId;
    } else if (players.black.user._id.toString() === uid) {
      color = "black";
      players.black.socketId = newSocketId;
    }

    if (!color) return null;

    await redis.hset(`game:${gameId}`, "players", JSON.stringify(players));

    game.players = players;
    return { game, color };
  }

  async saveGameState(gameId, instance, players, lastMoveTime) {
    await redis.hset(`game:${gameId}`, {
      fen: instance.fen(),
      pgn: instance.pgn(),
      players: JSON.stringify(players),
      lastMoveTime: lastMoveTime ? lastMoveTime.toString() : "",
    });

    if (players.white.time !== undefined) {
      await redis.set(`timer:${gameId}:white`, players.white.time);
      await redis.set(`timer:${gameId}:black`, players.black.time);
    }
  }

  async getGamesByArenaId(arenaId) {
    const keys = await redis.keys("game:*");
    const games = [];
    for (const key of keys) {
      const data = await redis.hgetall(key);
      if (data && data.arenaId === arenaId) {
        const game = await this.getGame(data.gameId);
        if (game) games.push(game);
      }
    }
    return games;
  }

  async removeGame(gameId) {
    await redis.del(`game:${gameId}`);
    await redis.del(`timer:${gameId}:white`);
    await redis.del(`timer:${gameId}:black`);
  }
}

export const gameService = new GameService();
