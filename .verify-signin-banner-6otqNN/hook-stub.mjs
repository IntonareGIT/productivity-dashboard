
/** Mutable test controls, read fresh on every render. */
export const control = { signedIn: false, busy: false, signInCalls: 0 };
export function useCloudAccount() {
  return {
    state: { signedIn: control.signedIn, email: null, status: '', tone: 'muted',
             pendingWork: false, errorMessage: null, diagnostics: null },
    busy: control.busy,
    signIn: async () => { control.signInCalls += 1; },
    signOut: async () => {},
    syncNow: async () => {},
    clearError: () => {},
  };
}
