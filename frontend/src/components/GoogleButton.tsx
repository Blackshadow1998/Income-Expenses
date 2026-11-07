import { useEffect, useRef, useState } from 'react';
import { Platform, View } from 'react-native';
import { api } from '../api';

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (o: { client_id: string; callback: (r: { credential: string }) => void }) => void;
          renderButton: (el: HTMLElement, o: Record<string, unknown>) => void;
        };
      };
    };
  }
}

let script: Promise<void> | null = null;
function loadGoogleScript() {
  script ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('โหลด Google Sign-In ไม่ได้'));
    document.head.appendChild(s);
  });
  return script;
}

/**
 * "Sign in with Google" button (web only), shown only when the server has GOOGLE_CLIENT_ID.
 * Calls onCredential with Google's ID token.
 */
export function GoogleButton({ onCredential, text = 'signin_with' }: {
  onCredential: (credential: string) => void;
  text?: 'signin_with' | 'continue_with';
}) {
  const [clientId, setClientId] = useState('');
  const callback = useRef(onCredential);
  callback.current = onCredential;
  const id = 'google-btn';

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    api.auth.config().then((c) => setClientId(c.google_client_id)).catch(() => {});
  }, []);

  useEffect(() => {
    if (!clientId) return;
    loadGoogleScript()
      .then(() => {
        const el = document.getElementById(id);
        if (!el || !window.google) return;
        window.google.accounts.id.initialize({ client_id: clientId, callback: (r) => callback.current(r.credential) });
        window.google.accounts.id.renderButton(el, { theme: 'outline', size: 'large', shape: 'pill', text, locale: 'th' });
      })
      .catch(() => {});
  }, [clientId, text]);

  if (Platform.OS !== 'web' || !clientId) return null;
  return <View nativeID={id} style={{ alignItems: 'center', minHeight: 44 }} />;
}
