import { Picker } from '@react-native-picker/picker';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Account, api, Category, Option, SlipRule, SlipRuleInput } from '@/api';
import { FadeIn, PressScale } from '@/components/motion';
import { Button, Card, ErrorBox, IconBubble, Loading } from '@/components/ui';
import { accountLabel, bankName, CATEGORY_COLORS, CATEGORY_ICONS, CATEGORY_TINTS, COLORS, confirmAsync, showError } from '@/format';
import { t, tCode } from '@/i18n';

type Form = Omit<SlipRuleInput, 'bank_id' | 'category_id' | 'subcategory_id' | 'account_id' | 'to_account_id'> & {
  bank_id: number | null;
  category_id: number | null;
  subcategory_id: number | null;
  account_id: number | null;
  to_account_id: number | null;
};

const EMPTY: Form = {
  name: '', match_kind: 'to', match_text: '', bank_id: null, action: 'transaction',
  category_id: null, subcategory_id: null, account_id: null, to_account_id: null, payee: '', note: '',
};

const KINDS: { kind: SlipRule['match_kind']; label: string }[] = [
  { kind: 'to', label: t('rules.kindTo') },
  { kind: 'from', label: t('rules.kindFrom') },
  { kind: 'self', label: t('rules.kindSelf') },
];

const condition = (r: SlipRule) =>
  (r.match_kind === 'self' ? t('rules.condSelf') : t(r.match_kind === 'to' ? 'rules.condTo' : 'rules.condFrom', { text: r.match_text })) +
  (r.bank_name ? t('rules.condBank', { bank: bankName(r.bank_name) }) : '');

/** Category and account names come from the server in Thai: rebuild them from the lists when we have them. */
const outcome = (r: SlipRule, categories: Category[], accounts: Account[]) => {
  const label = (id: number | null, fallback: string) => {
    const a = accounts.find((x) => x.id === id);
    return a ? accountLabel(a) : fallback;
  };
  const c = categories.find((x) => x.id === r.category_id);
  return r.action === 'transfer'
    ? t('rules.outTransfer', { account: label(r.to_account_id, r.to_account_label) || t('rules.receivingBankAccount') })
    : [c ? tCode('category', c.code, c.name) : r.category_name, r.subcategory_name, label(r.account_id, r.account_label)].filter(Boolean).join(' · ');
};

/** Slip rules: "when a scanned slip looks like this, prefill the confirm form like that". */
export default function SlipRulesScreen() {
  const [rules, setRules] = useState<SlipRule[] | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [banks, setBanks] = useState<Option[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState<Form>(EMPTY);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setError(null);
    try {
      const [rs, cs, accs, opts] = await Promise.all([api.slipRules(), api.categories(), api.accounts(), api.accountOptions()]);
      setRules(rs);
      setCategories(cs);
      setAccounts(accs.accounts);
      setBanks(opts.banks);
      setForm((f) => ({ ...f, category_id: f.category_id ?? cs.find((c) => c.code === 'expense')?.id ?? null }));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const set = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }));
  const category = categories.find((c) => c.id === form.category_id);
  const reset = () => {
    setEditId(null);
    setForm((f) => ({ ...EMPTY, category_id: f.category_id }));
  };

  const save = async () => {
    if (!form.name.trim()) return showError(new Error(t('rules.nameError')));
    if (form.match_kind !== 'self' && !form.match_text.trim()) return showError(new Error(t('rules.textError')));
    if (form.action === 'transaction' && !form.category_id) return showError(new Error(t('rules.categoryError')));
    setSaving(true);
    try {
      await api.saveSlipRule(editId, {
        ...form,
        name: form.name.trim(),
        match_text: form.match_text.trim(),
        payee: form.payee.trim(),
        note: form.note.trim(),
      } as SlipRuleInput);
      reset();
      await load();
    } catch (e) {
      showError(e);
    } finally {
      setSaving(false);
    }
  };

  const edit = (r: SlipRule) => {
    setEditId(r.id);
    setForm({
      name: r.name, match_kind: r.match_kind, match_text: r.match_text, bank_id: r.bank_id, action: r.action,
      category_id: r.category_id ?? form.category_id, subcategory_id: r.subcategory_id, account_id: r.account_id,
      to_account_id: r.to_account_id, payee: r.payee, note: r.note,
    });
  };

  const move = async (r: SlipRule, dir: -1 | 1) => {
    try {
      await api.moveSlipRule(r.id, dir);
      await load();
    } catch (e) {
      showError(e);
    }
  };

  const remove = async (r: SlipRule) => {
    if (!(await confirmAsync(t('rules.deleteTitle'), t('rules.deleteBody', { name: r.name })))) return;
    try {
      await api.removeSlipRule(r.id);
      if (editId === r.id) reset();
      await load();
    } catch (e) {
      showError(e);
    }
  };

  if (error) return <View style={styles.page}><ErrorBox message={error} onRetry={load} /></View>;
  if (!rules) return <Loading />;

  const accountPicker = (value: number | null, onChange: (id: number | null) => void, emptyLabel: string) => (
    <View style={styles.pickerWrap}>
      <Picker selectedValue={value ?? 0} onValueChange={(v) => onChange(Number(v) || null)} style={styles.picker}>
        <Picker.Item label={emptyLabel} value={0} />
        {accounts.map((a) => <Picker.Item key={a.id} label={accountLabel(a)} value={a.id} />)}
      </Picker>
    </View>
  );

  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <Card style={{ gap: 12 }}>
        <Text style={styles.h2}>{editId ? t('rules.edit') : t('rules.add')}</Text>
        <TextInput value={form.name} onChangeText={(v) => set({ name: v })} maxLength={40} placeholder={t('rules.namePh')} placeholderTextColor="#9ca3af" style={styles.input} />

        <Text style={styles.label}>{t('rules.if')}</Text>
        <View style={styles.chips}>
          {KINDS.map((k) => {
            const active = form.match_kind === k.kind;
            return (
              <PressScale key={k.kind} onPress={() => set({ match_kind: k.kind, ...(k.kind === 'self' && { action: 'transfer' }) })} style={[styles.chip, active && styles.chipActive]}>
                <Text style={{ color: active ? '#fff' : COLORS.primary, fontWeight: '700' }}>{k.label}</Text>
              </PressScale>
            );
          })}
        </View>
        {form.match_kind !== 'self' && (
          <TextInput value={form.match_text} onChangeText={(v) => set({ match_text: v })} placeholder={form.match_kind === 'to' ? t('rules.toPh') : t('rules.fromPh')} placeholderTextColor="#9ca3af" style={styles.input} />
        )}
        <View style={styles.pickerWrap}>
          <Picker selectedValue={form.bank_id ?? 0} onValueChange={(v) => set({ bank_id: Number(v) || null })} style={styles.picker}>
            <Picker.Item label={t('rules.anyBank')} value={0} />
            {banks.map((b) => <Picker.Item key={b.id} label={t('rules.bankItem', { name: b.name })} value={b.id} />)}
          </Picker>
        </View>

        <Text style={styles.label}>{t('rules.then')}</Text>
        <View style={styles.chips}>
          {(['transaction', 'transfer'] as const).map((a) => {
            const active = form.action === a;
            return (
              <PressScale key={a} onPress={() => set({ action: a })} style={[styles.chip, active && styles.chipActive]}>
                <Text style={{ color: active ? '#fff' : COLORS.primary, fontWeight: '700' }}>{a === 'transaction' ? t('rules.asTxn') : t('rules.asTransfer')}</Text>
              </PressScale>
            );
          })}
        </View>

        {form.action === 'transaction' ? (
          <>
            <View style={styles.chips}>
              {categories.map((c) => {
                const active = c.id === form.category_id;
                const color = CATEGORY_COLORS[c.code];
                return (
                  <PressScale key={c.id} onPress={() => set({ category_id: c.id, subcategory_id: null })} style={[styles.chip, { borderColor: color }, active && { backgroundColor: color }]}>
                    <Text style={{ color: active ? '#fff' : color, fontWeight: '700' }}>{CATEGORY_ICONS[c.code]} {tCode('category', c.code, c.name)}</Text>
                  </PressScale>
                );
              })}
            </View>
            {!!category?.subcategories.length && (
              <View style={styles.pickerWrap}>
                <Picker selectedValue={form.subcategory_id ?? 0} onValueChange={(v) => set({ subcategory_id: Number(v) || null })} style={styles.picker}>
                  <Picker.Item label={t('form.itemNone')} value={0} />
                  {category.subcategories.map((s) => <Picker.Item key={s.id} label={s.name} value={s.id} />)}
                </Picker>
              </View>
            )}
            {accountPicker(form.account_id, (id) => set({ account_id: id }), t('rules.accountBySlip'))}
            <TextInput value={form.payee} onChangeText={(v) => set({ payee: v })} placeholder={t('rules.payeePh')} placeholderTextColor="#9ca3af" style={styles.input} />
          </>
        ) : (
          <>
            {accountPicker(form.account_id, (id) => set({ account_id: id }), t('rules.fromBySlip'))}
            {accountPicker(form.to_account_id, (id) => set({ to_account_id: id }), t('rules.toByBank'))}
          </>
        )}
        <TextInput value={form.note} onChangeText={(v) => set({ note: v })} placeholder={t('rules.notePh')} placeholderTextColor="#9ca3af" style={styles.input} />
        <Text style={styles.hint}>{t('rules.hint')}</Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {!!editId && <Button title={t('common.cancel')} variant="outline" style={{ flex: 1 }} onPress={reset} />}
          <Button title={saving ? t('common.saving') : t('common.save')} style={{ flex: 1 }} onPress={save} disabled={saving} />
        </View>
      </Card>

      {rules.length === 0 && <Text style={[styles.hint, { textAlign: 'center' }]}>{t('rules.empty')}</Text>}
      {rules.map((r, i) => {
        const code = categories.find((c) => c.id === r.category_id)?.code;
        return (
          <FadeIn key={r.id} delay={i * 50}>
            <PressScale onPress={() => edit(r)} scaleTo={0.98} style={[styles.row, editId === r.id && { borderColor: COLORS.primary }]}>
              {r.action === 'transfer' || !code
                ? <IconBubble icon="🔁" tint={COLORS.primarySoft} />
                : <IconBubble icon={CATEGORY_ICONS[code]} tint={CATEGORY_TINTS[code]} />}
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={styles.name} numberOfLines={1}>{i + 1}. {r.name}</Text>
                <Text style={styles.hint} numberOfLines={1}>{condition(r)}</Text>
                <Text style={styles.hint} numberOfLines={1}>{outcome(r, categories, accounts)}</Text>
              </View>
              <View style={{ flexDirection: 'row', gap: 6 }}>
                <PressScale onPress={() => move(r, -1)} disabled={i === 0} hitSlop={6} scaleTo={0.85} style={styles.iconBtn} accessibilityLabel={t('rules.up')}>
                  <Text style={styles.iconText}>▲</Text>
                </PressScale>
                <PressScale onPress={() => move(r, 1)} disabled={i === rules.length - 1} hitSlop={6} scaleTo={0.85} style={styles.iconBtn} accessibilityLabel={t('rules.down')}>
                  <Text style={styles.iconText}>▼</Text>
                </PressScale>
                <PressScale onPress={() => remove(r)} hitSlop={6} scaleTo={0.85} style={[styles.iconBtn, { backgroundColor: COLORS.dangerSoft }]} accessibilityLabel={t('common.delete')}>
                  <Text style={{ fontSize: 12 }}>🗑️</Text>
                </PressScale>
              </View>
            </PressScale>
          </FadeIn>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, gap: 12, maxWidth: 640, width: '100%', alignSelf: 'center', paddingBottom: 32 },
  h2: { fontSize: 16, fontWeight: '800', color: COLORS.text },
  label: { fontWeight: '700', color: COLORS.text, marginBottom: -4 },
  hint: { color: COLORS.muted, fontSize: 12 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1.5, borderColor: COLORS.primary, borderRadius: 999, paddingVertical: 7, paddingHorizontal: 12 },
  chipActive: { backgroundColor: COLORS.primary },
  pickerWrap: { borderWidth: 1, borderColor: COLORS.border, borderRadius: 12, backgroundColor: COLORS.input, overflow: 'hidden' },
  picker: { fontSize: 16, color: COLORS.text, padding: 10, borderWidth: 0, backgroundColor: 'transparent' },
  input: { borderWidth: 1, borderColor: COLORS.border, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16, color: COLORS.text, backgroundColor: COLORS.input },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 18, backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.border },
  name: { fontWeight: '700', color: COLORS.text },
  iconBtn: { width: 28, height: 28, borderRadius: 14, backgroundColor: COLORS.primarySoft, alignItems: 'center', justifyContent: 'center' },
  iconText: { fontSize: 11, color: COLORS.primary, fontWeight: '800' },
});
