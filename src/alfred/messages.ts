import { address, greeting } from "./voice";

/**
 * Alfred's sign-in messages. The same code reaches you by Telegram or email, so both carry his voice:
 * brief, composed, no drama. Clarity comes first; the personality is in the phrasing.
 */

export interface LoginCodeInput {
  /** What Alfred calls the user. */
  name: string;
  code: string;
  now: Date;
  ttlMinutes: number;
}

export interface LoginCodeMessages {
  subject: string;
  /** Plain-text email body, also the fallback for clients that do not show HTML. */
  text: string;
  html: string;
  /** Shorter wording for a chat bubble. */
  telegram: string;
}

const MINUTES: Record<number, string> = { 1: "one minute", 2: "two minutes", 3: "three minutes", 5: "five minutes", 10: "ten minutes" };
const minutes = (n: number) => MINUTES[n] ?? `${n} minutes`;

/** Escapes text for use inside HTML, so a name or code can never inject markup. */
export function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export function loginCodeMessages(input: LoginCodeInput): LoginCodeMessages {
  const hello = greeting(input.name, input.now);
  const ttl = minutes(input.ttlMinutes);

  // The sender name already says "Alfred"; a person would not sign their own subject line.
  const subject = `Your code, ${address(input.name, input.now)}`;

  const text = [
    hello,
    "",
    "Here is the code you asked for:",
    "",
    `    ${input.code}`,
    "",
    `It works once and expires in ${ttl}. If you did not ask to sign in, you may safely ignore this message. Nothing has been opened.`,
    "",
    "Alfred",
  ].join("\n");

  const telegram = `${hello} Your sign-in code is ${input.code}. It works once and expires in ${ttl}. If that was not you, simply ignore this.`;

  const code = escapeHtml(input.code);
  const html = `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:0;background:#f5f1e8;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(hello)} Your sign-in code is inside.</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f1e8;padding:24px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="width:100%;max-width:480px;background:#fffdf8;border:1px solid #ddd6c6;border-radius:16px;overflow:hidden;">
            <tr>
              <td style="background:#101a2e;padding:20px 28px;">
                <span style="display:inline-block;width:22px;height:22px;border-radius:50%;background:#2b6cde;background-image:radial-gradient(circle at 35% 30%,#8fb8ff,#2b6cde 55%,#16327a);vertical-align:middle;"></span>
                <span style="font-family:Georgia,'Times New Roman',serif;font-size:24px;color:#ffffff;vertical-align:middle;margin-left:10px;">Alfred</span>
              </td>
            </tr>
            <tr>
              <td style="padding:28px;font-family:Georgia,'Times New Roman',serif;color:#1b2433;">
                <p style="margin:0 0 16px;font-size:20px;line-height:1.3;">${escapeHtml(hello)}</p>
                <p style="margin:0 0 20px;font-size:16px;line-height:1.5;">Here is the code you asked for:</p>
                <p style="margin:0 0 24px;text-align:center;">
                  <span style="display:inline-block;padding:14px 22px;background:#f5f1e8;border:1px solid #c9a96a;border-radius:12px;font-family:'Courier New',monospace;font-size:32px;font-weight:bold;letter-spacing:6px;color:#101a2e;">${code}</span>
                </p>
                <p style="margin:0 0 20px;font-size:15px;line-height:1.5;color:#5b6372;">It works once and expires in ${escapeHtml(ttl)}. If you did not ask to sign in, you may safely ignore this message. Nothing has been opened.</p>
                <p style="margin:0;font-size:16px;font-style:italic;">Alfred</p>
              </td>
            </tr>
          </table>
          <p style="margin:16px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#7c8290;">Sent because someone asked to sign in to Alfred with this address.</p>
        </td>
      </tr>
    </table>
  </body>
</html>
`;

  return { subject, text, html, telegram };
}

export interface InvitationInput {
  /** What Alfred calls the person who invited them. */
  inviterName: string;
  /** Where to sign in, such as "https://alfred.example.workers.dev". */
  siteUrl: string;
  now: Date;
}

export interface InvitationMessages {
  subject: string;
  text: string;
  html: string;
}

/** The invitation email: what this is, how to begin, and that ignoring it is safe. */
export function invitationMessages(input: InvitationInput): InvitationMessages {
  const { inviterName, siteUrl } = input;
  const subject = `An invitation from ${inviterName}`;

  const text = [
    "Good day.",
    "",
    `${inviterName} has invited you to use me, a private ledger and assistant for your money: accounts, cards, spending and what is coming due.`,
    "",
    "To begin, open the link below, enter this email address, and I will send you a one-time code. There is no password to set.",
    "",
    `    ${siteUrl}`,
    "",
    "If you were not expecting this, you may ignore it. Nothing is created until you sign in.",
    "",
    "Alfred",
  ].join("\n");

  const html = `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:0;background:#f5f1e8;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(inviterName)} has invited you to Alfred.</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f1e8;padding:24px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="width:100%;max-width:480px;background:#fffdf8;border:1px solid #ddd6c6;border-radius:16px;overflow:hidden;">
            <tr>
              <td style="background:#101a2e;padding:20px 28px;">
                <span style="display:inline-block;width:22px;height:22px;border-radius:50%;background:#2b6cde;background-image:radial-gradient(circle at 35% 30%,#8fb8ff,#2b6cde 55%,#16327a);vertical-align:middle;"></span>
                <span style="font-family:Georgia,'Times New Roman',serif;font-size:24px;color:#ffffff;vertical-align:middle;margin-left:10px;">Alfred</span>
              </td>
            </tr>
            <tr>
              <td style="padding:28px;font-family:Georgia,'Times New Roman',serif;color:#1b2433;">
                <p style="margin:0 0 16px;font-size:20px;line-height:1.3;">Good day.</p>
                <p style="margin:0 0 16px;font-size:16px;line-height:1.5;">${escapeHtml(inviterName)} has invited you to use me, a private ledger and assistant for your money: accounts, cards, spending and what is coming due.</p>
                <p style="margin:0 0 24px;font-size:16px;line-height:1.5;">To begin, open the link below, enter this email address, and I will send you a one-time code. There is no password to set.</p>
                <p style="margin:0 0 24px;text-align:center;">
                  <a href="${escapeHtml(siteUrl)}" style="display:inline-block;padding:14px 24px;background:#1f5c47;color:#ffffff;border-radius:12px;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:bold;text-decoration:none;">Open Alfred</a>
                </p>
                <p style="margin:0 0 20px;font-size:15px;line-height:1.5;color:#5b6372;">If you were not expecting this, you may ignore it. Nothing is created until you sign in.</p>
                <p style="margin:0;font-size:16px;font-style:italic;">Alfred</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
`;

  return { subject, text, html };
}
