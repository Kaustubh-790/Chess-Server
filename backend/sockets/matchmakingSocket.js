import { gameService } from "../services/gameService.js";
import { startMatch } from "../utils/socketStartMatch.js";

export const registerMatchMakingHandlers = (io, socket) => {
  socket.on("enter_arena", (payload) => {
    const timeControl = payload?.timeControl || null;
    const added = gameService.addToQueue(socket, socket.user, timeControl);
    if (!added) return;

    console.log(
      `[Global] ${socket.user.userName} joined global pool (${timeControl?.label || "unlimited"}). Total Queue: ${gameService.getQueueLength()}`,
    );
    startMatch(gameService.matchPlayers());
  });

  socket.on("disconnect", () => {
    gameService.removeFromQueue(socket.id);
  });
};
