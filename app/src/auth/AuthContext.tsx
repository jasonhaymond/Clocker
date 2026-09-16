import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { wipeLocalDatabase } from "../db/database";
import { takePendingLocationPrompts } from "../lib/locationTracking";
import { cancelAllStaleShiftReminders } from "../lib/staleShiftReminder";
import * as api from "../sync/api";
import { getToken, isTokenPersisted, setToken } from "./tokenStore";

// Sign-in/sign-up/sign-out (and logoutEverywhere, which ends in the same signed-out state
// as sign-out) are the only places an *account switch* can happen on this device — as
// opposed to changePassword, which stays on the same account. Clearing every
// account-specific thing this device holds locally there is what keeps two accounts
// sharing one device fully independent, matching the server's own per-user data isolation
// (every table there is already scoped by userId; this is the client-side half of the
// same guarantee):
//   - the local SQLite mirror (jobs/shifts/etc.) — without this, a second account signing
//     in would briefly see the first account's cached data, and any of the first
//     account's *unsynced* outbox entries would get pushed to the server under the new
//     account's token on the next sync.
//   - scheduled "forgot to clock out" notifications, keyed by a shift id that's about to
//     stop existing on this device.
//   - a queued location-arrival/departure prompt, keyed by a job id likewise about to
//     stop existing.
// Best effort throughout: a cleanup failure shouldn't block the actual sign-in/out it's
// attached to.
async function wipeLocalDataForAccountSwitch(): Promise<void> {
  try {
    await Promise.all([wipeLocalDatabase(), cancelAllStaleShiftReminders(), takePendingLocationPrompts()]);
  } catch (err) {
    console.warn("Failed to clear local data on account switch", err);
  }
}

interface SignInOptions {
  captchaId: string;
  captchaAnswer: number;
  rememberMe: boolean;
}

interface AuthState {
  isReady: boolean;
  isSignedIn: boolean;
  signIn: (email: string, password: string, options: SignInOptions) => Promise<void>;
  signUp: (email: string, password: string, options: SignInOptions) => Promise<void>;
  signOut: () => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  logoutEverywhere: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [isReady, setIsReady] = useState(false);
  const [isSignedIn, setIsSignedIn] = useState(false);

  useEffect(() => {
    getToken().then((token) => {
      setIsSignedIn(!!token);
      setIsReady(true);
    });
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      isReady,
      isSignedIn,
      signIn: async (email, password, { captchaId, captchaAnswer, rememberMe }) => {
        const { token } = await api.login({ email, password, captchaId, captchaAnswer, rememberMe });
        await wipeLocalDataForAccountSwitch();
        await setToken(token, rememberMe);
        setIsSignedIn(true);
      },
      signUp: async (email, password, { captchaId, captchaAnswer, rememberMe }) => {
        const { token } = await api.register({ email, password, captchaId, captchaAnswer, rememberMe });
        await wipeLocalDataForAccountSwitch();
        await setToken(token, rememberMe);
        setIsSignedIn(true);
      },
      signOut: async () => {
        await setToken(null);
        setIsSignedIn(false);
        await wipeLocalDataForAccountSwitch();
      },
      // Bumps the server's tokenVersion, invalidating every token this user has ever
      // been issued — including the one this device is about to replace with the fresh
      // one below. Persisted the same way ("remember me" or not) the current session
      // already was, so changing your password doesn't silently change that.
      changePassword: async (currentPassword, newPassword) => {
        const persisted = await isTokenPersisted();
        const { token } = await api.changePassword(currentPassword, newPassword);
        await setToken(token, persisted);
      },
      // Also invalidates this device's own token — there's no server-side session to
      // delete selectively (see server/src/lib/auth.ts), so "everywhere" really does mean
      // everywhere. The caller is expected to sign out locally right after this resolves.
      logoutEverywhere: async () => {
        await api.logoutEverywhere();
        await setToken(null);
        setIsSignedIn(false);
        await wipeLocalDataForAccountSwitch();
      },
    }),
    [isReady, isSignedIn],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
