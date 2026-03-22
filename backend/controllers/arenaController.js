import { arenaService } from "../arena/arenaService.js";

export const createArena = (req, res) => {
  const { duration, timeControl } = req.body;

  if (!duration || duration <= 0)
    return res
      .status(400)
      .json({ error: "invalid time duration or no duration provided" });
  
  const { arenaId, endTime } = arenaService.createArena(duration, timeControl);

  res.status(201).json({ arenaId, endTime, message: "arena created " });
};
