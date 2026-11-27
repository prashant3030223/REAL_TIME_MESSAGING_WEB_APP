import { lazy, Suspense, useEffect, useRef, useState } from "react";
import type { IScannerControls } from "@zxing/browser";
import { X, Copy, Check, Camera, RefreshCw, Sparkles } from "lucide-react";
import type { User } from "../services/types.js";
import { createProfileQrLink, getConnectUsername } from "../services/profileQr.js";

const QRCodeSVG = lazy(async () => {
  const module = await import("qrcode.react");
  return { default: module.QRCodeSVG };
});

type QrModalProps = {
  isOpen: boolean;
  onClose: () => void;
  currentUser: User;
  onScannedUser?: (username: string) => Promise<void> | void;
};

function getCameraError(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError" || error.name === "PermissionDeniedError") {
      return "Camera permission is blocked. Allow camera access in your browser settings and try again.";
    }
    if (error.name === "NotFoundError" || error.name === "DevicesNotFoundError") {
      return "No camera was found on this device.";
    }
    if (error.name === "NotReadableError" || error.name === "TrackStartError") {
      return "The camera is already in use by another app.";
    }
  }
  return error instanceof Error ? error.message : "Could not start the camera. Check browser camera permissions.";
}

export function QrModal({ isOpen, onClose, currentUser, onScannedUser }: QrModalProps) {
  const [tab, setTab] = useState<"my-code" | "scan">("my-code");
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scannedResult, setScannedResult] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const scannerControlsRef = useRef<IScannerControls | null>(null);
  const scanHandledRef = useRef(false);
  const onScannedUserRef = useRef(onScannedUser);
  const copyTimerRef = useRef<number | null>(null);

  onScannedUserRef.current = onScannedUser;

  const profileLink = createProfileQrLink(currentUser.username, window.location.origin);

  useEffect(() => {
    if (isOpen) return;
    setTab("my-code");
    setIsScanning(false);
    setScanError(null);
    setScannedResult(null);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || tab !== "scan" || !isScanning || !videoRef.current) return;

    let cancelled = false;
    let controls: IScannerControls | null = null;
    scanHandledRef.current = false;

    async function startCamera() {
      try {
        const { BrowserMultiFormatReader } = await import("@zxing/browser");
        if (cancelled) return;
        const reader = new BrowserMultiFormatReader();
        const startedControls = await reader.decodeFromVideoDevice(
          undefined,
          videoRef.current!,
          (result, _error, activeControls) => {
            if (!result || cancelled || scanHandledRef.current) return;
            scanHandledRef.current = true;
            controls = activeControls;
            scannerControlsRef.current = activeControls;
            activeControls.stop();
            setIsScanning(false);

            const username = getConnectUsername(result.getText(), window.location.origin);
            if (!username) {
              setScanError("This QR code is not a valid ConnectSphere profile.");
              return;
            }

            const connect = onScannedUserRef.current;
            if (!connect) {
              setScanError("Profile connection is unavailable right now.");
              return;
            }

            setScanError(null);
            void Promise.resolve(connect(username))
              .then(() => setScannedResult(`Connected to @${username}`))
              .catch((error: unknown) => {
                setScanError(error instanceof Error ? error.message : "Could not connect to this profile.");
              });
          },
        );
        controls = startedControls;
        if (cancelled || scanHandledRef.current) {
          startedControls.stop();
        } else {
          scannerControlsRef.current = startedControls;
        }
      } catch (error) {
        if (!cancelled) {
          setIsScanning(false);
          setScanError(getCameraError(error));
        }
      }
    }

    void startCamera();
    return () => {
      cancelled = true;
      controls?.stop();
      scannerControlsRef.current?.stop();
      scannerControlsRef.current = null;
    };
  }, [isOpen, isScanning, tab]);

  useEffect(() => () => {
    if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
    scannerControlsRef.current?.stop();
  }, []);

  if (!isOpen) return null;

  async function handleCopy() {
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error("Clipboard access is unavailable. Copy the profile link manually.");
      }
      await navigator.clipboard.writeText(profileLink);
      setCopyError(null);
      setCopied(true);
      if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
      copyTimerRef.current = window.setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      setCopied(false);
      setCopyError(error instanceof Error ? error.message : "Could not copy the profile link.");
    }
  }

  function startScanning() {
    setScanError(null);
    setScannedResult(null);
    scanHandledRef.current = false;
    setIsScanning(true);
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-card qr-modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="qr-modal-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="qr-modal-header">
          <div>
            <h3 id="qr-modal-title">Profile QR Code</h3>
            <p className="modal-subtitle">Share your code or scan to connect</p>
          </div>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Close QR code dialog">
            <X size={18} />
          </button>
        </div>

        <div className="qr-tabs" role="tablist" aria-label="Profile QR options">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "my-code"}
            className={`qr-tab ${tab === "my-code" ? "is-active" : ""}`}
            onClick={() => {
              setIsScanning(false);
              setTab("my-code");
            }}
          >
            My QR Code
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "scan"}
            className={`qr-tab ${tab === "scan" ? "is-active" : ""}`}
            onClick={() => {
              setScanError(null);
              setTab("scan");
            }}
          >
            Scan QR
          </button>
        </div>

        {tab === "my-code" ? (
          <div className="qr-content-pane">
            <div className="qr-frame">
              <Suspense fallback={<div className="qr-code-loading" role="status">Preparing QR code...</div>}>
                <QRCodeSVG
                  value={profileLink}
                  size={256}
                  level="H"
                  marginSize={4}
                  title={`Connect with ${currentUser.displayName} on ConnectSphere`}
                />
              </Suspense>
            </div>

            <div className="qr-user-info">
              <h4>{currentUser.displayName}</h4>
              <p className="qr-handle">@{currentUser.username}</p>
              <p className="qr-hint">Scan with a ConnectSphere camera to open a chat with you.</p>
            </div>

            <div className="qr-link-box">
              <span className="qr-link-text" title={profileLink}>{profileLink}</span>
              <button type="button" className="qr-copy-btn" onClick={() => void handleCopy()}>
                {copied ? <Check size={16} className="text-success" /> : <Copy size={16} />}
                <span>{copied ? "Copied" : "Copy"}</span>
              </button>
            </div>
            {copyError && <p className="qr-error" role="alert">{copyError}</p>}
          </div>
        ) : (
          <div className="qr-content-pane">
            <div className={`scanner-viewfinder ${isScanning ? "is-scanning" : ""}`}>
              <video
                ref={videoRef}
                className="scanner-video"
                muted
                playsInline
                aria-label="Live camera preview for QR scanning"
              />
              {isScanning ? (
                <>
                  <div className="scanner-corner top-left" />
                  <div className="scanner-corner top-right" />
                  <div className="scanner-corner bottom-left" />
                  <div className="scanner-corner bottom-right" />
                  <div className="scanner-laser" />
                  <p className="scanner-text">Hold the ConnectSphere QR code inside the frame.</p>
                </>
              ) : (
                <p className="scanner-idle-text">Camera preview will appear here when scanning starts.</p>
              )}
            </div>

            {scanError && <p className="qr-error" role="alert">{scanError}</p>}
            {scannedResult && (
              <div className="scanned-success-box" role="status">
                <Sparkles size={18} className="text-success" />
                <span>{scannedResult}</span>
              </div>
            )}

            <button
              type="button"
              className="primary-action-btn w-full qr-scan-button"
              onClick={isScanning ? () => setIsScanning(false) : startScanning}
            >
              {isScanning ? (
                <>
                  <RefreshCw size={16} className="spin-icon" />
                  <span>Stop scanning</span>
                </>
              ) : (
                <>
                  <Camera size={16} />
                  <span>{scanError ? "Try camera again" : "Start camera"}</span>
                </>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
