import { appConfig } from '@workspace/shared/appConfig';
import { useState } from 'react';
import { useAuth, readError } from '@/auth/auth-context';
import { useCreateResource, useUpdateResource, type ResourceItem, type ResourceInput, type ResourceContext } from '@workspace/api-client-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button, Input } from '@/components/brand-system';
import { Notice } from '@/auth/auth-ui';
import { ResourceMarkdown as MarkdownView } from './resource-markdown';
import { useResourceRefresh } from './use-resource-refresh';
import { AGREEMENT_TITLES, MAX_FILE, fileError, httpsError, isAgreementCat } from './validate';

type T = 'document' | 'article' | 'link';
const MD_HELP = 'Markdown: # headings, **bold**, links and bullet or numbered lists. HTML and embedded images are not enabled.';
const lbl = 'mb-1 block text-sm font-bold';
const area = 'alliance-input';

export function ResourceEditor({ type, item, ctx, onClose }: { type: T; item: ResourceItem | null; ctx?: ResourceContext; onClose: () => void }) {
  const auth = useAuth();
  const refresh = useResourceRefresh();
  const create = useCreateResource({ request: auth.request });
  const update = useUpdateResource({ request: auth.request });
  const [f, setF] = useState({
    title: item?.title ?? '', category: item?.category ?? '', summary: item?.summary ?? '', body: item?.body ?? '',
    url: item?.url ?? item?.href ?? '', isQuickLink: item?.isQuickLink ?? false, isPublished: item?.isPublished ?? false, bump: false,
  });
  const [file, setFile] = useState<File | null>(null);
  const [fileErr, setFileErr] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF(p => ({ ...p, [k]: v }));
  const agree = isAgreementCat(f.category);

  function problem(): string | null {
    if (!f.title.trim()) return 'Add a title.';
    if (!f.category.trim()) return 'Add a category.';
    if (agree) {
      if (type === 'link') return 'The Agreements category can’t be used for links.';
      const ex = item && item.category.toLowerCase() === 'agreements' && item.title === f.title.trim();
      if (!ex && !AGREEMENT_TITLES.includes(f.title.trim().toLowerCase())) return 'In the Agreements category, the title must be “User Agreement” or “Safety Guidelines”.';
    }
    if (type === 'link') { const e = httpsError(f.url); if (e) return e; }
    if (type === 'article' && !f.body.trim()) return 'Write the article body.';
    if (type === 'document') { if (!item && !file) return 'Choose a PDF or DOCX file.'; if (file) return fileError(file); }
    return null;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null); setOk(null);
    const p = problem();
    if (p) { setErr(p); return; }
    const meta: ResourceInput = {
      type, title: f.title.trim(), category: f.category.trim(), summary: f.summary.trim(),
      body: type === 'article' ? f.body : '', url: type === 'link' ? f.url.trim() : '',
      isQuickLink: type === 'link' && f.isQuickLink, isPublished: f.isPublished, bumpAgreementVersion: agree && appConfig.requireAgreementAcknowledgment && f.bump,
    };
    const data = { metadata: JSON.stringify(meta), ...(type === 'document' && file ? { file } : {}) };
    setBusy(true);
    try {
      const r = item ? await update.mutateAsync({ id: item.id, data }) : await create.mutateAsync({ data });
      await refresh(r.resource.id).catch(() => undefined);
      if (r.bumped) { setOk(`Saved. Agreement version is now ${r.agreementVersion}. Current members must re-acknowledge.`); setF(p2 => ({ ...p2, bump: false })); }
      else onClose();
    } catch (x) { setErr(readError(x, 'We couldn’t save this. Your changes are still here.').message); }
    finally { setBusy(false); }
  }

  const name = { document: 'document', article: 'article', link: 'quick link' }[type];
  return (
    <Dialog open onOpenChange={o => { if (!o && !busy) onClose(); }}>
      <DialogContent className={`max-h-[92dvh] overflow-y-auto ${type === 'article' ? 'sm:max-w-5xl' : 'sm:max-w-xl'}`}>
        <DialogHeader><DialogTitle>{item ? 'Edit' : 'New'} {name}</DialogTitle><DialogDescription>Volunteers only see this once it is published.</DialogDescription></DialogHeader>
        <form onSubmit={e => { void submit(e); }} className="grid gap-4" noValidate>
          {err && <Notice>{err}</Notice>}
          {ok && <Notice kind="success">{ok}</Notice>}
          <div><label className={lbl} htmlFor="r-title">Title</label><Input id="r-title" value={f.title} maxLength={180} onChange={e => set('title', e.target.value)} /></div>
          <div>
            <label className={lbl} htmlFor="r-cat">Category</label>
            <Input id="r-cat" list="r-cats" value={f.category} maxLength={80} onChange={e => set('category', e.target.value)} />
            <datalist id="r-cats">{(ctx?.categories ?? []).map(c => <option key={c} value={c} />)}</datalist>
          </div>
          <div><label className={lbl} htmlFor="r-sum">Short description</label><textarea id="r-sum" className={area} rows={2} maxLength={1000} value={f.summary} onChange={e => set('summary', e.target.value)} /></div>
          {type === 'document' && (
            <div>
              <label className={lbl} htmlFor="r-file">{item ? 'Replace file (optional)' : 'File'}</label>
              <input id="r-file" type="file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                className="block w-full min-w-0 cursor-pointer rounded-lg text-navy file:mr-3 file:min-h-11 file:cursor-pointer file:rounded-lg file:border-[1.5px] file:border-blue file:bg-white file:px-4 file:py-2 file:font-bold file:text-blue hover:file:bg-gray focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue"
                onChange={e => { const x = e.target.files?.[0] ?? null; setFile(x); setFileErr(x ? fileError(x) : null); }} />
              <p className="mt-1 text-sm">PDF or DOCX, up to {MAX_FILE / 1024 ** 2} MB.{item?.fileName ? ` Current: ${item.fileName}.` : ''}{file ? ` Selected: ${file.name}.` : ''}</p>
              {fileErr && <p role="alert" className="mt-1 text-sm font-bold text-[var(--alliance-red-ink)]">{fileErr}</p>}
            </div>
          )}
          {type === 'article' && (
            <div className="grid gap-3 lg:grid-cols-2">
              <div><label className={lbl} htmlFor="r-body">Body (Markdown)</label><textarea id="r-body" className={`${area} min-h-64`} rows={12} maxLength={30000} value={f.body} onChange={e => set('body', e.target.value)} /><p className="mt-1 text-sm">{MD_HELP}</p></div>
              <div><p className={lbl}>Live preview</p><div className="min-h-64 rounded-lg bg-gray p-4 text-[17px] leading-8" data-testid="preview-body"><MarkdownView body={f.body || '_Nothing to preview yet._'} /></div></div>
            </div>
          )}
          {type === 'link' && (
            <>
              <div><label className={lbl} htmlFor="r-url">Link (https only)</label><Input id="r-url" type="url" inputMode="url" value={f.url} maxLength={2048} onChange={e => set('url', e.target.value)} /></div>
              <label className="flex min-h-11 items-center gap-3"><input type="checkbox" className="size-5" checked={f.isQuickLink} onChange={e => set('isQuickLink', e.target.checked)} />Show as a quick link at the top of Resources</label>
            </>
          )}
          <label className="flex min-h-11 items-center gap-3"><input type="checkbox" className="size-5" checked={f.isPublished} onChange={e => set('isPublished', e.target.checked)} />Published</label>
          {agree && appConfig.requireAgreementAcknowledgment && (
            <div className="rounded-lg bg-gray p-3">
              <label className="flex min-h-11 items-start gap-3"><input type="checkbox" className="mt-1 size-5" checked={f.bump} onChange={e => set('bump', e.target.checked)} data-testid="check-bump" />
                <span>Require current members to re-acknowledge (new agreement version{ctx ? `; now ${ctx.agreementVersion}` : ''})</span></label>
              <p className="mt-1 text-sm">Existing shift assignments stay as they are, but at their next sign-in or when they open shifts, members must acknowledge the updated agreement.</p>
            </div>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>{ok ? 'Close' : 'Cancel'}</Button>
            <Button type="submit" disabled={busy} data-testid="button-save-resource">{busy ? 'Saving…' : 'Save'}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
