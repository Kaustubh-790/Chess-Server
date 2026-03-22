import React, { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useSocket } from "../contexts/SocketContext";
import { useAuth } from "../contexts/AuthContext";
import api from "../services/axios";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const formatTimeLeft = (endTime) => {
  if (!endTime) return null;
  const diff = endTime - Date.now();
  if (diff <= 0) return { label: "Expired", expired: true };
  const mins = Math.floor(diff / 60000);
  const secs = Math.floor((diff % 60000) / 1000);
  return {
    label: `${mins}:${secs.toString().padStart(2, "0")}`,
    expired: false,
  };
};

// ─── Sub-components ───────────────────────────────────────────────────────────

const TimerDisplay = ({ endTime }) => {
  const [display, setDisplay] = useState(() => formatTimeLeft(endTime));

  useEffect(() => {
    if (!endTime) return;
    const tick = () => setDisplay(formatTimeLeft(endTime));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [endTime]);

  if (!display) return null;

  // Urgency colour: red under 60s, amber under 5 min
  const diff = endTime - Date.now();
  const colour = display.expired
    ? "text-red-500"
    : diff < 60_000
      ? "text-red-400"
      : diff < 5 * 60_000
        ? "text-amber-400"
        : "text-orange-400";

  return (
    <div className="text-center">
      <p className="text-xs uppercase tracking-widest text-slate-400 mb-1">
        Time Remaining
      </p>
      <p className={`text-4xl font-bold font-mono tabular-nums ${colour}`}>
        {display.label}
      </p>
    </div>
  );
};

const QueueList = ({ queue }) => (
  <div className="flex-1 overflow-y-auto">
    {queue.length === 0 ? (
      <p className="text-slate-500 text-sm text-center py-6">
        No players waiting yet
      </p>
    ) : (
      <ul className="space-y-2">
        {queue.map((p, i) => (
          <li
            key={p.userName}
            className="flex items-center gap-3 px-3 py-2 rounded-lg bg-slate-700/50 border border-slate-600/40"
          >
            <span className="w-5 h-5 rounded-full bg-orange-500/20 border border-orange-500/40 flex items-center justify-center text-[10px] font-bold text-orange-400">
              {i + 1}
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-slate-100 truncate">
                {p.userName}
              </p>
            </div>
            <span className="text-xs font-mono text-slate-400 shrink-0">
              {p.rating}
            </span>
          </li>
        ))}
      </ul>
    )}
  </div>
);

// ─── Main component ───────────────────────────────────────────────────────────

const Arena = () => {
  const { arenaId: paramArenaId } = useParams();
  const navigate = useNavigate();
  const socket = useSocket();
  const { currentUser } = useAuth();

  const [arenaId, setArenaId] = useState(paramArenaId || "");
  const [endTime, setEndTime] = useState(null);
  const [inLobby, setInLobby] = useState(false);
  const [duration, setDuration] = useState(10);
  const [timeControl, setTimeControl] = useState({ label: "3+2", initial: 3, increment: 2 });
  const [joinId, setJoinId] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [queue, setQueue] = useState([]);
  const [expired, setExpired] = useState(false);

  // ─── Auto-join from URL ───────────────────────────────────────────────────
  useEffect(() => {
    if (paramArenaId && socket) {
      setArenaId(paramArenaId);
      socket.emit("join_arena", { arenaId: paramArenaId });
      setInLobby(true);
    }
  }, [paramArenaId, socket]);

  // ─── Socket listeners ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!socket) return;

    const onMatchStarted = (gameData) => {
      sessionStorage.setItem(
        `game-${gameData.gameId}`,
        JSON.stringify(gameData),
      );
      navigate(`/game/${gameData.gameId}`, { state: gameData });
    };

    const onArenaError = ({ message }) => {
      setError(message);
      setTimeout(() => setError(""), 4000);
    };

    const onQueueUpdate = ({ queue: newQueue, endTime: newEndTime }) => {
      setQueue(newQueue);
      if (newEndTime && !endTime) setEndTime(newEndTime);
    };

    const onArenaExpired = () => {
      setExpired(true);
      setQueue([]);
    };

    socket.on("match_started", onMatchStarted);
    socket.on("arena_error", onArenaError);
    socket.on("arena_queue_update", onQueueUpdate);
    socket.on("arena_expired", onArenaExpired);

    return () => {
      socket.off("match_started", onMatchStarted);
      socket.off("arena_error", onArenaError);
      socket.off("arena_queue_update", onQueueUpdate);
      socket.off("arena_expired", onArenaExpired);
    };
  }, [socket, navigate, endTime]);

  // ─── Create ───────────────────────────────────────────────────────────────
  const handleCreate = async () => {
    setError("");
    try {
      const res = await api.post("/arena/create", { duration, timeControl });
      const { arenaId: newId, endTime: newEnd } = res.data;
      setArenaId(newId);
      setEndTime(newEnd);
      socket.emit("join_arena", { arenaId: newId });
      setInLobby(true);
    } catch (err) {
      setError(err.response?.data?.error || "Failed to create arena");
    }
  };

  // ─── Join ─────────────────────────────────────────────────────────────────
  const handleJoin = () => {
    const id = joinId.trim();
    if (!id) {
      setError("Please enter an arena ID");
      return;
    }
    setError("");
    setArenaId(id);
    socket.emit("join_arena", { arenaId: id });
    setInLobby(true);
  };

  // ─── Leave ────────────────────────────────────────────────────────────────
  const handleLeave = useCallback(() => {
    if (arenaId) socket.emit("leave_arena", { arenaId });
    setInLobby(false);
    setArenaId("");
    setEndTime(null);
    setQueue([]);
    setExpired(false);
    navigate("/");
  }, [arenaId, socket, navigate]);

  // ─── Copy ─────────────────────────────────────────────────────────────────
  const handleCopy = () => {
    navigator.clipboard.writeText(arenaId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // ─────────────────────────────────────────────────────────────────────────
  // LOBBY VIEW — two-column layout
  // ─────────────────────────────────────────────────────────────────────────
  if (inLobby) {
    return (
      <div className="min-h-screen bg-slate-900 text-white flex flex-col">
        {/* Top bar */}
        <div className="border-b border-slate-700/60 px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-orange-500 font-bold text-lg">
              Timed Arena
            </span>
            {!expired && (
              <span className="flex items-center gap-1.5 text-xs text-slate-400">
                <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                Live
              </span>
            )}
            {expired && (
              <span className="text-xs text-red-400 font-medium">Expired</span>
            )}
          </div>
          <button
            onClick={handleLeave}
            className="px-3 py-1.5 text-sm font-semibold text-white bg-red-600/80 hover:bg-red-600 rounded-lg transition-colors"
          >
            Leave Arena
          </button>
        </div>

        {/* Body */}
        <div className="flex flex-1 overflow-hidden">
          {/* ── Main area ── */}
          <main className="flex-1 flex items-center justify-center p-8">
            {expired ? (
              <div className="text-center space-y-4">
                <div className="text-6xl">⏰</div>
                <h2 className="text-2xl font-bold text-red-400">
                  Arena Expired
                </h2>
                <p className="text-slate-400">This arena has ended.</p>
                <button
                  onClick={() => navigate("/arena")}
                  className="mt-2 px-5 py-2 font-bold text-white bg-orange-600 hover:bg-orange-700 rounded-lg transition-colors"
                >
                  Create New Arena
                </button>
              </div>
            ) : (
              <div className="text-center space-y-6 max-w-sm w-full">
                {/* Arena ID card */}
                <div className="bg-slate-800 border border-slate-700 rounded-xl p-5">
                  <p className="text-xs uppercase tracking-widest text-slate-400 mb-2">
                    Arena ID — Share with friends
                  </p>
                  <div className="flex items-center justify-center gap-2 flex-wrap">
                    <code className="text-sm text-green-400 font-mono break-all">
                      {arenaId}
                    </code>
                    <button
                      onClick={handleCopy}
                      className="px-2.5 py-1 text-xs bg-slate-600 hover:bg-slate-500 rounded-md transition-colors shrink-0"
                    >
                      {copied ? "Copied ✓" : "Copy"}
                    </button>
                  </div>
                </div>

                {/* Waiting pulse */}
                <div className="flex flex-col items-center gap-3">
                  <div className="relative w-16 h-16">
                    <span className="absolute inset-0 rounded-full bg-orange-500/20 animate-ping" />
                    <span className="relative flex items-center justify-center w-16 h-16 rounded-full bg-orange-500/30 border border-orange-500/50">
                      <svg
                        className="w-7 h-7 text-orange-400"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                        />
                      </svg>
                    </span>
                  </div>
                  <p className="text-slate-300 font-medium">
                    Waiting for opponent…
                  </p>
                  <p className="text-slate-500 text-sm">
                    {queue.length} player{queue.length !== 1 ? "s" : ""} in
                    queue
                  </p>
                </div>

                {error && (
                  <div className="p-3 bg-red-900/40 border border-red-700/60 rounded-lg text-red-400 text-sm">
                    {error}
                  </div>
                )}
              </div>
            )}
          </main>

          {/* ── Sidebar ── */}
          <aside className="w-72 border-l border-slate-700/60 flex flex-col bg-slate-800/40">
            {/* Timer */}
            <div className="p-5 border-b border-slate-700/60">
              <TimerDisplay endTime={endTime} />
            </div>

            {/* Queue header */}
            <div className="px-4 py-3 border-b border-slate-700/60 flex items-center justify-between">
              <span className="text-sm font-semibold text-slate-200">
                Queue
              </span>
              <span className="text-xs font-mono text-slate-400 bg-slate-700 px-2 py-0.5 rounded-full">
                {queue.length}
              </span>
            </div>

            {/* Queue list */}
            <div className="flex-1 p-3 overflow-y-auto">
              <QueueList queue={queue} />
            </div>

            {/* Footer hint */}
            <div className="p-4 border-t border-slate-700/60">
              <p className="text-xs text-slate-500 text-center">
                Matched games start automatically when 2+ players are waiting.
              </p>
            </div>
          </aside>
        </div>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // CREATE / JOIN VIEW
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-slate-900 text-white p-4">
      <div className="max-w-md w-full bg-slate-800 p-8 rounded-xl shadow-lg border border-slate-700">
        <h1 className="text-3xl font-bold text-orange-500 mb-1 text-center">
          Timed Arena
        </h1>
        <p className="text-slate-400 text-center mb-8 text-sm">
          Create a timed arena and compete as many games as you can before the
          clock runs out!
        </p>

        {/* Create */}
        <div className="mb-5 p-4 bg-slate-700/60 rounded-xl border border-slate-600/40">
          <h2 className="text-base font-semibold mb-3 text-white">
            Create Arena
          </h2>
          
          <label className="block text-xs text-slate-400 mb-1">
            Time Control
          </label>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 mb-3">
            {[
              { label: "1 min", initial: 1, increment: 0 },
              { label: "3 min", initial: 3, increment: 0 },
              { label: "3+2", initial: 3, increment: 2 },
              { label: "10 min", initial: 10, increment: 0 }
            ].map((tc) => (
              <button
                key={tc.label}
                onClick={() => setTimeControl(tc)}
                className={`py-1.5 px-1 rounded-md text-xs font-semibold transition-colors ${
                  timeControl.label === tc.label
                    ? "bg-orange-600 text-white"
                    : "bg-slate-600 text-slate-300 hover:bg-slate-500"
                }`}
              >
                {tc.label}
              </button>
            ))}
          </div>

          <label className="block text-xs text-slate-400 mb-1">
            Arena Duration (minutes)
          </label>
          <input
            type="number"
            min="1"
            max="120"
            value={duration}
            onChange={(e) => setDuration(Number(e.target.value))}
            className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white mb-3 focus:outline-none focus:border-orange-500 text-sm"
          />
          <button
            onClick={handleCreate}
            className="w-full px-4 py-2 font-bold text-white bg-orange-600 rounded-lg hover:bg-orange-700 transition-colors text-sm"
          >
            Create &amp; Join
          </button>
        </div>

        {/* Join */}
        <div className="mb-5 p-4 bg-slate-700/60 rounded-xl border border-slate-600/40">
          <h2 className="text-base font-semibold mb-3 text-white">
            Join Arena
          </h2>
          <input
            type="text"
            placeholder="Paste Arena ID…"
            value={joinId}
            onChange={(e) => setJoinId(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleJoin()}
            className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white mb-3 focus:outline-none focus:border-orange-500 font-mono text-xs"
          />
          <button
            onClick={handleJoin}
            className="w-full px-4 py-2 font-bold text-white bg-green-600 rounded-lg hover:bg-green-700 transition-colors text-sm"
          >
            Join Arena
          </button>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-900/40 border border-red-700/60 rounded-lg text-red-400 text-sm text-center">
            {error}
          </div>
        )}

        <button
          onClick={() => navigate("/")}
          className="w-full px-4 py-2 font-bold text-slate-300 bg-slate-700 rounded-lg hover:bg-slate-600 transition-colors text-sm"
        >
          ← Back to Home
        </button>
      </div>
    </div>
  );
};

export default Arena;
