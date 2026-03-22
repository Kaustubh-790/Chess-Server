import React, { useState, useEffect, useRef, useCallback } from "react";
import { useLocation, useParams, useNavigate } from "react-router-dom";
import { Chessboard } from "react-chessboard";
import { Chess } from "chess.js";
import { useSocket } from "../contexts/SocketContext";
import "./Game.css";

const Game = () => {
  const { gameId: routeGameId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const socket = useSocket();

  // ─── gameData as STATE (not memo) so it re-renders on new match ──────────
  const [gameData, setGameData] = useState(() => {
    if (location.state) return location.state;
    const stored = sessionStorage.getItem(`game-${routeGameId}`);
    return stored ? JSON.parse(stored) : null;
  });

  // Derive current gameId from live state, not just the route param
  const gameId = gameData?.gameId || routeGameId;

  const playerColor = gameData?.color || "white";
  const opponentName = gameData?.opponent || "Opponent";
  const opponentRating = gameData?.opponentRating ?? "?";

  const chessRef = useRef(new Chess());
  const serverFenRef = useRef(chessRef.current.fen());

  const [fen, setFen] = useState(chessRef.current.fen());
  const [turn, setTurn] = useState("w");
  const [whiteTime, setWhiteTime] = useState(gameData?.whiteTime || 0);
  const [blackTime, setBlackTime] = useState(gameData?.blackTime || 0);
  const [gameOver, setGameOver] = useState(null);

  const formatClock = (ms) => {
    if (ms === undefined || ms === null) return "0:00";
    const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    
    // If less than 20s, show tenths for more urgency
    if (ms < 20000 && ms > 0) {
      const tenths = Math.floor((ms % 1000) / 100);
      return `${m}:${s.toString().padStart(2, "0")}.${tenths}`;
    }
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  const [requeue, setRequeue] = useState(null);
  const [statusText, setStatusText] = useState("");
  const [isLookingForMatch, setIsLookingForMatch] = useState(false);
  const [arenaExpired, setArenaExpired] = useState(false);

  useEffect(() => {
    if (gameOver || isLookingForMatch || !gameData?.timeControl || gameData.timeControl === "unlimited") return;

    const interval = setInterval(() => {
      if (turn === "w") {
        setWhiteTime((prev) => Math.max(0, prev - 100));
      } else {
        setBlackTime((prev) => Math.max(0, prev - 100));
      }
    }, 100);

    return () => clearInterval(interval);
  }, [turn, gameOver, isLookingForMatch, gameData?.timeControl]);

  // Arena countdown
  const [arenaEndTime, setArenaEndTime] = useState(null);
  const [arenaTimeLeft, setArenaTimeLeft] = useState("");

  // ─── Arena countdown tick ─────────────────────────────────────────────────
  useEffect(() => {
    if (!arenaEndTime) return;
    const tick = () => {
      const diff = arenaEndTime - Date.now();
      if (diff <= 0) {
        setArenaTimeLeft("Expired");
        return;
      }
      const m = Math.floor(diff / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setArenaTimeLeft(`${m}:${s.toString().padStart(2, "0")}`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [arenaEndTime]);

  // ─── Socket listeners ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!socket) return;

    const onBoardSync = ({ fen: newFen, turn: newTurn, whiteTime: newWt, blackTime: newBt }) => {
      chessRef.current.load(newFen);
      serverFenRef.current = newFen;
      setFen(newFen);
      setTurn(newTurn);
      setStatusText("");
      if (newWt !== undefined) setWhiteTime(newWt);
      if (newBt !== undefined) setBlackTime(newBt);
    };

    const onMoveRejected = ({ reason }) => {
      chessRef.current.load(serverFenRef.current);
      setFen(serverFenRef.current);
      setStatusText(`Move rejected: ${reason.replace(/_/g, " ")}`);
      setTimeout(() => setStatusText(""), 3000);
    };

    const onGameOver = (data) => setGameOver(data);

    const onMatchStarted = (newGameData) => {
      // ── Reset ALL game state for the new match ──────────────────────────
      const freshChess = new Chess();
      chessRef.current = freshChess;
      serverFenRef.current = freshChess.fen();

      setFen(freshChess.fen());
      setTurn("w");
      setGameOver(null);
      setRequeue(null);
      setIsLookingForMatch(false);
      setArenaExpired(false);
      setStatusText("");
      if (newGameData.whiteTime !== undefined) setWhiteTime(newGameData.whiteTime);
      if (newGameData.blackTime !== undefined) setBlackTime(newGameData.blackTime);

      // ── Update gameData STATE so playerColor / opponentName re-render ──
      setGameData(newGameData);

      // Keep session storage fresh for page-refresh recovery
      sessionStorage.setItem(
        `game-${newGameData.gameId}`,
        JSON.stringify(newGameData),
      );

      // Update URL to new gameId without a full navigation
      window.history.replaceState(
        newGameData,
        "",
        `/game/${newGameData.gameId}`,
      );
    };

    const onRequeueCountdown = ({ secondsLeft, arenaId }) => {
      setRequeue({ secondsLeft, arenaId });
      const interval = setInterval(() => {
        setRequeue((prev) => {
          if (!prev || prev.secondsLeft <= 1) {
            clearInterval(interval);
            return null;
          }
          return { ...prev, secondsLeft: prev.secondsLeft - 1 };
        });
      }, 1000);
    };

    const onArenaExpired = () => {
      setArenaExpired(true);
      setRequeue(null);
      setIsLookingForMatch(false);
      setGameOver(
        (prev) =>
          prev ?? {
            winner: null,
            reason: "arena_expired",
            ratingChanges: null,
          },
      );
    };

    const onQueueUpdate = ({ endTime }) => {
      if (endTime) setArenaEndTime(endTime);
    };

    socket.on("board_sync", onBoardSync);
    socket.on("move_rejected", onMoveRejected);
    socket.on("game_over", onGameOver);
    socket.on("match_started", onMatchStarted);
    socket.on("requeue_countdown", onRequeueCountdown);
    socket.on("arena_expired", onArenaExpired);
    socket.on("arena_queue_update", onQueueUpdate);

    return () => {
      socket.off("board_sync", onBoardSync);
      socket.off("move_rejected", onMoveRejected);
      socket.off("game_over", onGameOver);
      socket.off("match_started", onMatchStarted);
      socket.off("requeue_countdown", onRequeueCountdown);
      socket.off("arena_expired", onArenaExpired);
      socket.off("arena_queue_update", onQueueUpdate);
    };
  }, [socket]);

  // ─── Requeue countdown → emit join_arena ─────────────────────────────────
  useEffect(() => {
    if (!requeue || requeue.secondsLeft <= 0) return;
    const timer = setInterval(() => {
      setRequeue((prev) => {
        if (!prev) return null;
        if (prev.secondsLeft <= 1) {
          socket.emit("join_arena", { arenaId: prev.arenaId });
          setIsLookingForMatch(true);
          setGameOver(null);
          return null;
        }
        return { ...prev, secondsLeft: prev.secondsLeft - 1 };
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [requeue, socket]);

  // ─── Move handler ─────────────────────────────────────────────────────────
  const onPieceDrop = useCallback(
    ({ piece, sourceSquare, targetSquare }) => {
      if (!targetSquare) return false;
      const myColorChar = playerColor === "white" ? "w" : "b";
      if (turn !== myColorChar) {
        setStatusText("Not your turn!");
        setTimeout(() => setStatusText(""), 2000);
        return false;
      }
      const pieceType = piece.pieceType.toLowerCase();
      const isPromotion =
        pieceType === "p" &&
        ((myColorChar === "w" && targetSquare[1] === "8") ||
          (myColorChar === "b" && targetSquare[1] === "1"));
      try {
        const moveData = { from: sourceSquare, to: targetSquare };
        if (isPromotion) moveData.promotion = "q";
        const result = chessRef.current.move(moveData);
        if (!result) return false;
        setFen(chessRef.current.fen());
        socket.emit("move_attempt", {
          gameId,
          from: sourceSquare,
          to: targetSquare,
          promotion: isPromotion ? "q" : undefined,
        });
        return true;
      } catch {
        return false;
      }
    },
    [turn, playerColor, socket, gameId],
  );

  const canDragPiece = useCallback(
    ({ piece }) => {
      if (gameOver) return false;
      const myColorChar = playerColor === "white" ? "w" : "b";
      return turn === myColorChar;
    },
    [playerColor, turn, gameOver],
  );

  const handleResign = () => {
    if (gameOver) return;
    if (window.confirm("Are you sure you want to resign?")) {
      socket.emit("resign", { gameId });
    }
  };

  // ─── Move history ─────────────────────────────────────────────────────────
  const moveHistory = chessRef.current.history();
  const movePairs = [];
  for (let i = 0; i < moveHistory.length; i += 2) {
    movePairs.push({
      num: Math.floor(i / 2) + 1,
      white: moveHistory[i],
      black: moveHistory[i + 1] || "",
    });
  }

  const isMyTurn = turn === (playerColor === "white" ? "w" : "b");
  const topColor = playerColor === "white" ? "black" : "white";
  const bottomColor = playerColor;

  const getResultText = () => {
    if (!gameOver) return "";
    if (gameOver.reason === "arena_expired") return "Arena Ended";
    if (gameOver.winner === "draw") return "Draw!";
    if (gameOver.winner === playerColor) return "You Won!";
    return "You Lost!";
  };

  const getReasonText = (reason) =>
    ({
      checkmate: "by Checkmate",
      stalemate: "Stalemate",
      resignation: "by Resignation",
      repetition: "Threefold Repetition",
      insufficient_material: "Insufficient Material",
      agreement: "by Agreement",
      arena_expired: "The arena time limit was reached",
    })[reason] || reason;

  const boardWidth = Math.min(
    560,
    typeof window !== "undefined" ? window.innerWidth - 48 : 560,
  );

  if (!gameData) {
    return (
      <div
        className="game-container"
        style={{ justifyContent: "center", alignItems: "center" }}
      >
        <div style={{ textAlign: "center", color: "#94a3b8" }}>
          <h2 style={{ color: "#f97316", marginBottom: "0.5rem" }}>
            Game not found
          </h2>
          <p>This game session may have expired.</p>
          <button
            className="btn-lobby"
            style={{ marginTop: "1rem", maxWidth: 200 }}
            onClick={() => navigate("/")}
          >
            Back to Lobby
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="game-container">
      {/* ─── Board Column ─── */}
      <div className="board-column">
        <div
          className={`player-panel ${turn === (topColor === "white" ? "w" : "b") ? "active-turn" : ""}`}
        >
          <div className="player-info">
            <div className={`player-avatar ${topColor}-avatar`}>
              {opponentName.charAt(0)}
            </div>
            <div>
              <div className="player-name">{opponentName}</div>
              <div className="player-rating">{opponentRating}</div>
            </div>
          </div>
          {gameData?.timeControl !== "unlimited" && (
            <div className={`player-clock ${turn === (topColor === "white" ? "w" : "b") ? "bg-orange-600 outline outline-2 outline-white text-white" : "bg-slate-700 text-slate-300"} font-mono text-xl font-bold px-3 py-1.5 rounded-md min-w-[5rem] text-center`}>
              {formatClock(topColor === "white" ? whiteTime : blackTime)}
            </div>
          )}
          <div
            className={`turn-indicator ${turn === (topColor === "white" ? "w" : "b") ? "active" : ""}`}
          />
        </div>

        <div
          className="board-wrapper"
          style={{ width: boardWidth, height: boardWidth }}
        >
          <Chessboard
            options={{
              id: "game-board",
              position: fen,
              onPieceDrop,
              boardOrientation: playerColor,
              canDragPiece,
              animationDurationInMs: 200,
              darkSquareStyle: { backgroundColor: "#779952" },
              lightSquareStyle: { backgroundColor: "#edeed1" },
            }}
          />
        </div>

        <div className="game-status-bar">
          {statusText ||
            (gameOver ? "" : isMyTurn ? "Your turn" : "Opponent's turn")}
        </div>

        <div
          className={`player-panel ${isMyTurn && !gameOver ? "active-turn" : ""}`}
        >
          <div className="player-info">
            <div className={`player-avatar ${bottomColor}-avatar`}>
              {bottomColor === "white" ? "W" : "B"}
            </div>
            <div>
              <div className="player-name">You ({playerColor})</div>
              <div className="player-rating">{gameData?.yourRating ?? ""}</div>
            </div>
          </div>
          {gameData?.timeControl !== "unlimited" && (
            <div className={`player-clock ${isMyTurn && !gameOver ? "bg-orange-600 outline outline-2 outline-white text-white" : "bg-slate-700 text-slate-300"} font-mono text-xl font-bold px-3 py-1.5 rounded-md min-w-[5rem] text-center`}>
              {formatClock(bottomColor === "white" ? whiteTime : blackTime)}
            </div>
          )}
          <div
            className={`turn-indicator ${isMyTurn && !gameOver ? "active" : ""}`}
          />
        </div>
      </div>

      {/* ─── Sidebar ─── */}
      <div className="game-sidebar">
        {gameData?.arenaId && (
          <div className="move-history-card">
            <div
              className="move-history-header"
              style={{ justifyContent: "space-between" }}
            >
              <span style={{ color: "#f97316" }}>Timed Arena</span>
              {arenaExpired && (
                <span
                  style={{
                    fontSize: "0.7rem",
                    color: "#ef4444",
                    fontWeight: 600,
                  }}
                >
                  EXPIRED
                </span>
              )}
            </div>
            <div style={{ padding: "0.75rem 1rem", textAlign: "center" }}>
              {arenaEndTime && !arenaExpired && (
                <>
                  <div
                    style={{
                      fontSize: "0.7rem",
                      color: "#94a3b8",
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                    }}
                  >
                    Arena ends in
                  </div>
                  <div
                    style={{
                      fontSize: "1.5rem",
                      fontWeight: "bold",
                      fontFamily: "monospace",
                      color:
                        arenaTimeLeft === "Expired"
                          ? "#ef4444"
                          : arenaEndTime - Date.now() < 60_000
                            ? "#f87171"
                            : arenaEndTime - Date.now() < 5 * 60_000
                              ? "#fbbf24"
                              : "#f97316",
                    }}
                  >
                    {arenaTimeLeft || "…"}
                  </div>
                </>
              )}
              {arenaExpired && (
                <div style={{ color: "#ef4444", fontSize: "0.85rem" }}>
                  The arena has ended
                </div>
              )}
            </div>
          </div>
        )}

        <div className="move-history-card">
          <div className="move-history-header">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="currentColor"
            >
              <path d="M13 3a9 9 0 1 0 9 9h-2a7 7 0 1 1-7-7V3zm0 4v5l4.28 2.54-.72 1.21L12 13V7h1z" />
            </svg>
            Moves
          </div>
          <div className="move-list">
            {movePairs.length === 0 && (
              <div
                style={{
                  padding: "1rem",
                  color: "#64748b",
                  textAlign: "center",
                  fontSize: "0.85rem",
                }}
              >
                No moves yet
              </div>
            )}
            {movePairs.map((pair) => (
              <div className="move-row" key={pair.num}>
                <span className="move-number">{pair.num}.</span>
                <span className="move-white">{pair.white}</span>
                <span className="move-black">{pair.black}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="game-actions">
          {!gameOver && !isLookingForMatch && (
            <button className="btn-resign" onClick={handleResign}>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
                <line x1="4" y1="22" x2="4" y2="15" />
              </svg>
              Resign
            </button>
          )}
          <button
            className="btn-lobby"
            onClick={() => {
              if (isLookingForMatch && gameData?.arenaId) {
                socket.emit("leave_arena", { arenaId: gameData.arenaId });
              }
              navigate(gameData?.arenaId ? `/arena/${gameData.arenaId}` : "/");
            }}
          >
            ← {isLookingForMatch ? "Leave Queue" : "Back to Lobby"}
          </button>
        </div>
      </div>

      {/* ─── Game Over Modal ─── */}
      {gameOver && (
        <div className="game-over-overlay">
          <div className="game-over-modal">
            <h2>{getResultText()}</h2>
            <div className="game-over-reason">
              {getReasonText(gameOver.reason)}
            </div>

            {gameOver.ratingChanges && (
              <div className="rating-changes">
                <div className="rating-change-item">
                  <span className="rating-label">White</span>
                  <span
                    className={`rating-delta ${gameOver.ratingChanges.white.delta > 0 ? "positive" : gameOver.ratingChanges.white.delta < 0 ? "negative" : "neutral"}`}
                  >
                    {gameOver.ratingChanges.white.delta > 0 ? "+" : ""}
                    {gameOver.ratingChanges.white.delta}
                  </span>
                </div>
                <div className="rating-change-item">
                  <span className="rating-label">Black</span>
                  <span
                    className={`rating-delta ${gameOver.ratingChanges.black.delta > 0 ? "positive" : gameOver.ratingChanges.black.delta < 0 ? "negative" : "neutral"}`}
                  >
                    {gameOver.ratingChanges.black.delta > 0 ? "+" : ""}
                    {gameOver.ratingChanges.black.delta}
                  </span>
                </div>
              </div>
            )}

            <div className="game-over-actions">
              {arenaExpired ? (
                <button
                  className="btn-lobby"
                  onClick={() => navigate("/arena")}
                >
                  ← Back to Arenas
                </button>
              ) : (
                <button
                  className="btn-lobby"
                  onClick={() =>
                    navigate(
                      gameData?.arenaId ? `/arena/${gameData.arenaId}` : "/",
                    )
                  }
                >
                  ← Back to Lobby
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ─── Looking for Match Overlay ─── */}
      {isLookingForMatch && !arenaExpired && (
        <div
          className="game-over-overlay"
          style={{
            backdropFilter: "blur(6px)",
            backgroundColor: "rgba(15, 23, 42, 0.85)",
          }}
        >
          <div
            className="game-over-modal"
            style={{
              border: "2px solid #f97316",
              boxShadow: "0 0 40px rgba(249, 115, 22, 0.2)",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "12px",
                marginBottom: "1rem",
              }}
            >
              <div
                style={{
                  width: "16px",
                  height: "16px",
                  backgroundColor: "#f97316",
                  borderRadius: "50%",
                  animation: "pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite",
                }}
              />
              <h2 style={{ color: "#f97316", margin: 0 }}>
                Looking for match…
              </h2>
            </div>
            <p
              style={{
                color: "#94a3b8",
                fontSize: "0.95rem",
                marginBottom: "1.5rem",
              }}
            >
              Waiting for an opponent in the arena queue.
            </p>
            {arenaEndTime && (
              <p
                style={{
                  color: "#f97316",
                  fontFamily: "monospace",
                  fontSize: "1.1rem",
                  marginBottom: "1.5rem",
                }}
              >
                {arenaTimeLeft}
              </p>
            )}
            <button
              className="btn-lobby"
              style={{ backgroundColor: "#ef4444", borderColor: "#dc2626" }}
              onClick={() => {
                socket.emit("leave_arena", { arenaId: gameData.arenaId });
                navigate(`/arena/${gameData.arenaId}`);
              }}
            >
              Cancel Search
            </button>
          </div>
        </div>
      )}

      {/* ─── Requeue Banner ─── */}
      {requeue && (
        <div className="requeue-banner" style={{ zIndex: 9999 }}>
          Queuing for next match in {requeue.secondsLeft}s…
        </div>
      )}
    </div>
  );
};

export default Game;
