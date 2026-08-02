/**
 * One shared, plain, accessible template used for every notification
 * category — deliberately generic rather than one bespoke template per
 * event type. Never includes the notification's full body (which may
 * contain amounts or other specifics); only the non-sensitive title and
 * a sign-in link back to the app. The recipient sees the real detail
 * only after authenticating, when RLS re-applies.
 */

export interface NotificationEmailContent {
  title: string;
  actionUrl: string;
}

export function renderNotificationEmail({ title, actionUrl }: NotificationEmailContent): {
  subject: string;
  text: string;
  html: string;
} {
  const subject = title;

  const text = [
    "WealthCircle",
    "",
    title,
    "",
    `View this in WealthCircle: ${actionUrl}`,
    "",
    "You're receiving this because of activity in a WealthCircle group you belong to. Sign in to see the full detail — this email intentionally omits specifics.",
    "",
    "You can manage which email notifications you receive from your WealthCircle notification settings.",
  ].join("\n");

  const html = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:0;background-color:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f5;padding:24px 0;">
    <tr>
      <td align="center">
        <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:8px;overflow:hidden;">
          <tr>
            <td style="padding:24px 32px;border-bottom:1px solid #e4e4e7;">
              <span style="font-size:16px;font-weight:600;color:#18181b;">WealthCircle</span>
            </td>
          </tr>
          <tr>
            <td style="padding:32px;">
              <p style="margin:0 0 24px;font-size:16px;line-height:1.5;color:#18181b;">${escapeHtml(title)}</p>
              <a href="${escapeHtml(actionUrl)}"
                 style="display:inline-block;padding:10px 20px;background-color:#18181b;color:#ffffff;text-decoration:none;border-radius:6px;font-size:14px;font-weight:500;">
                View in WealthCircle
              </a>
            </td>
          </tr>
          <tr>
            <td style="padding:0 32px 32px;">
              <p style="margin:0;font-size:13px;line-height:1.5;color:#71717a;">
                You're receiving this because of activity in a WealthCircle group you belong to.
                Sign in to see the full detail — this email intentionally omits specifics.
                You can manage which email notifications you receive from your WealthCircle notification settings.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return { subject, text, html };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
