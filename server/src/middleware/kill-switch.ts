import type { RequestHandler } from "express";
import { env } from "../env.ts";

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export const killSwitch: RequestHandler = (req, res, next) => {
  if (!env.MANTUA_KILL_SWITCH) {
    next();
    return;
  }
  if (!WRITE_METHODS.has(req.method)) {
    next();
    return;
  }
  res.status(503).json({
    error: "Mantua write operations are temporarily disabled.",
    code: "KILL_SWITCH_ACTIVE",
  });
};
