/** Uses the existing failed/error fields: no notification enum/schema migration. */
export const UNCERTAIN_DELIVERY = 'DELIVERY_UNCERTAIN:';
export function isUncertainDelivery(error: string | null | undefined) {
  return !!error && (error.startsWith(UNCERTAIN_DELIVERY) ||
    error.includes('Delivery started but has not been confirmed') ||
    error.startsWith('Postmark accepted this email') ||
    /\b(?:ETIMEDOUT|ECONNRESET|socket hang up|timed out|timeout exceeded)\b/i.test(error));
}
export function uncertainDelivery(reason: string) {
  return `${UNCERTAIN_DELIVERY} ${reason} Delivery may have occurred. Automatic and manual resend are disabled; review this email in Postmark.`;
}
/** A positive rejection is retryable; transport errors/ambiguous responses are not. */
export function providerRejected(error: unknown) {
  const status = (error as { statusCode?: number } | null)?.statusCode;
  return typeof status === 'number' && status >= 400 && status < 500 && status !== 408;
}
