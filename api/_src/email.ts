/**
 * Resend (resend.com) transactional email via REST — no SDK needed.
 * Without RESEND_API_KEY the message is logged instead of sent (returns
 * false) so invite flows still work locally; callers surface the link.
 */
export async function sendEmail({
  to,
  subject,
  html,
  text,
}: {
  to: string;
  subject: string;
  html: string;
  text: string;
}): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.log(`[email] RESEND_API_KEY unset — would send to ${to}: ${text}`);
    return false;
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM || 'TopDown <noreply@topdown.sh>',
        to: [to],
        subject,
        html,
        text,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      console.warn(`[email] resend failed ${res.status}: sending to ${to}`);
      await res.body?.cancel().catch(() => undefined);
      return false;
    }
    return true;
  } catch (error) {
    console.warn('[email] send failed', error);
    return false;
  }
}
