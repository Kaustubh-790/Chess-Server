export const startMatch = (io, newGame) => {
  if (!newGame) return;
  const { gameId, arenaId, instance, players, timeControl } = newGame;

  io.in(players.white.socketId).socketsJoin(gameId);
  io.in(players.black.socketId).socketsJoin(gameId);

  const tcLabel = timeControl ? timeControl.label : "unlimited";

  io.to(players.white.socketId).emit("match_started", {
    gameId,
    arenaId: arenaId ?? null,
    color: "white",
    opponent: players.black.user.userName,
    opponentRating: players.black.user.rating,
    fen: instance.fen(),
    timeControl: tcLabel,
    whiteTime: players.white.time,
    blackTime: players.black.time,
  });

  io.to(players.black.socketId).emit("match_started", {
    gameId,
    arenaId: arenaId ?? null,
    color: "black",
    opponent: players.white.user.userName,
    opponentRating: players.white.user.rating,
    fen: instance.fen(),
    timeControl: tcLabel,
    whiteTime: players.white.time,
    blackTime: players.black.time,
  });
};
