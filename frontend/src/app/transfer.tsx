import { Picker } from '@react-native-picker/picker';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { ReactNode, useEffect, useState } from 'react';
import { Image, Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Account, api, Slip } from '@/api';
import { PressScale } from '@/components/motion';
import { Button, Card, ErrorBox, Loading } from '@/components/ui';
import { accountLabel, COLORS, confirmAsync, currentMonth, dateLabel, isValidDate, money, showError, toISODate } from '@/format';
import { t } from '@/i18n';
import { getLastAccountId, setPendingMonth } from '@/state';

/** Add or edit a transfer between two of the user's own accounts (or confirm a slip as one). */
export default function TransferScreen() {
  const params = useLocalSearchParams<{ id?: string; month?: string; date?: string; accountId?: string; slipId?: string }>();
  const editId = params.id ? Number(params.id) : undefined;
  const slipId = !editId && params.slipId ? Number(params.slipId) : undefined;

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [slip, setSlip] = useState<Slip | null>(null);
  // The transfer being edited is already in the balances; take it out so they show "before".
  const [original, setOriginal] = useState<{ from: number; to: number; amount: number } | null>(null);
  const [fromId, setFromId] = useState<number | null>(null);
  const [toId, setToId] = useState<number | null>(null);
  const [date, setDate] = useState(() =>
    params.date && isValidDate(params.date)
      ? params.date
      : params.month && params.month !== currentMonth() ? `${params.month}-01` : toISODate(new Date()),
  );
  const [amountText, setAmountText] = useState('');
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const load = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [accs, tr, sl] = await Promise.all([
        api.accounts(),
        editId ? api.getTransfer(editId) : Promise.resolve(null),
        slipId ? api.getSlip(slipId) : Promise.resolve(null),
      ]);
      if (sl && sl.status !== 'pending') throw new Error(t('slip.alreadyConfirmed'));
      setAccounts(accs.accounts);
      setSlip(sl);
      if (tr) {
        setOriginal({ from: tr.from_account_id, to: tr.to_account_id, amount: tr.amount });
        setFromId(tr.from_account_id);
        setToId(tr.to_account_id);
        setDate(tr.date);
        setAmountText(String(tr.amount));
        setNote(tr.note);
      } else if (sl) {
        // From the slip: its rule's accounts, else the accounts at the sender's and receiver's banks.
        const known = (id: number | null | undefined) => accs.accounts.find((a) => a.id === id)?.id;
        const atBank = (bank: number | null, not?: number | null) =>
          accs.accounts.find((a) => a.bank_id === bank && a.id !== not)?.id;
        const from = known(sl.suggestion?.account_id) ?? atBank(sl.bank_id) ?? null;
        setFromId(from);
        setToId(known(sl.suggestion?.to_account_id) ?? atBank(sl.to_bank_id, from) ?? null);
        setDate(sl.date);
        if (sl.amount > 0) setAmountText(String(sl.amount));
        setNote(sl.suggestion?.note ?? '');
      } else {
        // From: the filtered or last used account, else the one with the most money.
        const known = (id: number | null) => accs.accounts.find((a) => a.id === id)?.id;
        const richest = [...accs.accounts].sort((a, b) => b.balance - a.balance)[0]?.id;
        const first = known(Number(params.accountId) || null) ?? known(getLastAccountId()) ?? richest ?? null;
        setFromId(first);
        setToId(accs.accounts.find((a) => a.id !== first)?.id ?? null);
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

  const amount = parseAmount(amountText);
  const before = (id: number | null) => {
    const a = accounts.find((x) => x.id === id);
    if (!a) return 0;
    let b = a.balance;
    if (original?.from === id) b += original.amount;
    if (original?.to === id) b -= original.amount;
    return b;
  };

  const shiftDay = (delta: number) => {
    if (!isValidDate(date)) return;
    const [y, m, d] = date.split('-').map(Number);
    setDate(toISODate(new Date(y, m - 1, d + delta)));
  };

  const save = async () => {
    const errs: Record<string, string> = {};
    if (!fromId) errs.from = t('transfer.pickFrom');
    if (!toId) errs.to = t('transfer.pickTo');
    if (fromId && fromId === toId) errs.to = t('transfer.sameAccount');
    if (!isValidDate(date)) errs.date = t('form.dateFormat');
    if (amount === null || amount <= 0) errs.amount = t('form.amountPositive');
    setErrors(errs);
    if (Object.keys(errs).length) return;

    const body = {
      date, from_account_id: fromId!, to_account_id: toId!, amount: amount!, note: note.trim(),
      ...(slip ? { slip_id: slip.id } : {}),
    };
    setSaving(true);
    try {
      if (editId) await api.updateTransfer(editId, body);
      else await api.createTransfer(body);
      setPendingMonth(date.slice(0, 7));
      if (router.canGoBack()) router.back();
      else router.replace('/');
    } catch (e) {
      showError(e);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!editId || !(await confirmAsync(t('transfer.deleteTitle'), t('transfer.deleteBody', { amount: money(amount ?? 0) })))) return;
    try {
      await api.removeTransfer(editId);
      if (router.canGoBack()) router.back();
      else router.replace('/');
    } catch (e) {
      showError(e);
    }
  };

  const title = editId ? t('transfer.edit') : slipId ? t('transfer.confirmSlip') : t('transfer.title');
  if (loading)
    return (
      <>
        <Stack.Screen options={{ title }} />
        <Loading />
      </>
    );
  if (loadError)
    return (
      <View style={styles.page}>
        <Stack.Screen options={{ title }} />
        <ErrorBox message={loadError} onRetry={load} />
      </View>
    );

  if (accounts.length < 2)
    return (
      <View style={styles.page}>
        <Stack.Screen options={{ title }} />
        <Card style={{ alignItems: 'center', gap: 10, paddingVertical: 24 }}>
          <Text style={{ fontSize: 32 }}>⇄</Text>
          <Text style={{ color: COLORS.muted, textAlign: 'center' }}>{t('transfer.needTwo')}</Text>
          <Button title={t('accounts.add')} icon="＋" onPress={() => router.push('/account')} />
        </Card>
      </View>
    );

  const picker = (value: number | null, onChange: (id: number | null) => void) => (
    <View style={styles.pickerWrap}>
      <Picker selectedValue={value ?? 0} onValueChange={(v) => onChange(Number(v) || null)} style={styles.picker}>
        <Picker.Item label={t('form.pickAccount')} value={0} color={COLORS.muted} />
        {accounts.map((a) => (
          <Picker.Item key={a.id} label={`${accountLabel(a)}  (${money(before(a.id))})`} value={a.id} />
        ))}
      </Picker>
    </View>
  );

  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title }} />
      {slip && (
        <View style={styles.slipCard}>
          <Pressable onPress={() => Linking.openURL(api.slipImageUrl(slip))} accessibilityLabel={t('slip.viewImage')}>
            <Image source={{ uri: api.slipImageUrl(slip) }} style={styles.slipThumb} resizeMode="cover" />
          </Pressable>
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={styles.slipTitle}>{t('slip.fromSlipTitle')}</Text>
            <Text style={styles.hint}>{t('slip.fromLine', { name: slip.from_name || '-' })}{slip.bank_name ? ` · ${slip.bank_name}` : ''}</Text>
            <Text style={styles.hint}>{t('slip.toLine', { name: slip.to_name || '-' })}{slip.to_bank_name ? ` · ${slip.to_bank_name}` : ''}</Text>
            {!!slip.suggestion && <Text style={styles.ruleBadge}>{t('slip.ruleUsed', { name: slip.suggestion.rule_name })}</Text>}
            <Pressable onPress={() => router.replace({ pathname: '/transaction', params: { slipId: String(slip.id), as: 'transaction' } })}>
              <Text style={{ color: COLORS.primary, fontSize: 12 }}>{t('transfer.notTransfer')}</Text>
            </Pressable>
          </View>
        </View>
      )}
      <Card style={{ gap: 16 }}>
        <Text style={styles.hint}>{t('transfer.hint')}</Text>

        <Field label={t('transfer.from')} error={errors.from}>
          {picker(fromId, setFromId)}
        </Field>

        <PressScale
          onPress={() => {
            setFromId(toId);
            setToId(fromId);
          }}
          scaleTo={0.85}
          style={styles.swap}
          accessibilityLabel={t('transfer.swap')}
        >
          <Text style={{ color: COLORS.primary, fontSize: 18, fontWeight: '800' }}>⇅</Text>
        </PressScale>

        <Field label={t('transfer.to')} error={errors.to}>
          {picker(toId, setToId)}
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

        {fromId && toId && fromId !== toId && (
          <View style={styles.readonly}>
            <AfterLine label={t('transfer.fromAfter')} value={before(fromId) - (amount ?? 0)} />
            <AfterLine label={t('transfer.toAfter')} value={before(toId) + (amount ?? 0)} />
          </View>
        )}

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

        <Field label={t('form.note')}>
          <TextInput value={note} onChangeText={setNote} placeholder={t('transfer.noteHint')} style={styles.input} />
        </Field>

        <View style={{ flexDirection: 'row', gap: 12 }}>
          <Button title={t('common.cancel')} variant="outline" style={{ flex: 1 }} onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
          <Button title={saving ? t('common.saving') : slip ? t('slip.confirm') : t('common.save')} style={{ flex: 1 }} onPress={save} disabled={saving} />
        </View>
        {!!editId && <Button title={t('transfer.delete')} variant="danger" onPress={remove} />}
      </Card>
    </ScrollView>
  );
}

function AfterLine({ label, value }: { label: string; value: number }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
      <Text style={{ color: COLORS.muted }}>{label}</Text>
      <Text style={{ fontWeight: '700', color: value >= 0 ? COLORS.text : COLORS.out }}>{t('money.bahtValue', { amount: money(value) })}</Text>
    </View>
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

function parseAmount(text: string): number | null {
  const n = Number(text.replace(/,/g, ''));
  return text.trim() === '' || !Number.isFinite(n) ? null : Math.round(n * 100) / 100;
}

const styles = StyleSheet.create({
  page: { padding: 16, gap: 12, maxWidth: 640, width: '100%', alignSelf: 'center' },
  label: { fontWeight: '700', color: COLORS.text },
  hint: { color: COLORS.muted, fontSize: 13 },
  input: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: COLORS.text,
    backgroundColor: COLORS.input,
  },
  pickerWrap: { borderWidth: 1, borderColor: COLORS.border, borderRadius: 12, backgroundColor: COLORS.input, overflow: 'hidden' },
  picker: { fontSize: 16, color: COLORS.text, padding: 10, borderWidth: 0, backgroundColor: 'transparent' },
  swap: {
    alignSelf: 'center',
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: -6,
  },
  readonly: { gap: 6, padding: 12, borderRadius: 12, backgroundColor: COLORS.subtle },
  slipCard: { flexDirection: 'row', gap: 12, padding: 12, borderRadius: 16, borderWidth: 1, borderColor: COLORS.pendingBorder, backgroundColor: COLORS.pendingBg },
  slipThumb: { width: 64, height: 96, borderRadius: 6, backgroundColor: '#fde68a' },
  slipTitle: { fontWeight: '700', color: COLORS.pending },
  ruleBadge: { fontSize: 12, fontWeight: '700', color: COLORS.primary },
});
