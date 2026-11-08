import { Picker } from '@react-native-picker/picker';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { ReactNode, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Account, api, Option } from '@/api';
import { Button, Card, ErrorBox, Loading } from '@/components/ui';
import { ACCOUNT_TYPE_COLORS, COLORS, money, showError } from '@/format';
import { t, tCode } from '@/i18n';

const CARD_CODE = 'credit_card';
type Kind = 'bank' | 'card';

export default function AccountFormScreen() {
  const params = useLocalSearchParams<{ id?: string }>();
  const editId = params.id ? Number(params.id) : undefined;
  const isEdit = !!editId;

  const [banks, setBanks] = useState<Option[]>([]);
  const [types, setTypes] = useState<Option[]>([]);
  const [existing, setExisting] = useState<Account | null>(null);
  const [bankId, setBankId] = useState<number | null>(null);
  const [typeId, setTypeId] = useState<number | null>(null);
  const [kind, setKind] = useState<Kind>('bank');
  const [name, setName] = useState('');
  const [amountText, setAmountText] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const load = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [opts, acc] = await Promise.all([
        api.accountOptions(),
        editId ? api.getAccount(editId) : Promise.resolve(null),
      ]);
      setBanks(opts.banks);
      setTypes(opts.types);
      if (acc) {
        const isCard = opts.types.find((t) => t.id === acc.type_id)?.code === CARD_CODE;
        setExisting(acc);
        setBankId(acc.bank_id);
        setTypeId(acc.type_id);
        setKind(isCard ? 'card' : 'bank');
        setName(acc.name);
        // A card's opening amount is shown as the positive amount owed.
        setAmountText(String(isCard ? -acc.opening_balance || 0 : acc.opening_balance));
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
  }, [editId]);

  const isCard = kind === 'card';
  const cardTypeId = types.find((t) => t.code === CARD_CODE)?.id ?? null;
  const bankTypes = types.filter((t) => t.code !== CARD_CODE);

  const switchKind = (k: Kind) => {
    if (k === kind) return;
    setKind(k);
    setTypeId(k === 'card' ? cardTypeId : null);
    setErrors({});
  };

  const save = async () => {
    const amount = amountText.trim() === '' ? 0 : Number(amountText.replace(/,/g, ''));
    const chosenType = isCard ? cardTypeId : typeId;
    const errs: Record<string, string> = {};
    if (!bankId) errs.bank = isCard ? t('account.pickIssuer') : t('account.pickBank');
    if (!chosenType) errs.type = t('account.pickType');
    if (!Number.isFinite(amount)) errs.amount = t('account.badAmount');
    setErrors(errs);
    if (Object.keys(errs).length) return;

    const opening = Math.round((isCard ? -amount : amount) * 100) / 100;
    const body = { bank_id: bankId!, type_id: chosenType!, name: name.trim(), opening_balance: opening || 0 };
    setSaving(true);
    try {
      if (editId) await api.updateAccount(editId, body);
      else await api.createAccount(body);
      if (router.canGoBack()) router.back();
      else router.replace('/accounts');
    } catch (e) {
      showError(e);
    } finally {
      setSaving(false);
    }
  };

  const title = isEdit ? (isCard ? t('account.editCard') : t('account.edit')) : isCard ? t('account.addCard') : t('account.add');
  if (loading) return (<><Stack.Screen options={{ title }} /><Loading /></>);
  if (loadError)
    return (
      <View style={styles.page}>
        <Stack.Screen options={{ title }} />
        <ErrorBox message={loadError} onRetry={load} />
      </View>
    );

  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title }} />

      <View style={styles.segment}>
        {(['bank', 'card'] as const).map((k) => (
          <Pressable key={k} onPress={() => switchKind(k)} style={[styles.segBtn, kind === k && styles.segBtnActive]}>
            <Text style={[styles.segText, kind === k && { color: '#fff' }]}>{k === 'bank' ? t('account.kindBank') : t('account.kindCard')}</Text>
          </Pressable>
        ))}
      </View>

      {existing && (
        <Card style={styles.balanceCard}>
          <Text style={{ color: '#f5e9dc' }}>{isCard ? t('account.cardOwedNow') : t('account.balanceNow')}</Text>
          <Text style={styles.balanceValue}>{t('money.bahtValue', { amount: money(isCard ? -existing.balance || 0 : existing.balance) })}</Text>
          <Text style={{ color: '#e8d5c0', fontSize: 12 }}>{t('account.txnCount', { n: existing.transaction_count })}</Text>
        </Card>
      )}

      <Card style={{ gap: 16 }}>
        <Field label={isCard ? t('account.issuer') : t('account.bank')} error={errors.bank}>
          <View style={styles.pickerWrap}>
            <Picker selectedValue={bankId ?? 0} onValueChange={(v) => setBankId(Number(v) || null)} style={styles.picker}>
              <Picker.Item label={t('account.pickBankItem')} value={0} color={COLORS.muted} />
              {banks.map((b) => (
                <Picker.Item key={b.id} label={b.name} value={b.id} />
              ))}
            </Picker>
          </View>
        </Field>

        {isCard ? (
          !!errors.type && <Text style={{ color: COLORS.out, fontSize: 13 }}>{errors.type}</Text>
        ) : (
          <Field label={t('account.type')} error={errors.type}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {bankTypes.map((ty) => {
                const active = ty.id === typeId;
                const color = ACCOUNT_TYPE_COLORS[ty.code ?? ''] ?? COLORS.primary;
                return (
                  <Pressable
                    key={ty.id}
                    onPress={() => setTypeId(ty.id)}
                    style={[styles.typeBtn, { borderColor: color }, active && { backgroundColor: color }]}
                  >
                    <Text style={{ color: active ? '#fff' : color, fontWeight: '700' }}>{tCode('accountType', ty.code, ty.name)}</Text>
                  </Pressable>
                );
              })}
            </View>
          </Field>
        )}

        <Field label={isCard ? t('account.cardName') : t('account.name')}>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder={isCard ? t('account.cardNameHint') : t('account.nameHint')}
            style={styles.input}
          />
        </Field>

        <Field
          label={isCard ? (isEdit ? t('account.cardOpening') : t('account.cardOwed')) : isEdit ? t('account.opening') : t('money.amountBaht')}
          error={errors.amount}
        >
          <TextInput
            value={amountText}
            onChangeText={(v) => setAmountText(v.replace(/[^0-9.,-]/g, ''))}
            placeholder="0.00"
            keyboardType="numbers-and-punctuation"
            style={[styles.input, { fontSize: 18 }]}
          />
          <Text style={styles.hint}>
            {isCard
              ? t('account.cardHint')
              : t('account.hint')}
          </Text>
        </Field>

        <View style={{ flexDirection: 'row', gap: 12 }}>
          <View style={{ flex: 1 }}>
            <Button title={t('common.cancel')} variant="outline" onPress={() => (router.canGoBack() ? router.back() : router.replace('/accounts'))} />
          </View>
          <View style={{ flex: 1 }}>
            <Button title={saving ? t('common.saving') : t('common.save')} onPress={save} disabled={saving} />
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

const styles = StyleSheet.create({
  page: { padding: 16, gap: 12, maxWidth: 640, width: '100%', alignSelf: 'center' },
  balanceCard: { backgroundColor: COLORS.primary, borderColor: COLORS.primary, gap: 4 },
  balanceValue: { color: '#fff', fontSize: 26, fontWeight: '800' },
  label: { fontWeight: '700', color: COLORS.text },
  hint: { color: COLORS.muted, fontSize: 12 },
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
  pickerWrap: { borderWidth: 1, borderColor: COLORS.border, borderRadius: 8, backgroundColor: COLORS.input, overflow: 'hidden' },
  picker: { fontSize: 16, color: COLORS.text, padding: 10, borderWidth: 0, backgroundColor: 'transparent' },
  segment: { flexDirection: 'row', padding: 4, gap: 4, borderRadius: 999, backgroundColor: COLORS.track },
  segBtn: { flex: 1, paddingVertical: 10, borderRadius: 999, alignItems: 'center' },
  segBtnActive: { backgroundColor: COLORS.primary },
  segText: { color: COLORS.muted, fontWeight: '800' },
  typeBtn: { borderWidth: 1.5, borderRadius: 20, paddingVertical: 8, paddingHorizontal: 14 },
});
