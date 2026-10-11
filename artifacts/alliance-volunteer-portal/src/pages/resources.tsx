import { useMemo, useState } from 'react';
import { Link, useParams } from 'wouter';
import { ExternalLink, Search } from 'lucide-react';
import { getGetVolunteerResourcesQueryKey, useGetVolunteerResources, useGetResource, getGetResourceQueryKey, type VolunteerResource } from '@workspace/api-client-react';
import { EmptyState } from '@/components/brand-system';
import { FETCH_CREDS } from '@/auth/auth-context';
import { ErrorBlock, LoadingBlock, VolunteerPage, volunteerRoute } from '@/components/volunteer-ui';
import { ResourceMarkdown as MarkdownView } from '@/components/resources/resource-markdown';
import { FileActions, TypeIcon } from '@/components/resources/resource-files';
import { useSeo } from '@/components/resources/use-seo';
import { safeHttps } from '@/lib/pacific';

const linkOf = (r: VolunteerResource) => safeHttps(r.url ?? r.href);

function OpenLink({ r, big = false }: { r: VolunteerResource; big?: boolean }) {
  const href = linkOf(r);
  if (!href) return <p className="mt-2 text-sm">This link isn't available right now.</p>;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={`alliance-button ${big ? 'alliance-button-primary min-h-14' : 'alliance-button-secondary mt-3'}`} data-testid={`link-resource-${r.id}`}>
      {big ? r.title : 'Open link'}<ExternalLink size={14} aria-hidden="true" /><span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}

function Body() {
  useSeo('Resources', 'Guides, documents and quick links for Resource Coordinators.');
  const q = useGetVolunteerResources({ query: { queryKey: getGetVolunteerResourcesQueryKey() }, request: FETCH_CREDS });
  const [term, setTerm] = useState('');
  const [cat, setCat] = useState<string | null>(null);
  const list = q.data ?? [];
  const cats = useMemo(() => [...new Set(list.map(r => r.category))], [list]);
  const quick = list.filter(r => r.isQuickLink && r.type === 'link');
  const t = term.trim().toLowerCase();
  const shown = list.filter(r => (!cat || r.category === cat) && (!t || [r.title, r.summary, r.category, r.body].some(x => x?.toLowerCase().includes(t))));
  return (
    <VolunteerPage kicker="Resources" title="Guides and documents">
      {q.isPending ? <LoadingBlock /> : q.isError ? <ErrorBlock what="resources" onRetry={() => { void q.refetch(); }} /> : list.length === 0 ? (
        <EmptyState title="No resources yet" description="Guides and documents from the Community Care Team will appear here." />
      ) : (
        <div className="grid gap-5">
          {quick.length > 0 && <div className="grid gap-2 sm:grid-cols-2" data-testid="quick-links">{quick.map(r => <OpenLink key={r.id} r={r} big />)}</div>}
          <label className="relative block"><span className="sr-only">Search resources</span>
            <Search size={18} className="absolute left-3 top-3.5" aria-hidden="true" />
            <input type="search" value={term} onChange={e => setTerm(e.target.value)} placeholder="Search guides and documents…" data-testid="input-search"
              className="alliance-input pl-10" /></label>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Categories">
            {[null, ...cats].map(c => <button key={c ?? 'all'} type="button" aria-pressed={cat === c} onClick={() => setCat(c)}
              className={`min-h-11 rounded-full px-4 text-sm font-bold ${cat === c ? 'bg-navy text-white' : 'bg-white shadow-sm'}`}>{c ?? 'All'}</button>)}
          </div>
          {shown.length === 0 ? <EmptyState title="No matches" description="Try a different word or category." /> : (
            <ul className="grid gap-3">{shown.map(r => (
              <li key={r.id} className="rounded-xl bg-white p-5 shadow-sm" data-testid={`resource-${r.id}`}>
                <p className="flex items-center gap-2 text-xs font-bold text-blue"><TypeIcon type={r.type} size={14} />{r.category}</p>
                <h2 className="mt-1 text-lg font-bold">{r.title}</h2>
                {r.summary && <p className="mt-1">{r.summary}</p>}
                {r.type === 'article' && <Link href={`/resources/${r.id}`} className="alliance-button alliance-button-secondary mt-3">Read article</Link>}
                {r.type === 'document' && <FileActions id={r.id} mime={r.fileMimeType} name={r.fileName} />}
                {r.type === 'link' && !r.isQuickLink && <OpenLink r={r} />}
                {r.type === 'link' && r.isQuickLink && <OpenLink r={r} />}
              </li>))}</ul>
          )}
        </div>
      )}
    </VolunteerPage>
  );
}

function ArticleBody() {
  const { id = '' } = useParams<{ id: string }>();
  const q = useGetResource(id, { query: { queryKey: getGetResourceQueryKey(id), enabled: !!id }, request: FETCH_CREDS });
  useSeo(q.data?.title ?? 'Article', q.data?.summary ?? 'A guide for Resource Coordinators.');
  return (
    <main className="mx-auto max-w-2xl px-4 py-8 md:px-6">
      <Link href="/resources" className="inline-flex min-h-11 items-center text-sm font-bold underline">Back to Resources</Link>
      {q.isPending ? <LoadingBlock /> : q.isError || !q.data ? <ErrorBlock what="this article" onRetry={() => { void q.refetch(); }} /> : (
        <article className="mt-4">
          <p className="alliance-section-kicker">{q.data.category}</p>
          <h1 className="font-display text-3xl font-bold md:text-4xl">{q.data.title}</h1>
          {q.data.summary && <p className="mt-2 text-lg">{q.data.summary}</p>}
          <MarkdownView body={q.data.body ?? ''} className="mt-6 text-[17px] leading-8" testId="article-body" />
        </article>
      )}
    </main>
  );
}

export const Resources = volunteerRoute(() => <Body />);
export const ResourceArticle = volunteerRoute(() => <ArticleBody />);
