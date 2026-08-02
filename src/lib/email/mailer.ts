import nodemailer from "nodemailer";
import { env } from "@/lib/env";
import { renderNotificationEmail } from "@/lib/email/templates";

/**
 * Mailtrap SMTP only — development email sandbox, never a production
 * provider (see docs/security-boundaries.md). Every notification email
 * send is a safe no-op when unset, mirroring isSupabaseConfigured: the
 * in-app notification always exists regardless of whether email is
 * configured or delivery succeeds.
 */
export const isEmailConfigured = Boolean(
  env.MAILTRAP_HOST && env.MAILTRAP_PORT && env.MAILTRAP_USER && env.MAILTRAP_PASS && env.MAILTRAP_FROM_EMAIL,
);

let cachedTransport: ReturnType<typeof nodemailer.createTransport> | null = null;

function getTransport() {
  if (!isEmailConfigured) return null;
  if (!cachedTransport) {
    cachedTransport = nodemailer.createTransport({
      host: env.MAILTRAP_HOST,
      port: env.MAILTRAP_PORT,
      auth: { user: env.MAILTRAP_USER, pass: env.MAILTRAP_PASS },
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
      from: env.MAILTRAP_FROM_EMAIL,
      to,
      subject,
      text,
      html,
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Unknown email delivery error" };
  }
}
