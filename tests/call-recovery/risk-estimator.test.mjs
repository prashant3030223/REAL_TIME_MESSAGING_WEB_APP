import test from "node:test";
import assert from "node:assert/strict";
import { PredictiveCallRecoveryEstimator } from "../../src/call-recovery/risk-estimator.mjs";

test("evaluates low latency sample as NORMAL", () => {
  const estimator = new PredictiveCallRecoveryEstimator();
  const estimate = estimator.addSample({
    timestampMs: Date.now(),
    roundTripTimeMs: 40,
    jitterMs: 5,
    packetLossPercent: 0,
    availableOutgoingBitrateBps: 2000000,
    sendingBitrateBps: 1000000,
  });
  assert.equal(estimate.level, "NORMAL");
  assert.ok(estimate.score < 25);
});

test("evaluates degraded metrics as CRITICAL", () => {
  const estimator = new PredictiveCallRecoveryEstimator();
  const estimate = estimator.addSample({
    timestampMs: Date.now(),
    roundTripTimeMs: 600,
    jitterMs: 120,
    packetLossPercent: 20,
    availableOutgoingBitrateBps: 500000,
    sendingBitrateBps: 1000000,
  });
  assert.equal(estimate.level, "CRITICAL");
  assert.ok(estimate.score >= 75);
});
