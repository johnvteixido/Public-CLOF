import crypto from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import pino from "pino";

const isDev = process.env.NODE_ENV !== "production";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? (isDev ? "debug" : "info"),
  ...(isDev
    ? {
        transport: {
          target: "pino-pretty",
          options: { colorize: true, translateTime: "HH:MM:ss.l" },
        },
      }
    : {}),
});

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      id?: string;
      log?: pino.Logger;
    }
  }
}

export function requestLog(req: Request, res: Response, next: NextFunction): void {
  if (req.path === "/api/health" || req.path === "/health") {
    next();
    return;
  }
  const id = (req.headers["x-request-id"] as string) ?? crypto.randomUUID();
  req.id = id;
  req.log = logger.child({ request_id: id });
  const start = Date.now();
  res.on("finish", () => {
    const duration_ms = Date.now() - start;
    req.log?.info(
      {
        method: req.method,
        path: req.path,
        status: res.statusCode,
        duration_ms,
        ip: req.headers["x-forwarded-for"] ?? req.socket.remoteAddress ?? "",
      },
      "request",
    );
  });
  next();
}
