import { useState } from 'react';
import { useGetAdminResources, getGetAdminResourcesQueryKey, useGetResourceContext, getGetResourceContextQueryKey, type ResourceItem } from '@workspace/api-client-react';
import { AppLayout, Button } from '@/components/brand-system';
import { RequireAdmin } from '@/auth/guards';
import { FETCH_CREDS } from '@/auth/auth-context';
import { ErrorBlock, LoadingBlock } from '@/components/volunteer-ui';
import { ResourceList } from '@/components/resources/resource-list';
import { ResourceEditor } from '@/components/resources/resource-editor';
import { useSeo } from '@/components/resources/use-seo';

type T = 'document' | 'article' | 'link';
const TABS: { type: T; label: string; noun: string }[] = [
  { type: 'document', label: 'Documents', noun: 'document' }, { type: 'article', label: 'Articles', noun: 'article' }, { type: 'link', label: 'Quick Links', noun: 'link' },
];

function Body() {
  useSeo('Resources admin', 'Manage volunteer documents, articles and quick links.');
  const q = useGetAdminResources({ query: { queryKey: getGetAdminResourcesQueryKey() }, request: FETCH_CREDS });
  const ctx = useGetResourceContext({ query: { queryKey: getGetResourceContextQueryKey() }, request: FETCH_CREDS });
  const [tab, setTab] = useState<T>('document');
  const [editor, setEditor] = useState<{ item: ResourceItem | null } | null>(null);
  const cur = TABS.find(t => t.type === tab)!;
  return (
    <main className="mx-auto max-w-4xl px-4 py-8 md:px-6">
      <p className="alliance-section-kicker">Resources</p>
      <h1 className="font-display text-3xl font-bold">Manage resources</h1>
      {ctx.data && <p className="mt-1 text-sm">Current agreement version: <b>{ctx.data.agreementVersion}</b></p>}
      <div role="tablist" aria-label="Resource types" className="mt-5 flex flex-wrap gap-2">
        {TABS.map(t => (
          <button key={t.type} role="tab" type="button" aria-selected={tab === t.type} onClick={() => setTab(t.type)} data-testid={`tab-${t.type}`}
            className={`min-h-11 rounded-lg px-4 font-bold ${tab === t.type ? 'bg-navy text-white' : 'bg-white shadow-sm'}`}>{t.label}</button>
        ))}
        <Button className="ml-auto" onClick={() => setEditor({ item: null })} data-testid="button-new-resource">New {cur.noun}</Button>
      </div>
      <div className="mt-4" role="tabpanel">
        {q.isPending ? <LoadingBlock /> : q.isError ? <ErrorBlock what="resources" onRetry={() => { void q.refetch(); }} /> : (
          <ResourceList key={tab} type={tab} all={q.data} onEdit={item => setEditor({ item })} />
        )}
      </div>
      {editor && <ResourceEditor key={editor.item?.id ?? 'new'} type={tab} item={editor.item} ctx={ctx.data} onClose={() => setEditor(null)} />}
    </main>
  );
}

export const AdminResources = () => <RequireAdmin>{() => <AppLayout role="admin"><Body /></AppLayout>}</RequireAdmin>;
