import type { ImagePickerAsset } from 'expo-image-picker';
import { Platform } from 'react-native';

// Web talks to the API on the same host that served the page, so opening http://<PC-IP>:8081 on a
// phone's browser works too. iOS simulator uses localhost; the Android emulator uses 10.0.2.2.
// For the native app on a physical phone set EXPO_PUBLIC_API_URL=http://<your-PC-IP>:8080 in frontend/.env
const DEFAULT_URL =
  Platform.OS === 'web' && typeof window !== 'undefined'
    ? `http://${window.location.hostname}:8080`
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

export interface MonthData {
  month: string;
  items: Transaction[];
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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}/api${path}`, {
    ...init,
    // FormData sets its own multipart Content-Type (with boundary).
    headers: init?.body instanceof FormData ? init?.headers : { 'Content-Type': 'application/json', ...init?.headers },
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      msg = (await res.json()).error ?? msg;
    } catch {}
    throw new Error(msg);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export const api = {
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
  slipImageUrl: (id: number) => `${API_URL}/api/slips/${id}/image`,
};
