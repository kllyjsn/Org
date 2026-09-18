import type { Notice } from './compose.js';

export function toSlackPayload(notice: Notice): {
  text: string;
  blocks: Record<string, unknown>[];
} {
  return {
    text: `${notice.title}\n${notice.lines.join('\n')}`,
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: notice.title.slice(0, 150) },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: notice.lines.join('\n').slice(0, 3000),
        },
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: notice.ctaLabel },
            url: notice.ctaUrl,
          },
        ],
      },
    ],
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function toEmail(notice: Notice): {
  subject: string;
  html: string;
  text: string;
} {
  const subject = `TopDown — ${notice.title}`;
  const items = notice.lines
    .map((line) => `<li style="margin:4px 0">${escapeHtml(line)}</li>`)
    .join('');
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f8fafc;font-family:-apple-system,Segoe UI,Roboto,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;padding:24px">
<tr><td>
  <h1 style="font-size:16px;margin:0 0 12px;color:#0f172a">${escapeHtml(notice.title)}</h1>
  <ul style="margin:0 0 16px;padding-left:18px;color:#475569;font-size:13px;line-height:1.6">${items}</ul>
  <a href="${escapeHtml(notice.ctaUrl)}" style="display:inline-block;background:#5b4cf0;color:#ffffff;text-decoration:none;font-size:13px;font-weight:600;padding:10px 18px;border-radius:8px">${escapeHtml(notice.ctaLabel)}</a>
</td></tr></table>
</td></tr></table></body></html>`;
  const text = `${notice.title}\n\n${notice.lines.join('\n')}\n\n${notice.ctaLabel}: ${notice.ctaUrl}`;
  return { subject, html, text };
}
