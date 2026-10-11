import { appConfig } from '@workspace/shared/appConfig';
import { useEffect, useRef, useState } from 'react';
import { Reorder } from 'framer-motion';
import { ArrowDown, ArrowUp, GripVertical } from 'lucide-react';
import { useReorderResources, usePublishResource, useDeleteResource, type ResourceItem } from '@workspace/api-client-react';
import { Button, StatusBadge } from '@/components/brand-system';
import { Notice } from '@/auth/auth-ui';
import { readError, useAuth } from '@/auth/auth-context';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { TypeIcon } from './resource-files';
import { isAgreementCat } from './validate';
import { useResourceRefresh } from './use-resource-refresh';

type T = 'document' | 'article' | 'link';

export function ResourceList({ type, all, onEdit }: { type: T; all: ResourceItem[]; onEdit: (r: ResourceItem) => void }) {
  const auth = useAuth();
  const refresh = useResourceRefresh();
  const reorder = useReorderResources({ request: auth.request });
  const publish = usePublishResource({ request: auth.request });
  const del = useDeleteResource({ request: auth.request });
  const server = all.filter(r => r.type === type).sort((a, b) => a.sortOrder - b.sortOrder);
  const [order, setOrder] = useState<string[]>(server.map(r => r.id));
  const orderRef = useRef(order);
  const [err, setErr] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<ResourceItem | null>(null);
  const key = server.map(r => r.id).join('|');
  useEffect(() => { setOrder(server.map(r => r.id)); orderRef.current = server.map(r => r.id); }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const byId = new Map(server.map(r => [r.id, r]));
  const apply = (o: string[]) => { orderRef.current = o; setOrder(o); };

  async function commit(prev: string[]) {
    const next = orderRef.current;
    if (next.join('|') === prev.join('|')) return;
    setErr(null);
    try { await reorder.mutateAsync({ data: { type, ids: next } }); await refresh(); }
    catch (e) { apply(prev); await refresh(); setErr(readError(e, 'We couldn’t save the new order. It was put back.').message); }
  }
  const move = (i: number, d: number) => {
    const prev = orderRef.current; const o = [...prev]; const j = i + d;
    if (j < 0 || j >= o.length) return;
    [o[i], o[j]] = [o[j], o[i]]; apply(o); void commit(prev);
  };
  const dragStart = useRef<string[]>(order);

  async function toggle(r: ResourceItem) {
    setErr(null); setBusyId(r.id);
    try { await publish.mutateAsync({ id: r.id, data: { isPublished: !r.isPublished } }); await refresh(r.id); }
    catch (e) { setErr(readError(e, `We couldn’t ${r.isPublished ? 'unpublish' : 'publish'} that.`).message); }
    finally { setBusyId(null); }
  }
  async function remove() {
    const r = toDelete; if (!r) return;
    setErr(null); setBusyId(r.id);
    try { await del.mutateAsync({ id: r.id }); setToDelete(null); await refresh(r.id); }
    catch (e) { setToDelete(null); setErr(readError(e, 'We couldn’t delete that.').message); }
    finally { setBusyId(null); }
  }
  const agr = (r: ResourceItem) => isAgreementCat(r.category);

  if (!server.length) return <p className="rounded-xl bg-white p-6 text-center shadow-sm" data-testid="empty-resources">Your resource collection starts here. Choose New to add a guide or link that helps volunteers feel prepared.</p>;
  return (
    <div>
      {err && <div><Notice>{err}</Notice></div>}
      <Reorder.Group axis="y" values={order} onReorder={apply} className="grid gap-2">
        {order.map((id, i) => { const r = byId.get(id); if (!r) return null; return (
          <Reorder.Item key={id} value={id} dragListener={!reorder.isPending} onDragStart={() => { dragStart.current = [...orderRef.current]; }} onDragEnd={() => { void commit(dragStart.current); }}
            className="rounded-xl bg-white p-3 shadow-sm" style={{ touchAction: 'pan-y' }} data-testid={`row-resource-${id}`}>
            <div className="flex items-start gap-2">
              <span className="mt-2 cursor-grab touch-none text-navy-soft" aria-hidden="true"><GripVertical size={20} /></span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-xs font-bold"><TypeIcon type={r.type} size={14} />{r.category}
                  <StatusBadge status={r.isPublished ? 'good' : 'neutral'}>{r.isPublished ? 'Published' : 'Draft'}</StatusBadge></div>
                <p className="break-words font-bold">{r.title}</p>
                {r.fileName && <p className="break-all text-sm">{r.fileName}</p>}
                {r.type === 'document' && r.fileMissing && <p className="mt-1 text-sm font-bold text-amber-ink" role="status">File missing — replace it</p>}
              </div>
              <div className="flex flex-col">
                <Button variant="secondary" size="icon" aria-label={`Move ${r.title} up`} disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp size={16} /></Button>
                <Button variant="secondary" size="icon" aria-label={`Move ${r.title} down`} disabled={i === order.length - 1} onClick={() => move(i, 1)}><ArrowDown size={16} /></Button>
              </div>
            </div>
            <div className="mt-2 flex flex-wrap gap-2 pl-7">
              <Button variant="secondary" size="sm" onClick={() => onEdit(r)}>Edit</Button>
              <Button variant="secondary" size="sm" disabled={busyId === r.id} onClick={() => { void toggle(r); }}>{r.isPublished ? 'Unpublish' : 'Publish'}</Button>
              <Button variant="secondary" size="sm" disabled={busyId === r.id} onClick={() => setToDelete(r)}>Delete</Button>
            </div>
          </Reorder.Item>); })}
      </Reorder.Group>
      <AlertDialog open={!!toDelete} onOpenChange={o => { if (!o) setToDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{toDelete?.title}”?</AlertDialogTitle>
            <AlertDialogDescription>This can’t be undone.{toDelete && agr(toDelete) && appConfig.requireAgreementAcknowledgment ? ' This is an agreement: deleting it affects volunteer onboarding until a replacement is published.' : ''}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Keep it</AlertDialogCancel><AlertDialogAction onClick={e => { e.preventDefault(); void remove(); }}>Delete</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
