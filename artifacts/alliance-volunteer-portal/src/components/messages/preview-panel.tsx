import { useEffect, useRef, useState } from 'react';
import type { MessagePreview } from '@workspace/api-client-react';
import { renderMessageMarkdown } from '@workspace/shared/markdown';
import { Button } from '@/components/brand-system';
import { MarkdownView } from './markdown-view';

export function PreviewPanel({ preview, subject, body, byEmail, busy, onSend }: {
  preview: MessagePreview; subject: string; body: string; byEmail: boolean; busy: boolean; onSend: () => void;
}) {
  const [confirm, setConfirm] = useState(false);
  const yes = useRef<HTMLButtonElement>(null);
  const openBtn = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (confirm) yes.current?.focus(); }, [confirm]);
  const none = preview.recipientCount === 0;
  const shown = renderMessageMarkdown(body).text.length > 0;
  return (
    <section className="alliance-card mt-5" aria-labelledby="pv-h" data-testid="panel-preview">
      <h2 id="pv-h" className="alliance-display">Preview</h2>
      <p className="mt-2 font-bold" data-testid="text-recipient-count">{none ? 'This reaches no one. Change the audience before sending.' : `This will reach ${preview.recipientCount} volunteer${preview.recipientCount === 1 ? '' : 's'}.`}</p>
      <p className="text-sm">{byEmail ? 'Also emailed to each recipient.' : 'In-portal only. No email is sent.'}</p>
      <div className="mt-3 rounded-lg border border-gray bg-white p-4">
        <p className="text-xs font-bold text-navy-soft">Subject</p>
        <p className="font-bold" data-testid="text-preview-subject">{subject}</p>
        <div className="mt-3 border-t border-gray pt-3">{shown ? <MarkdownView body={body} testId="text-preview-body" /> : null}</div>
      </div>
      {preview.recipients.length > 0 && (
        <details className="mt-3"><summary className="min-h-11 cursor-pointer py-2 font-bold text-blue">Recipient list ({preview.recipients.length})</summary>
          <ul className="max-h-60 divide-y divide-gray overflow-y-auto text-sm">
            {preview.recipients.map(r => <li key={r.userId} className="py-2"><span className="font-bold">{r.firstName} {r.lastName}</span> <span className="break-all text-navy-soft">{r.email}</span></li>)}
          </ul></details>
      )}
      {!confirm ? (
        <Button ref={openBtn} type="button" className="mt-4" disabled={none || busy} onClick={() => setConfirm(true)} data-testid="button-send-start">Send message</Button>
      ) : (
        <div role="alertdialog" aria-label="Confirm send" className="mt-4 rounded-lg bg-gray p-4" data-testid="confirm-send">
          <p className="font-bold">Send to {preview.recipientCount} volunteer{preview.recipientCount === 1 ? '' : 's'}? This cannot be undone.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button ref={yes} type="button" disabled={busy} onClick={() => { onSend(); setConfirm(false); }} data-testid="button-send-confirm">Yes, send now</Button>
            <Button type="button" variant="secondary" disabled={busy} onClick={() => { setConfirm(false); setTimeout(() => openBtn.current?.focus(), 0); }} data-testid="button-send-cancel">Cancel</Button>
          </div>
        </div>
      )}
    </section>
  );
}
