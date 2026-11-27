import type { AppLogger } from "./logger.js";

export type SmsSendResult = {
  success: boolean;
  msgId?: string | undefined;
  error?: string | undefined;
  otp?: string | undefined;
  carrierStatus?: string | undefined;
  carrierError?: string | undefined;
  raw?: unknown;
};

const SMS_HORIZON_API_URL = "https://smshorizon.com/api/v2/sendsms";

function getSmsConfiguration() {
  const token = process.env.SMS_HORIZON_TOKEN?.trim();
  const user = process.env.SMS_HORIZON_USER?.trim();
  const senderId = process.env.SMS_HORIZON_SENDER_ID?.trim();
  const templateId = process.env.SMS_HORIZON_TID?.trim();

  if (!token || !user || !senderId || !templateId) {
    return null;
  }
  return { token, user, senderId, templateId };
}

/**
 * Normalizes phone numbers for SMS Horizon.
 * Strips non-digits and removes common country prefixes while preserving the local dialable number.
 */
export function normalizePhoneNumber(rawPhone: string): string {
  const digits = rawPhone.replace(/\D/g, "");

  if (digits.length === 12 && digits.startsWith("91")) {
    return digits.slice(2);
  }

  if (digits.length === 11 && digits.startsWith("0")) {
    return digits.slice(1);
  }

  return digits;
}

/**
 * Sends a 6-digit OTP SMS via the SMS Horizon API
 */
export async function sendSmsOtp(
  phone: string,
  otp: string,
  logger?: AppLogger,
): Promise<SmsSendResult> {
  if (process.env.NODE_ENV === "test") {
    return { success: true, msgId: "test_mock_msgid", otp };
  }

  const configuration = getSmsConfiguration();
  if (!configuration) {
    return {
      success: false,
      error: "SMS delivery is not configured. Set SMS_HORIZON_TOKEN, SMS_HORIZON_USER, SMS_HORIZON_SENDER_ID, and SMS_HORIZON_TID.",
    };
  }

  const SMS_HORIZON_TOKEN = configuration.token;
  const normalizedNumber = normalizePhoneNumber(phone);

  // Exact registered DLT template message format:
  // "OTP for your new user account registration is: {#var#}\n\n- SmsHorizon"
  const message = `OTP for your new user account registration is: ${otp}\n\n- SmsHorizon`;

  const params = new URLSearchParams({
    user: configuration.user,
    number: normalizedNumber,
    mobile: normalizedNumber,
    senderid: configuration.senderId,
    message: message,
    type: "txt",
    tid: configuration.templateId,
    prettyprint: "1",
  });

  logger?.info({ phone: normalizedNumber, tid: configuration.templateId }, "Dispatching OTP SMS via SMS Horizon");

  try {
    const response = await fetch(SMS_HORIZON_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${configuration.token}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });

    const responseText = await response.text();
    let parsed: any;
    try {
      parsed = JSON.parse(responseText);
    } catch {
      parsed = { raw: responseText };
    }

    if (!response.ok || parsed?.error || !parsed?.msgid) {
      const errorMsg = parsed?.error ? String(parsed.error) : `SMS Gateway Error (${response.status})`;
      logger?.warn({ status: response.status, response: parsed }, "SMS Horizon API returned error");

      // In unit test environment only, permit mock fallback so tests don't drain real SMS quota
      return {
        success: false,
        error: errorMsg,
        otp,
        raw: parsed,
      };
    }

    const msgId = String(parsed.msgid);
    logger?.info({ msgId, balanceAfter: parsed?.balance_after }, "SMS successfully dispatched by gateway");

    // Check immediate carrier delivery feedback from SMS Horizon
    let carrierStatus: string | undefined;
    let carrierError: string | undefined;

    try {
      const statusRes = await fetch("https://smshorizon.co.in/api/v2/status.php", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${SMS_HORIZON_TOKEN}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          user: configuration.user,
          msgid: msgId,
        }).toString(),
      });
      if (statusRes.ok) {
        const sData = (await statusRes.json()) as any;
        carrierStatus = sData?.status;
        carrierError = sData?.error_desc || sData?.error_code;
        logger?.info({ msgId, carrierStatus, carrierError }, "SMS Horizon carrier status checked");
      }
    } catch (error) {
      logger?.warn(
        { errorName: error instanceof Error ? error.name : "UnknownError" },
        "Could not check SMS carrier status",
      );
    }

    return {
      success: true,
      msgId,
      carrierStatus,
      carrierError,
      otp,
      raw: parsed,
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : "Network error";
    logger?.error({ error: errMsg }, "Failed to connect to SMS Horizon API");

    return {
      success: false,
      error: errMsg,
      otp,
    };
  }
}
