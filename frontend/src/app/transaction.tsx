import { Picker } from '@react-native-picker/picker';
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { ReactNode, useCallback, useEffect, useState } from 'react';
import { Image, Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { AccountsSummary, api, Category, Slip } from '@/api';
import { Button, Card, ErrorBox, Loading } from '@/components/ui';
import { accountLabel, CATEGORY_COLORS, COLORS, currentMonth, dateLabel, isValidDate, money, showError, toISODate } from '@/format';
import { t, tCode } from '@/i18n';
import { getLastAccountId, setLastAccountId, setPendingMonth } from '@/state';

export default function TransactionScreen() {
  // category / payee / amount prefill a new transaction (e.g. "คืนแล้ว" from the debts screen).
  const params = useLocalSearchParams<{
    id?: string; month?: string; accountId?: string; slipId?: string; category?: string; payee?: string; amount?: string;
    as?: string; // 'transaction': keep a slip here even when its rule says "transfer"
    date?: string; // default date (the day picked on the monthly screen)
  }>();
  const editId = params.id ? Number(params.id) : undefined;
  const slipId = !editId && params.slipId ? Number(params.slipId) : undefined;
  const isEdit = !!editId;

  const [categories, setCategories] = useState<Category[]>([]);
  const [summary, setSummary] = useState<AccountsSummary | null>(null);
  // Effect of the row being edited (+/- amount on its account). Balances shown in the
  // form leave it out, so "balance ± amount" doesn't count this row twice.
  const [original, setOriginal] = useState<{ accountId: number | null; effect: number } | null>(null);
  const [accountId, setAccountId] = useState<number | null>(null);
  const [slip, setSlip] = useState<Slip | null>(null);
  const [showOcr, setShowOcr] = useState(false);
  const [date, setDate] = useState(() => (params.date && isValidDate(params.date) ? params.date : defaultDate(params.month)));
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [subcategoryId, setSubcategoryId] = useState<number | null>(null);
  const [amountText, setAmountText] = useState('');
  const [note, setNote] = useState('');
  const [payee, setPayee] = useState('');
  const [knownPayees, setKnownPayees] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const load = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      // Suggestions are a nice-to-have: the form still works if they fail to load.
      api.payees().then(setKnownPayees).catch(() => {});
      const [cats, accs, txn, sl] = await Promise.all([
        api.categories(),
        api.accounts(),
        editId ? api.get(editId) : Promise.resolve(null),
        slipId ? api.getSlip(slipId) : Promise.resolve(null),
      ]);
      if (sl && sl.status !== 'pending') throw new Error(t('slip.alreadyConfirmed'));
      if (sl?.suggestion?.action === 'transfer' && params.as !== 'transaction') {
        router.replace({ pathname: '/transfer', params: { slipId: String(sl.id) } });
        return;
      }
      setCategories(cats);
      setSummary(accs);
      setSlip(sl);
      if (txn) {
        setOriginal({ accountId: txn.account_id, effect: txn.direction * txn.amount });
        setAccountId(txn.account_id);
        setDate(txn.date);
        setCategoryId(txn.category_id);
        setSubcategoryId(txn.subcategory_id);
        setAmountText(String(txn.amount));
        setNote(txn.note);
        setPayee(txn.payee);
      } else {
        setCategoryId((cats.find((c) => c.code === (params.category ?? 'expense')) ?? cats[0])?.id ?? null);
        if (params.payee) setPayee(params.payee);
        if (params.amount) setAmountText(params.amount);
        // From a slip: prefer an account at the bank the slip came from.
        const slipAccount = sl?.bank_id ? accs.accounts.find((a) => a.bank_id === sl.bank_id)?.id : undefined;
        setAccountId(pickDefaultAccount(accs, slipAccount ?? (Number(params.accountId) || getLastAccountId())));
        if (sl) {
          setDate(sl.date);
          if (sl.amount > 0) setAmountText(String(sl.amount));
          setPayee(sl.to_name);
          const s = sl.suggestion?.action === 'transaction' ? sl.suggestion : null;
          if (s) {
            if (s.category_id) setCategoryId(s.category_id);
            setSubcategoryId(s.subcategory_id);
            if (s.account_id && accs.accounts.some((a) => a.id === s.account_id)) setAccountId(s.account_id);
            if (s.payee) setPayee(s.payee);
            if (s.note) setNote(s.note);
          }
        }
      }
    } catch (e) {
      setLoadError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editId, slipId]);

  // Coming back from "เพิ่มบัญชีใหม่" — refresh the account list without touching the form.
  useFocusEffect(
    useCallback(() => {
      api
        .accounts()
        .then((accs) => {
          setSummary(accs);
          if (!isEdit) setAccountId((prev) => prev ?? pickDefaultAccount(accs, null));
        })
        .catch(() => {});
    }, [isEdit]),
  );

  const category = categories.find((c) => c.id === categoryId);
  const subcategories = category?.subcategories ?? [];

  // Items belong to one category, so switching category clears an item from another one.
  const selectCategory = (c: Category) => {
    setCategoryId(c.id);
    if (!c.subcategories.some((s) => s.id === subcategoryId)) setSubcategoryId(null);
  };

  const amount = parseAmount(amountText);
  const accounts = summary?.accounts ?? [];
  const account = accounts.find((a) => a.id === accountId);
  const effectOn = (id: number | null) => (original && original.accountId === id ? original.effect : 0);
  const total = (summary?.total ?? 0) - (original?.effect ?? 0);
  // Balance of the chosen account (or of everything until one is chosen).
  const balance = account ? account.balance - effectOn(account.id) : total;
  const remaining = balance + (category?.direction ?? -1) * (amount ?? 0);

  const shiftDay = (delta: number) => {
    if (!isValidDate(date)) return;
    const [y, m, d] = date.split('-').map(Number);
    setDate(toISODate(new Date(y, m - 1, d + delta)));
  };

  const save = async () => {
    const errs: Record<string, string> = {};
    if (!isValidDate(date)) errs.date = t('form.dateFormat');
    if (!accountId) errs.account = t('txn.pickAccount');
    if (!categoryId) errs.category = t('txn.pickCategory');
    if (amount === null || amount <= 0) errs.amount = t('form.amountPositive');
    setErrors(errs);
    if (Object.keys(errs).length) return;

    const body = {
      date,
      category_id: categoryId!,
      subcategory_id: subcategoryId,
      account_id: accountId!,
      ...(slip ? { slip_id: slip.id } : {}),
      amount: amount!,
      note: note.trim(),
      payee: payee.trim(),
    };
    setSaving(true);
    try {
      if (editId) await api.update(editId, body);
      else await api.create(body);
      setLastAccountId(accountId!);
      setPendingMonth(date.slice(0, 7));
      if (router.canGoBack()) router.back();
      else router.replace('/');
    } catch (e) {
      showError(e);
    } finally {
      setSaving(false);
    }
  };

  const title = isEdit ? t('txn.edit') : slip || slipId ? t('txn.confirmSlip') : t('txn.add');
  if (loading) return (<><Stack.Screen options={{ title }} /><Loading /></>);
  if (loadError)
    return (
      <View style={styles.page}>
        <Stack.Screen options={{ title }} />
        <ErrorBox message={loadError} onRetry={load} />
      </View>
    );

  const sign = (category?.direction ?? -1) > 0 ? '+' : '−';

  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title }} />

      {/* Read-only balance — shown outside the form, cannot be edited */}
      <Card style={styles.balanceCard}>
        <Text style={styles.balanceLabel}>
          {account ? t('txn.balanceOf', { name: accountLabel(account) }) : t('txn.balanceAll')}
          {isEdit ? t('txn.excludingThis') : ''}
        </Text>
        <Text style={styles.balanceValue}>{t('money.bahtValue', { amount: money(balance) })}</Text>
        {account && <Text style={styles.balanceSub}>{t('txn.totalAll', { amount: money(total) })}</Text>}
      </Card>

      {slip && (
        <View style={styles.slipCard}>
          <Pressable onPress={() => Linking.openURL(api.slipImageUrl(slip))} accessibilityLabel={t('slip.viewImage')}>
            <Image source={{ uri: api.slipImageUrl(slip) }} style={styles.slipThumb} resizeMode="cover" />
          </Pressable>
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={styles.slipTitle}>{t('slip.fromSlipTitle')}</Text>
            <SlipLine label={t('slip.amount')} value={slip.amount > 0 ? t('money.bahtValue', { amount: money(slip.amount) }) : t('slip.amountUnreadable')} />
            <SlipLine label={t('slip.fromAccount')} value={slip.from_name || '-'} />
            <SlipLine label={t('slip.toAccount')} value={slip.to_name || '-'} />
            <SlipLine label={t('slip.date')} value={slip.date_found ? dateLabel(slip.date) : t('slip.dateUnreadable')} />
            {!!slip.ref && <SlipLine label={t('slip.ref')} value={slip.ref} />}
            {!!slip.bank_name && <SlipLine label={t('account.bank')} value={slip.bank_name} />}
            {!!slip.to_bank_name && <SlipLine label={t('slip.toBank')} value={slip.to_bank_name} />}
            {slip.suggestion?.action === 'transaction' && (
              <Text style={styles.ruleBadge}>{t('slip.ruleCheck', { name: slip.suggestion.rule_name })}</Text>
            )}
            <Pressable onPress={() => router.replace({ pathname: '/transfer', params: { slipId: String(slip.id) } })}>
              <Text style={{ color: COLORS.primary, fontSize: 12 }}>{t('slip.isTransfer')}</Text>
            </Pressable>
            <Pressable onPress={() => setShowOcr((v) => !v)}>
              <Text style={{ color: COLORS.primary, fontSize: 12 }}>{showOcr ? t('slip.hideOcr') : t('slip.showOcr')}</Text>
            </Pressable>
            {showOcr && <Text style={styles.ocrText} selectable>{slip.ocr_text.split('\n===== 2x =====\n')[0] || t('slip.noOcr')}</Text>}
          </View>
        </View>
      )}

      <Card style={{ gap: 16 }}>
        <Field label={t('txn.account')} error={errors.account}>
          {accounts.length === 0 ? (
            <Text style={styles.hint}>{t('txn.noAccounts')}</Text>
          ) : (
            <View style={styles.pickerWrap}>
              <Picker
                selectedValue={accountId ?? 0}
                onValueChange={(v) => setAccountId(Number(v) || null)}
                style={styles.picker}
              >
                <Picker.Item label={t('form.pickAccount')} value={0} color={COLORS.muted} />
                {accounts.map((a) => (
                  <Picker.Item
                    key={a.id}
                    label={`${accountLabel(a)}  (${money(a.balance - effectOn(a.id))})`}
                    value={a.id}
                  />
                ))}
              </Picker>
            </View>
          )}
          <View style={{ alignSelf: 'flex-start' }}>
            <Button title={t('txn.addAccount')} variant="ghost" small onPress={() => router.push('/account')} />
          </View>
        </Field>

        <Field label={t('form.date')} error={errors.date}>
          <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
            <Button title="◀" variant="outline" small onPress={() => shiftDay(-1)} />
            <TextInput
              value={date}
              onChangeText={setDate}
              placeholder="2026-11-06"
              maxLength={10}
              style={[styles.input, { flex: 1, textAlign: 'center' }]}
            />
            <Button title="▶" variant="outline" small onPress={() => shiftDay(1)} />
            <Button title={t('form.today')} variant="ghost" small onPress={() => setDate(toISODate(new Date()))} />
          </View>
          {isValidDate(date) && <Text style={styles.hint}>{dateLabel(date)}</Text>}
        </Field>

        <Field label={t('txn.category')} error={errors.category}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {categories.map((c) => {
              const active = c.id === categoryId;
              const color = CATEGORY_COLORS[c.code];
              return (
                <Pressable
                  key={c.id}
                  onPress={() => selectCategory(c)}
                  style={[styles.catBtn, { borderColor: color }, active && { backgroundColor: color }]}
                >
                  <Text style={{ color: active ? '#fff' : color, fontWeight: '700' }}>
                    {tCode('category', c.code, c.name)} ({c.direction > 0 ? t('money.in') : t('money.out')})
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </Field>

        {subcategories.length > 0 && (
          <Field label={t('txn.item')}>
            <View style={styles.pickerWrap}>
              <Picker
                selectedValue={subcategoryId ?? 0}
                onValueChange={(v) => setSubcategoryId(Number(v) || null)}
                style={styles.picker}
              >
                <Picker.Item label={t('txn.none')} value={0} color={COLORS.muted} />
                {subcategories.map((s) => (
                  <Picker.Item key={s.id} label={s.name} value={s.id} />
                ))}
              </Picker>
            </View>
          </Field>
        )}

        <Field label={t('txn.payee')}>
          <TextInput
            value={payee}
            onChangeText={setPayee}
            placeholder={t('txn.payeeHint')}
            style={styles.input}
          />
          {payeeSuggestions(knownPayees, payee).length > 0 && (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {payeeSuggestions(knownPayees, payee).map((p) => (
                <Pressable key={p} onPress={() => setPayee(p)} style={styles.payeeChip}>
                  <Text style={{ color: COLORS.text, fontSize: 13 }}>👤 {p}</Text>
                </Pressable>
              ))}
            </View>
          )}
        </Field>

        <Field label={t('money.amountBaht')} error={errors.amount}>
          <TextInput
            value={amountText}
            onChangeText={(v) => setAmountText(v.replace(/[^0-9.,]/g, ''))}
            placeholder="0.00"
            keyboardType="decimal-pad"
            style={[styles.input, { fontSize: 18 }]}
          />
        </Field>

        <Field label={account ? t('txn.remainingAccount') : t('txn.remaining')}>
          <View style={styles.readonly}>
            <Text style={{ color: COLORS.muted }}>
              {money(balance)} {sign} {money(amount ?? 0)} =
            </Text>
            <Text style={{ fontSize: 18, fontWeight: '700', color: remaining >= 0 ? COLORS.in : COLORS.out }}>
              {t('money.bahtValue', { amount: money(remaining) })}
            </Text>
          </View>
        </Field>

        <Field label={t('form.note')}>
          <TextInput
            value={note}
            onChangeText={setNote}
            placeholder={t('txn.noteHint')}
            multiline
            numberOfLines={3}
            style={[styles.input, { minHeight: 80, textAlignVertical: 'top' }]}
          />
        </Field>

        <View style={{ flexDirection: 'row', gap: 12 }}>
          <View style={{ flex: 1 }}>
            <Button title={t('common.cancel')} variant="outline" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
          </View>
          <View style={{ flex: 1 }}>
            <Button title={saving ? t('common.saving') : slip ? t('slip.confirm') : t('common.save')} onPress={save} disabled={saving} />
          </View>
        </View>
      </Card>
    </ScrollView>
  );
}

function Field({ label, error, children }: { label: string; error?: string; children: ReactNode }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={styles.label}>{label}</Text>
      {children}
      {!!error && <Text style={{ color: COLORS.out, fontSize: 13 }}>{error}</Text>}
    </View>
  );
}

function SlipLine({ label, value }: { label: string; value: string }) {
  return (
    <Text style={{ fontSize: 13, color: COLORS.text }}>
      <Text style={{ color: COLORS.muted }}>{label}: </Text>
      {value}
    </Text>
  );
}

/** Up to 6 previously used payees matching what was typed (most recent first). */
function payeeSuggestions(known: string[], typed: string): string[] {
  const q = typed.trim().toLowerCase();
  return known.filter((p) => p.toLowerCase() !== q && (q === '' || p.toLowerCase().includes(q))).slice(0, 6);
}

function parseAmount(text: string): number | null {
  const n = Number(text.replace(/,/g, ''));
  return text.trim() === '' || !Number.isFinite(n) ? null : Math.round(n * 100) / 100;
}

/** Preferred account if it still exists, otherwise the first account. */
function pickDefaultAccount(summary: AccountsSummary, preferred: number | null): number | null {
  const accs = summary.accounts;
  return accs.find((a) => a.id === preferred)?.id ?? accs[0]?.id ?? null;
}

/** Adding from a past/future month defaults the date to the 1st of that month, otherwise today. */
function defaultDate(month?: string): string {
  if (month && /^\d{4}-\d{2}$/.test(month) && month !== currentMonth()) return `${month}-01`;
  return toISODate(new Date());
}

const styles = StyleSheet.create({
  page: { padding: 16, gap: 12, maxWidth: 640, width: '100%', alignSelf: 'center' },
  balanceCard: { backgroundColor: COLORS.primary, borderColor: COLORS.primary, gap: 4 },
  balanceLabel: { color: '#f5e9dc', fontSize: 14 },
  balanceValue: { color: '#fff', fontSize: 26, fontWeight: '800' },
  balanceSub: { color: '#e8d5c0', fontSize: 12 },
  slipCard: {
    flexDirection: 'row',
    gap: 12,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: COLORS.pendingBorder,
    backgroundColor: COLORS.pendingBg,
  },
  slipThumb: { width: 80, height: 120, borderRadius: 6, backgroundColor: '#fde68a' },
  slipTitle: { fontWeight: '700', color: COLORS.pending },
  ruleBadge: { fontSize: 12, fontWeight: '700', color: COLORS.primary },
  ocrText: { fontSize: 11, color: COLORS.muted, backgroundColor: COLORS.input, padding: 8, borderRadius: 6 },
  label: { fontWeight: '700', color: COLORS.text },
  hint: { color: COLORS.muted, fontSize: 13 },
  input: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: COLORS.text,
    backgroundColor: COLORS.input,
  },
  pickerWrap: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    backgroundColor: COLORS.input,
    overflow: 'hidden',
  },
  picker: { fontSize: 16, color: COLORS.text, padding: 10, borderWidth: 0, backgroundColor: 'transparent' },
  payeeChip: {
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.subtle,
  },
  catBtn: { borderWidth: 1.5, borderRadius: 20, paddingVertical: 8, paddingHorizontal: 14 },
  readonly: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    borderRadius: 8,
    backgroundColor: COLORS.subtle,
  },
});
