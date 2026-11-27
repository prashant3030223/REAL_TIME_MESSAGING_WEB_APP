import type {
  WebRtcTelemetrySample,
  RecoveryRiskEstimate,
  RecoveryRiskLevel,
} from "./types.js";

const METRICS: (keyof WebRtcTelemetrySample)[] = [
  "roundTripTimeMs",
  "jitterMs",
  "packetLossPercent",
  "availableOutgoingBitrateBps",
  "sendingBitrateBps",
];

function trendDelta(samples: WebRtcTelemetrySample[], metric: keyof WebRtcTelemetrySample): number {
  const first = samples.find((s) => Number.isFinite(s[metric]));
  const last = [...samples].reverse().find((s) => Number.isFinite(s[metric]));
  if (first && last && first !== last) {
    const valFirst = first[metric];
    const valLast = last[metric];
    if (typeof valFirst === "number" && typeof valLast === "number") {
      return valLast - valFirst;
    }
  }
  return 0;
}

function scoreLatest(sample: WebRtcTelemetrySample, history: WebRtcTelemetrySample[]): number {
  let score = 0;
  const rtt = sample.roundTripTimeMs;
  const jitter = sample.jitterMs;
  const loss = sample.packetLossPercent;

  if (rtt >= 500) score += 40;
  else if (rtt >= 250) score += 22;
  else if (rtt >= 150) score += 10;

  if (jitter >= 100) score += 30;
  else if (jitter >= 50) score += 20;
  else if (jitter >= 30) score += 10;

  if (loss >= 15) score += 40;
  else if (loss >= 5) score += 25;
  else if (loss >= 2) score += 12;

  if (sample.availableOutgoingBitrateBps > 0 && sample.sendingBitrateBps > 0) {
    const headroom = sample.availableOutgoingBitrateBps / sample.sendingBitrateBps;
    if (headroom <= 1) score += 25;
    else if (headroom <= 1.3) score += 15;
  }

  if (history.length >= 2) {
    const rttIncrease = trendDelta(history, "roundTripTimeMs");
    const jitterIncrease = trendDelta(history, "jitterMs");
    const lossIncrease = trendDelta(history, "packetLossPercent");
    if (rttIncrease >= 100) score += 20;
    else if (rttIncrease >= 50) score += 12;
    if (jitterIncrease >= 30) score += 15;
    else if (jitterIncrease >= 15) score += 8;
    if (lossIncrease >= 5) score += 20;
    else if (lossIncrease >= 2) score += 12;
  }

  return Math.min(score, 100);
}

function determineAdaptationAction(level: RecoveryRiskLevel, sample: WebRtcTelemetrySample): string {
  switch (level) {
    case "CRITICAL":
      return "Immediate Emergency Fallback: Switched video to 240p @ 15fps, audio prioritized to prevent drop.";
    case "HIGH":
      return "Proactive Adaptation: Reduced sending bitrate and downscaled resolution to maintain audio continuity.";
    case "ELEVATED":
      return "Minor degradation detected: Monitoring latency jitter trend.";
    case "NORMAL":
    default:
      return "Network conditions optimal. Highest bitrate profile active.";
  }
}

export class PredictiveCallRecoveryEstimatorClient {
  private windowMs: number;
  private maxSamples: number;
  private samples: WebRtcTelemetrySample[] = [];

  constructor(options: { windowMs?: number; maxSamples?: number } = {}) {
    this.windowMs = options.windowMs || 10000;
    this.maxSamples = options.maxSamples || 16;
  }

  addSample(sample: WebRtcTelemetrySample): RecoveryRiskEstimate {
    const now = sample.timestampMs || Date.now();
    this.samples.push({ ...sample, timestampMs: now });
    const cutoff = now - this.windowMs;
    this.samples = this.samples.filter((s) => s.timestampMs >= cutoff);
    if (this.samples.length > this.maxSamples) {
      this.samples = this.samples.slice(-this.maxSamples);
    }

    const score = scoreLatest(sample, this.samples);
    let level: RecoveryRiskLevel = "NORMAL";
    if (this.samples.length === 0) level = "UNKNOWN";
    else if (score >= 75) level = "CRITICAL";
    else if (score >= 50) level = "HIGH";
    else if (score >= 25) level = "ELEVATED";

    return {
      score,
      level,
      adaptationAction: determineAdaptationAction(level, sample),
      timestampMs: now,
      confidence: this.samples.length >= 5 ? "MEDIUM" : "LOW",
      sampleCount: this.samples.length,
      observedWindowMs: this.windowMs,
    };
  }

  reset() {
    this.samples = [];
  }
}
