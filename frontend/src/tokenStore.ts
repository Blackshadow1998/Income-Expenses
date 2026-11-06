import * as SecureStore from 'expo-secure-store';

// Native: the session token lives in the Keychain / Android Keystore. Web uses tokenStore.web.ts.
const KEY = 'auth_token';

export const loadToken = () => SecureStore.getItemAsync(KEY);
export const saveToken = (token: string) => SecureStore.setItemAsync(KEY, token);
export const clearToken = () => SecureStore.deleteItemAsync(KEY);
