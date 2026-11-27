import { useState, useEffect, useRef } from "react";
import {
  Cpu,
  Activity,
  Play,
  Square,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  TrendingUp,
  Sliders,
  Sparkles,
  Zap,
} from "lucide-react";
import type {
  WebRtcTelemetrySample,
  RecoveryRiskEstimate,
  RecoveryRiskLevel,
} from "../services/types.js";
import { PredictiveCallRecoveryEstimatorClient } from "../services/predictiveEstimator.js";

type RecoveryLabViewProps = {
  currentEstimate: RecoveryRiskEstimate;
};

export function RecoveryLabView({ currentEstimate: _ }: RecoveryLabViewProps) {
  // Simulator State
  const [isRunning, setIsRunning] = useState(true);
  const [rtt, setRtt] = useState(32);
  const [jitter, setJitter] = useState(6);
  const [packetLoss, setPacketLoss] = useState(0);
  const [sendingBitrate, setSendingBitrate] = useState(2_400_000);
  const [availableBitrate, setAvailableBitrate] = useState(3_200_000);

  // History & logs
  const [history, setHistory] = useState<WebRtcTelemetrySample[]>([]);
  const [auditLog, setAuditLog] = useState<{ id: string; time: string; text: string; level: RecoveryRiskLevel }[]>([
    {
      id: "log-1",
      time: "12:30:14",
      text: "Normal baseline established: 1080p @ 30fps streaming with 1.33x bitrate headroom.",
      level: "NORMAL",
    },
  ]);

  const estimatorRef = useRef(new PredictiveCallRecoveryEstimatorClient({ windowMs: 10_000, maxSamples: 16 }));
  const [estimate, setEstimate] = useState<RecoveryRiskEstimate>({
    level: "NORMAL",
    score: 6,
    confidence: "MEDIUM",
    sampleCount: 8,
    observedWindowMs: 8000,
    adaptationAction: "Optimal Condition: Streaming at full 1080p @ 30fps with maximum clarity.",
    timestampMs: Date.now(),
  });

  // Ticking simulation loop
  useEffect(() => {
    if (!isRunning) return;

    const interval = window.setInterval(() => {
      // Add subtle jitter variance
      const actualRtt = Math.max(10, Math.round(rtt + (Math.random() - 0.5) * 6));
      const actualJitter = Math.max(1, Math.round(jitter + (Math.random() - 0.5) * 3));
      const sample: WebRtcTelemetrySample = {
        timestampMs: Date.now(),
        roundTripTimeMs: actualRtt,
        jitterMs: actualJitter,
        packetLossPercent: packetLoss,
        availableOutgoingBitrateBps: availableBitrate,
        sendingBitrateBps: sendingBitrate,
        resolution: "1080p",
        fps: 30,
      };

      const est = estimatorRef.current.addSample(sample);
      setEstimate(est);

      setHistory((prev) => [...prev.slice(-18), sample]);

      // Check if risk changed and log it
      setAuditLog((prev) => {
        const last = prev[0];
        if (!last || last.level !== est.level) {
          const nowStr = new Date().toLocaleTimeString();
          return [
            {
              id: `log-${Date.now()}`,
              time: nowStr,
              text: `Risk transition to ${est.level} (${est.score}%). Adaptation: ${est.adaptationAction}`,
              level: est.level,
            },
            ...prev.slice(0, 19),
          ];
        }
        return prev;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [isRunning, rtt, jitter, packetLoss, availableBitrate, sendingBitrate]);

  function applyPreset(name: "ideal" | "cellular" | "tunnel" | "jitter") {
    if (name === "ideal") {
      setRtt(24);
      setJitter(3);
      setPacketLoss(0);
      setAvailableBitrate(3_800_000);
      setSendingBitrate(2_400_000);
    } else if (name === "cellular") {
      setRtt(260);
      setJitter(45);
      setPacketLoss(4);
      setAvailableBitrate(1_600_000);
      setSendingBitrate(1_800_000);
    } else if (name === "tunnel") {
      setRtt(580);
      setJitter(120);
      setPacketLoss(18);
      setAvailableBitrate(600_000);
      setSendingBitrate(1_400_000);
    } else {
      setRtt(160);
      setJitter(115);
      setPacketLoss(2);
      setAvailableBitrate(2_200_000);
      setSendingBitrate(2_000_000);
    }
  }

  function resetEngine() {
    estimatorRef.current.reset();
    setHistory([]);
    setRtt(25);
    setJitter(4);
    setPacketLoss(0);
  }

  const getRiskColor = (level: RecoveryRiskLevel) => {
    switch (level) {
      case "CRITICAL":
        return "#ef4444";
      case "HIGH":
        return "#f97316";
      case "ELEVATED":
        return "#eab308";
      default:
        return "#10b981";
    }
  };

  return (
    <div className="recovery-lab-page">
      {/* Top Banner */}
      <div className="lab-hero-card">
        <div className="hero-content">
          <div className="hero-tag">
            <Zap size={14} className="text-accent" />
            <span>Real-Time Health</span>
          </div>
          <h2>Call Quality Diagnostics &amp; Recovery</h2>
          <p>
            ConnectSphere continuously analyzes connection latency, jitter buffers, and bitrate trends
            to proactively optimize streaming quality and ensure uninterrupted, zero-drop voice and video calling.
          </p>
        </div>

        <div className="hero-quick-stats">
          <div className="q-stat-item">
            <span className="q-stat-val">5–10s</span>
            <span className="q-stat-lbl">Proactive Adaptation</span>
          </div>
          <div className="q-stat-item">
            <span className="q-stat-val">100%</span>
            <span className="q-stat-lbl">Audio Continuity</span>
          </div>
          <div className="q-stat-item">
            <span className="q-stat-val">1080p</span>
            <span className="q-stat-lbl">HD Video Target</span>
          </div>
        </div>
      </div>

      <div className="lab-grid-layout">
        {/* Left Column: Interactive Network Telemetry Sliders & Presets */}
        <div className="lab-control-panel">
          <div className="panel-header-row">
            <div className="title-box">
              <Sliders size={18} className="text-accent" />
              <h3>Simulated Network Conditions</h3>
            </div>
            <div className="control-btn-group">
              <button
                type="button"
                className={`sim-toggle-btn ${isRunning ? "is-running" : ""}`}
                onClick={() => setIsRunning((r) => !r)}
              >
                {isRunning ? <Square size={13} /> : <Play size={13} />}
                <span>{isRunning ? "Pause Stream" : "Resume Stream"}</span>
              </button>
              <button type="button" className="sim-reset-btn" onClick={resetEngine} title="Reset Engine">
                <RefreshCw size={14} />
              </button>
            </div>
          </div>

          {/* Preset Buttons */}
          <div className="preset-buttons-deck">
            <span className="deck-title">Scenarios:</span>
            <button type="button" className="preset-chip" onClick={() => applyPreset("ideal")}>
              Fiber (Ideal)
            </button>
            <button type="button" className="preset-chip" onClick={() => applyPreset("cellular")}>
              4G Congestion
            </button>
            <button type="button" className="preset-chip is-danger" onClick={() => applyPreset("tunnel")}>
              Subway Tunnel (Severe)
            </button>
            <button type="button" className="preset-chip" onClick={() => applyPreset("jitter")}>
              Jitter Buffer Overflow
            </button>
          </div>

          {/* Sliders */}
          <div className="sliders-form">
            <div className="slider-item">
              <div className="slider-label-row">
                <span>Round Trip Time (RTT):</span>
                <strong>{rtt} ms</strong>
              </div>
              <input
                type="range"
                min={10}
                max={750}
                value={rtt}
                onChange={(e) => setRtt(Number(e.target.value))}
                className="lab-range"
              />
              <span className="slider-hint">Normal: &lt;150ms · Elevated: 250ms · Critical: &gt;500ms</span>
            </div>

            <div className="slider-item">
              <div className="slider-label-row">
                <span>Jitter:</span>
                <strong>{jitter} ms</strong>
              </div>
              <input
                type="range"
                min={1}
                max={150}
                value={jitter}
                onChange={(e) => setJitter(Number(e.target.value))}
                className="lab-range"
              />
              <span className="slider-hint">Normal: &lt;30ms · Elevated: 50ms · Critical: &gt;100ms</span>
            </div>

            <div className="slider-item">
              <div className="slider-label-row">
                <span>Packet Loss:</span>
                <strong>{packetLoss}%</strong>
              </div>
              <input
                type="range"
                min={0}
                max={25}
                value={packetLoss}
                onChange={(e) => setPacketLoss(Number(e.target.value))}
                className="lab-range"
              />
              <span className="slider-hint">Normal: &lt;2% · High: 5% · Critical: &gt;15%</span>
            </div>

            <div className="slider-item">
              <div className="slider-label-row">
                <span>Available Bitrate:</span>
                <strong>{(availableBitrate / 1_000_000).toFixed(2)} Mbps</strong>
              </div>
              <input
                type="range"
                min={400_000}
                max={5_000_000}
                step={100_000}
                value={availableBitrate}
                onChange={(e) => setAvailableBitrate(Number(e.target.value))}
                className="lab-range"
              />
            </div>
          </div>
        </div>

        {/* Right Column: Real-Time Telemetry Estimator Output */}
        <div className="lab-output-panel">
          <div className="panel-header-row">
            <div className="title-box">
              <Activity size={18} className="text-accent" />
              <h3>Estimator Diagnostics</h3>
            </div>
            <span className="engine-badge">PredictiveCallRecoveryEstimator v2.4</span>
          </div>

          {/* Risk Gauge Card */}
          <div className="risk-gauge-card" style={{ borderColor: getRiskColor(estimate.level) }}>
            <div className="gauge-header">
              <div>
                <span className="gauge-subtitle">Forecasted Call Degradation Risk</span>
                <h3 className="gauge-level-title" style={{ color: getRiskColor(estimate.level) }}>
                  {estimate.level} ({estimate.score}%)
                </h3>
              </div>
              <div className="gauge-score-circle" style={{ borderColor: getRiskColor(estimate.level) }}>
                <span>{estimate.score}</span>
              </div>
            </div>

            <div className="gauge-progress-track">
              <div
                className="gauge-progress-bar"
                style={{
                  width: `${Math.min(100, estimate.score)}%`,
                  backgroundColor: getRiskColor(estimate.level),
                }}
              />
            </div>

            <div className="gauge-meta-pills">
              <span>Confidence: <strong>{estimate.confidence}</strong></span>
              <span>Sample Window: <strong>{(estimate.observedWindowMs / 1000).toFixed(1)}s</strong></span>
              <span>Samples: <strong>{estimate.sampleCount}</strong></span>
            </div>

            {/* Proactive Action Banner */}
            <div className="proactive-action-box">
              <ShieldCheck size={18} style={{ color: getRiskColor(estimate.level) }} />
              <div>
                <strong>Proactive Mitigation Policy:</strong>
                <p>{estimate.adaptationAction}</p>
              </div>
            </div>
          </div>

          {/* Real-Time Sparkline Wave Visualizer */}
          <div className="telemetry-sparkline-box">
            <div className="sparkline-header">
              <TrendingUp size={15} />
              <span>Rolling WebRTC Latency (RTT ms)</span>
            </div>
            <div className="sparkline-bars">
              {history.map((s, idx) => {
                const heightPercent = Math.min(100, Math.max(10, (s.roundTripTimeMs / 600) * 100));
                return (
                  <div key={idx} className="sparkline-col" title={`RTT: ${s.roundTripTimeMs}ms`}>
                    <div
                      className={`spark-bar ${s.roundTripTimeMs > 300 ? "is-red" : s.roundTripTimeMs > 150 ? "is-orange" : "is-green"}`}
                      style={{ height: `${heightPercent}%` }}
                    />
                  </div>
                );
              })}
            </div>
          </div>

          {/* Adaptation Event Timeline Audit */}
          <div className="audit-timeline-box">
            <h4>Adaptation Event Stream</h4>
            <div className="timeline-items">
              {auditLog.map((log) => (
                <div key={log.id} className="timeline-event">
                  <span className="log-time">{log.time}</span>
                  <span className="log-bullet" style={{ backgroundColor: getRiskColor(log.level) }} />
                  <span className="log-text">{log.text}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
