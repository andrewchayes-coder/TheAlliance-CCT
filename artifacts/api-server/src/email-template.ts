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

export const emailFooter = "You're receiving this because you serve with The Alliance Community Care Team.";
export const emailContactLine = `Questions? Email ${appConfig.volunteerContactName} at ${appConfig.volunteerContactEmail}.`;

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
  // Production startup validates APP_BASE_URL; development can infer it from a CTA.
  const baseUrl = process.env.APP_BASE_URL?.trim() || (ctas[0] ? new URL(ctas[0].url).origin : 'http://localhost:80');
  const logoUrl = `${baseUrl.replace(/\/$/, '')}/brand/logo-horizontal.png`;
  const button = ctas.map(cta => `
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0;">
      <tr><td bgcolor="#0175aa" style="border-radius:8px;">
        <a class="email-cta" href="${escapeHtml(cta.url)}" style="display:inline-block;min-height:20px;padding:14px 22px;color:#FFFFFF;background-color:#0175aa;border-radius:8px;font-size:15px;font-weight:700;text-decoration:none;">${escapeHtml(cta.label)}</a>
      </td></tr>
    </table>
    <p style="margin:0 0 20px;font-size:15px;line-height:1.6;overflow-wrap:anywhere;">If the button doesn’t open, this link will take you to the same place:<br>
      <a href="${escapeHtml(cta.url)}" style="color:#0175aa;word-break:break-all;">${escapeHtml(cta.url)}</a>
    </p>`).join('\n');
  return {
    html: `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(options.heading)}</title>
<style>.email-cta:hover{background-color:#06365D!important}.email-cta:focus{outline:3px solid #06365D;outline-offset:3px}@media only screen and (max-width:600px){.email-padding{padding:24px 16px!important}}</style>
</head>
<body style="margin:0;padding:0;background-color:#FFFFFF;color:#06365D;font-family:'Open Sans',Arial,sans-serif;font-size:17px;">
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${escapeHtml(options.preheader ?? options.paragraphs[0] ?? '')}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#FFFFFF"><tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background-color:#FFFFFF;">
      <tr><td class="email-padding" bgcolor="#FFFFFF" style="padding:28px 32px;border-bottom:4px solid #06365D;"><img src="${escapeHtml(logoUrl)}" alt="The Alliance Community Care Team" width="240" style="display:block;width:240px;max-width:100%;height:auto;"></td></tr>
      <tr><td class="email-padding" style="padding:32px;color:#06365D;font-family:'Open Sans',Arial,sans-serif;font-size:17px;line-height:1.55;">
        <h1 style="margin:0 0 24px;font-family:'Open Sans',Arial,sans-serif;font-size:28px;font-weight:700;line-height:1.3;color:#06365D;">${escapeHtml(options.heading)}</h1>
        ${paragraphs.map(paragraph => `<p style="margin:0 0 18px;">${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`).join('\n')}
        ${markdown?.html ?? ''}
        ${button}
      </td></tr>
      <tr><td class="email-padding" style="padding:24px 32px;border-top:1px solid #E6E6E6;color:#06365D;font-family:'Open Sans',Arial,sans-serif;font-size:15px;line-height:1.55;"><p>Questions? Email ${escapeHtml(appConfig.volunteerContactName)} at <a href="mailto:${escapeHtml(appConfig.volunteerContactEmail)}" style="color:#0175aa;">${escapeHtml(appConfig.volunteerContactEmail)}</a>.</p><p>${escapeHtml(appConfig.missionLine)}</p><p>${escapeHtml(emailFooter)}</p></td></tr>
    </table>
  </td></tr></table>
</body></html>`,
    text: [
      appConfig.appName, options.heading, ...paragraphs, ...(markdown ? [markdown.text] : []),
      ...ctas.map(cta => `${cta.label}: ${cta.url}`), emailContactLine, appConfig.missionLine, emailFooter,
    ].join('\n\n'),
  };
}
