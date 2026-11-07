import { Picker } from '@react-native-picker/picker';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { ReactNode, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Account, api, Option } from '@/api';
import { Button, Card, ErrorBox, Loading } from '@/components/ui';
import { ACCOUNT_TYPE_COLORS, COLORS, money, showError } from '@/format';

export default function AccountFormScreen() {
  const params = useLocalSearchParams<{ id?: string }>();
  const editId = params.id ? Number(params.id) : undefined;
  const isEdit = !!editId;

  const [banks, setBanks] = useState<Option[]>([]);
  const [types, setTypes] = useState<Option[]>([]);
  const [existing, setExisting] = useState<Account | null>(null);
  const [bankId, setBankId] = useState<number | null>(null);
  const [typeId, setTypeId] = useState<number | null>(null);
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
        setExisting(acc);
        setBankId(acc.bank_id);
        setTypeId(acc.type_id);
        setName(acc.name);
        setAmountText(String(acc.opening_balance));
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

  const save = async () => {
    const amount = amountText.trim() === '' ? 0 : Number(amountText.replace(/,/g, ''));
    const errs: Record<string, string> = {};
    if (!bankId) errs.bank = 'กรุณาเลือกธนาคาร';
    if (!typeId) errs.type = 'กรุณาเลือกประเภทบัญชี';
    if (!Number.isFinite(amount)) errs.amount = 'จำนวนเงินไม่ถูกต้อง';
    setErrors(errs);
    if (Object.keys(errs).length) return;

    const body = { bank_id: bankId!, type_id: typeId!, name: name.trim(), opening_balance: Math.round(amount * 100) / 100 };
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

  const title = isEdit ? 'แก้ไขบัญชี' : 'เพิ่มบัญชีใหม่';
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

      {existing && (
        <Card style={styles.balanceCard}>
          <Text style={{ color: '#e0e7ff' }}>เงินคงเหลือปัจจุบันของบัญชีนี้</Text>
          <Text style={styles.balanceValue}>{money(existing.balance)} บาท</Text>
          <Text style={{ color: '#c7d2fe', fontSize: 12 }}>{existing.transaction_count} รายการรับ/จ่าย</Text>
        </Card>
      )}

      <Card style={{ gap: 16 }}>
        <Field label="ธนาคาร" error={errors.bank}>
          <View style={styles.pickerWrap}>
            <Picker selectedValue={bankId ?? 0} onValueChange={(v) => setBankId(Number(v) || null)} style={styles.picker}>
              <Picker.Item label="-- เลือกธนาคาร --" value={0} color={COLORS.muted} />
              {banks.map((b) => (
                <Picker.Item key={b.id} label={b.name} value={b.id} />
              ))}
            </Picker>
          </View>
        </Field>

        <Field label="ประเภท" error={errors.type}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {types.map((t) => {
              const active = t.id === typeId;
              const color = ACCOUNT_TYPE_COLORS[t.code ?? ''] ?? COLORS.primary;
              return (
                <Pressable
                  key={t.id}
                  onPress={() => setTypeId(t.id)}
                  style={[styles.typeBtn, { borderColor: color }, active && { backgroundColor: color }]}
                >
                  <Text style={{ color: active ? '#fff' : color, fontWeight: '700' }}>{t.name}</Text>
                </Pressable>
              );
            })}
          </View>
        </Field>

        <Field label="ชื่อบัญชี (ไม่บังคับ)">
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="เช่น บัญชีหลัก, xxx-1234"
            style={styles.input}
          />
        </Field>

        <Field label={isEdit ? 'จำนวนเงินเริ่มต้น (บาท)' : 'จำนวนเงิน (บาท)'} error={errors.amount}>
          <TextInput
            value={amountText}
            onChangeText={(t) => setAmountText(t.replace(/[^0-9.,-]/g, ''))}
            placeholder="0.00"
            keyboardType="numbers-and-punctuation"
            style={[styles.input, { fontSize: 18 }]}
          />
          <Text style={styles.hint}>
            ยอดเงินในบัญชีตอนเริ่มใช้งาน รายการรับ/จ่ายที่บันทึกภายหลังจะบวก/ลบจากยอดนี้ (บัตรเครดิตที่มียอดค้าง ใส่เป็นค่าติดลบได้)
          </Text>
        </Field>

        <View style={{ flexDirection: 'row', gap: 12 }}>
          <View style={{ flex: 1 }}>
            <Button title="ยกเลิก" variant="outline" onPress={() => (router.canGoBack() ? router.back() : router.replace('/accounts'))} />
          </View>
          <View style={{ flex: 1 }}>
            <Button title={saving ? 'กำลังบันทึก...' : 'บันทึก'} onPress={save} disabled={saving} />
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
  typeBtn: { borderWidth: 1.5, borderRadius: 20, paddingVertical: 8, paddingHorizontal: 14 },
});
