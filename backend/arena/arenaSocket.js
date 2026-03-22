import { arenaService } from "./arenaService.js";
import { startMatch } from "../utils/socketStartMatch.js";

export const registerArenaHandlers = (io, socket) => {
  socket.on("join_arena", async ({ arenaId }) => {
    const result = await arenaService.joinArena(arenaId, socket, socket.user);

    if (result.error) {
      return socket.emit("arena_error", { message: result.error });
    }

    socket.join(`arena:${arenaId}`);

    console.log(
      `[Arena] ${socket.user.userName} joined arena ${arenaId}. Queue: ${result.queueLength}`,
    );

    await arenaService.broadcastQueueUpdate(arenaId);

    const newGame = await arenaService.matchArena(arenaId);
    if (newGame) {
      startMatch(io, newGame);
    }
  });

  socket.on("leave_arena", async ({ arenaId }) => {
    await arenaService.removePlayerFromArena(arenaId, socket.id);
    socket.leave(`arena:${arenaId}`);
    await arenaService.broadcastQueueUpdate(arenaId);
  });

  socket.on("disconnect", async () => {
    const affected = await arenaService.removeSocketFromAllArenas(socket.id);
    for (const arenaId of affected) {
      await arenaService.broadcastQueueUpdate(arenaId);
    }
  });
};
