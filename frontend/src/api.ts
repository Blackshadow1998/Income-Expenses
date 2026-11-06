import type { ImagePickerAsset } from 'expo-image-picker';
import { Platform } from 'react-native';

// Web: the built site is served by the API itself, so it uses the same origin (works behind any
// host name / HTTPS proxy). The dev server (expo start, port 8081) talks to port 8080 on the same host.
// iOS simulator uses localhost; the Android emulator uses 10.0.2.2.
// For the native app on a physical phone set EXPO_PUBLIC_API_URL=http://<your-PC-IP>:8080 in frontend/.env
const DEFAULT_URL =
  Platform.OS === 'web' && typeof window !== 'undefined'
    ? __DEV__
      ? `http://${window.location.hostname}:8080`
      : ''
    : Platform.OS === 'android'
      ? 'http://10.0.2.2:8080'
      : 'http://localhost:8080';
export const API_URL = process.env.EXPO_PUBLIC_API_URL || DEFAULT_URL;

export type CategoryCode = 'income' | 'expense' | 'lend' | 'borrow';

export interface Subcategory {
  id: number;
  name: string;
}

export interface Category {
  id: number;
  code: CategoryCode;
  name: string;
  direction: 1 | -1;
  subcategories: Subcategory[];
}

export interface Transaction {
  id: number;
  date: string;
  category_id: number;
  category_code: CategoryCode;
  category_name: string;
  subcategory_id: number | null;
  subcategory_name: string;
  account_id: number | null; // null for rows saved before accounts existed
  account_label: string;
  slip_id: number | null; // set when confirmed from a bank slip
  slip_from: string;
  slip_to: string;
  direction: 1 | -1;
  amount: number;
  note: string;
  payee: string; // optional "ผู้รับ", '' when not given
}

export interface TransactionInput {
  date: string;
  category_id: number;
  subcategory_id: number | null;
  account_id: number;
  slip_id?: number; // confirms this pending slip (create only)
  amount: number;
  note: string;
  payee: string;
}

export interface Slip {
  id: number;
  date: string;
  date_found: boolean;
  amount: number; // 0 = not readable
  from_name: string;
  to_name: string;
  ref: string;
  bank_id: number | null;
  bank_name: string;
  ocr_text: string;
  status: 'pending' | 'confirmed';
  transaction_id: number | null;
  image_url: string; // signed, short-lived path of the slip image
}

export interface User {
  id: number;
  name: string;
  username: string;
  has_pin: boolean;
}

export interface SignInResult {
  token: string;
  user: User;
}

export interface SlipUploadResult {
  file: string;
  slip?: Slip;
  error?: string;
  duplicate?: boolean;
}

export interface Option {
  id: number;
  code?: string;
  name: string;
}

export interface Account {
  id: number;
  bank_id: number;
  bank_name: string;
  type_id: number;
  type_code: string;
  type_name: string;
  name: string;
  label: string;
  opening_balance: number;
  balance: number;
  transaction_count: number;
}

export interface AccountInput {
  bank_id: number;
  type_id: number;
  name: string;
  opening_balance: number;
}

export interface AccountsSummary {
  accounts: Account[];
  by_type: { code: string; name: string; balance: number; count: number }[];
  unassigned: { balance: number; count: number };
  total: number;
}

/** Money moved between two of the user's own accounts (not income or expense). */
export interface Transfer {
  id: number;
  date: string;
  from_account_id: number;
  from_label: string;
  to_account_id: number;
  to_label: string;
  amount: number;
  note: string;
}

export interface TransferInput {
  date: string;
  from_account_id: number;
  to_account_id: number;
  amount: number;
  note: string;
}

export interface MonthData {
  month: string;
  items: Transaction[];
  transfers: Transfer[]; // not part of totals
  pending: Slip[]; // slips waiting for confirmation in this month
  totals: { in: number; out: number; net: number; by_category: Partial<Record<CategoryCode, number>> };
  balance: number;
}

export interface MonthSummary {
  month: number;
  in: number;
  out: number;
  net: number;
  by_category: Partial<Record<CategoryCode, number>>;
}

export interface YearData {
  year: number;
  months: MonthSummary[];
  totals: { in: number; out: number; net: number };
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string, // e.g. unauthenticated, locked, pin_required, wrong_pin, bad_credentials
  ) {
    super(message);
  }
}

/** Auth problems the sign-in gate (auth.tsx) reacts to. */
export type AuthProblem = 'unauthenticated' | 'pin_required' | 'locked';

let token: string | null = null;
let onAuthProblem: ((p: AuthProblem) => void) | null = null;
// Requests that hit "locked" / "pin_required" wait here until the PIN is entered, then retry,
// so screens behind the lock screen just finish loading afterwards.
let waiting: { resolve: () => void; reject: (e: Error) => void }[] = [];

/** Time of the last successful request; the idle lock in auth.tsx reads and bumps it. */
export const activity = { last: Date.now() };

export function setAuthToken(t: string | null) {
  token = t;
}

export function setAuthProblemHandler(fn: ((p: AuthProblem) => void) | null) {
  onAuthProblem = fn;
}

export function resumeWaitingRequests() {
  const w = waiting;
  waiting = [];
  w.forEach((x) => x.resolve());
}

export function cancelWaitingRequests() {
  const w = waiting;
  waiting = [];
  w.forEach((x) => x.reject(new ApiError('กรุณาเข้าสู่ระบบ', 401, 'unauthenticated')));
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  // FormData sets its own multipart Content-Type (with boundary).
  const headers: Record<string, string> = init?.body instanceof FormData ? {} : { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API_URL}/api${path}`, { ...init, headers });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    let code: string | undefined;
    try {
      const body = await res.json();
      msg = body.error ?? msg;
      code = body.code;
    } catch {}
    if (code === 'locked' || code === 'pin_required') {
      onAuthProblem?.(code);
      await new Promise<void>((resolve, reject) => waiting.push({ resolve, reject }));
      return request<T>(path, init);
    }
    if (code === 'unauthenticated') onAuthProblem?.(code);
    throw new ApiError(msg, res.status, code);
  }
  activity.last = Date.now();
  if (res.status === 204) return undefined as T;
  return res.json();
}

const post = (body?: unknown): RequestInit => ({ method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });

export const api = {
  auth: {
    signup: (body: { name: string; username: string; password: string }) =>
      request<SignInResult>('/auth/signup', post(body)),
    login: (body: { username: string; password: string }) => request<SignInResult>('/auth/login', post(body)),
    me: () => request<{ user: User; locked: boolean }>('/auth/me'),
    unlock: (pin: string) => request<void>('/auth/unlock', post({ pin })),
    /** First PIN, a reset right after a password sign-in (no currentPin), or a change. */
    setPin: (pin: string, currentPin?: string) => request<void>('/auth/pin', post({ pin, current_pin: currentPin ?? '' })),
    lock: () => request<void>('/auth/lock', post()),
    logout: () => request<void>('/auth/logout', post()),
    ping: () => request<void>('/auth/ping', post()),
  },

  categories: () => request<Category[]>('/categories'),
  payees: () => request<string[]>('/payees'),
  months: () => request<string[]>('/months'),
  years: () => request<number[]>('/years'),
  month: (month: string, accountId?: number | null) =>
    request<MonthData>(`/transactions?month=${month}${accountId ? `&account_id=${accountId}` : ''}`),
  get: (id: number) => request<Transaction>(`/transactions/${id}`),
  create: (body: TransactionInput) =>
    request<Transaction>('/transactions', { method: 'POST', body: JSON.stringify(body) }),
  update: (id: number, body: TransactionInput) =>
    request<Transaction>(`/transactions/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  remove: (id: number) => request<void>(`/transactions/${id}`, { method: 'DELETE' }),
  yearly: (year: number, accountId?: number | null) =>
    request<YearData>(`/summary/yearly?year=${year}${accountId ? `&account_id=${accountId}` : ''}`),

  getTransfer: (id: number) => request<Transfer>(`/transfers/${id}`),
  createTransfer: (body: TransferInput) => request<Transfer>('/transfers', post(body)),
  updateTransfer: (id: number, body: TransferInput) =>
    request<Transfer>(`/transfers/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  removeTransfer: (id: number) => request<void>(`/transfers/${id}`, { method: 'DELETE' }),

  accounts: () => request<AccountsSummary>('/accounts'),
  accountOptions: () => request<{ banks: Option[]; types: Option[] }>('/accounts/options'),
  getAccount: (id: number) => request<Account>(`/accounts/${id}`),
  createAccount: (body: AccountInput) =>
    request<Account>('/accounts', { method: 'POST', body: JSON.stringify(body) }),
  updateAccount: (id: number, body: AccountInput) =>
    request<Account>(`/accounts/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  removeAccount: (id: number) => request<void>(`/accounts/${id}`, { method: 'DELETE' }),

  uploadSlips: (assets: ImagePickerAsset[]) => {
    const form = new FormData();
    for (const a of assets) {
      if (Platform.OS === 'web' && a.file) {
        form.append('files', a.file, a.fileName ?? a.file.name);
      } else {
        // React Native's FormData takes a { uri, name, type } file descriptor.
        form.append('files', { uri: a.uri, name: a.fileName ?? 'slip.jpg', type: a.mimeType ?? 'image/jpeg' } as unknown as Blob);
      }
    }
    return request<SlipUploadResult[]>('/slips', { method: 'POST', body: form });
  },
  getSlip: (id: number) => request<Slip>(`/slips/${id}`),
  removeSlip: (id: number) => request<void>(`/slips/${id}`, { method: 'DELETE' }),
  slipImageUrl: (slip: Slip) => `${API_URL}${slip.image_url}`,
};
