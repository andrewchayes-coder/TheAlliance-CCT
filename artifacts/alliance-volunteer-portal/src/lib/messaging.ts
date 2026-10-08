/** Roster bulk selection hand-off. Navigation is done by the caller with the router so the base path is kept. */
export const MESSAGE_SELECTED_EVENT = 'alliance:message-selected';
export const composeHref = (userIds: string[]) => `/admin/messages?userIds=${userIds.join(',')}`;
export function onMessageSelected(userIds: string[], navigate?: (to: string) => void): void {
  window.dispatchEvent(new CustomEvent(MESSAGE_SELECTED_EVENT, { detail: { userIds } }));
  navigate?.(composeHref(userIds));
}
