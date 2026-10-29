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
  /** What to call the invitee, when the inviter said. */
  name?: string | null | undefined;
  /** Where to sign in, such as "https://alfred.example.workers.dev". */
  siteUrl: string;
  now: Date;
}

export interface InvitationMessages {
  subject: string;
  text: string;
  html: string;
}

/** The invitation, written by Alfred to the new person: who he is, what he does, and how to begin. */
export function invitationMessages(input: InvitationInput): InvitationMessages {
  const { inviterName, siteUrl } = input;
  const hello = input.name?.trim() ? `Good day, ${input.name.trim()}.` : "Good day.";
  const subject = `An invitation from ${inviterName}`;

  const intro = `${inviterName} has arranged for you to have a ledger of your own, and has asked me to attend to it. I am Alfred, and I am pleased to make your acquaintance.`;
  const about =
    "Think of me as a household manager for your money. I record what comes in and goes out, watch for payments falling due, and tell you plainly where things stand. Your ledger is private, visible to no one but me, and I have yet to repeat anything to anyone.";
  const begin =
    "Beginning takes about two minutes. Open the link below, enter this address, and I will send you a one-time code. There is no password to remember. I find them tiresome as well. Then I will guide you from there.";
  const safety = "If this has reached you in error, please disregard it. Nothing is set up until you sign in.";

  const text = [hello, "", intro, "", about, "", begin, "", `    ${siteUrl}`, "", safety, "", "At your service,", "Alfred"].join("\n");

  const html = `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:0;background:#f5f1e8;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(hello)} ${escapeHtml(inviterName)} has arranged a ledger for you.</div>
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
                <p style="margin:0 0 16px;font-size:16px;line-height:1.5;">${escapeHtml(intro)}</p>
                <p style="margin:0 0 16px;font-size:16px;line-height:1.5;">${escapeHtml(about)}</p>
                <p style="margin:0 0 24px;font-size:16px;line-height:1.5;">${escapeHtml(begin)}</p>
                <p style="margin:0 0 24px;text-align:center;">
                  <a href="${escapeHtml(siteUrl)}" style="display:inline-block;padding:14px 24px;background:#1f5c47;color:#ffffff;border-radius:12px;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:bold;text-decoration:none;">Open Alfred</a>
                </p>
                <p style="margin:0 0 20px;font-size:15px;line-height:1.5;color:#5b6372;">${escapeHtml(safety)}</p>
                <p style="margin:0;font-size:16px;line-height:1.5;font-style:italic;">At your service,<br />Alfred</p>
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
