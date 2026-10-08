import { Download, ExternalLink, FileText, Link2, Newspaper } from 'lucide-react';

export const fileUrl = (id: string) => `/api/resources/${encodeURIComponent(id)}/file`;
export const isPdf = (mime?: string | null, name?: string | null) => mime === 'application/pdf' || /\.pdf$/i.test(name ?? '');

export function TypeIcon({ type, size = 18 }: { type: string; size?: number }) {
  const I = type === 'article' ? Newspaper : type === 'link' ? Link2 : FileText;
  return <I size={size} aria-hidden="true" />;
}

/** Private downloads: native anchors only, never storage keys. */
export function FileActions({ id, mime, name }: { id: string; mime?: string | null; name?: string | null }) {
  const pdf = isPdf(mime, name);
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {pdf && (
        <a href={fileUrl(id)} target="_blank" rel="noopener noreferrer" className="alliance-button alliance-button-secondary" data-testid={`link-view-${id}`}>
          View PDF<ExternalLink size={14} aria-hidden="true" /><span className="sr-only"> (opens in a new tab)</span>
        </a>
      )}
      <a href={`${fileUrl(id)}?download=1`} className="alliance-button alliance-button-secondary" data-testid={`link-download-${id}`}>
        Download<Download size={14} aria-hidden="true" /><span className="sr-only"> {name ?? 'file'}</span>
      </a>
    </div>
  );
}
