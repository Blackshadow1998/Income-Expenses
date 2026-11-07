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

export type CategoryCode = 'income' | 'expense' | 'lend' | 'borrow' | 'lend_return' | 'borrow_repay';

/** Outstanding money with one person (transactions' payee): lend − returned, borrow − repaid. */
export interface Debt {
  person: string; // '' = no payee recorded
  lent: number;
  returned: number;
  borrowed: number;
  repaid: number;
  owed_to_me: number;
  i_owe: number;
  last_date: string;
}

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
  recurring_id: number | null; // set when created by a recurring rule
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
  email: string; // where "forgot password" codes go; '' when not set
  has_pin: boolean;
}

export interface SignInResult {
  token: string;
  user: User;
  must_change_password: boolean; // signed in with a temporary password
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

/** Monthly rule that creates a normal transaction on `day` (clamped to the month's last day). */
export interface Recurring {
  id: number;
  day: number;
  category_id: number;
  category_code: CategoryCode;
  category_name: string;
  subcategory_id: number | null;
  subcategory_name: string;
  account_id: number;
  account_label: string;
  amount: number;
  note: string;
  payee: string;
  next_date: string;
  active: boolean;
}

export type RecurringInput = Pick<Recurring, 'day' | 'category_id' | 'subcategory_id' | 'account_id' | 'amount' | 'note' | 'payee' | 'active'>;

export interface Budget {
  id: number;
  category_id: number;
  category_code: CategoryCode;
  category_name: string;
  subcategory_id: number | null; // null = whole category
  subcategory_name: string;
  amount: number; // monthly limit
  spent: number; // in the requested month
}

export interface Insights {
  out: number;
  prev_out: number;
  change_pct: number | null; // vs last month; null when last month had no spending
  avg_per_day: number;
  top: { name: string; amount: number }[];
  biggest: Transaction | null;
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
export type AuthProblem = 'unauthenticated' | 'pin_required' | 'locked' | 'password_change_required';

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
    if (code === 'locked' || code === 'pin_required' || code === 'password_change_required') {
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

/**
 * Downloads transactions + transfers in [from, to] as a CSV file (opens in Excel). Web only: the
 * request needs the Authorization header, so it is fetched and saved through a temporary link.
 */
export async function downloadCsv(from = '', to = '') {
  await api.auth.ping(); // waits for the PIN first if the app is locked
  const res = await fetch(`${API_URL}/api/export.csv?from=${from}&to=${to}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new ApiError(`ส่งออกไม่สำเร็จ (HTTP ${res.status})`, res.status);
  const name = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? 'income-expenses.csv';
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

const post = (body?: unknown): RequestInit => ({ method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });

export const api = {
  auth: {
    signup: (body: { name: string; email: string; username: string; password: string }) =>
      request<SignInResult>('/auth/signup', post(body)),
    login: (body: { username: string; password: string }) => request<SignInResult>('/auth/login', post(body)),
    me: () => request<{ user: User; locked: boolean; must_change_password: boolean }>('/auth/me'),
    /** Same answer whether or not the e-mail has an account. */
    forgot: (email: string) => request<{ message: string; expires_in: number }>('/auth/forgot', post({ email })),
    verifyForgot: (email: string, code: string) =>
      request<{ username: string; temp_password: string; expires_at: string }>('/auth/forgot/verify', post({ email, code })),
    setEmail: (email: string, currentPassword: string) =>
      request<void>('/auth/email', { method: 'PUT', body: JSON.stringify({ email, current_password: currentPassword }) }),
    unlock: (pin: string) => request<void>('/auth/unlock', post({ pin })),
    /** First PIN, a reset right after a password sign-in (no currentPin), or a change. */
    setPin: (pin: string, currentPin?: string) => request<void>('/auth/pin', post({ pin, current_pin: currentPin ?? '' })),
    config: () => request<{ google_client_id: string }>('/auth/config'),
    /** `credential` is the ID token from Google Identity Services. */
    google: (credential: string) => request<SignInResult>('/auth/google', post({ credential })),
    linkGoogle: (credential: string) => request<void>('/auth/google/link', post({ credential })),
    changePassword: (current: string, next: string) =>
      request<void>('/auth/password', post({ current_password: current, new_password: next })),
    lock: () => request<void>('/auth/lock', post()),
    logout: () => request<void>('/auth/logout', post()),
    ping: () => request<void>('/auth/ping', post()),
  },

  categories: () => request<Category[]>('/categories'),
  createSubcategory: (categoryId: number, name: string) =>
    request<Subcategory>('/subcategories', post({ category_id: categoryId, name })),
  renameSubcategory: (id: number, name: string) =>
    request<Subcategory>(`/subcategories/${id}`, { method: 'PUT', body: JSON.stringify({ name }) }),
  /** Transactions that used it keep their category; their item becomes "ไม่ระบุ". */
  removeSubcategory: (id: number) => request<{ cleared_transactions: number }>(`/subcategories/${id}`, { method: 'DELETE' }),
  payees: () => request<string[]>('/payees'),
  months: () => request<string[]>('/months'),
  years: () => request<number[]>('/years'),
  month: (month: string, accountId?: number | null) =>
    request<MonthData>(`/transactions?month=${month}${accountId ? `&account_id=${accountId}` : ''}`),
  get: (id: number) => request<Transaction>(`/transactions/${id}`),
  /** Filters: q, from, to (YYYY-MM-DD), category_id, account_id, min, max — empty values are left out. */
  search: (filters: Record<string, string | number | null | undefined>) => {
    const qs = Object.entries(filters)
      .filter(([, v]) => v !== null && v !== undefined && v !== '')
      .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
      .join('&');
    return request<{ items: Transaction[]; totals: { in: number; out: number }; capped: boolean }>(`/transactions/search?${qs}`);
  },
  create: (body: TransactionInput) =>
    request<Transaction>('/transactions', { method: 'POST', body: JSON.stringify(body) }),
  update: (id: number, body: TransactionInput) =>
    request<Transaction>(`/transactions/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  remove: (id: number) => request<void>(`/transactions/${id}`, { method: 'DELETE' }),
  yearly: (year: number, accountId?: number | null) =>
    request<YearData>(`/summary/yearly?year=${year}${accountId ? `&account_id=${accountId}` : ''}`),

  debts: () => request<Debt[]>('/debts'),
  insights: (month: string) => request<Insights>(`/insights?month=${month}`),
  recurring: () => request<Recurring[]>('/recurring'),
  saveRecurring: (id: number | null, body: RecurringInput) =>
    id
      ? request<{ id: number; created_transactions: number }>(`/recurring/${id}`, { method: 'PUT', body: JSON.stringify(body) })
      : request<{ id: number; created_transactions: number }>('/recurring', post(body)),
  removeRecurring: (id: number) => request<void>(`/recurring/${id}`, { method: 'DELETE' }),

  budgets: (month: string) => request<Budget[]>(`/budgets?month=${month}`),
  /** Creates or replaces the budget of a category (or of one item of it). */
  saveBudget: (categoryId: number, subcategoryId: number | null, amount: number) =>
    request<{ id: number }>('/budgets', post({ category_id: categoryId, subcategory_id: subcategoryId, amount })),
  removeBudget: (id: number) => request<void>(`/budgets/${id}`, { method: 'DELETE' }),

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
