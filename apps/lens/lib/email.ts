/**
 * Email via Resend — REST, and optional.
 * ─────────────────────────────────────────────────────────────────────
 *
 * No `resend` package: the send endpoint is one POST with a bearer token,
 * and a dependency for that is not worth the bundle or the version to keep
 * working. Same reasoning as lib/cloudinary.ts.
 *
 * OPTIONAL IS THE IMPORTANT PART. Every invite already works as a join
 * code and a link; email is a convenience on top. When RESEND_API_KEY is
 * absent `sendInvites` reports that plainly and the caller shows the link
 * to copy instead — a teacher at a booth with no key still gets students
 * into the class, which is the thing that actually has to work.
 *
 * Resend's shared `onboarding@resend.dev` sender needs no domain
 * verification but can only deliver to the address that owns the Resend
 * account. Any other recipient comes back 403. That is a real limit, not a
 * bug, and it is surfaced rather than swallowed so nobody spends the demo
 * wondering where the mail went.
 */

const ENDPOINT = "https://api.resend.com/emails";

const FROM = () =>
  process.env.RESEND_FROM || "LENS <onboarding@resend.dev>";

export function emailConfigured(): boolean {
  return !!process.env.RESEND_API_KEY;
}

export type InviteResult = {
  email: string;
  sent: boolean;
  error?: string;
};

function inviteHtml(input: {
  className: string;
  topic?: string | null;
  joinCode: string;
  joinUrl: string;
  fromName?: string | null;
}): string {
  const topic = input.topic
    ? `<p style="margin:0 0 18px;color:#4E5C69;font-size:15px;">First topic: <strong style="color:#0B1220;">${escapeHtml(input.topic)}</strong></p>`
    : "";
  return `<!doctype html>
<html><body style="margin:0;padding:24px;background:#F7F9FA;font-family:ui-sans-serif,system-ui,-apple-system,Inter,sans-serif;">
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:18px;padding:32px;border:1px solid #E3E9EC;">
    <p style="margin:0 0 6px;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#00897B;">LENS</p>
    <h1 style="margin:0 0 14px;font-size:22px;line-height:1.25;color:#0B1220;">
      ${escapeHtml(input.fromName || "Your teacher")} added you to ${escapeHtml(input.className)}
    </h1>
    <p style="margin:0 0 18px;color:#4E5C69;font-size:15px;line-height:1.55;">
      LENS is a tutor that never gives you the answer. It watches what you're
      actually working on and asks before it explains.
    </p>
    ${topic}
    <a href="${input.joinUrl}" style="display:inline-block;background:#00C2A8;color:#04121A;text-decoration:none;font-weight:600;font-size:15px;padding:12px 22px;border-radius:12px;">
      Join the class
    </a>
    <p style="margin:22px 0 0;color:#6F7E8C;font-size:13px;">
      Or enter this code after signing in:
      <strong style="color:#0B1220;letter-spacing:.18em;font-size:16px;">${escapeHtml(input.joinCode)}</strong>
    </p>
  </div>
</body></html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Send one invite per address. Sent in parallel and reported per-recipient
 * — one bad address must not decide the fate of the other twenty.
 */
export async function sendInvites(input: {
  emails: string[];
  className: string;
  topic?: string | null;
  joinCode: string;
  joinUrl: string;
  fromName?: string | null;
}): Promise<InviteResult[]> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    return input.emails.map((email) => ({
      email,
      sent: false,
      error: "RESEND_API_KEY is not set — share the join link or code instead.",
    }));
  }

  const html = inviteHtml(input);
  const subject = `You've been added to ${input.className} on LENS`;

  return Promise.all(
    input.emails.map(async (email): Promise<InviteResult> => {
      try {
        const res = await fetch(ENDPOINT, {
          method: "POST",
          headers: {
            authorization: `Bearer ${key}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ from: FROM(), to: [email], subject, html }),
          signal: AbortSignal.timeout(20_000),
        });

        if (res.ok) return { email, sent: true };

        const body = await res.text().catch(() => "");

        // Three failures are common enough to name, because Resend words
        // all of them in ways that point at the wrong thing.

        // 1. The shared sender only delivers to the account owner until a
        //    domain is verified. Reported as a 403 about "testing emails".
        if (res.status === 403 && /testing emails|own email address/i.test(body)) {
          return {
            email,
            sent: false,
            error:
              "Resend's shared sender only delivers to the address that owns the Resend account. Verify a domain and set RESEND_FROM to reach anyone else.",
          };
        }

        // 2. Reserved test domains (example.com, test.com) are refused as a
        //    422 validation error, which reads like a malformed address.
        if (res.status === 422 && /testing email address|domains like/i.test(body)) {
          return {
            email,
            sent: false,
            error: `${email} is on a reserved test domain that Resend refuses. Use a real address, or delivered@resend.dev to exercise the pipeline.`,
          };
        }

        // 3. A bad or revoked key.
        if (res.status === 401) {
          return {
            email,
            sent: false,
            error: "Resend rejected the API key — check RESEND_API_KEY.",
          };
        }

        return { email, sent: false, error: `Resend ${res.status}: ${body.slice(0, 140)}` };
      } catch (error) {
        return { email, sent: false, error: (error as Error).message.slice(0, 140) };
      }
    })
  );
}
