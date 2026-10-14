import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { signoutAndRedirect, signoutTarget } from './signout';

describe('official sign-out destination', () => {
  it('keeps sign-in public instead of bouncing a failed sign-out back into an account', () => {
    const page = readFileSync(new URL('../pages/signin.tsx', import.meta.url), 'utf8');
    expect(page).not.toContain('PublicAuthGate');
    expect(page).not.toContain('useRedirectIfAuthed');
    expect(page).toContain('if (auth.sessionLoading)');
    expect(page).toContain('return <Form />');
  });
  it('uses the session appOrigin before the current artifact path', () => {
    expect(signoutTarget('https://cct.defendingthecause.org', '/portal/'))
      .toBe('https://cct.defendingthecause.org/signin');
    expect(signoutTarget('https://cct.defendingthecause.org/', '/'))
      .toBe('https://cct.defendingthecause.org/signin');
  });
  it('falls back to BASE_URL when the official origin is unknown', () => {
    expect(signoutTarget(undefined, '/')).toBe('/signin');
    expect(signoutTarget(null, '/portal/')).toBe('/portal/signin');
  });
  it.each(['success', 'network', '403'])('clears the entire cache and replaces location after %s', async outcome => {
    const order: string[] = [];
    const clear = vi.fn(() => { order.push('clear'); });
    const replace = vi.fn(() => { order.push('replace'); });
    await signoutAndRedirect({
      request: async () => { order.push('request'); if (outcome !== 'success') throw new Error(outcome); },
      clear, replace, appOrigin: 'https://cct.defendingthecause.org', baseUrl: '/',
    });
    expect(order).toEqual(['request', 'clear', 'replace']);
    expect(clear).toHaveBeenCalledOnce();
    expect(replace).toHaveBeenCalledExactlyOnceWith('https://cct.defendingthecause.org/signin');
  });
});
