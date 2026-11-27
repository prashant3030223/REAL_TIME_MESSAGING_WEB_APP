import { Router } from "express";
import { z } from "zod";
import { PredictiveCallRecoveryEstimator } from "../../../src/call-recovery/risk-estimator.mjs";
import { ApiError } from "./errors.js";
import type { AppLogger } from "./logger.js";

const TelemetrySampleSchema = z.object({
  timestampMs: z.number().nonnegative(),
  roundTripTimeMs: z.number().nonnegative().optional(),
  jitterMs: z.number().nonnegative().optional(),
  packetLossPercent: z.number().nonnegative().optional(),
  availableOutgoingBitrateBps: z.number().nonnegative().optional(),
  sendingBitrateBps: z.number().nonnegative().optional(),
});

const EvaluateRequestSchema = z.object({
  samples: z.array(TelemetrySampleSchema).min(1).max(30),
});

export function createTelemetryRouter(logger: AppLogger) {
  const router = Router();

  // POST /api/telemetry/evaluate - evaluates rolling WebRTC telemetry samples
  router.post("/evaluate", (request, response, next) => {
    const parseResult = EvaluateRequestSchema.safeParse(request.body);
    if (!parseResult.success) {
      next(new ApiError(400, "INVALID_TELEMETRY_PAYLOAD", "Samples array with valid metrics is required."));
      return;
    }

    try {
      const estimator = new PredictiveCallRecoveryEstimator({ windowMs: 12_000, maxSamples: 20 });
      let latestEstimate = null;

      for (const sample of parseResult.data.samples) {
        latestEstimate = estimator.addSample(sample);
      }

      logger.info({
        riskLevel: latestEstimate?.level,
        riskScore: latestEstimate?.score,
      }, "WebRTC predictive call recovery evaluated");

      response.status(200).json({
        estimate: latestEstimate,
        evaluatedAt: new Date().toISOString(),
      });
    } catch (error) {
      next(new ApiError(400, "EVALUATION_ERROR", error instanceof Error ? error.message : "Estimation failed."));
    }
  });

  // GET /api/telemetry/health - reports predictive recovery engine baseline status
  router.get("/health", (_request, response) => {
    response.status(200).json({
      status: "operational",
      version: "2.4.0",
      algorithm: "rolling_trend_gradient_v2",
      supportedMetrics: [
        "roundTripTimeMs",
        "jitterMs",
        "packetLossPercent",
        "availableOutgoingBitrateBps",
        "sendingBitrateBps",
      ],
      leadTimeForecastSeconds: "5-10s",
    });
  });

  return router;
}
