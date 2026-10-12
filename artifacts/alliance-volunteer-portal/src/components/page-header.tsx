import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** Shared class names so PageHeader and AuthHeading keep the same rhythm. */
export const HEADER_EYEBROW = 'alliance-label';
export const HEADER_TITLE = 'alliance-display mt-1';
export const HEADER_DESCRIPTION = 'mt-2 max-w-2xl';

export function PageHeader({ eyebrow, title, description, actions, back, titleTestId, titleSuffix, className = '' }: {
  eyebrow?: ReactNode; title: ReactNode; description?: ReactNode; actions?: ReactNode; back?: ReactNode;
  titleTestId?: string; titleSuffix?: ReactNode; className?: string;
}) {
  return (
    <header className={cn('mb-6 [&+*]:!mt-0', className)} data-testid="page-header">
      {back && <div className="mb-1">{back}</div>}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          {eyebrow && <p className={HEADER_EYEBROW}>{eyebrow}</p>}
          <h1 className={HEADER_TITLE} data-testid={titleTestId}>{title}{titleSuffix}</h1>
          {description && <div className={HEADER_DESCRIPTION}>{description}</div>}
        </div>
        {actions && <div className="flex w-full min-w-0 flex-wrap items-start gap-2 sm:w-auto sm:max-w-[55%] sm:flex-none sm:justify-end">{actions}</div>}
      </div>
    </header>
  );
}
