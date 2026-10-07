/** Hook for the future messaging step. Receives role-validated volunteer USER ids (never profile ids). */
export const MESSAGE_SELECTED_EVENT = 'alliance:message-selected';
export function onMessageSelected(userIds: string[]): void {
  window.dispatchEvent(new CustomEvent(MESSAGE_SELECTED_EVENT, { detail: { userIds } }));
}
