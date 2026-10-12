import { useId } from 'react';
import { states } from '@workspace/shared/profileFields';
import { Field } from '@/auth/auth-ui';

export type ProfileKey =
  | 'firstName' | 'lastName' | 'phone' | 'dateOfBirth' | 'addressLine1' | 'city' | 'state' | 'zip'
  | 'emergencyContactName' | 'emergencyContactRelationship' | 'emergencyContactPhone';
export type ProfileValues = Record<ProfileKey, string>;
export type ProfileErrors = Partial<Record<ProfileKey, string>>;

export const RELATIONSHIPS = ['Spouse/Partner', 'Parent', 'Sibling', 'Child', 'Friend', 'Other'] as const;

/** Latest selectable birth date: yesterday in Pacific time. */
export function maxBirthDate(): string {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

const legend = 'alliance-section-kicker mb-3';

export function ProfileFields({ values, errors, email, emailEditableBelow = false, showDob = true, dobReadOnly = false, onChange, onBlur }: {
  values: ProfileValues; errors: ProfileErrors; email: string; emailEditableBelow?: boolean; showDob?: boolean; dobReadOnly?: boolean;
  onChange: (k: ProfileKey, v: string) => void; onBlur: (k: ProfileKey) => void;
}) {
  const stateId = useId();
  const listId = useId();
  const p = (k: ProfileKey, extra: Record<string, unknown> = {}) => ({
    value: values[k], error: errors[k], onBlur: () => onBlur(k),
    onChange: (e: { target: { value: string } }) => onChange(k, e.target.value), ...extra,
  });
  return (
    <div className="grid gap-8">
      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className={legend}>About you</legend>
        <Field label="First name" required autoComplete="given-name" maxLength={100} {...p('firstName')} data-testid="input-first-name" />
        <Field label="Last name" required autoComplete="family-name" maxLength={100} {...p('lastName')} data-testid="input-last-name" />
        <Field className="sm:col-span-2" label="Email" type="email" value={email} readOnly aria-readonly="true" hint={emailEditableBelow ? 'To change your email, use Email address below.' : 'To change your email, contact Alliance staff.'} data-testid="input-email" />
        <Field className="sm:col-span-2" label="Mobile phone" type="tel" inputMode="tel" required autoComplete="tel" maxLength={20} {...p('phone')}
          hint="We use this only to coordinate your shifts." data-testid="input-phone" />
        {showDob && (
          <Field className="sm:col-span-2" label="Date of birth" type="date" required max={maxBirthDate()} readOnly={dobReadOnly} autoComplete="bday" {...p('dateOfBirth')}
            hint={dobReadOnly ? 'Only Alliance staff can see this. Ask staff to change it.' : 'Only Alliance staff can see this.'} data-testid="input-dob" />
        )}
      </fieldset>
      <fieldset className="grid gap-4 sm:grid-cols-6">
        <legend className={legend}>Home address</legend>
        <Field className="sm:col-span-6" label="Home address" required autoComplete="address-line1" maxLength={300} {...p('addressLine1')} data-testid="input-address" />
        <Field className="sm:col-span-3" label="City" required autoComplete="address-level2" maxLength={100} {...p('city')} data-testid="input-city" />
        <div className="sm:col-span-1">
          <label htmlFor={stateId} className="mb-1.5 block text-sm font-bold">State</label>
          <select id={stateId} className="alliance-input" autoComplete="address-level1" value={values.state} aria-invalid={!!errors.state}
            onChange={e => onChange('state', e.target.value)} onBlur={() => onBlur('state')} data-testid="select-state">
            {states.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          {errors.state && <p className="mt-1.5 text-sm text-[var(--alliance-red-ink)]">{errors.state}</p>}
        </div>
        <Field className="sm:col-span-2" label="ZIP" required inputMode="numeric" autoComplete="postal-code" maxLength={10} {...p('zip')} data-testid="input-zip" />
      </fieldset>
      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className={legend}>Emergency contact</legend>
        <p className="text-sm text-navy-soft sm:col-span-2">Only Alliance staff can see this.</p>
        <Field label="Contact name" required autoComplete="off" maxLength={200} {...p('emergencyContactName')} data-testid="input-ec-name" />
        <div>
          <Field label="Relationship" required autoComplete="off" maxLength={100} list={listId} {...p('emergencyContactRelationship')} data-testid="input-ec-relationship" />
          <datalist id={listId}>{RELATIONSHIPS.map(r => <option key={r} value={r} />)}</datalist>
        </div>
        <Field className="sm:col-span-2" label="Contact phone" type="tel" inputMode="tel" required autoComplete="off" maxLength={20} {...p('emergencyContactPhone')} data-testid="input-ec-phone" />
      </fieldset>
    </div>
  );
}
