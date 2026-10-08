import { renderMessageMarkdown } from '@workspace/shared/markdown';

/** Renders the shared, escaping Markdown subset. Server-supplied html is never trusted. */
export function MarkdownView({ body, className = '', testId }: { body: string; className?: string; testId?: string }) {
  const { html } = renderMessageMarkdown(body);
  return <div className={`break-words text-navy [&_a]:font-bold [&_li]:mb-1 [&_ol]:list-decimal [&_ul]:list-disc ${className}`} data-testid={testId} dangerouslySetInnerHTML={{ __html: html }} />;
}

export const MD_HELP = 'Formatting: **bold**, [link text](https://example.org), lines starting with "- " for bullets or "1. " for numbers. Raw HTML is shown as plain text.';
