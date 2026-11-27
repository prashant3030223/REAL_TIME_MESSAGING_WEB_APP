import { useEffect, useRef, useState } from "react";
import type { ClipboardEvent, FormEvent, KeyboardEvent } from "react";
import {
  Mail,
  Lock,
  User as UserIcon,
  AtSign,
  Eye,
  EyeOff,
  ShieldCheck,
  ArrowRight,
  ArrowLeft,
  CheckCircle2,
  Check,
  AlertCircle,
  Loader2,
} from "lucide-react";
import type { User } from "../services/types.js";
import { soundFx } from "../services/soundFx.js";
import { MEMOJI_AVATARS, DEFAULT_AVATAR } from "../services/avatars.js";
import { getInviterUsername } from "../services/inviteLinks.js";

type AuthProps = {
  isOpen: boolean;
  onSignedIn: (user: User) => void;
};

type AuthMode = "login" | "signup" | "forgot";

export function WhatsAppAuth({ isOpen, onSignedIn }: AuthProps) {
  const [mode, setMode] = useState<AuthMode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [selectedAvatar, setSelectedAvatar] = useState(DEFAULT_AVATAR);
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  // Forgot Password flow state
  const [forgotStep, setForgotStep] = useState<1 | 2>(1);
  const [resetCode, setResetCode] = useState(["", "", "", "", "", ""]);
  const [newPassword, setNewPassword] = useState("");
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [infoMessage, setInfoMessage] = useState("");
  const resetCodeInputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const inviterUsername = getInviterUsername(window.location.search);

  useEffect(() => {
    if (isOpen && mode === "forgot" && forgotStep === 2) {
      resetCodeInputRefs.current[0]?.focus({ preventScroll: true });
    }
  }, [isOpen, mode, forgotStep]);

  if (!isOpen) return null;

  function switchMode(newMode: AuthMode) {
    setMode(newMode);
    setErrorMessage("");
    setInfoMessage("");
    setForgotStep(1);
    setResetCode(["", "", "", "", "", ""]);
    setNewPassword("");
  }

  function handleResetCodeChange(index: number, value: string) {
    const digits = value.replace(/\D/g, "");
    if (digits.length > 1) {
      const pastedDigits = digits.slice(0, 6).split("");
      const nextCode = ["", "", "", "", "", ""];
      pastedDigits.forEach((digit, digitIndex) => {
        nextCode[digitIndex] = digit;
      });
      setResetCode(nextCode);
      resetCodeInputRefs.current[Math.min(pastedDigits.length, 5)]?.focus();
      return;
    }

    const nextCode = [...resetCode];
    nextCode[index] = digits.slice(0, 1);
    setResetCode(nextCode);
    if (digits && index < 5) {
      resetCodeInputRefs.current[index + 1]?.focus();
    }
  }

  function handleResetCodePaste(event: ClipboardEvent<HTMLInputElement>) {
    const pastedDigits = event.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6).split("");
    if (!pastedDigits.length) return;

    event.preventDefault();
    const nextCode = ["", "", "", "", "", ""];
    pastedDigits.forEach((digit, index) => {
      nextCode[index] = digit;
    });
    setResetCode(nextCode);
    resetCodeInputRefs.current[Math.min(pastedDigits.length, 5)]?.focus();
  }

  function handleResetCodeKeyDown(index: number, event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Backspace" && !resetCode[index] && index > 0) {
      resetCodeInputRefs.current[index - 1]?.focus();
    } else if (event.key === "ArrowLeft" && index > 0) {
      event.preventDefault();
      resetCodeInputRefs.current[index - 1]?.focus();
    } else if (event.key === "ArrowRight" && index < 5) {
      event.preventDefault();
      resetCodeInputRefs.current[index + 1]?.focus();
    }
  }

  async function handleResendResetCode() {
    setErrorMessage("");
    setIsSubmitting(true);
    try {
      const cleanEmail = email.trim();
      const response = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: cleanEmail }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error?.message || "Failed to resend reset code.");
      }

      setResetCode(["", "", "", "", "", ""]);
      setInfoMessage(`We've sent a new verification code to ${cleanEmail}.`);
      resetCodeInputRefs.current[0]?.focus({ preventScroll: true });
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Failed to resend reset code.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setErrorMessage("");

    const cleanEmail = email.trim();
    if (!cleanEmail) {
      setErrorMessage("Please enter your email address.");
      return;
    }

    if (mode === "forgot") {
      if (forgotStep === 1) {
        setIsSubmitting(true);
        try {
          const response = await fetch("/api/auth/forgot-password", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: cleanEmail }),
          });

          const data = await response.json();
          if (!response.ok) {
            throw new Error(data?.error?.message || "Failed to request password reset code.");
          }

          setResetCode(["", "", "", "", "", ""]);
          setInfoMessage(`We've sent a 6-digit verification code to ${cleanEmail}. Please check your inbox (or spam) and enter it below.`);
          setForgotStep(2);
        } catch (err) {
          setErrorMessage(err instanceof Error ? err.message : "Failed to request reset code.");
        } finally {
          setIsSubmitting(false);
        }
        return;
      }

      // Step 2: Verify reset code and update password
      const cleanCode = resetCode.join("");
      if (!/^\d{6}$/.test(cleanCode)) {
        setErrorMessage("Please enter the complete 6-digit verification code.");
        return;
      }

      if (newPassword.length < 6) {
        setErrorMessage("New password must be at least 6 characters.");
        return;
      }

      setIsSubmitting(true);
      try {
        const response = await fetch("/api/auth/reset-password", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: cleanEmail,
            code: cleanCode,
            newPassword,
          }),
        });

        const data = await response.json();
        if (!response.ok) {
          throw new Error(data?.error?.message || "Failed to reset password. Please check your code.");
        }

        soundFx.playCallConnect();
        onSignedIn(data.user);
      } catch (err) {
        setErrorMessage(err instanceof Error ? err.message : "Password reset failed.");
      } finally {
        setIsSubmitting(false);
      }
      return;
    }

    if (password.length < 6) {
      setErrorMessage("Password must be at least 6 characters.");
      return;
    }

    setIsSubmitting(true);

    try {
      if (mode === "login") {
        const response = await fetch("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: cleanEmail,
            password,
          }),
        });

        const data = await response.json();
        if (!response.ok) {
          throw new Error(data?.error?.message || "Invalid email or password.");
        }

        soundFx.playCallConnect();
        onSignedIn(data.user);
      } else {
        const cleanDisplayName = displayName.trim();
        const cleanUsername = username.trim().toLowerCase();

        const response = await fetch("/api/auth/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: cleanEmail,
            password,
            displayName: cleanDisplayName || undefined,
            username: cleanUsername || undefined,
            avatar: selectedAvatar,
          }),
        });

        const data = await response.json();
        if (!response.ok) {
          throw new Error(data?.error?.message || "Failed to create account. Please try again.");
        }

        soundFx.playCallConnect();
        onSignedIn(data.user);
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Authentication failed.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="auth-overlay whatsapp-auth-overlay">
      <div className="auth-card whatsapp-auth-card">
        {/* Brand Header */}
        <div className="auth-brand-header">
          <div className="auth-brand-logo-wrap">
            <img src="/logo.svg" alt="ConnectSphere" className="auth-brand-horizontal-logo" />
          </div>
          <p className="auth-brand-subtitle">
            {mode === "forgot"
              ? forgotStep === 1
                ? "Enter your account email to receive a password reset code"
                : "Enter the verification code and set your new password"
              : mode === "login"
              ? "Sign in to access your conversations and calls"
              : "Create an account with email and password"}
          </p>
        </div>

        {/* Mode Switcher Tabs */}
        <div className="auth-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={mode === "login"}
            className={`auth-tab-btn ${mode === "login" ? "is-active" : ""}`}
            onClick={() => switchMode("login")}
          >
            Sign In
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "signup"}
            className={`auth-tab-btn ${mode === "signup" ? "is-active" : ""}`}
            onClick={() => switchMode("signup")}
          >
            Create Account
          </button>
          {mode === "forgot" && (
            <button
              type="button"
              role="tab"
              aria-selected={true}
              className="auth-tab-btn is-active"
            >
              Reset Password
            </button>
          )}
        </div>

        {mode === "signup" && inviterUsername && (
          <div className="auth-info-banner auth-invite-banner" role="status">
            <CheckCircle2 size={17} />
            <span>
              Invited by <strong>@{inviterUsername}</strong>
            </span>
          </div>
        )}

        {/* Info Banner */}
        {infoMessage && (
          <div className="auth-info-banner" role="status">
            <CheckCircle2 size={16} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>{infoMessage}</span>
          </div>
        )}

        {/* Error Banner */}
        {errorMessage && (
          <div className="auth-error-banner" role="alert">
            <AlertCircle size={16} className="auth-error-icon" />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* Authentication Form */}
        <form onSubmit={handleSubmit} className="auth-form" noValidate>
          {mode === "forgot" ? (
            <>
              {forgotStep === 1 ? (
                <>
                  <div className="auth-field">
                    <label className="auth-label" htmlFor="auth-forgot-email">
                      Account Email Address
                    </label>
                    <div className="auth-input-wrapper">
                      <Mail size={16} className="auth-input-icon" />
                      <input
                        id="auth-forgot-email"
                        type="email"
                        className="auth-input"
                        placeholder="name@example.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        autoComplete="email"
                        autoFocus
                        required
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    className="auth-submit-btn"
                    disabled={isSubmitting || !email.trim()}
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 size={16} className="auth-spinner" />
                        <span>Sending Code...</span>
                      </>
                    ) : (
                      <>
                        <span>Request Reset Code</span>
                        <ArrowRight size={16} />
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    className="auth-back-btn"
                    onClick={() => switchMode("login")}
                  >
                    <ArrowLeft size={14} /> Back to Sign In
                  </button>
                </>
              ) : (
                <>
                  <div className="auth-field">
                    <div className="auth-field-header">
                      <label id="auth-reset-code-label" className="auth-label" htmlFor="auth-reset-code">
                        6-Digit Verification Code
                      </label>
                      <button
                        type="button"
                        className="auth-forgot-link"
                        onClick={handleResendResetCode}
                        disabled={isSubmitting}
                      >
                        {isSubmitting ? "Sending..." : "Resend code"}
                      </button>
                    </div>
                    <div className="auth-otp-boxes" role="group" aria-labelledby="auth-reset-code-label">
                      {Array.from({ length: 6 }, (_, index) => (
                        <input
                          key={index}
                          id={index === 0 ? "auth-reset-code" : undefined}
                          ref={(element) => { resetCodeInputRefs.current[index] = element; }}
                          type="text"
                          className={`auth-otp-box ${resetCode[index] ? "has-value" : ""}`}
                          inputMode="numeric"
                          pattern="[0-9]*"
                          autoComplete={index === 0 ? "one-time-code" : "off"}
                          aria-label={`Verification code digit ${index + 1} of 6`}
                          value={resetCode[index] ?? ""}
                          onChange={(event) => handleResetCodeChange(index, event.target.value)}
                          onPaste={handleResetCodePaste}
                          onKeyDown={(event) => handleResetCodeKeyDown(index, event)}
                          disabled={isSubmitting}
                        />
                      ))}
                    </div>
                  </div>

                  <div className="auth-field">
                    <div className="auth-field-header">
                      <label className="auth-label" htmlFor="auth-new-password">
                        New Password
                      </label>
                      <span className="auth-field-hint">Min. 6 characters</span>
                    </div>
                    <div className="auth-input-wrapper">
                      <Lock size={16} className="auth-input-icon" />
                      <input
                        id="auth-new-password"
                        type={showNewPassword ? "text" : "password"}
                        className="auth-input"
                        placeholder="Enter your new password"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        autoComplete="new-password"
                        required
                      />
                      <button
                        type="button"
                        className="auth-toggle-pwd-btn"
                        onClick={() => setShowNewPassword((prev) => !prev)}
                        title={showNewPassword ? "Hide password" : "Show password"}
                        aria-label={showNewPassword ? "Hide password" : "Show password"}
                      >
                        {showNewPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>
                  </div>

                  <button
                    type="submit"
                    className="auth-submit-btn"
                    disabled={isSubmitting || resetCode.join("").length < 6 || newPassword.length < 6}
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 size={16} className="auth-spinner" />
                        <span>Resetting Password...</span>
                      </>
                    ) : (
                      <>
                        <span>Reset Password & Sign In</span>
                        <ArrowRight size={16} />
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    className="auth-back-btn"
                    onClick={() => switchMode("login")}
                  >
                    <ArrowLeft size={14} /> Back to Sign In
                  </button>
                </>
              )}
            </>
          ) : (
            <>
              {/* Sign Up Fields: Display Name & Username */}
              {mode === "signup" && (
                <>
                  <div className="auth-field">
                    <label className="auth-label" htmlFor="auth-display-name">
                      Full Name / Display Name
                    </label>
                    <div className="auth-input-wrapper">
                      <UserIcon size={16} className="auth-input-icon" />
                      <input
                        id="auth-display-name"
                        type="text"
                        className="auth-input"
                        placeholder="e.g. Prashant Yadav"
                        value={displayName}
                        onChange={(e) => setDisplayName(e.target.value)}
                        maxLength={80}
                        autoFocus={mode === "signup"}
                      />
                    </div>
                  </div>

                  <div className="auth-field">
                    <label className="auth-label" htmlFor="auth-username">
                      Username <span className="auth-label-opt">(optional)</span>
                    </label>
                    <div className="auth-input-wrapper">
                      <AtSign size={16} className="auth-input-icon" />
                      <input
                        id="auth-username"
                        type="text"
                        className="auth-input"
                        placeholder="e.g. prashant"
                        value={username}
                        onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))}
                        maxLength={30}
                      />
                    </div>
                  </div>

                  {/* 3D Memoji Avatar Selector */}
                  <div className="auth-field">
                    <div className="auth-avatar-header-row">
                      <label className="auth-label">Choose 3D Avatar</label>
                      <span className="auth-avatar-selected-badge">
                        <img src={selectedAvatar} alt="Selected" className="mini-selected-avatar-preview" />
                        <span>Preview</span>
                      </span>
                    </div>

                    <div className="auth-memoji-grid">
                      {/* Plus button for custom photo upload */}
                      <label className="auth-avatar-upload-tile" title="Upload custom photo or avatar">
                        <input
                          type="file"
                          accept="image/*"
                          style={{ display: "none" }}
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) {
                              const reader = new FileReader();
                              reader.onload = (ev) => {
                                const res = ev.target?.result as string;
                                if (res) setSelectedAvatar(res);
                              };
                              reader.readAsDataURL(file);
                            }
                          }}
                        />
                        <span className="upload-tile-plus">+</span>
                      </label>

                      {/* 28 3D Memoji Avatars matching Reference */}
                      {MEMOJI_AVATARS.map((m) => {
                        const isChosen = selectedAvatar === m.url;
                        return (
                          <button
                            key={m.id}
                            type="button"
                            className={`auth-memoji-tile ${isChosen ? "is-selected" : ""}`}
                            onClick={() => setSelectedAvatar(m.url)}
                            title={m.label}
                            aria-label={m.label}
                          >
                            <img src={m.url} alt={m.label} className="auth-memoji-img" />
                            {isChosen && (
                              <span className="memoji-check-badge">
                                <Check size={11} strokeWidth={3} />
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </>
              )}

              {/* Email Address */}
              <div className="auth-field">
                <label className="auth-label" htmlFor="auth-email">
                  Email Address
                </label>
                <div className="auth-input-wrapper">
                  <Mail size={16} className="auth-input-icon" />
                  <input
                    id="auth-email"
                    type="email"
                    className="auth-input"
                    placeholder="name@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="email"
                    autoFocus={mode === "login"}
                    required
                  />
                </div>
              </div>

              {/* Password */}
              <div className="auth-field">
                <div className="auth-field-header">
                  <label className="auth-label" htmlFor="auth-password">
                    Password
                  </label>
                  {mode === "signup" ? (
                    <span className="auth-field-hint">Min. 6 characters</span>
                  ) : (
                    <button
                      type="button"
                      className="auth-forgot-link"
                      onClick={() => switchMode("forgot")}
                    >
                      Forgot password?
                    </button>
                  )}
                </div>
                <div className="auth-input-wrapper">
                  <Lock size={16} className="auth-input-icon" />
                  <input
                    id="auth-password"
                    type={showPassword ? "text" : "password"}
                    className="auth-input"
                    placeholder={mode === "signup" ? "Create a secure password" : "Enter your password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete={mode === "login" ? "current-password" : "new-password"}
                    required
                  />
                  <button
                    type="button"
                    className="auth-toggle-pwd-btn"
                    onClick={() => setShowPassword((prev) => !prev)}
                    title={showPassword ? "Hide password" : "Show password"}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              {/* Submit Action Button */}
              <button
                type="submit"
                className="auth-submit-btn"
                disabled={isSubmitting || !email.trim() || password.length < 6}
              >
                {isSubmitting ? (
                  <>
                    <Loader2 size={16} className="auth-spinner" />
                    <span>{mode === "login" ? "Signing In..." : "Creating Account..."}</span>
                  </>
                ) : (
                  <>
                    <span>{mode === "login" ? "Sign In" : "Create Account"}</span>
                    <ArrowRight size={16} />
                  </>
                )}
              </button>
            </>
          )}
        </form>

        {/* Switch Prompt */}
        <div className="auth-switch-prompt">
          {mode === "login" ? (
            <p>
              Don't have an account?{" "}
              <button
                type="button"
                className="auth-switch-link"
                onClick={() => switchMode("signup")}
              >
                Create one now
              </button>
            </p>
          ) : mode === "signup" ? (
            <p>
              Already have an account?{" "}
              <button
                type="button"
                className="auth-switch-link"
                onClick={() => switchMode("login")}
              >
                Sign in
              </button>
            </p>
          ) : (
            <p>
              Remember your password?{" "}
              <button
                type="button"
                className="auth-switch-link"
                onClick={() => switchMode("login")}
              >
                Back to Sign in
              </button>
            </p>
          )}
        </div>

        {/* Security badge */}
        <div className="auth-security-tag">
          <ShieldCheck size={14} className="text-accent" />
          <span>End-to-end encrypted session · Secure real-time chat</span>
        </div>
      </div>
    </div>
  );
}

// Export AuthView as alias for clarity
export const AuthView = WhatsAppAuth;
