// src/features/dashboard/components/SignInBanner.tsx
import { useEffect, useState } from "react";

// .verify-signin-banner-oKyjz4/icons-stub.mjs
var mk = () => () => null;
var CloudOff = mk();
var LogIn = mk();

// .verify-signin-banner-oKyjz4/db-stub.mjs
var control = { currentUserValue: void 0, subscribers: [] };
var db = {
  cloud: {
    get currentUser() {
      return {
        get value() {
          return control.currentUserValue;
        },
        subscribe(fn) {
          control.subscribers.push(fn);
          return { unsubscribe() {
          } };
        }
      };
    }
  }
};

// .verify-signin-banner-oKyjz4/hook-stub.mjs
var control2 = { signedIn: false, busy: false, signInCalls: 0 };
function useCloudAccount() {
  return {
    state: {
      signedIn: control2.signedIn,
      email: null,
      status: "",
      tone: "muted",
      pendingWork: false,
      errorMessage: null,
      diagnostics: null
    },
    busy: control2.busy,
    signIn: async () => {
      control2.signInCalls += 1;
    },
    signOut: async () => {
    },
    syncNow: async () => {
    },
    clearError: () => {
    }
  };
}

// src/features/dashboard/components/signInBannerState.ts
function shouldShowBanner({ initialized, signedIn, dismissed }) {
  if (!initialized) return false;
  if (signedIn) return false;
  return !dismissed;
}
var SIGN_IN_BANNER_TEXT = "Not signed in. Your data is only saved on this device and is not backed up. Clearing browser data or losing this device will erase it.";

// src/features/dashboard/components/SignInBanner.tsx
import { jsx, jsxs } from "react/jsx-runtime";
var btn = "inline-flex items-center justify-center gap-2 px-3 min-h-[44px] rounded-xl text-xs font-semibold transition-colors disabled:opacity-40";
var SignInBanner = () => {
  const { state, busy, signIn } = useCloudAccount();
  const [initialized, setInitialized] = useState(() => {
    const cloud = db.cloud;
    if (!cloud) return true;
    return Boolean(cloud.currentUser?.value);
  });
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    const currentUser = db.cloud?.currentUser;
    if (!currentUser) {
      setInitialized(true);
      return;
    }
    const sub = currentUser.subscribe(() => setInitialized(true));
    return () => sub.unsubscribe();
  }, []);
  if (!shouldShowBanner({ initialized, signedIn: state.signedIn, dismissed })) return null;
  return /* @__PURE__ */ jsx(
    "div",
    {
      role: "status",
      className: "w-full rounded-2xl border border-border bg-accent-subtle px-4 py-3 sm:px-5 sm:py-4",
      children: /* @__PURE__ */ jsxs("div", { className: "flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between", children: [
        /* @__PURE__ */ jsxs("div", { className: "flex items-start gap-3 min-w-0", children: [
          /* @__PURE__ */ jsx(CloudOff, { className: "w-5 h-5 shrink-0 mt-0.5 text-amber-500", "aria-hidden": "true" }),
          /* @__PURE__ */ jsx("p", { className: "text-sm text-content-primary", children: SIGN_IN_BANNER_TEXT })
        ] }),
        /* @__PURE__ */ jsxs("div", { className: "flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:shrink-0", children: [
          /* @__PURE__ */ jsx(
            "button",
            {
              onClick: () => setDismissed(true),
              className: `${btn} border border-border text-content-secondary hover:text-content-primary hover:bg-bg-elevated`,
              children: "Not now"
            }
          ),
          /* @__PURE__ */ jsxs(
            "button",
            {
              onClick: () => void signIn(),
              disabled: busy,
              className: `${btn} bg-accent hover:bg-accent-hover text-white`,
              children: [
                /* @__PURE__ */ jsx(LogIn, { className: "w-4 h-4", "aria-hidden": "true" }),
                "Sign in"
              ]
            }
          )
        ] })
      ] })
    }
  );
};
export {
  SIGN_IN_BANNER_TEXT,
  SignInBanner,
  control as dbControl,
  control2 as hookControl,
  shouldShowBanner
};
