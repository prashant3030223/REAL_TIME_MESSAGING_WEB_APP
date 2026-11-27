import { randomBytes, randomInt, scrypt as nodeScrypt, createHash, timingSafeEqual, randomUUID } from "node:crypto";
import { Router } from "express";
import type { Request, Response } from "express";
import type { Pool, PoolClient } from "pg";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { ApiError } from "./errors.js";
import type { AppLogger } from "./logger.js";
import { sendSmsOtp, normalizePhoneNumber } from "./sms.js";
import { sendPasswordResetEmail } from "./brevo.js";

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const PASSWORD_HASH_BYTES = 64;
const SCRYPT_OPTIONS = { N: 32_768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
export const SESSION_COOKIE_NAME = "connectsphere_session";

const registrationSchema = z.object({
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  username: z.string().trim().toLowerCase().regex(/^[a-z0-9_]{3,30}$/).optional(),
  displayName: z.string().trim().min(1).max(80).optional(),
  password: z.string().min(6).max(128),
  avatar: z.string().trim().optional(),
}).strict();

const loginSchema = z.object({
  email: z.string().trim().min(1).max(254),
  password: z.string().min(1).max(128),
}).strict();

const forgotPasswordSchema = z.object({
  email: z.string().trim().email().toLowerCase(),
}).strict();

const resetPasswordSchema = z.object({
  email: z.string().trim().email().toLowerCase(),
  code: z.string().trim().regex(/^\d{6}$/),
  newPassword: z.string().min(6).max(128),
}).strict();

const resetCodesStore = new Map<string, { code: string; expiresAt: number }>();

const sendOtpSchema = z.object({
  phone: z.string().trim().min(7).max(20),
});

const verifyOtpSchema = z.object({
  phone: z.string().trim().min(7).max(20),
  otp: z.string().trim().regex(/^\d{6}$/),
});

const updateProfileSchema = z.object({
  displayName: z.string().trim().min(1).max(80).optional(),
  username: z.string().trim().toLowerCase().regex(/^[a-z0-9_]{3,30}$/).optional(),
  avatar: z.string().trim().min(1).optional(),
  bio: z.string().trim().max(160).optional(),
  statusText: z.string().trim().max(80).optional(),
  profilePhotoProtection: z.enum(["nobody", "contacts", "everyone"]).optional(),
});

export type PublicUser = {
  id: string;
  email?: string | null;
  phone?: string | null;
  username: string;
  displayName: string;
  avatar?: string | null;
  bio?: string | null;
  statusText?: string | null;
  profilePhotoProtection?: "nobody" | "contacts" | "everyone" | null;
};

type StoredPassword = {
  password_hash: string;
};

// In-memory fallbacks when Postgres is unavailable (e.g. testing or local demo)
const inMemoryOtps = new Map<string, { otp: string; expiresAt: number; verified: boolean }>();
const inMemoryUsers = new Map<string, PublicUser>();
const inMemorySessions = new Map<string, { userId: string; expiresAt: number }>();

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}

function hashToken(token: string): Buffer {
  return createHash("sha256").update(token).digest();
}

function tokenMatches(provided: string, expected: string): boolean {
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);
  return providedBuffer.length === expectedBuffer.length &&
    timingSafeEqual(providedBuffer, expectedBuffer);
}

export async function resolveSessionUserId(
  database: Pool | undefined,
  token: string | undefined,
): Promise<string | null> {
  if (!database || !token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const result = await database.query<{ user_id: string }>(
    "SELECT user_id FROM app_sessions WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now()",
    [hashToken(token)],
  );
  return result.rows[0]?.user_id ?? null;
}

function deriveKey(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    nodeScrypt(password, salt, PASSWORD_HASH_BYTES, SCRYPT_OPTIONS, (error, derived) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(derived);
    });
  });
}

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await deriveKey(password, salt);
  return `scrypt$${SCRYPT_OPTIONS.N}$${SCRYPT_OPTIONS.r}$${SCRYPT_OPTIONS.p}$${salt.toString("base64url")}$${derived.toString("base64url")}`;
}

async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [algorithm, n, r, p, saltValue, hashValue, extra] = encoded.split("$");
  if (
    algorithm !== "scrypt" ||
    n !== String(SCRYPT_OPTIONS.N) ||
    r !== String(SCRYPT_OPTIONS.r) ||
    p !== String(SCRYPT_OPTIONS.p) ||
    !saltValue ||
    !hashValue ||
    extra !== undefined
  ) {
    return false;
  }

  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(saltValue, "base64url");
    expected = Buffer.from(hashValue, "base64url");
  } catch {
    return false;
  }
  if (salt.length !== 16 || expected.length !== PASSWORD_HASH_BYTES) return false;

  const actual = await deriveKey(password, salt);
  return timingSafeEqual(actual, expected);
}

const dummyPasswordHash = hashPassword(randomBytes(32).toString("hex"));

function databaseRequired(database: Pool | undefined): asserts database is Pool {
  if (!database) {
    throw new ApiError(503, "SERVICE_UNAVAILABLE", "Account services are not configured.");
  }
}

function publicUser(user: PublicUser) {
  return {
    id: user.id,
    ...(user.email ? { email: user.email } : {}),
    ...(user.phone ? { phone: user.phone } : {}),
    username: user.username,
    displayName: user.displayName,
    avatar: user.avatar || "/avatars/boy.png",
    bio: user.bio || "Hey there! I am using ConnectSphere.",
    ...(user.statusText ? { statusText: user.statusText } : {}),
    profilePhotoProtection: user.profilePhotoProtection || "nobody",
  };
}

function setSessionCookie(response: Response, token: string, secureCookies: boolean) {
  response.cookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: secureCookies,
    sameSite: "strict",
    path: "/",
    maxAge: SESSION_TTL_MS,
  });
}

function clearSessionCookie(response: Response, secureCookies: boolean) {
  response.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    secure: secureCookies,
    sameSite: "strict",
    path: "/",
  });
}

function sessionRateLimit(logger: AppLogger) {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler: (request, response) => {
      logger.warn({ requestId: response.locals.requestId, route: request.path }, "Authentication rate limit exceeded");
      response.status(429).json({
        error: {
          code: "RATE_LIMITED",
          message: "Too many account requests. Try again later.",
          requestId: response.locals.requestId,
        },
      });
    },
  });
}

function validationError() {
  return new ApiError(400, "INVALID_REQUEST", "The account details are invalid.");
}

async function createSession(
  client: PoolClient,
  userId: string,
) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await client.query(
    "INSERT INTO app_sessions (user_id, token_hash, expires_at) VALUES ($1, $2, $3)",
    [userId, hashToken(token), expiresAt],
  );
  return token;
}

export function createAuthRouter(
  database: Pool | undefined,
  logger: AppLogger,
  secureCookies: boolean,
) {
  const router = Router();
  const limiter = sessionRateLimit(logger);

  // 1. WhatsApp-style: Send OTP to Mobile Number via SMS Horizon API
  router.post("/send-otp", limiter, async (request, response) => {
    if (!database && process.env.NODE_ENV !== "test") databaseRequired(database);
    const parsed = sendOtpSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ApiError(400, "INVALID_PHONE_NUMBER", "Please enter a valid phone number.");
    }

    const { phone } = parsed.data;
    const cleanPhone = normalizePhoneNumber(phone);
    if (cleanPhone.length < 10) {
      throw new ApiError(400, "INVALID_PHONE_NUMBER", "Phone number must have at least 10 digits.");
    }

    // Rate-limiting / resend cooldown protection (45s)
    if (database && process.env.NODE_ENV !== "test") {
      const recentRes = await database.query<{ created_at: Date }>(
        `SELECT created_at FROM app_otps
         WHERE phone = $1 AND verified = false AND created_at > now() - interval '45 seconds'
         ORDER BY created_at DESC LIMIT 1`,
        [cleanPhone],
      );
      if (recentRes.rows.length > 0) {
        throw new ApiError(429, "RATE_LIMITED", "Please wait before requesting another verification code.");
      }
    }

    // Invalidate previous pending OTPs for this phone number
    if (database) {
      await database.query(
        "DELETE FROM app_otps WHERE phone = $1 AND verified = false",
        [cleanPhone],
      );
    } else {
      inMemoryOtps.delete(cleanPhone);
    }

    // Generate 6-digit random code
    const otp = randomInt(100_000, 1_000_000).toString();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 min expiry

    // Save in DB or in-memory
    if (database) {
      await database.query(
        "INSERT INTO app_otps (phone, otp_hash, expires_at) VALUES ($1, $2, $3)",
        [cleanPhone, hashToken(otp).toString("hex"), expiresAt],
      );
    } else {
      inMemoryOtps.set(cleanPhone, { otp, expiresAt: expiresAt.getTime(), verified: false });
    }

    // Real production SMS dispatch via SMS Horizon
    const smsResult = await sendSmsOtp(cleanPhone, otp, logger);
    if (!smsResult.success) {
      if (database) {
        await database.query(
          "DELETE FROM app_otps WHERE phone = $1 AND otp_hash = $2 AND verified = false",
          [cleanPhone, hashToken(otp).toString("hex")],
        );
      } else {
        inMemoryOtps.delete(cleanPhone);
      }
      throw new ApiError(
        502,
        "SMS_DISPATCH_FAILED",
        smsResult.error || "Failed to dispatch SMS to your phone number. Please verify your mobile number.",
      );
    }

    response.status(200).json({
      success: true,
      message: "6-digit verification code sent to your mobile number.",
      phone: cleanPhone,
      smsDispatched: true,
      ...(smsResult.msgId ? { msgId: smsResult.msgId } : {}),
      ...(smsResult.carrierStatus ? { carrierStatus: smsResult.carrierStatus } : {}),
      ...(process.env.NODE_ENV === "test" ? { devOtp: otp } : {}),
    });
  });

  // 2. WhatsApp-style: Verify 6-digit OTP & Issue Session
  router.post("/verify-otp", limiter, async (request, response) => {
    if (!database && process.env.NODE_ENV !== "test") databaseRequired(database);
    const parsed = verifyOtpSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ApiError(400, "INVALID_OTP", "Enter a valid 6-digit verification code.");
    }

    const { phone, otp } = parsed.data;
    const cleanPhone = normalizePhoneNumber(phone);
    let otpValid = false;

    // Check DB first
    if (database) {
      const otpHash = hashToken(otp).toString("hex");
      const res = await database.query(
        `UPDATE app_otps
         SET verified = true
         WHERE id = (
           SELECT id FROM app_otps
           WHERE phone = $1 AND otp_hash = $2 AND expires_at > now() AND verified = false
           ORDER BY created_at DESC
           LIMIT 1
           FOR UPDATE SKIP LOCKED
         )
         RETURNING id`,
        [cleanPhone, otpHash],
      );
      otpValid = res.rows.length > 0;
    }

    if (!database) {
      const memOtp = inMemoryOtps.get(cleanPhone);
      if (memOtp && memOtp.otp === otp && memOtp.expiresAt > Date.now() && !memOtp.verified) {
        otpValid = true;
        memOtp.verified = true;
      }
    }

    if (!otpValid) {
      throw new ApiError(400, "INVALID_OTP", "The verification code is invalid or has expired.");
    }

    // Find or create account
    let user: PublicUser;
    let isNewUser = false;

    if (database) {
      try {
        const userRes = await database.query<PublicUser>(
          `SELECT id, phone, email, username, display_name AS "displayName", avatar, bio,
                  status_text AS "statusText", profile_photo_protection AS "profilePhotoProtection"
           FROM app_users
           WHERE phone = $1`,
          [cleanPhone],
        );
        if (userRes.rows[0]) {
          user = userRes.rows[0];
        } else {
          isNewUser = true;
          const defaultUsername = `user_${cleanPhone.slice(-4)}_${randomUUID().slice(0, 4)}`;
          const inserted = await database.query<PublicUser>(
            `INSERT INTO app_users (phone, username, display_name, avatar, bio)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING id, phone, email, username, display_name AS "displayName", avatar, bio,
                       status_text AS "statusText", profile_photo_protection AS "profilePhotoProtection"`,
            [
              cleanPhone,
              defaultUsername,
              `+91 ${cleanPhone.slice(-10)}`,
              "/avatars/boy.png",
              "Hey there! I am using ConnectSphere.",
            ],
          );
          user = inserted.rows[0]!;
        }

        const client = await database.connect();
        try {
          const token = await createSession(client, user.id);
          setSessionCookie(response, token, secureCookies);
        } finally {
          client.release();
        }
      } catch (err) {
        logger.error({ errorName: err instanceof Error ? err.name : "UnknownError" }, "Failed to verify OTP account");
        throw new ApiError(503, "ACCOUNT_SERVICE_UNAVAILABLE", "Could not complete sign-in. Please try again.");
      }
    } else {
      isNewUser = !inMemoryUsers.has(cleanPhone);
      if (isNewUser) {
        user = {
          id: `usr_${Date.now()}`,
          phone: cleanPhone,
          username: `user_${cleanPhone.slice(-4)}`,
          displayName: `+91 ${cleanPhone.slice(-10)}`,
          avatar: "/avatars/boy.png",
          bio: "Hey there! I am using ConnectSphere.",
        };
        inMemoryUsers.set(cleanPhone, user);
      } else {
        user = inMemoryUsers.get(cleanPhone)!;
      }
      const token = randomBytes(32).toString("base64url");
      inMemorySessions.set(token, { userId: user.id, expiresAt: Date.now() + SESSION_TTL_MS });
      setSessionCookie(response, token, secureCookies);
    }

    response.status(200).json({
      success: true,
      user: { ...publicUser(user), isVerified: true },
      isNewUser,
    });
  });

  // 3. WhatsApp-style: Profile Info Setup (Name, Avatar, About)
  router.post("/profile", async (request, response) => {
    if (!database && process.env.NODE_ENV !== "test") databaseRequired(database);
    const parsed = updateProfileSchema.safeParse(request.body);
    if (!parsed.success) throw validationError();

    const token = request.cookies?.[SESSION_COOKIE_NAME] as string | undefined;
    const { displayName, username, avatar, bio, statusText, profilePhotoProtection } = parsed.data;

    if (database && token) {
      try {
        const sessionRes = await database.query<{ user_id: string }>(
          "SELECT user_id FROM app_sessions WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now()",
          [hashToken(token)],
        );
        const userId = sessionRes.rows[0]?.user_id;
        if (!userId) throw new ApiError(401, "UNAUTHENTICATED", "Sign in to update profile.");

        const updateRes = await database.query<PublicUser>(
          `UPDATE app_users
           SET display_name = COALESCE($1, display_name),
               username = COALESCE($2, username),
               avatar = COALESCE($3, avatar),
               bio = COALESCE($4, bio),
               status_text = COALESCE($5, status_text),
               profile_photo_protection = COALESCE($6, profile_photo_protection),
               updated_at = now()
           WHERE id = $7
           RETURNING id, phone, email, username, display_name AS "displayName", avatar, bio,
                     status_text AS "statusText", profile_photo_protection AS "profilePhotoProtection"`,
          [displayName || null, username || null, avatar || null, bio || null, statusText || null, profilePhotoProtection || null, userId],
        );

        if (updateRes.rows[0]) {
          response.status(200).json({ success: true, user: publicUser(updateRes.rows[0]) });
          return;
        }
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw new ApiError(409, "USERNAME_TAKEN", "This username is already taken.");
        }
        if (err instanceof ApiError) throw err;
        logger.error({ errorName: err instanceof Error ? err.name : "UnknownError" }, "Failed to update user profile");
        throw new ApiError(503, "PROFILE_SERVICE_UNAVAILABLE", "Could not update your profile. Please try again.");
      }
    }

    // In-memory fallback
    if (token && inMemorySessions.has(token)) {
      const sess = inMemorySessions.get(token)!;
      for (const [phone, u] of inMemoryUsers.entries()) {
        if (u.id === sess.userId) {
          if (displayName) u.displayName = displayName;
          if (username) u.username = username;
          if (avatar) u.avatar = avatar;
          if (bio) u.bio = bio;
          if (statusText) u.statusText = statusText;
          if (profilePhotoProtection) u.profilePhotoProtection = profilePhotoProtection;
          inMemoryUsers.set(phone, u);
          response.status(200).json({ success: true, user: publicUser(u) });
          return;
        }
      }
    }

    throw new ApiError(401, "UNAUTHENTICATED", "Sign in to update profile.");
  });

  // 4. Standard Registration (Email & Password)
  router.post("/register", limiter, async (request, response) => {
    databaseRequired(database);
    const parsed = registrationSchema.safeParse(request.body);
    if (!parsed.success) throw validationError();

    const { email, username, displayName, password, avatar } = parsed.data;
    const baseUsername = email.split("@")[0]!.toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 20);
    const finalUsername = (username && username.trim()) || `${baseUsername || "user"}_${randomInt(1000, 9999)}`;
    const finalDisplayName = (displayName && displayName.trim()) || finalUsername;
    const finalAvatar = avatar || "/avatars/boy.png";
    const passwordHash = await hashPassword(password);

    const client = await database.connect();
    try {
      await client.query("BEGIN");
      const inserted = await client.query<PublicUser>(
        `INSERT INTO app_users (email, username, display_name, password_hash, avatar, bio)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, email, username, display_name AS "displayName", avatar, bio, status_text AS "statusText", profile_photo_protection AS "profilePhotoProtection"`,
        [email, finalUsername, finalDisplayName, passwordHash, finalAvatar, "Hey there! I am using ConnectSphere."],
      );
      const user = inserted.rows[0];
      if (!user) throw new Error("User insert returned no row.");
      const token = await createSession(client, user.id);
      await client.query("COMMIT");
      setSessionCookie(response, token, secureCookies);
      response.status(201).json({ user: publicUser(user) });
    } catch (error) {
      await client.query("ROLLBACK");
      if (isUniqueViolation(error)) {
        throw new ApiError(409, "ACCOUNT_ALREADY_EXISTS", "An account with those details already exists.");
      }
      throw error;
    } finally {
      client.release();
    }
  });

  // 5. Standard Login (Email & Password)
  router.post("/login", limiter, async (request, response) => {
    databaseRequired(database);
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) throw validationError();

    const { email, password } = parsed.data;

    const result = await database.query<PublicUser & StoredPassword>(
      `SELECT id, email, username, display_name AS "displayName", avatar, bio, status_text AS "statusText", profile_photo_protection AS "profilePhotoProtection", password_hash
       FROM app_users
       WHERE LOWER(email) = LOWER($1) OR LOWER(username) = LOWER($1)`,
      [email],
    );
    const stored = result.rows[0];
    const expectedHash = stored?.password_hash ?? await dummyPasswordHash;
    const passwordMatches = await verifyPassword(password, expectedHash);
    if (!stored || !passwordMatches) {
      throw new ApiError(401, "INVALID_CREDENTIALS", "Email or password is incorrect.");
    }

    const client = await database.connect();
    let token: string;
    try {
      await client.query("BEGIN");
      token = await createSession(client, stored.id);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    setSessionCookie(response, token, secureCookies);
    response.status(200).json({ user: publicUser(stored) });
  });

  // 5.1 Forgot Password (Generate Verification Code & Dispatch via Brevo)
  router.post("/forgot-password", limiter, async (request, response) => {
    databaseRequired(database);
    const parsed = forgotPasswordSchema.safeParse(request.body);
    if (!parsed.success) throw validationError();

    const { email } = parsed.data;

    const userRes = await database.query<{
      id: string;
      email: string;
      display_name: string | null;
      username: string | null;
    }>(
      `SELECT id, email, display_name, username
       FROM app_users
       WHERE LOWER(email) = LOWER($1)`,
      [email],
    );
    if (!userRes.rows[0]) {
      throw new ApiError(404, "USER_NOT_FOUND", "No account registered with this email address.");
    }

    const matchedUser = userRes.rows[0];
    const code = randomInt(100_000, 1_000_000).toString();
    resetCodesStore.set(email.toLowerCase(), {
      code,
      expiresAt: Date.now() + 15 * 60 * 1000,
    });

    const emailResult = await sendPasswordResetEmail({
      toEmail: matchedUser.email,
      recipientName: matchedUser.display_name || matchedUser.username || "ConnectSphere User",
      resetCode: code,
      logger,
    });

    if (!emailResult.success && process.env.NODE_ENV !== "test") {
      logger.error({ error: emailResult.error, toEmail: matchedUser.email }, "Brevo password reset dispatch failed");
      throw new ApiError(502, "EMAIL_DISPATCH_FAILED", `Could not send verification email to ${matchedUser.email}. ${emailResult.error || "Please try again later."}`);
    }

    response.status(200).json({
      success: true,
      message: `A 6-digit verification code has been dispatched to ${matchedUser.email}.`,
      brevoMessageId: emailResult.messageId,
    });
  });

  // 5.2 Reset Password (Verify Code & Update Password)
  router.post("/reset-password", limiter, async (request, response) => {
    databaseRequired(database);
    const parsed = resetPasswordSchema.safeParse(request.body);
    if (!parsed.success) throw validationError();

    const { email, code, newPassword } = parsed.data;

    const record = resetCodesStore.get(email.toLowerCase());
    if (!record || record.expiresAt < Date.now()) {
      throw new ApiError(400, "CODE_EXPIRED", "Verification code has expired or was not requested. Please try again.");
    }

    if (!tokenMatches(code, record.code)) {
      throw new ApiError(400, "INVALID_CODE", "Invalid 6-digit reset code. Please check and try again.");
    }

    const passwordHash = await hashPassword(newPassword);

    const client = await database.connect();
    let updatedUser: PublicUser;
    let token: string;
    try {
      await client.query("BEGIN");
      const updated = await client.query<PublicUser>(
        `UPDATE app_users
         SET password_hash = $1, updated_at = now()
         WHERE LOWER(email) = LOWER($2)
         RETURNING id, email, username, display_name AS "displayName", avatar, bio, status_text AS "statusText", profile_photo_protection AS "profilePhotoProtection"`,
        [passwordHash, email],
      );
      if (!updated.rows[0]) {
        throw new ApiError(404, "USER_NOT_FOUND", "Account not found.");
      }
      updatedUser = updated.rows[0];
      token = await createSession(client, updatedUser.id);
      await client.query("COMMIT");
      resetCodesStore.delete(email.toLowerCase());
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    setSessionCookie(response, token, secureCookies);
    response.status(200).json({
      success: true,
      user: publicUser(updatedUser),
      message: "Password reset successfully. You are now logged in.",
    });
  });

  // 6. Current User Me
  router.get("/me", async (request, response) => {
    const token = request.cookies?.[SESSION_COOKIE_NAME] as string | undefined;
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
      throw new ApiError(401, "UNAUTHENTICATED", "Sign in to continue.");
    }

    if (!database && process.env.NODE_ENV !== "test") databaseRequired(database);
    let user: PublicUser | undefined;
    if (database) {
      const result = await database.query<PublicUser>(
        `SELECT u.id, u.email, u.phone, u.username, u.display_name AS "displayName", u.avatar, u.bio,
                u.status_text AS "statusText", u.profile_photo_protection AS "profilePhotoProtection"
         FROM app_sessions s
         JOIN app_users u ON u.id = s.user_id
         WHERE s.token_hash = $1
           AND s.revoked_at IS NULL
           AND s.expires_at > now()`,
        [hashToken(token)],
      );
      user = result.rows[0];
    } else {
      const session = inMemorySessions.get(token);
      if (session && session.expiresAt > Date.now()) {
        user = Array.from(inMemoryUsers.values()).find((candidate) => candidate.id === session.userId);
      }
    }
    if (!user) throw new ApiError(401, "UNAUTHENTICATED", "Sign in to continue.");
    response.status(200).json({ user: publicUser(user) });
  });

  // 7. Logout
  router.post("/logout", async (request, response) => {
    const token = request.cookies?.[SESSION_COOKIE_NAME] as string | undefined;
    if (database && token && /^[A-Za-z0-9_-]{43}$/.test(token)) {
      await database.query(
        "UPDATE app_sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL",
        [hashToken(token)],
      );
    } else if (process.env.NODE_ENV !== "test" && !database) {
      clearSessionCookie(response, secureCookies);
      throw new ApiError(503, "SERVICE_UNAVAILABLE", "Account services are not configured.");
    }
    if (token) inMemorySessions.delete(token);
    clearSessionCookie(response, secureCookies);
    response.status(204).end();
  });

  // 8. Registered Users Directory for real contacts
  router.get("/users", async (_request, response) => {
    if (database) {
      const result = await database.query<PublicUser>(
        `SELECT id, phone, email, username, display_name AS "displayName", avatar, bio,
                status_text AS "statusText", profile_photo_protection AS "profilePhotoProtection"
         FROM app_users
         ORDER BY created_at DESC
         LIMIT 100`,
      );
      response.status(200).json({ users: result.rows.map(publicUser) });
      return;
    }
    if (process.env.NODE_ENV !== "test") databaseRequired(database);
    const users = Array.from(inMemoryUsers.values()).map(publicUser);
    response.status(200).json({ users });
  });

  // 9. Lookup user by phone or username (Verifies if user actually exists on platform)
  router.get("/lookup", async (request, response) => {
    const query = String(request.query["query"] || "").trim();
    if (!query) {
      response.status(400).json({ error: "Query parameter is required" });
      return;
    }
    if (!database && process.env.NODE_ENV !== "test") databaseRequired(database);
    const cleanDigits = query.replace(/\D/g, "");
    const phonePattern = cleanDigits.length >= 7 ? `%${cleanDigits.slice(-10)}%` : null;

    // Check database
    if (database) {
      const result = await database.query<PublicUser>(
        `SELECT id, phone, email, username, display_name AS "displayName", avatar, bio,
                status_text AS "statusText", profile_photo_protection AS "profilePhotoProtection"
         FROM app_users
         WHERE (LOWER(email) = LOWER($1))
            OR (LOWER(username) = LOWER($1))
            OR (LOWER(display_name) = LOWER($1))
            OR ($2::text IS NOT NULL AND phone LIKE $2)
         LIMIT 1`,
        [query.toLowerCase(), phonePattern],
      );
      if (result.rows[0]) {
        response.status(200).json({ exists: true, user: publicUser(result.rows[0]) });
        return;
      }
    }

    if (!database) {
      for (const u of inMemoryUsers.values()) {
        const uDigits = (u.phone || "").replace(/\D/g, "");
        const matchPhone = Boolean(phonePattern && cleanDigits && (uDigits.endsWith(cleanDigits) || cleanDigits.endsWith(uDigits)));
        const matchEmail = Boolean(u.email && u.email.toLowerCase() === query.toLowerCase());
        const matchUsername = u.username.toLowerCase() === query.toLowerCase();
        const matchName = u.displayName.toLowerCase() === query.toLowerCase();
        if (matchEmail || matchUsername || matchName || matchPhone) {
          response.status(200).json({ exists: true, user: publicUser(u) });
          return;
        }
      }
    }

    // Not found
    response.status(404).json({
      exists: false,
      message: `The user "${query}" is not registered on ConnectSphere yet.`,
    });
  });

  // 10. Quick Contact Provisioning (Instant chat with any contact or email)
  router.post("/quick-contact", async (request, response) => {
    if (!database && process.env.NODE_ENV !== "test") databaseRequired(database);
    const name = String(request.body.name || "").trim();
    if (!name) throw new ApiError(400, "NAME_REQUIRED", "Name is required.");

    const cleanUsername = name.toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 20) || `user_${Date.now().toString().slice(-4)}`;
    const email = name.includes("@") ? name.toLowerCase() : `${cleanUsername}@example.com`;

    const sampleAvatars = [
      "/avatars/boy.png",
      "/avatars/robot.png",
      "/avatars/cat.png",
      "/avatars/dog.png",
      "/avatars/fox.png",
      "/avatars/panda.png",
      "/avatars/lion.png",
    ];
    const avatar = sampleAvatars[Math.floor(Math.random() * sampleAvatars.length)]!;

    if (database) {
      const existing = await database.query<PublicUser>(
        `SELECT id, phone, email, username, display_name AS "displayName", avatar, bio,
                status_text AS "statusText", profile_photo_protection AS "profilePhotoProtection"
         FROM app_users
         WHERE LOWER(email) = LOWER($1) OR LOWER(username) = LOWER($2) OR LOWER(display_name) = LOWER($3)
         LIMIT 1`,
        [email, cleanUsername, name],
      );
      if (existing.rows[0]) {
        response.status(200).json({ user: publicUser(existing.rows[0]) });
        return;
      }

      const inserted = await database.query<PublicUser>(
        `INSERT INTO app_users (email, username, display_name, avatar, bio, status_text)
         VALUES ($1, $2, $3, $4, 'ConnectSphere contact', 'Available')
         RETURNING id, phone, email, username, display_name AS "displayName", avatar, bio,
                   status_text AS "statusText", profile_photo_protection AS "profilePhotoProtection"`,
        [email, cleanUsername, name, avatar],
      );
      response.status(201).json({ user: publicUser(inserted.rows[0]!) });
      return;
    }

    // In-memory
    const id = randomUUID();
    const newUser = {
      id,
      email,
      username: cleanUsername,
      displayName: name,
      avatar,
      bio: "ConnectSphere contact",
      statusText: "Available",
    };
    inMemoryUsers.set(cleanUsername, newUser);
    response.status(201).json({ user: newUser });
  });

  return router;
}
