import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import * as api from "../sync/api";
import { getToken, setToken } from "./tokenStore";

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
        await setToken(token, rememberMe);
        setIsSignedIn(true);
      },
      signUp: async (email, password, { captchaId, captchaAnswer, rememberMe }) => {
        const { token } = await api.register({ email, password, captchaId, captchaAnswer, rememberMe });
        await setToken(token, rememberMe);
        setIsSignedIn(true);
      },
      signOut: async () => {
        await setToken(null);
        setIsSignedIn(false);
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
