import nodemailer from "nodemailer";
import { env } from "@/lib/env";
import { renderNotificationEmail } from "@/lib/email/templates";
import { logger } from "@/lib/logger";

/**
 * Generic SMTP relay via nodemailer — Mailtrap's sandbox in development,
 * a real transactional provider in production (see
 * docs/security-boundaries.md; provider choice is a deliberate,
 * separately-approved decision, not made by this file). Every
 * notification email send is a safe no-op when unset, mirroring
 * isSupabaseConfigured: the in-app notification always exists
 * regardless of whether email is configured or delivery succeeds.
 */
export const isEmailConfigured = Boolean(
  env.EMAIL_SMTP_HOST && env.EMAIL_SMTP_PORT && env.EMAIL_SMTP_USER && env.EMAIL_SMTP_PASS && env.EMAIL_SMTP_FROM_EMAIL,
);

let cachedTransport: ReturnType<typeof nodemailer.createTransport> | null = null;

function getTransport() {
  if (!isEmailConfigured) return null;
  if (!cachedTransport) {
    cachedTransport = nodemailer.createTransport({
      host: env.EMAIL_SMTP_HOST,
      port: env.EMAIL_SMTP_PORT,
      auth: { user: env.EMAIL_SMTP_USER, pass: env.EMAIL_SMTP_PASS },
    });
  }
  return cachedTransport;
}

export interface SendNotificationEmailInput {
  to: string;
  title: string;
  actionUrl: string;
}

export interface SendEmailResult {
  ok: boolean;
  error?: string;
}

export async function sendNotificationEmail({ to, title, actionUrl }: SendNotificationEmailInput): Promise<SendEmailResult> {
  const transport = getTransport();
  if (!transport) {
    return { ok: false, error: "Email is not configured" };
  }

  const { subject, text, html } = renderNotificationEmail({ title, actionUrl });

  try {
    await transport.sendMail({
      from: env.EMAIL_SMTP_FROM_EMAIL,
      to,
      subject,
      text,
      html,
    });
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown email delivery error";
    // Deliberately no recipient address or subject in this log line —
    // the failure is already durably recorded per-notification in
    // notifications.email_error by the caller; this is just for
    // real-time ops visibility, not a second copy of who-got-what.
    logger.warn("Notification email delivery failed", { error: message });
    return { ok: false, error: message };
  }
}
