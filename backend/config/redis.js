import { Redis } from "ioredis";
import { createAdapter } from "@socket.io/redis-adapter";
import dotenv from "dotenv";

dotenv.config();

const REDIS_URL = process.env.REDIS_URL || "redis://127.0.0.1:6379";

export const redis = new Redis(REDIS_URL);
export const pubClient = new Redis(REDIS_URL);
export const subClient = pubClient.duplicate();

export const createRedisAdapter = () => {
  return createAdapter(pubClient, subClient);
};

redis.on("connect", () => console.log("Connected to Redis"));
redis.on("error", (err) => console.error("Redis Client Error:", err));
pubClient.on("error", (err) => console.error("Redis Pub Client Error:", err));
subClient.on("error", (err) => console.error("Redis Sub Client Error:", err));
