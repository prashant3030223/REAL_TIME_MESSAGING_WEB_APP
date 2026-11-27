import { useState, useRef, useEffect } from "react";
import type { FormEvent } from "react";
import { Phone, ArrowLeft, Check, Sparkles, AlertCircle, RefreshCw, Camera, ShieldCheck } from "lucide-react";
import type { User } from "../services/types.js";

type AuthModalProps = {
  isOpen: boolean;
  onSignedIn: (user: User) => void;
  onCancel?: () => void;
};

type AuthStep = "phone" | "otp" | "profile";

const AVATAR_PRESETS = [
  "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=240&q=80",
  "https://images.unsplash.com/photo-1570295999919-56ceb5ecca61?auto=format&fit=crop&w=240&q=80",
  "https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=240&q=80",
  "https://images.unsplash.com/photo-1580489944761-15a19d654956?auto=format&fit=crop&w=240&q=80",
  "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=240&q=80",
];

export function AuthModal({ isOpen, onSignedIn, onCancel }: AuthModalProps) {
  const [step, setStep] = useState<AuthStep>("phone");
  const [countryCode, setCountryCode] = useState("+91");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [otpCode, setOtpCode] = useState(["", "", "", "", "", ""]);
  const [displayName, setDisplayName] = useState("");
  const [aboutStatus, setAboutStatus] = useState("Hey there! I am using ConnectSphere.");
  const [selectedAvatar, setSelectedAvatar] = useState(AVATAR_PRESETS[0]!);

  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [successNotice, setSuccessNotice] = useState("");
  const [debugOtp, setDebugOtp] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(30);

  const otpInputRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Countdown timer for Resend OTP
  useEffect(() => {
    if (step !== "otp" || countdown <= 0) return;
    const timer = setInterval(() => {
      setCountdown((prev) => prev - 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [step, countdown]);

  if (!isOpen) return null;

  // 1. Submit Phone Number -> Request SMS OTP via SMS Horizon
  async function handleSendOtp(e?: FormEvent) {
    if (e) e.preventDefault();
    setErrorMessage("");
    setSuccessNotice("");

    const digitsOnly = phoneNumber.replace(/\D/g, "");
    if (digitsOnly.length !== 10) {
      setErrorMessage("Please enter a valid 10-digit mobile number.");
      return;
    }

    setIsLoading(true);
    try {
      const res = await fetch("/api/auth/send-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: digitsOnly }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error?.message || "Failed to send verification SMS.");
      }

      setSuccessNotice(`Verification code sent to ${countryCode} ${digitsOnly}`);
      if (data?.debugOtp) {
        setDebugOtp(data.debugOtp);
      }
      setCountdown(30);
      setStep("otp");
      setTimeout(() => {
        otpInputRefs.current[0]?.focus();
      }, 100);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Network error sending OTP");
    } finally {
      setIsLoading(false);
    }
  }

  // 2. Submit 6-Digit OTP Code
  async function handleVerifyOtp(fullOtpString?: string) {
    setErrorMessage("");
    const codeToVerify = fullOtpString || otpCode.join("");
    if (codeToVerify.length !== 6) {
      setErrorMessage("Please enter all 6 digits of the verification code.");
      return;
    }

    setIsLoading(true);
    const digitsOnly = phoneNumber.replace(/\D/g, "");

    try {
      const res = await fetch("/api/auth/verify-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: digitsOnly,
          otp: codeToVerify,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error?.message || "Invalid or expired verification code.");
      }

      if (data?.isNewUser) {
        // Needs profile setup screen
        setStep("profile");
      } else if (data?.user) {
        // Logged in!
        onSignedIn({
          id: data.user.id,
          phone: data.user.phone || digitsOnly,
          username: data.user.username,
          displayName: data.user.displayName,
          avatar: data.user.avatar || selectedAvatar,
          bio: data.user.bio || aboutStatus,
          isOnline: true,
          isVerified: true,
        });
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Verification failed.");
    } finally {
      setIsLoading(false);
    }
  }

  // 3. Complete Profile Info for New User
  async function handleCompleteProfile(e: FormEvent) {
    e.preventDefault();
    if (!displayName.trim()) {
      setErrorMessage("Please enter your name to finish setup.");
      return;
    }

    setIsLoading(true);
    setErrorMessage("");
    const digitsOnly = phoneNumber.replace(/\D/g, "");

    try {
      const res = await fetch("/api/auth/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName: displayName.trim(),
          avatar: selectedAvatar,
          bio: aboutStatus.trim(),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error?.message || "Profile creation failed.");
      }

      onSignedIn({
        id: data.user.id,
        phone: data.user.phone || digitsOnly,
        username: data.user.username,
        displayName: data.user.displayName,
        avatar: data.user.avatar || selectedAvatar,
        bio: data.user.bio || aboutStatus,
        isOnline: true,
        isVerified: true,
      });
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Error saving profile.");
    } finally {
      setIsLoading(false);
    }
  }

  // OTP Box Digit Change Handler with auto-focus next
  function handleOtpDigitChange(index: number, value: string) {
    // Handle paste of full 6 digits
    if (value.length > 1) {
      const pasteDigits = value.replace(/\D/g, "").slice(0, 6).split("");
      const nextOtp = [...otpCode];
      pasteDigits.forEach((d, i) => {
        if (i < 6) nextOtp[i] = d;
      });
      setOtpCode(nextOtp);
      if (pasteDigits.length === 6) {
        handleVerifyOtp(pasteDigits.join(""));
      }
      return;
    }

    const digit = value.replace(/\D/g, "").slice(0, 1);
    const nextOtp = [...otpCode];
    nextOtp[index] = digit;
    setOtpCode(nextOtp);

    // Auto-advance
    if (digit && index < 5) {
      otpInputRefs.current[index + 1]?.focus();
    }

    // Auto-submit on 6th digit
    if (digit && index === 5) {
      const full = nextOtp.join("");
      if (full.length === 6) {
        handleVerifyOtp(full);
      }
    }
  }

  function handleOtpKeyDown(index: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace" && !otpCode[index] && index > 0) {
      otpInputRefs.current[index - 1]?.focus();
    }
  }

  return (
    <div className="modal-backdrop wa-auth-backdrop">
      <div className="modal-card wa-auth-card">
        {/* Top Header Badge */}
        <div className="wa-auth-header">
          <div className="wa-brand-icon">
            <ShieldCheck size={32} className="text-accent" />
          </div>

          {step === "phone" && (
            <>
              <h2>Verify your phone number</h2>
              <p className="wa-sub-text">
                ConnectSphere will send an SMS to verify your mobile number.
              </p>
            </>
          )}

          {step === "otp" && (
            <>
              <div className="wa-step-nav-row">
                <button
                  type="button"
                  className="wa-back-link"
                  onClick={() => setStep("phone")}
                  title="Edit phone number"
                >
                  <ArrowLeft size={18} /> Edit Number
                </button>
              </div>
              <h2>Verifying your number</h2>
              <p className="wa-sub-text">
                Enter the 6-digit code sent via SMS to{" "}
                <strong className="text-accent">{countryCode} {phoneNumber}</strong>
              </p>
            </>
          )}

          {step === "profile" && (
            <>
              <h2>Profile info</h2>
              <p className="wa-sub-text">
                Please provide your name and an optional profile photo.
              </p>
            </>
          )}
        </div>

        {/* Error / Success Feedback */}
        {errorMessage && (
          <div className="wa-auth-error-banner" role="alert">
            <AlertCircle size={16} />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* STEP 1: PHONE NUMBER INPUT */}
        {step === "phone" && (
          <form onSubmit={handleSendOtp} className="wa-form-body">
            <div className="wa-phone-input-group">
              <div className="wa-country-select-box">
                <span className="wa-flag">🇮🇳</span>
                <span className="wa-country-code">{countryCode}</span>
              </div>
              <input
                type="tel"
                className="wa-phone-input"
                placeholder="97569 96666"
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                maxLength={14}
                autoFocus
                required
              />
            </div>

            <p className="wa-hint-text">
              Standard SMS rates may apply. You will receive an official verification code from <strong>ConnectSphere</strong>.
            </p>

            <button
              type="submit"
              className="wa-primary-submit-btn"
              disabled={isLoading || phoneNumber.replace(/\D/g, "").length < 10}
            >
              {isLoading ? (
                <>
                  <RefreshCw size={18} className="spin-icon" /> Sending SMS...
                </>
              ) : (
                "NEXT"
              )}
            </button>
          </form>
        )}

        {/* STEP 2: 6-DIGIT OTP VERIFICATION */}
        {step === "otp" && (
          <div className="wa-form-body">
            {debugOtp && (
              <div className="wa-debug-otp-chip">
                <span>SMS Gateway Code: <strong>{debugOtp}</strong></span>
              </div>
            )}

            <div className="wa-otp-boxes-row">
              {otpCode.map((digit, i) => (
                <input
                  key={i}
                  ref={(el) => { otpInputRefs.current[i] = el; }}
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={1}
                  className="wa-otp-digit-box"
                  value={digit}
                  onChange={(e) => handleOtpDigitChange(i, e.target.value)}
                  onKeyDown={(e) => handleOtpKeyDown(i, e)}
                  disabled={isLoading}
                />
              ))}
            </div>

            <div className="wa-resend-row">
              {countdown > 0 ? (
                <span className="wa-countdown-text">Resend code in 0:{countdown < 10 ? `0${countdown}` : countdown}</span>
              ) : (
                <button
                  type="button"
                  className="wa-resend-btn"
                  onClick={() => handleSendOtp()}
                  disabled={isLoading}
                >
                  Resend SMS
                </button>
              )}
            </div>

            <button
              type="button"
              className="wa-primary-submit-btn"
              onClick={() => handleVerifyOtp()}
              disabled={isLoading || otpCode.join("").length < 6}
            >
              {isLoading ? (
                <>
                  <RefreshCw size={18} className="spin-icon" /> Verifying...
                </>
              ) : (
                "VERIFY"
              )}
            </button>
          </div>
        )}

        {/* STEP 3: PROFILE SETUP (NEW USER) */}
        {step === "profile" && (
          <form onSubmit={handleCompleteProfile} className="wa-form-body">
            <div className="wa-avatar-picker-section">
              <div className="wa-current-avatar-wrap">
                <img src={selectedAvatar} alt="Profile" className="wa-current-avatar" />
                <span className="wa-camera-badge"><Camera size={14} /></span>
              </div>

              <div className="wa-preset-avatars-row">
                {AVATAR_PRESETS.map((av, idx) => (
                  <button
                    key={idx}
                    type="button"
                    className={`wa-preset-avatar-btn ${selectedAvatar === av ? "is-selected" : ""}`}
                    onClick={() => setSelectedAvatar(av)}
                  >
                    <img src={av} alt="Preset avatar" />
                  </button>
                ))}
              </div>
            </div>

            <div className="wa-field-group">
              <label htmlFor="wa-display-name" className="wa-input-label">Type your name here</label>
              <input
                id="wa-display-name"
                type="text"
                className="wa-text-input"
                placeholder="e.g. Prashant Yadav"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                maxLength={40}
                autoFocus
                required
              />
            </div>

            <div className="wa-field-group">
              <label htmlFor="wa-about-status" className="wa-input-label">About / Status</label>
              <input
                id="wa-about-status"
                type="text"
                className="wa-text-input"
                placeholder="Available"
                value={aboutStatus}
                onChange={(e) => setAboutStatus(e.target.value)}
                maxLength={100}
              />
            </div>

            <button
              type="submit"
              className="wa-primary-submit-btn"
              disabled={isLoading || !displayName.trim()}
            >
              {isLoading ? (
                <>
                  <RefreshCw size={18} className="spin-icon" /> Setting up...
                </>
              ) : (
                "FINISH SETUP"
              )}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
