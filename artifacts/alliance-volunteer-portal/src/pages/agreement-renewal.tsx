import { useState } from 'react';
import { PageHeader } from '@/components/page-header';
import { useQueryClient } from '@tanstack/react-query';
import { getGetMeQueryKey, getGetOnboardingAgreementsQueryKey, useAcknowledgeAgreement, useGetOnboardingAgreements } from '@workspace/api-client-react';
import { AppLayout, Button, Card } from '@/components/brand-system';
import { Notice } from '@/auth/auth-ui';
import { RequireVerified } from '@/auth/guards';
import { FETCH_CREDS, readError, useAuth } from '@/auth/auth-context';
import { ErrorBlock, LoadingBlock } from '@/components/volunteer-ui';
import { ResourceMarkdown as MarkdownView } from '@/components/resources/resource-markdown';
import { FileActions } from '@/components/resources/resource-files';
import { useSeo } from '@/components/resources/use-seo';

function Body() {
  useSeo('Updated agreements', 'Review and acknowledge the updated Resource Coordinator agreements.');
  const auth = useAuth();
  const qc = useQueryClient();
  const q = useGetOnboardingAgreements({ query: { queryKey: getGetOnboardingAgreementsQueryKey() }, request: FETCH_CREDS });
  const ack = useAcknowledgeAgreement({ request: auth.request });
  const [checked, setChecked] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function submit() {
    if (!q.data) return;
    setErr(null);
    try {
      await ack.mutateAsync({ data: { version: q.data.version, acknowledged: true } });
      await qc.invalidateQueries({ queryKey: getGetMeQueryKey() });
      await auth.refresh().catch(() => undefined);
      window.location.assign(`${import.meta.env.BASE_URL.replace(/\/$/, '')}/shifts`);
    } catch (e) { setErr(readError(e, 'We couldn’t save your acknowledgment. Please try again.').message); }
  }
  return (
    <main className="mx-auto max-w-2xl px-4 py-8 md:px-6">
      <PageHeader eyebrow="Agreements" title="We’ve updated our agreements" description={<p>Thank you for serving as a Resource Coordinator. Please read the latest version{q.data ? ` (${q.data.version})` : ''} and confirm. Your shifts stay as they are.</p>} />
      <div className="mt-6 grid gap-4">
        {q.isPending ? <LoadingBlock /> : q.isError ? <ErrorBlock what="the agreements" onRetry={() => { void q.refetch(); }} /> : (
          <>
            {q.data.resources.map(r => (
              <Card key={r.id}>
                <h2 className="text-xl font-bold">{r.title}</h2>
              {r.body ? <MarkdownView body={r.body} className="mt-3 text-[17px] leading-8" /> : r.href ? <FileActions id={r.id} mime={r.fileMimeType} name={r.fileName ?? r.title} /> : <p>Not available yet.</p>}
              </Card>
            ))}
            {!q.data.ready && <Notice kind="info">The agreements aren’t both available yet. Please check back soon.</Notice>}
            {err && <Notice>{err}</Notice>}
            <label className="flex min-h-11 items-start gap-3"><input type="checkbox" className="mt-1 size-5" checked={checked} disabled={!q.data.ready} onChange={e => setChecked(e.target.checked)} data-testid="check-acknowledge" />I have read and agree to the User Agreement and Safety Guidelines.</label>
            <Button disabled={!checked || !q.data.ready || ack.isPending} onClick={() => { void submit(); }} data-testid="button-acknowledge">{ack.isPending ? 'Saving…' : 'Acknowledge and continue'}</Button>
          </>
        )}
      </div>
    </main>
  );
}

export const AgreementRenewal = () => <RequireVerified>{() => <AppLayout role="volunteer"><Body /></AppLayout>}</RequireVerified>;
