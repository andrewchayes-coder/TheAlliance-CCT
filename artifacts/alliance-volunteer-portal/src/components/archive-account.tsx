import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSetUserArchived, type PublicUser } from '@workspace/api-client-react';
import { readError, useAuth } from '@/auth/auth-context';
import { Notice } from '@/auth/auth-ui';
import { Button } from '@/components/brand-system';
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription,
  AlertDialogFooter } from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';

export function ArchiveAccount({ user, self = false }: { user: PublicUser; self?: boolean }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { request } = useAuth();
  const mutation = useSetUserArchived({ request });
  const qc = useQueryClient();
  const { toast } = useToast();
  const restoring = !!user.archivedAt;
  async function save() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await mutation.mutateAsync({ userId: user.id, data: { archived: !restoring } });
      await qc.invalidateQueries({ predicate: q => typeof q.queryKey[0] === 'string' &&
        (q.queryKey[0] as string).startsWith('/api/admin/') });
      setOpen(false);
      toast({ title: restoring ? 'Account restored. Sign-in is still disabled until reactivated.' : 'Account archived. Hours and history are preserved.' });
    } catch (e) { setError(readError(e, "We couldn't update this account. Please try again.").message); }
    finally { setBusy(false); }
  }
  return <>
    <Button type="button" variant="secondary" disabled={self || !!user.isTestAccount}
      title={self ? "You can't archive your own account." : user.isTestAccount ? 'Use Reset test accounts for built-in QA accounts.' : undefined}
      onClick={() => { setError(null); setOpen(true); }} data-testid={`button-archive-${user.id}`}>
      {restoring ? 'Restore account' : 'Archive account'}
    </Button>
    <AlertDialog open={open} onOpenChange={value => { if (!busy) setOpen(value); }}>
      <AlertDialogContent data-testid="dialog-archive-account">
        <AlertDialogHeader>
          <AlertDialogTitle>{restoring ? 'Restore' : 'Archive'} {user.firstName} {user.lastName}?</AlertDialogTitle>
          <AlertDialogDescription>
            {restoring
              ? 'The account will return to the normal lists. Sign-in stays disabled until you reactivate it separately. Previous shifts will not be restored.'
              : 'This hides the account from the normal lists, disables sign-in, ends existing sessions and releases future shifts. Logged hours, messages and history are kept. You can restore the account from the Archived filter. Nothing is permanently deleted.'}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && <div role="alert"><Notice>{error}</Notice></div>}
        <AlertDialogFooter>
          <Button type="button" variant="secondary" disabled={busy} onClick={() => setOpen(false)}>Cancel</Button>
          <Button type="button" disabled={busy} onClick={() => void save()} data-testid="button-confirm-archive">
            {busy ? 'Saving…' : restoring ? 'Restore account' : 'Archive account'}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </>;
}
