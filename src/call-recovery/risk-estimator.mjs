export class PredictiveCallRecoveryEstimator {
  constructor(options = {}) {
    this.windowMs = options.windowMs || 12000;
    this.maxSamples = options.maxSamples || 20;
    this.samples = [];
  }

  addSample(sample) {
    const now = sample.timestampMs || Date.now();
    this.samples.push({ ...sample, timestampMs: now });
    const cutoff = now - this.windowMs;
    this.samples = this.samples.filter((s) => s.timestampMs >= cutoff);
    if (this.samples.length > this.maxSamples) {
      this.samples = this.samples.slice(-this.maxSamples);
    }
    return this.evaluate(sample);
  }

  evaluate(sample) {
    let score = 0;
    const rtt = sample.roundTripTimeMs || 0;
    const jitter = sample.jitterMs || 0;
    const loss = sample.packetLossPercent || 0;

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

    score = Math.min(Math.round(score), 100);

    let level = "NORMAL";
    if (this.samples.length < 1) level = "UNKNOWN";
    else if (score >= 75) level = "CRITICAL";
    else if (score >= 50) level = "HIGH";
    else if (score >= 25) level = "ELEVATED";

    return {
      score,
      level,
      timestampMs: sample.timestampMs || Date.now(),
      adaptationAction: level === "CRITICAL" ? "Emergency audio-only fallback" : undefined,
    };
  }

  reset() {
    this.samples = [];
  }
}
