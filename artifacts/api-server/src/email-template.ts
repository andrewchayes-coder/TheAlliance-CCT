import { appConfig } from '@workspace/shared/appConfig';
import { renderMessageMarkdown } from '@workspace/shared/markdown';

export interface EmailTemplateOptions {
  heading: string;
  firstName?: string;
  paragraphs: string[];
  cta?: { label: string; url: string };
  ctas?: { label: string; url: string }[];
  preheader?: string;
  /** Raw Markdown; never untrusted HTML. */
  markdownBody?: string;
}

export const emailFooter = "You're receiving this because you volunteer with The Alliance's Resource Coordination Program.";

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]!);
}

/** Plain-text copy and HTML are generated together, with every CTA in both versions. */
export function createEmailTemplate(options: EmailTemplateOptions): { html: string; text: string } {
  const ctas = [...(options.cta ? [options.cta] : []), ...(options.ctas ?? [])];
  if (ctas.some(cta => !['http:', 'https:'].includes(new URL(cta.url).protocol))) {
    throw new Error('Email CTA URLs must use http or https.');
  }
  const greeting = options.firstName?.trim() ? `Hi ${options.firstName.trim()},` : undefined;
  const paragraphs = [...(greeting ? [greeting] : []), ...options.paragraphs];
  const markdown = options.markdownBody ? renderMessageMarkdown(options.markdownBody) : null;
  const button = ctas.map(cta => `
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0;">
      <tr><td bgcolor="#02928F" style="border-radius:8px;">
        <a href="${escapeHtml(cta.url)}" style="display:inline-block;padding:14px 22px;color:#FFFFFF;background-color:#02928F;border-radius:8px;font-size:16px;font-weight:700;text-decoration:none;">${escapeHtml(cta.label)}</a>
      </td></tr>
    </table>
    <p style="margin:0 0 20px;font-size:14px;line-height:1.6;overflow-wrap:anywhere;">If the button doesn't open, use this link:<br>
      <a href="${escapeHtml(cta.url)}" style="color:#027A77;word-break:break-all;">${escapeHtml(cta.url)}</a>
    </p>`).join('\n');
  return {
    html: `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(options.heading)}</title>
<style>@media only screen and (max-width:600px){.email-padding{padding:24px 16px!important}}</style>
</head>
<body style="margin:0;padding:0;background-color:#FFFFFF;color:#06365D;font-family:'Open Sans',Arial,sans-serif;font-size:16px;">
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${escapeHtml(options.preheader ?? options.paragraphs[0] ?? '')}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#FFFFFF"><tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background-color:#FFFFFF;">
      <tr><td class="email-padding" bgcolor="#06365D" style="padding:28px 32px;color:#FFFFFF;font-family:'Open Sans',Arial,sans-serif;font-size:18px;font-weight:700;letter-spacing:1px;">${escapeHtml(appConfig.appName.toUpperCase())}</td></tr>
      <tr><td class="email-padding" style="padding:32px;color:#06365D;font-family:'Open Sans',Arial,sans-serif;font-size:16px;line-height:1.6;">
        <h1 style="margin:0 0 24px;font-size:24px;line-height:1.3;color:#06365D;">${escapeHtml(options.heading)}</h1>
        ${paragraphs.map(paragraph => `<p style="margin:0 0 18px;">${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`).join('\n')}
        ${markdown?.html ?? ''}
        ${button}
      </td></tr>
      <tr><td class="email-padding" style="padding:24px 32px;border-top:1px solid #E6E6E6;color:#06365D;font-family:'Open Sans',Arial,sans-serif;font-size:13px;line-height:1.6;">${escapeHtml(emailFooter)}</td></tr>
    </table>
  </td></tr></table>
</body></html>`,
    text: [
      appConfig.appName.toUpperCase(), options.heading, ...paragraphs, ...(markdown ? [markdown.text] : []),
      ...ctas.map(cta => `${cta.label}: ${cta.url}`), emailFooter,
    ].join('\n\n'),
  };
}
