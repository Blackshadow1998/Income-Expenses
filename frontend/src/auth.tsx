import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import {
  activity, api, ApiError, cancelWaitingRequests, resumeWaitingRequests, setAuthProblemHandler, setAuthToken, SignInResult, User,
} from './api';
import { clearToken, loadToken, saveToken } from './tokenStore';

const IDLE_LOCK_MS = 5 * 60 * 1000; // matches unlockTTL on the server
const PING_MS = 60 * 1000; // taps keep the server-side unlock alive at most this often

/**
 * loading → (offline) → signedOut → needsPin (first PIN, or a reset after "forgot PIN") → ready ⇄ locked.
 * Signing in with a temporary password ("forgot password") goes to needsPassword first.
 * A fresh app start with a saved session always begins locked.
 */
export type AuthStatus = 'loading' | 'offline' | 'signedOut' | 'needsPassword' | 'needsPin' | 'locked' | 'ready';

interface AuthValue {
  status: AuthStatus;
  user: User | null;
  error: string | null; // why we're offline
  tempPassword: string; // the temporary password just used to sign in, to prefill the change form
  signIn: (username: string, password: string) => Promise<void>;
  signUp: (name: string, email: string, username: string, password: string) => Promise<void>;
  /** Replace the temporary password (status needsPassword). */
  replaceTempPassword: (current: string, next: string) => Promise<void>;
  refreshUser: () => Promise<void>;
  signInWithGoogle: (credential: string) => Promise<void>;
  /** `beforeOpen` runs after the PIN is accepted and before the app is shown (e.g. an unlock animation). */
  unlock: (pin: string, beforeOpen?: () => Promise<void>) => Promise<void>;
  setPin: (pin: string, currentPin?: string) => Promise<void>;
  lockNow: () => void;
  signOut: () => Promise<void>;
  forgotPin: () => Promise<void>;
  retry: () => void;
  touch: () => void; // the user did something: postpones the idle lock
}

const AuthContext = createContext<AuthValue | null>(null);

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<User | null>(null);
  const [error, setError] = useState<string | null>(null);
  const statusRef = useRef(status);
  useEffect(() => {
    statusRef.current = status;
  }, [status]);
  const lastPing = useRef(0);
  const resettingPin = useRef(false); // signed out via "forgot PIN": ask for a new PIN after the password
  const [tempPassword, setTempPassword] = useState('');

  const dropSession = useCallback(async () => {
    setAuthToken(null);
    cancelWaitingRequests();
    setUser(null);
    setStatus('signedOut');
    await clearToken();
  }, []);

  const start = useCallback(async () => {
    setStatus('loading');
    setError(null);
    const saved = await loadToken();
    if (!saved) {
      setStatus('signedOut');
      return;
    }
    setAuthToken(saved);
    try {
      const me = await api.auth.me();
      setUser(me.user);
      if (me.must_change_password) {
        setStatus('needsPassword');
      } else if (!me.user.has_pin) {
        setStatus('needsPin');
      } else {
        await api.auth.lock();
        setStatus('locked');
      }
    } catch (e) {
      if (e instanceof ApiError && e.code === 'unauthenticated') return; // the problem handler signed out
      setError((e as Error).message);
      setStatus('offline');
    }
  }, []);

  useEffect(() => {
    setAuthProblemHandler((p) => {
      if (p === 'unauthenticated') dropSession();
      else if (p === 'password_change_required') setStatus('needsPassword');
      else if (p === 'pin_required') setStatus('needsPin');
      else if (statusRef.current === 'ready') setStatus('locked');
    });
    start();
    return () => setAuthProblemHandler(null);
  }, [dropSession, start]);

  const signedIn = useCallback(async (r: SignInResult) => {
    setAuthToken(r.token);
    await saveToken(r.token);
    setUser(r.user);
    if (r.must_change_password) {
      setStatus('needsPassword');
      return;
    }
    const needsPin = !r.user.has_pin || resettingPin.current;
    resettingPin.current = false;
    setStatus(needsPin ? 'needsPin' : 'ready');
  }, []);

  const unlocked = useCallback(() => {
    lastPing.current = Date.now();
    setStatus('ready');
    resumeWaitingRequests();
  }, []);

  const lockNow = useCallback(() => {
    setStatus('locked');
    api.auth.lock().catch(() => {});
  }, []);

  // Idle lock: checked on a timer and whenever the app comes back to the foreground.
  useEffect(() => {
    const check = () => {
      if (statusRef.current === 'ready' && Date.now() - activity.last > IDLE_LOCK_MS) lockNow();
    };
    const timer = setInterval(check, 15_000);
    const sub = AppState.addEventListener('change', (s) => s === 'active' && check());
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, [lockNow]);

  const value = useMemo<AuthValue>(
    () => ({
      status,
      user,
      error,
      tempPassword,
      signIn: async (username, password) => {
        const r = await api.auth.login({ username, password });
        setTempPassword(r.must_change_password ? password : '');
        await signedIn(r);
      },
      signUp: async (name, email, username, password) => signedIn(await api.auth.signup({ name, email, username, password })),
      replaceTempPassword: async (current, next) => {
        await api.auth.changePassword(current, next);
        setTempPassword('');
        if (user && !user.has_pin) setStatus('needsPin');
        else unlocked();
      },
      refreshUser: async () => setUser((await api.auth.me()).user),
      signInWithGoogle: async (credential) => signedIn(await api.auth.google(credential)),
      unlock: async (pin, beforeOpen) => {
        await api.auth.unlock(pin);
        await beforeOpen?.();
        unlocked();
      },
      setPin: async (pin, currentPin) => {
        await api.auth.setPin(pin, currentPin);
        setUser((u) => (u ? { ...u, has_pin: true } : u));
        unlocked();
      },
      lockNow,
      signOut: async () => {
        await api.auth.logout().catch(() => {});
        await dropSession();
      },
      forgotPin: async () => {
        resettingPin.current = true;
        await api.auth.logout().catch(() => {});
        await dropSession();
      },
      retry: start,
      touch: () => {
        if (statusRef.current !== 'ready') return;
        const now = Date.now();
        if (now - activity.last > IDLE_LOCK_MS) return; // already idle; the timer will lock
        activity.last = now;
        if (now - lastPing.current > PING_MS) {
          lastPing.current = now;
          api.auth.ping().catch(() => {});
        }
      },
    }),
    [status, user, error, tempPassword, signedIn, unlocked, lockNow, dropSession, start],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
