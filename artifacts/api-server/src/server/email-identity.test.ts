import { describe, expect, it } from 'vitest';
import { emailIdentity, emailProviderStatus, parseEmailFrom, parseEmailReplyTo } from './email-identity';
import { assertProductionConfig } from './production-config';
import { createEmailTemplate, emailContactLine, emailFooter } from '../email-template';
import { appConfig } from '@workspace/shared/appConfig';

const from = 'The Alliance Community Care Team <cct@defendingthecause.org>';
describe('central CCT email identity', () => {
  it('parses sender and defaults replies to the address, not the display-name header', () => {
    expect(emailIdentity({ EMAIL_FROM: from })).toEqual({
      from: { name: 'The Alliance Community Care Team', address: 'cct@defendingthecause.org', header: from },
      replyTo: 'cct@defendingthecause.org',
    });
    expect(emailIdentity({ EMAIL_FROM: from, EMAIL_REPLY_TO: 'replies@example.invalid' }).replyTo).toBe('replies@example.invalid');
    expect(emailIdentity({ EMAIL_FROM: from, EMAIL_REPLY_TO: ' ' }).replyTo).toBe('cct@defendingthecause.org');
  });
  it.each(['team@example.invalid', '<team@example.invalid>', 'Team <bad>', 'Team <one@example.invalid>, Other <two@example.invalid>', 'Team <one@example.invalid>\r\nBcc: other@example.invalid'])('refuses malformed sender without echoing values: %s', value => {
    expect(() => parseEmailFrom(value)).toThrow('EMAIL_FROM');
    try { parseEmailFrom(value); } catch (error) { expect(String(error)).not.toContain(value); }
  });
  it.each(['bad', 'first@example.invalid,second@example.invalid', 'team@example.invalid\r\nBcc: private@example.invalid'])('rejects ambiguous or injected Reply-To: %s', value => {
    expect(() => parseEmailReplyTo(value)).toThrow('EMAIL_REPLY_TO');
  });
  it('fails startup for configured invalid identity, including development; absent dev configuration is allowed', () => {
    expect(() => assertProductionConfig({ NODE_ENV: 'development', EMAIL_FROM: 'bare@example.invalid' })).toThrow('EMAIL_FROM');
    expect(() => assertProductionConfig({ NODE_ENV: 'development', EMAIL_REPLY_TO: 'bad' })).toThrow('EMAIL_REPLY_TO');
    expect(() => assertProductionConfig({ NODE_ENV: 'development' })).not.toThrow();
  });
  it('reports staff-only identity and token existence without exposing a token', () => {
    const status = emailProviderStatus({ EMAIL_FROM: from, POSTMARK_SERVER_TOKEN: 'synthetic-private-token' });
    expect(status).toEqual({ tokenConfigured: true, emailFrom: 'cct@defendingthecause.org', fromName: 'The Alliance Community Care Team',
      fromAddress: 'cct@defendingthecause.org', replyTo: 'cct@defendingthecause.org', deliveryEnabled: true });
    expect(JSON.stringify(status)).not.toContain('synthetic-private-token');
    expect(emailProviderStatus({ EMAIL_FROM: from }).deliveryEnabled).toBe(false);
  });
  it('includes team contact, mission and service explanation in both footer versions', () => {
    const body = createEmailTemplate({ heading: 'Thank you', paragraphs: ['Your weekly time makes a difference.'] });
    expect(body.text).toContain([emailContactLine, appConfig.missionLine, emailFooter].join('\n\n'));
    expect(body.html).toContain('mailto:cct@defendingthecause.org');
    expect(body.html).toContain('Questions? Email the Community Care Team at');
    expect(body.html).toContain(emailFooter.replace(/'/g, '&#39;'));
  });
});
