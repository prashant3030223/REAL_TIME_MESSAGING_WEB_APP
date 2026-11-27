import type { Request, Response, NextFunction } from "express";
import type { AppLogger } from "./logger.js";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function createErrorHandler(logger: AppLogger) {
  return (err: any, req: Request, res: Response, _next: NextFunction) => {
    const requestId = (res.locals?.requestId as string) || (req.headers["x-request-id"] as string) || "";
    const isProduction = process.env.NODE_ENV === "production";

    if (err instanceof ApiError) {
      res.status(err.status).json({
        error: {
          code: err.code,
          message: err.message,
          ...(requestId ? { requestId } : {}),
        },
      });
      return;
    }

    if (err.type === "entity.too.large" || err.status === 413) {
      res.status(413).json({
        error: {
          code: "PAYLOAD_TOO_LARGE",
          message: "Request payload exceeds size limit.",
          ...(requestId ? { requestId } : {}),
        },
      });
      return;
    }

    if (err instanceof SyntaxError && "body" in err) {
      res.status(400).json({
        error: {
          code: "INVALID_JSON",
          message: "Malformed JSON payload.",
          ...(requestId ? { requestId } : {}),
        },
      });
      return;
    }

    logger.error({ err, requestId }, "Unhandled application error");
    res.status(err.status || 500).json({
      error: {
        code: err.code || "INTERNAL_SERVER_ERROR",
        message: isProduction
          ? "An unexpected error occurred."
          : (err.message || "An unexpected error occurred."),
        ...(requestId ? { requestId } : {}),
      },
    });
  };
}
