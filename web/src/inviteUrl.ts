/** Removes the invitation from the address bar once it has been read. Browser only; the parsing lives in invite.ts. */
export function clearInviteHash(): void {
  if (window.location.hash.startsWith("#invite=")) {
    window.history.replaceState({}, "", window.location.pathname + window.location.search);
  }
}
