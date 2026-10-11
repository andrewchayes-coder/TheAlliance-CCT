import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getGetTestAccountsQueryKey, useGetTestAccounts, useResetTestAccounts } from '@workspace/api-client-react';
import { useAuth, readError } from '@/auth/auth-context';
import { Notice } from '@/auth/auth-ui';
import { Button } from './brand-system';
import { TestBadge } from './test-badge';
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription,
  AlertDialogFooter, AlertDialogCancel } from './ui/alert-dialog';

export function TestAccountsCard() {
  const auth = useAuth(), qc = useQueryClient();
  const list = useGetTestAccounts({ request: auth.request, query: { queryKey: getGetTestAccountsQueryKey(), retry: false } });
  const reset = useResetTestAccounts({ request: auth.request });
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);
  async function restore() {
    try {
      await reset.mutateAsync({ data: {} });
      setOpen(false);
      setNotice({ kind: 'success', message: 'The five test accounts are ready for a fresh QA session.' });
      await qc.invalidateQueries();
    } catch (error) { setNotice({ kind: 'error', message: readError(error).message }); }
  }
  if (!list.data?.enabled) return null;
  return <section className="alliance-card mb-6" aria-labelledby="qa-accounts-heading" data-testid="test-accounts-card">
    <h2 id="qa-accounts-heading" className="alliance-display">Test accounts</h2>
    <p className="mt-2 text-sm">These QA personas never receive real emails and are excluded from blasts, reports, and volunteer totals.
      In production, resets release all test shifts; testers must choose shifts themselves.</p>
    <ul className="my-4 divide-y divide-[#ECEEEE]">
      {list.data.accounts.map(person => <li key={person.key} className="py-3 sm:flex sm:justify-between sm:gap-4">
        <div><p className="font-bold">{person.label}<TestBadge test /></p><p className="break-all text-sm">{person.email}</p></div>
        <p className="mt-1 text-sm sm:mt-0">{person.lastLoginAt ? `Last sign-in: ${new Date(person.lastLoginAt).toLocaleString('en-US',
          { timeZone: 'America/Los_Angeles', dateStyle: 'medium', timeStyle: 'short' })} PT` : 'Never signed in'}</p>
      </li>)}
    </ul>
    <Notice kind={notice?.kind ?? 'success'}>{notice?.message}</Notice>
    <Button type="button" variant="secondary" onClick={() => { setNotice(null); setOpen(true); }} data-testid="button-reset-test-accounts">Reset test accounts</Button>
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogContent>
        <AlertDialogHeader><AlertDialogTitle>Reset the five test accounts?</AlertDialogTitle>
          <AlertDialogDescription>This clears their shifts, weeks off, inbox memberships, profile edits, and onboarding answers, and ends their sessions.
            No real accounts will be changed. In development, Active receives a weekly shift if a slot has room.</AlertDialogDescription></AlertDialogHeader>
        <AlertDialogFooter><AlertDialogCancel disabled={reset.isPending}>Keep test data</AlertDialogCancel>
          <Button type="button" onClick={restore} disabled={reset.isPending}>{reset.isPending ? 'Resetting…' : 'Reset test accounts'}</Button></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </section>;
}
