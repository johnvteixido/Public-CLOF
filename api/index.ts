import { createRequire } from "node:module";
import type { Request, Response } from "express";

type ExpressApp = (req: Request, res: Response) => void;

const require = createRequire(import.meta.url);
let cachedApp: ExpressApp | undefined;

/**
 * Vercel's ESM function wrapper did not resolve the extensionless import of
 * ../server. The project already builds a bundled CommonJS server at
 * dist/server.cjs, so load that explicit artifact instead.
 */
export default function handler(req: Request, res: Response): void {
  try {
    if (!cachedApp) {
      const loaded = require("../dist/server.cjs") as { default?: unknown };
      if (typeof loaded.default !== "function") {
        throw new Error("Bundled Express app was not exported from dist/server.cjs");
      }
      cachedApp = loaded.default as ExpressApp;
    }

    cachedApp(req, res);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    console.error("[api-bootstrap] Failed to initialize Express app", stack ?? message);

    // Keep internal exception details out of production responses.
    if (process.env.VERCEL_ENV === "production") {
      res.status(500).json({ error: "API initialization failed" });
      return;
    }

    res.status(500).json({
      error: "API initialization failed",
      detail: message,
    });
  }
}
