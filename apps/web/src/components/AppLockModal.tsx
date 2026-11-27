import { useState, useEffect, useRef } from "react";
import { ShieldCheck, Delete, AlertCircle, X } from "lucide-react";
import { soundFx } from "../services/soundFx.js";

type AppLockModalProps = {
  isOpen: boolean;
  onUnlock: () => void;
  expectedPin: string;
  title?: string;
  subtitle?: string;
  onClose?: () => void;
};

export function AppLockModal({
  isOpen,
  onUnlock,
  expectedPin,
  title = "ConnectSphere Locked",
  subtitle = "Enter your 4-digit PIN to continue",
  onClose,
}: AppLockModalProps) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState(false);
  const timerRef = useRef<number | null>(null);

  function handleDigit(digit: string) {
    if (pin.length >= 4) return;
    soundFx.playDtmf(digit);
    const nextPin = pin + digit;
    setPin(nextPin);
    setError(false);

    if (nextPin.length === 4) {
      if (nextPin === expectedPin) {
        soundFx.playSent();
        timerRef.current = window.setTimeout(() => {
          timerRef.current = null;
          setPin("");
          onUnlock();
        }, 200);
      } else {
        soundFx.playCallDisconnect();
        setError(true);
        timerRef.current = window.setTimeout(() => {
          timerRef.current = null;
          setPin("");
        }, 700);
      }
    }
  }

  function handleDelete() {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    setPin((prev) => prev.slice(0, -1));
    setError(false);
  }

  useEffect(() => {
    if (!isOpen) {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = null;
      setPin("");
      setError(false);
    }
  }, [isOpen]);

  useEffect(() => () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key >= "0" && e.key <= "9") {
        e.preventDefault();
        handleDigit(e.key);
      } else if (e.key === "Backspace") {
        e.preventDefault();
        handleDelete();
      } else if (e.key === "Escape" && onClose) {
        e.preventDefault();
        setPin("");
        setError(false);
        onClose();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, pin, expectedPin, onClose]);

  if (!isOpen) return null;

  return (
    <div className="lock-screen-overlay">
      <div
        className={`lock-card ${error ? "is-shaking" : ""}`}
        style={{ position: "relative" }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="app-lock-title"
      >
        {onClose && (
          <button
            type="button"
            className="modal-close-btn"
            style={{ position: "absolute", top: 16, right: 16 }}
            onClick={() => {
              setPin("");
              setError(false);
              onClose();
            }}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        )}
        <div className="lock-icon-circle">
          <ShieldCheck size={32} className="text-accent" />
        </div>

        <h2 id="app-lock-title" className="lock-title">{title}</h2>
        <p className="lock-subtitle">{subtitle}</p>

        {/* PIN indicator circles */}
        <div className="pin-indicators">
          {[0, 1, 2, 3].map((index) => (
            <div
              key={index}
              className={`pin-dot ${index < pin.length ? "is-filled" : ""} ${error ? "is-error" : ""}`}
            />
          ))}
        </div>

        {error && (
          <p className="pin-error-text">
            <AlertCircle size={14} /> Incorrect PIN. Try again.
          </p>
        )}

        {/* Keypad */}
        <div className="pin-keypad">
          {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((num) => (
            <button
              key={num}
              type="button"
              className="keypad-btn"
              onClick={() => handleDigit(num)}
            >
              {num}
            </button>
          ))}

          <span className="keypad-spacer" aria-hidden="true" />
          <button
            type="button"
            className="keypad-btn"
            onClick={() => handleDigit("0")}
          >
            0
          </button>

          <button
            type="button"
            className="keypad-btn action-key"
            onClick={handleDelete}
            title="Delete digit"
            disabled={pin.length === 0}
          >
            <Delete size={22} />
          </button>
        </div>

        <div className="lock-footnote">
          <span>Enter your 4-digit PIN to continue.</span>
        </div>
      </div>
    </div>
  );
}
