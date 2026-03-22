export const startMatch = (newGame) => {
  if (!newGame) return;
  const { gameId, arenaId, instance, players, timeControl } = newGame;

  players.white.socket.join(gameId);
  players.black.socket.join(gameId);

  const tcLabel = timeControl ? timeControl.label : "unlimited";

  players.white.socket.emit("match_started", {
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

  players.black.socket.emit("match_started", {
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
