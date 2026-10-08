import { useRef, type ReactNode } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

/** Mounted only while open: captures the opener on first render and restores focus on close. */
export function ShiftModal({ title, description, children, footer, onClose, busy }: {
  title: string; description?: string; children?: ReactNode; footer: ReactNode; onClose: () => void; busy?: boolean;
}) {
  const opener = useRef<HTMLElement | null>(document.activeElement as HTMLElement | null);
  return (
    <Dialog open onOpenChange={o => { if (!o && !busy) onClose(); }}>
      <DialogContent data-testid="dialog-shift" className="bg-white text-navy"
        onCloseAutoFocus={e => {
          e.preventDefault();
          const el = opener.current;
          (el && el.isConnected ? el : document.getElementById('shifts-heading'))?.focus();
        }}>
        <DialogHeader>
          <DialogTitle className="alliance-display text-base">{title}</DialogTitle>
          {description && <DialogDescription className="text-navy">{description}</DialogDescription>}
        </DialogHeader>
        {children}
        <DialogFooter className="gap-2">{footer}</DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
