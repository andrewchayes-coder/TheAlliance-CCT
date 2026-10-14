import { describe, it, expect } from 'vitest';
import { officialAddressRedirect } from './official-address';

const old = { hostname: 'the-alliance-cct.replit.app', origin: 'https://the-alliance-cct.replit.app',
  pathname: '/verify', search: '?token=synthetic-test-token', hash: '#next' };
describe('official portal address', () => {
  it('preserves verification/reset/invite/shift paths, queries and fragments', () => {
    for (const pathname of ['/verify', '/reset-password', '/accept-invite', '/shifts'])
      expect(officialAddressRedirect({ ...old, pathname }, 'https://cct.example.invalid', true))
        .toBe(`https://cct.example.invalid${pathname}${old.search}${old.hash}`);
  });
  it('never forwards development, matching origins, or other hosts', () => {
    expect(officialAddressRedirect(old, 'https://cct.example.invalid', false)).toBeNull();
    expect(officialAddressRedirect(old, old.origin, true)).toBeNull();
    expect(officialAddressRedirect({ ...old, hostname: 'portal.replit.dev' }, 'https://cct.example.invalid', true)).toBeNull();
    expect(officialAddressRedirect({ ...old, hostname: 'custom.example.invalid' }, 'https://cct.example.invalid', true)).toBeNull();
  });
  it('rejects malformed or insecure official addresses', () => {
    for (const address of ['invalid', 'http://cct.example.invalid', 'https://user@cct.example.invalid', 'https://cct.example.invalid/path'])
      expect(officialAddressRedirect(old, address, true)).toBeNull();
  });
});
