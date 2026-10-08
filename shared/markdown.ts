/** Intentionally small Markdown subset. Raw HTML is always escaped. */
export const escapeHtml = (value: string) => value.replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[c]!);
export function safeMessageLink(value: string): string | null {
  try {
    const url = new URL(value.trim());
    return ['https:', 'http:', 'mailto:'].includes(url.protocol) ? url.href : null;
  } catch { return null; }
}
function inline(text: string): string {
  const pattern = /(\*\*([^*\n]+)\*\*|\[([^\]\n]+)\]\(([^)\n]+)\))/g;
  let result = '', end = 0;
  for (const match of text.matchAll(pattern)) {
    result += escapeHtml(text.slice(end, match.index));
    if (match[2]) result += `<strong>${escapeHtml(match[2])}</strong>`;
    else {
      const href = safeMessageLink(match[4]!);
      result += href ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer" style="color:#027A77;text-decoration:underline;">${escapeHtml(match[3]!)}</a>` : escapeHtml(match[3]!);
    }
    end = match.index! + match[0].length;
  }
  return result + escapeHtml(text.slice(end));
}
export function renderMessageMarkdown(body: string): { html: string; text: string } {
  const lines = body.replace(/\r\n?/g, '\n').split('\n');
  const blocks: string[] = []; let list: string | null = null;
  for (const line of lines) {
    const item = line.match(/^\s*(?:([-*])|(\d+)\.)\s+(.+)$/);
    const kind = item ? item[2] ? 'ol' : 'ul' : null;
    if (list && list !== kind) { blocks.push(`</${list}>`); list = null; }
    if (item) {
      if (!list) { list = kind; blocks.push(`<${list} style="margin:0 0 18px;padding-left:24px;">`); }
      blocks.push(`<li>${inline(item[3]!)}</li>`);
    } else if (line.trim()) blocks.push(`<p style="margin:0 0 12px;overflow-wrap:anywhere;">${inline(line)}</p>`);
  }
  if (list) blocks.push(`</${list}>`);
  return { html: blocks.join('\n'), text: body.replace(/\*\*([^*\n]+)\*\*/g, '$1').replace(/\[([^\]\n]+)\]\(([^)\n]+)\)/g,
    (_m, label: string, href: string) => safeMessageLink(href) ? `${label} (${href.trim()})` : label) };
}
