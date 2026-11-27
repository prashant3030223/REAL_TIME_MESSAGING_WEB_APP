export interface TelemetrySample {
  timestampMs: number;
  roundTripTimeMs?: number | undefined;
  jitterMs?: number | undefined;
  packetLossPercent?: number | undefined;
  availableOutgoingBitrateBps?: number | undefined;
  sendingBitrateBps?: number | undefined;
}

export type RiskLevel = "UNKNOWN" | "NORMAL" | "ELEVATED" | "HIGH" | "CRITICAL";

export interface RiskEstimate {
  level: RiskLevel;
  score: number;
  adaptationAction?: string | undefined;
  timestampMs: number;
}

export interface EstimatorOptions {
  windowMs?: number | undefined;
  maxSamples?: number | undefined;
}

export declare class PredictiveCallRecoveryEstimator {
  constructor(options?: EstimatorOptions);
  addSample(sample: TelemetrySample): RiskEstimate;
  evaluate(sample: TelemetrySample): RiskEstimate;
  reset(): void;
}
