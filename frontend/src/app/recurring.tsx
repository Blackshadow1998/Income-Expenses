import { Picker } from '@react-native-picker/picker';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Account, api, Category, Recurring, RecurringInput } from '@/api';
import { FadeIn, PressScale } from '@/components/motion';
import { Button, Card, ErrorBox, IconBubble, Loading } from '@/components/ui';
import {
  accountLabel, CATEGORY_COLORS, CATEGORY_ICONS, CATEGORY_TINTS, COLORS, confirmAsync, dateLabel, money, showError, showInfo,
} from '@/format';
import { t, tCode } from '@/i18n';

const EMPTY = { day: '', categoryId: null as number | null, subcategoryId: null as number | null, accountId: null as number | null, amount: '', note: '' };

/** Monthly recurring transactions (salary, card bill, internet...): created automatically on their day. */
export default function RecurringScreen() {
  const [rules, setRules] = useState<Recurring[] | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setError(null);
    try {
      const [rs, cs, accs] = await Promise.all([api.recurring(), api.categories(), api.accounts()]);
      setRules(rs);
      setCategories(cs);
      setAccounts(accs.accounts);
      setForm((f) => ({
        ...f,
        categoryId: f.categoryId ?? cs.find((c) => c.code === 'expense')?.id ?? null,
        accountId: f.accountId ?? accs.accounts[0]?.id ?? null,
      }));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const set = (patch: Partial<typeof EMPTY>) => setForm((f) => ({ ...f, ...patch }));
  const category = categories.find((c) => c.id === form.categoryId);

  const body = (active: boolean): RecurringInput | null => {
    const day = Number(form.day);
    const amount = Number(form.amount.replace(/,/g, ''));
    if (!(day >= 1 && day <= 31) || !form.categoryId || !form.accountId || !(amount > 0)) return null;
    return { day, category_id: form.categoryId, subcategory_id: form.subcategoryId, account_id: form.accountId, amount, note: form.note.trim(), payee: '', active };
  };

  const save = async () => {
    const b = body(rules?.find((r) => r.id === editId)?.active ?? true);
    if (!b) return showError(new Error(t('recurring.fillError')));
    setSaving(true);
    try {
      const res = await api.saveRecurring(editId, b);
      if (res.created_transactions > 0) showInfo(t('recurring.createdTitle'), t('recurring.createdBody', { n: res.created_transactions }));
      setEditId(null);
      setForm((f) => ({ ...EMPTY, categoryId: f.categoryId, accountId: f.accountId }));
      await load();
    } catch (e) {
      showError(e);
    } finally {
      setSaving(false);
    }
  };

  const edit = (r: Recurring) => {
    setEditId(r.id);
    setForm({ day: String(r.day), categoryId: r.category_id, subcategoryId: r.subcategory_id, accountId: r.account_id, amount: String(r.amount), note: r.note });
  };

  const toggle = async (r: Recurring) => {
    try {
      await api.saveRecurring(r.id, { day: r.day, category_id: r.category_id, subcategory_id: r.subcategory_id, account_id: r.account_id, amount: r.amount, note: r.note, payee: r.payee, active: !r.active });
      await load();
    } catch (e) {
      showError(e);
    }
  };

  const remove = async (r: Recurring) => {
    if (!(await confirmAsync(t('recurring.deleteTitle'), t('recurring.deleteBody', { name: r.note || r.subcategory_name || tCode('category', r.category_code, r.category_name) })))) return;
    try {
      await api.removeRecurring(r.id);
      if (editId === r.id) setEditId(null);
      await load();
    } catch (e) {
      showError(e);
    }
  };

  if (error) return <View style={styles.page}><ErrorBox message={error} onRetry={load} /></View>;
  if (!rules) return <Loading />;

  // The server builds account labels in Thai; use the app's language when the account is in the list.
  const labelOf = (id: number, fallback: string) => {
    const a = accounts.find((x) => x.id === id);
    return a ? accountLabel(a) : fallback;
  };

  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <Card style={{ gap: 12 }}>
        <Text style={styles.h2}>{editId ? t('recurring.edit') : t('recurring.add')}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {categories.map((c) => {
            const active = c.id === form.categoryId;
            const color = CATEGORY_COLORS[c.code];
            return (
              <PressScale key={c.id} onPress={() => set({ categoryId: c.id, subcategoryId: null })} style={[styles.chip, { borderColor: color }, active && { backgroundColor: color }]}>
                <Text style={{ color: active ? '#fff' : color, fontWeight: '700' }}>{CATEGORY_ICONS[c.code]} {tCode('category', c.code, c.name)}</Text>
              </PressScale>
            );
          })}
        </View>
        {!!category?.subcategories.length && (
          <View style={styles.pickerWrap}>
            <Picker selectedValue={form.subcategoryId ?? 0} onValueChange={(v) => set({ subcategoryId: Number(v) || null })} style={styles.picker}>
              <Picker.Item label={t('form.itemNone')} value={0} />
              {category.subcategories.map((s) => <Picker.Item key={s.id} label={s.name} value={s.id} />)}
            </Picker>
          </View>
        )}
        <View style={styles.pickerWrap}>
          <Picker selectedValue={form.accountId ?? 0} onValueChange={(v) => set({ accountId: Number(v) || null })} style={styles.picker}>
            <Picker.Item label={t('form.pickAccount')} value={0} />
            {accounts.map((a) => <Picker.Item key={a.id} label={accountLabel(a)} value={a.id} />)}
          </Picker>
        </View>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TextInput value={form.day} onChangeText={(v) => set({ day: v.replace(/\D/g, '').slice(0, 2) })} placeholder={t('recurring.dayPh')} placeholderTextColor="#9ca3af" keyboardType="number-pad" style={[styles.input, { flex: 1, minWidth: 0 }]} />
          <TextInput value={form.amount} onChangeText={(v) => set({ amount: v.replace(/[^0-9.,]/g, '') })} placeholder={t('form.amount')} placeholderTextColor="#9ca3af" keyboardType="decimal-pad" style={[styles.input, { flex: 1.3, minWidth: 0 }]} />
        </View>
        <TextInput value={form.note} onChangeText={(v) => set({ note: v })} placeholder={t('recurring.notePh')} placeholderTextColor="#9ca3af" style={styles.input} />
        <Text style={styles.hint}>{t('recurring.hint')}</Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {!!editId && <Button title={t('common.cancel')} variant="outline" style={{ flex: 1 }} onPress={() => { setEditId(null); setForm((f) => ({ ...EMPTY, categoryId: f.categoryId, accountId: f.accountId })); }} />}
          <Button title={saving ? t('common.saving') : t('common.save')} style={{ flex: 1 }} onPress={save} disabled={saving} />
        </View>
      </Card>

      {rules.length === 0 && <Text style={[styles.hint, { textAlign: 'center' }]}>{t('recurring.empty')}</Text>}
      {rules.map((r, i) => (
        <FadeIn key={r.id} delay={i * 50}>
          <PressScale onPress={() => edit(r)} scaleTo={0.98} style={[styles.row, !r.active && { opacity: 0.55 }]}>
            <IconBubble icon={CATEGORY_ICONS[r.category_code]} tint={CATEGORY_TINTS[r.category_code]} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={styles.name} numberOfLines={1}>{r.note || r.subcategory_name || tCode('category', r.category_code, r.category_name)}</Text>
              <Text style={styles.hint} numberOfLines={1}>{t('recurring.every', { day: r.day, account: labelOf(r.account_id, r.account_label) })}</Text>
              <Text style={styles.hint}>{r.active ? t('recurring.next', { date: dateLabel(r.next_date) }) : t('recurring.paused')}</Text>
            </View>
            <View style={{ alignItems: 'flex-end', gap: 6 }}>
              <Text style={{ fontWeight: '800', color: CATEGORY_COLORS[r.category_code] }}>{money(r.amount)}</Text>
              <View style={{ flexDirection: 'row', gap: 6 }}>
                <PressScale onPress={() => toggle(r)} hitSlop={6} scaleTo={0.85} style={styles.iconBtn} accessibilityLabel={r.active ? t('recurring.pause') : t('recurring.resume')}>
                  <Text style={{ fontSize: 12 }}>{r.active ? '⏸️' : '▶️'}</Text>
                </PressScale>
                <PressScale onPress={() => remove(r)} hitSlop={6} scaleTo={0.85} style={[styles.iconBtn, { backgroundColor: COLORS.dangerSoft }]} accessibilityLabel={t('common.delete')}>
                  <Text style={{ fontSize: 12 }}>🗑️</Text>
                </PressScale>
              </View>
            </View>
          </PressScale>
        </FadeIn>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, gap: 12, maxWidth: 640, width: '100%', alignSelf: 'center', paddingBottom: 32 },
  h2: { fontSize: 16, fontWeight: '800', color: COLORS.text },
  hint: { color: COLORS.muted, fontSize: 12 },
  chip: { borderWidth: 1.5, borderRadius: 999, paddingVertical: 7, paddingHorizontal: 12 },
  pickerWrap: { borderWidth: 1, borderColor: COLORS.border, borderRadius: 12, backgroundColor: COLORS.input, overflow: 'hidden' },
  picker: { fontSize: 16, color: COLORS.text, padding: 10, borderWidth: 0, backgroundColor: 'transparent' },
  input: { borderWidth: 1, borderColor: COLORS.border, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16, color: COLORS.text, backgroundColor: COLORS.input },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 18, backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.border },
  name: { fontWeight: '700', color: COLORS.text },
  iconBtn: { width: 28, height: 28, borderRadius: 14, backgroundColor: COLORS.primarySoft, alignItems: 'center', justifyContent: 'center' },
});
