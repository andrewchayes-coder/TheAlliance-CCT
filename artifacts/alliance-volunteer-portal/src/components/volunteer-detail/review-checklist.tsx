import { Link } from 'wouter';
import type { AdminVolunteerDetail } from '@workspace/api-client-react';
import { appConfig } from '@workspace/shared/appConfig';

type Guidance = { text: string; section?: string; action?: string };
function guidance(key: string): Guidance {
  if (key === 'email_verified') return {
    text: 'Volunteer: open the verification email and follow its link. They can sign in and use Resend email on the verification screen. Staff cannot mark an email verified.',
    section: 'review-account', action: 'Review account details',
  };
  if (key === 'onboarding_completed') return {
    text: 'Volunteer: sign in, complete the required profile fields, then submit onboarding. Staff edits alone do not record onboarding completion.',
    section: 'review-profile', action: 'Review profile details',
  };
  if (key === 'agreement_acknowledged') return { text: 'Volunteer: acknowledge the required agreement in the portal.', section: 'review-onboarding', action: 'Review agreement record' };
  if (key === 'certification_complete') return { text: 'Staff: confirm certification is complete, then update its tracking record.', section: 'review-tracking', action: 'Update certification' };
  if (key === 'background_cleared') return { text: 'Staff: confirm the background check is cleared, then update its tracking record.', section: 'review-tracking', action: 'Update background check' };
  if (['profile_firstName', 'profile_lastName', 'profile_phone'].includes(key)) return {
    text: 'Volunteer or staff: provide a valid value in account details and save it.', section: 'review-account', action: 'Edit account details',
  };
  return { text: 'Volunteer or staff: provide a valid value in the profile and save it.', section: 'review-profile', action: 'Edit profile details' };
}

export function ReviewChecklist({ detail, userId }: { detail: AdminVolunteerDetail; userId: string }) {
  const missing = detail.approvalRequirements.filter(r => !r.met);
  const volunteerSteps = missing.some(r => !['certification_complete', 'background_cleared'].includes(r.key));
  return (
    <div className="mt-3 rounded-xl border border-gray p-4" data-testid="review-checklist">
      <h3 className="font-bold">{missing.length ? (volunteerSteps ? 'Waiting on volunteer requirements' : 'Waiting on staff tracking') : 'Ready to activate'}</h3>
      <p className="mt-2 text-sm">{missing.length ? 'Complete the missing steps below before approval.' : 'All approval requirements are met. Review the profile, then choose Approve as Active.'}</p>
      <p className="mt-2 text-sm">{appConfig.autoActivateOnProfileComplete
        ? 'Email verification confirms the email address. Completing the required profile activates new volunteers automatically. Staff can still update program status by hand. Account login access is separate.'
        : 'Email verification confirms the email address. Onboarding completion records the submitted profile. Only staff approval changes program status to Active. Account login access is separate from program approval.'}</p>
      <ul className="mt-3 divide-y divide-gray">
        {detail.approvalRequirements.map(r => {
          const help = guidance(r.key);
          return <li key={r.key} className="py-2 text-sm">
            <p className="font-bold">{r.met ? 'Complete' : 'Missing'}: {r.label}</p>
            {!r.met && <><p className="mt-1">{help.text}</p>{help.section && <button type="button" className="min-h-11 text-blue font-bold underline underline-offset-4" onClick={() => document.getElementById(help.section!)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>{help.action}</button>}</>}
          </li>;
        })}
        <li className="py-2 text-sm"><p className="font-bold">Pending: Activation</p><p className="mt-1">{appConfig.autoActivateOnProfileComplete
          ? 'Staff can activate someone who remains Onboarding after completing their profile.'
          : 'Admin or Staff: review these requirements and confirm approval. No automatic approval occurs.'}</p></li>
      </ul>
      {missing.length > 0 && <Link href={`/admin/messages?userId=${userId}`} className="inline-flex min-h-11 items-center font-bold text-blue underline underline-offset-4">Message volunteer about missing steps</Link>}
    </div>
  );
}
