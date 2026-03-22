import React from "react";
import { useAuth } from "../contexts/AuthContext";

const Home = () => {
  const { currentUser, logout } = useAuth();

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-900 text-white p-4">
      <div className="max-w-md w-full bg-gray-800 p-8 rounded-xl shadow-lg border border-gray-700 text-center">
        <h1 className="text-4xl font-bold text-orange-500 mb-2">
          Chess Server
        </h1>
        <p className="text-xl text-gray-300 mb-6">
          Welcome, {currentUser?.userName}!
        </p>

        <div className="bg-gray-700 p-4 rounded-lg mb-6 text-left space-y-2">
          <p>
            <span className="text-gray-400">Email:</span> {currentUser?.email}
          </p>
          <p>
            <span className="text-gray-400">Rating:</span> {currentUser?.rating}
          </p>
          <p>
            <span className="text-gray-400">Games Played:</span>{" "}
            {currentUser?.gamesPlayed}
          </p>
        </div>

        <button
          onClick={logout}
          className="w-full px-4 py-2 font-bold text-white bg-red-600 rounded-lg hover:bg-red-700 transition-colors"
        >
          Log Out
        </button>
      </div>
    </div>
  );
};

export default Home;
