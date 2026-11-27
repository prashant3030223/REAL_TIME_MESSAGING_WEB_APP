import type { AppLogger } from "./logger.js";

export type BrevoSendEmailOptions = {
  toEmail: string;
  recipientName?: string;
  resetCode: string;
  logger?: AppLogger;
};

export type BrevoSendResult = {
  success: boolean;
  messageId?: string | undefined;
  error?: string | undefined;
  devCode?: string | undefined;
};

const BREVO_API_URL = "https://api.brevo.com/v3/smtp/email";

export function getBrevoConfiguration() {
  const apiKey = process.env.BREVO_API_KEY?.trim();
  const senderEmail = process.env.BREVO_SENDER_EMAIL?.trim() || "no-reply@connectsphere.io";
  const senderName = process.env.BREVO_SENDER_NAME?.trim() || "ConnectSphere";

  return {
    apiKey,
    senderEmail,
    senderName,
  };
}

/**
 * Generates a modern, responsive, branded HTML email for password reset
 */
export function generatePasswordResetEmailHtml(name: string, code: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ConnectSphere Password Reset</title>
</head>
<body style="margin: 0; padding: 0; background-color: #06090e; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #e2e8f0;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #06090e; padding: 40px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width: 520px; background-color: #0f172a; border-radius: 16px; border: 1px solid rgba(255, 255, 255, 0.08); padding: 36px 28px; box-shadow: 0 12px 40px rgba(0, 0, 0, 0.6);">
          <!-- Brand Header -->
          <tr>
            <td align="center" style="padding-bottom: 24px;">
              <table role="presentation" cellspacing="0" cellpadding="0">
                <tr>
                  <td align="center">
                    <div style="width: 48px; height: 48px; line-height: 48px; border-radius: 12px; background: linear-gradient(135deg, #00a884, #007f63); color: #ffffff; font-size: 24px; font-weight: 800; text-align: center; box-shadow: 0 4px 16px rgba(0, 168, 132, 0.35);">
                      C
                    </div>
                  </td>
                </tr>
                <tr>
                  <td align="center" style="padding-top: 12px;">
                    <h1 style="margin: 0; color: #ffffff; font-size: 22px; font-weight: 700; letter-spacing: -0.4px;">
                      ConnectSphere<span style="color: #00a884;">•</span>
                    </h1>
                    <p style="margin: 4px 0 0; color: #94a3b8; font-size: 13px; font-weight: 500;">
                      Password Reset Verification
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Message Body -->
          <tr>
            <td style="color: #cbd5e1; font-size: 14px; line-height: 1.6; padding-bottom: 24px; border-top: 1px solid rgba(255, 255, 255, 0.06); padding-top: 24px;">
              <p style="margin: 0 0 12px;">Hello <strong style="color: #ffffff;">${name}</strong>,</p>
              <p style="margin: 0;">We received a request to reset your password for your ConnectSphere account. Use the 6-digit verification code below to securely reset your credentials:</p>
            </td>
          </tr>

          <!-- Code Box -->
          <tr>
            <td align="center" style="padding-bottom: 24px;">
              <div style="background: rgba(0, 168, 132, 0.1); border: 1px solid rgba(0, 168, 132, 0.35); border-radius: 12px; padding: 18px 24px; text-align: center; max-width: 320px;">
                <span style="font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 34px; font-weight: 800; letter-spacing: 8px; color: #00c69d; display: block;">
                  ${code}
                </span>
                <span style="font-size: 12px; color: #94a3b8; display: block; margin-top: 8px;">
                  ⏱ Valid for 15 minutes
                </span>
              </div>
            </td>
          </tr>

          <!-- Security Callout -->
          <tr>
            <td style="background-color: rgba(255, 255, 255, 0.03); border-radius: 10px; padding: 14px 16px; color: #94a3b8; font-size: 12px; line-height: 1.5; border-left: 3px solid #00a884;">
              <strong style="color: #e2e8f0;">Security Notice:</strong> Never share this code with anyone. ConnectSphere support will never ask for your verification code. If you did not initiate this request, your account is still secure and you can disregard this email.
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td align="center" style="padding-top: 28px; margin-top: 24px; border-top: 1px solid rgba(255, 255, 255, 0.06); color: #64748b; font-size: 11.5px;">
              <p style="margin: 0 0 4px;">&copy; ${new Date().getFullYear()} ConnectSphere Inc. All rights reserved.</p>
              <p style="margin: 0;">Enterprise Real-Time Communication & Collaboration</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/**
 * Sends a password reset email using the Brevo (Sendinblue) Transactional API
 */
export async function sendPasswordResetEmail({
  toEmail,
  recipientName = "ConnectSphere User",
  resetCode,
  logger,
}: BrevoSendEmailOptions): Promise<BrevoSendResult> {
  const config = getBrevoConfiguration();

  // Test mode: Simulated success without external network call
  if (process.env.NODE_ENV === "test") {
    logger?.info({ toEmail, resetCode }, "Test environment: Simulated Brevo email dispatch");
    return { success: true, messageId: "test_mock_brevo_msgid", devCode: resetCode };
  }

  // Graceful fallback when BREVO_API_KEY is not yet populated
  if (!config.apiKey) {
    logger?.warn(
      { toEmail, resetCode },
      "BREVO_API_KEY is not set in environment. Set BREVO_API_KEY in .env to dispatch live emails via Brevo.",
    );
    return {
      success: true,
      error: "BREVO_API_KEY not configured. Verification code logged.",
      devCode: resetCode,
    };
  }

  const htmlContent = generatePasswordResetEmailHtml(recipientName, resetCode);
  const textContent = `Hello ${recipientName},\n\nYour ConnectSphere password reset verification code is: ${resetCode}\n\nThis verification code expires in 15 minutes.\n\nIf you did not request this password reset, please ignore this email.\n\n- ConnectSphere Team`;

  const payload = {
    sender: {
      name: config.senderName,
      email: config.senderEmail,
    },
    to: [
      {
        email: toEmail,
        name: recipientName,
      },
    ],
    subject: `ConnectSphere Password Reset Code: ${resetCode}`,
    htmlContent,
    textContent,
  };

  logger?.info({ toEmail, senderEmail: config.senderEmail }, "Dispatching password reset email via Brevo API");

  try {
    const response = await fetch(BREVO_API_URL, {
      method: "POST",
      headers: {
        "api-key": config.apiKey,
        "Content-Type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify(payload),
    });

    const responseData = (await response.json().catch(() => null)) as {
      messageId?: string;
      message?: string;
      code?: string;
    } | null;

    if (!response.ok) {
      const errorMsg = responseData?.message || `Brevo API HTTP ${response.status}`;
      logger?.error(
        { status: response.status, error: errorMsg, toEmail },
        "Brevo API rejected transactional email",
      );
      return {
        success: false,
        error: errorMsg,
      };
    }

    logger?.info(
      { toEmail, messageId: responseData?.messageId },
      "Successfully sent password reset email via Brevo",
    );

    return {
      success: true,
      messageId: responseData?.messageId,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : "Network error contacting Brevo API";
    logger?.error({ error: errorMsg, toEmail }, "Failed to reach Brevo API");
    return {
      success: false,
      error: errorMsg,
    };
  }
}
