/**
 * Pure decision logic for the "not signed in" dashboard banner.
 *
 * Deliberately free of React, Dexie and browser APIs so the behaviour can be
 * verified directly by `scripts/verify-signin-banner.mjs`. The component in
 * `SignInBanner.tsx` only gathers the inputs and calls `shouldShowBanner`.
 */

export interface SignInBannerInputs {
  /**
   * Whether the sign-in state has been determined yet. The shared
   * `useCloudAccount()` hook does not expose this, so the component derives it
   * from the first value of the addon's `currentUser` observable. While false,
   * the banner must stay hidden or it flashes for signed-in users.
   */
  initialized: boolean;
  /** The hook's real flag — `isLoggedIn`, never `currentUserId`. */
  signedIn: boolean;
  /** True once the user has dismissed the banner with "Not now". */
  dismissed: boolean;
}

/**
 * The banner is shown only when we KNOW the user is signed out.
 *
 * `!initialized` wins over everything, which is what prevents the flash for
 * signed-in users. `signedIn` is checked before `dismissed` so signing in hides
 * the banner immediately regardless of the dismiss state.
 */
export function shouldShowBanner({ initialized, signedIn, dismissed }: SignInBannerInputs): boolean {
  if (!initialized) return false;
  if (signedIn) return false;
  return !dismissed;
}

/** The exact banner copy, kept here so tests and the UI cannot drift apart. */
export const SIGN_IN_BANNER_TEXT =
  'Not signed in. Your data is only saved on this device and is not backed up. Clearing browser data or losing this device will erase it.';
