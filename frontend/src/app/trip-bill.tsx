import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { api, SplitMode, Trip } from '@/api';
import { PressScale } from '@/components/motion';
import { Button, Card, ErrorBox, Loading } from '@/components/ui';
import { COLORS, confirmAsync, dateLabel, isValidDate, money, showError, toISODate } from '@/format';
import { bahtText, shares, toSatang } from '@/tripSplit';

const MODES: { key: SplitMode; label: string }[] = [
  { key: 'equal', label: 'หารเท่ากัน' },
  { key: 'amount', label: 'ระบุจำนวน' },
  { key: 'ratio', label: 'ตามสัดส่วน' },
];

/** Add or edit a trip bill: title, amount, payer, who shares it and how. */
export default function TripBillScreen() {
  const params = useLocalSearchParams<{ tripId: string; id?: string }>();
  const tripId = Number(params.tripId);
  const billId = params.id ? Number(params.id) : null;
  const [trip, setTrip] = useState<Trip | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [amountText, setAmountText] = useState('');
  const [date, setDate] = useState(toISODate(new Date()));
  const [payer, setPayer] = useState<number | null>(null);
  const [mode, setMode] = useState<SplitMode>('equal');
  const [chosen, setChosen] = useState<number[]>([]); // members sharing, in member order
  const [values, setValues] = useState<Record<number, string>>({}); // baht or weight per member
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setError(null);
    try {
      const t = await api.trip(tripId);
      setTrip(t);
      const b = billId ? t.bills.find((x) => x.id === billId) : null;
      if (b) {
        setTitle(b.title);
        setAmountText(String(b.amount));
        setDate(b.date);
        setPayer(b.payer_id);
        setMode(b.split_mode);
        setChosen(t.members.map((m) => m.id).filter((id) => b.parts.some((p) => p.member_id === id)));
        setValues(Object.fromEntries(b.parts.map((p) => [p.member_id, b.split_mode === 'equal' ? '' : String(p.value)])));
      } else {
        setPayer(t.members[0]?.id ?? null);
        setChosen(t.members.map((m) => m.id)); // everyone shares by default
      }
    } catch (e) {
      setError((e as Error).message);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripId, billId]);

  const amount = toSatang(amountText);
  const toggle = (id: number) =>
    setChosen((c) => (c.includes(id) ? c.filter((x) => x !== id) : trip!.members.map((m) => m.id).filter((m) => m === id || c.includes(m))));
  const value = (id: number) => (mode === 'amount' ? toSatang(values[id] ?? '') : Number(values[id] || (mode === 'ratio' ? 1 : 0)));
  const preview =
    amountText && payer && chosen.length
      ? shares(amount, payer, mode, chosen.map((m) => ({ member: m, value: value(m) })))
      : null;
  const assigned = mode === 'amount' ? chosen.reduce((s, m) => s + (toSatang(values[m] ?? '') || 0), 0) : 0;

  const save = async () => {
    if (!title.trim()) return showError(new Error('กรุณาใส่ชื่อรายการ'));
    if (!(amount > 0)) return showError(new Error('กรุณาใส่ยอดบิลที่มากกว่า 0'));
    if (!isValidDate(date)) return showError(new Error('วันที่ต้องเป็น ปปปป-ดด-วว (ค.ศ.)'));
    if (!payer) return showError(new Error('กรุณาเลือกผู้จ่าย'));
    if (preview && 'error' in preview) return showError(new Error(preview.error));
    const body = {
      title: title.trim(),
      amount: amount / 100,
      payer_id: payer,
      split_mode: mode,
      date,
      parts: chosen.map((m) => ({ member_id: m, value: mode === 'amount' ? value(m) / 100 : mode === 'ratio' ? value(m) : 0 })),
    };
    setSaving(true);
    try {
      if (billId) await api.updateTripBill(billId, body);
      else await api.createTripBill(tripId, body);
      router.back();
    } catch (e) {
      showError(e);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!billId || !(await confirmAsync('ลบบิล', `ต้องการลบบิล "${title}" ใช่หรือไม่?`))) return;
    try {
      await api.removeTripBill(billId);
      router.back();
    } catch (e) {
      showError(e);
    }
  };

  const screenTitle = billId ? 'แก้ไขบิล' : 'เพิ่มบิล';
  if (error) return <View style={styles.page}><Stack.Screen options={{ title: screenTitle }} /><ErrorBox message={error} onRetry={load} /></View>;
  if (!trip) return <><Stack.Screen options={{ title: screenTitle }} /><Loading /></>;

  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: screenTitle }} />
      <Card style={{ gap: 14 }}>
        <Field label="รายการ">
          <TextInput value={title} onChangeText={setTitle} maxLength={80} placeholder="เช่น ที่พัก, ค่ารถ, ข้าวเย็น" placeholderTextColor={COLORS.muted} style={styles.input} />
        </Field>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Field label="ยอด (บาท)" style={{ flex: 1 }}>
            <TextInput
              value={amountText}
              onChangeText={(t) => setAmountText(t.replace(/[^0-9.,]/g, ''))}
              keyboardType="decimal-pad"
              placeholder="0.00"
              placeholderTextColor={COLORS.muted}
              style={[styles.input, { fontSize: 18 }]}
            />
          </Field>
          <Field label="วันที่" style={{ flex: 1 }}>
            <TextInput value={date} onChangeText={setDate} maxLength={10} style={styles.input} />
            {isValidDate(date) && <Text style={styles.hint}>{dateLabel(date)}</Text>}
          </Field>
        </View>

        <Field label="ใครจ่าย">
          <View style={styles.chips}>
            {trip.members.map((m) => (
              <PressScale
                key={m.id}
                onPress={() => setPayer(m.id)}
                accessibilityRole="radio"
                accessibilityState={{ selected: payer === m.id }}
                accessibilityLabel={`${m.name} จ่าย`}
                style={[styles.chip, payer === m.id && styles.chipOn]}
              >
                <Text style={[styles.chipText, payer === m.id && { color: '#fff' }]}>{m.name}</Text>
              </PressScale>
            ))}
          </View>
        </Field>

        <Field label={`หารกับใคร (${chosen.length} คน)`}>
          <View style={styles.chips}>
            {trip.members.map((m) => {
              const on = chosen.includes(m.id);
              return (
                <PressScale key={m.id} onPress={() => toggle(m.id)} style={[styles.check, on && styles.checkOn]} accessibilityRole="checkbox" accessibilityState={{ checked: on }}>
                  <Text style={[styles.chipText, on && { color: COLORS.primary }]}>
                    {on ? '☑' : '☐'} {m.name}
                  </Text>
                </PressScale>
              );
            })}
          </View>
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <Text style={styles.link} onPress={() => setChosen(trip.members.map((m) => m.id))}>เลือกทุกคน</Text>
            <Text style={styles.link} onPress={() => setChosen([])}>ล้าง</Text>
          </View>
        </Field>

        <Field label="วิธีหาร">
          <View style={styles.segment}>
            {MODES.map((m) => (
              <PressScale key={m.key} onPress={() => setMode(m.key)} containerStyle={{ flex: 1 }} style={[styles.segBtn, mode === m.key && styles.segOn]}>
                <Text style={[styles.segText, mode === m.key && { color: COLORS.primary }]}>{m.label}</Text>
              </PressScale>
            ))}
          </View>
        </Field>

        {chosen.length > 0 && (
          <View style={styles.preview}>
            {chosen.map((m, i) => {
              const name = trip.members.find((x) => x.id === m)?.name;
              const share = preview && 'shares' in preview ? preview.shares[i] : null;
              return (
                <View key={m} style={styles.previewRow}>
                  <Text style={[styles.name, { flex: 1 }]}>{name}</Text>
                  {mode !== 'equal' && (
                    <TextInput
                      value={values[m] ?? ''}
                      onChangeText={(t) => setValues((v) => ({ ...v, [m]: t.replace(mode === 'ratio' ? /[^0-9]/g : /[^0-9.,]/g, '') }))}
                      keyboardType={mode === 'ratio' ? 'number-pad' : 'decimal-pad'}
                      placeholder={mode === 'ratio' ? '1' : '0.00'}
                      placeholderTextColor={COLORS.muted}
                      style={[styles.input, styles.valueInput]}
                    />
                  )}
                  <Text style={styles.share}>{share !== null ? `${bahtText(share)}` : '—'}</Text>
                </View>
              );
            })}
            {mode === 'amount' && amount > 0 && (
              <Text style={[styles.hint, { color: assigned === amount ? COLORS.in : COLORS.out, textAlign: 'right' }]}>
                แบ่งแล้ว {bahtText(assigned)} / {bahtText(amount)} {assigned === amount ? '✓' : `(ขาด ${bahtText(amount - assigned)})`}
              </Text>
            )}
            {mode === 'ratio' && <Text style={styles.hint}>ใส่สัดส่วนเป็นจำนวนเต็ม เช่น 2 : 1 : 1</Text>}
            {preview && 'error' in preview && mode !== 'amount' && <Text style={{ color: COLORS.out }}>{preview.error}</Text>}
            {mode === 'equal' && amount > 0 && chosen.length > 1 && amount % chosen.length !== 0 && (
              <Text style={styles.hint}>หารไม่ลงตัว: เศษสตางค์ให้ผู้จ่ายรับไป</Text>
            )}
          </View>
        )}

        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Button title="ยกเลิก" variant="outline" style={{ flex: 1 }} onPress={() => router.back()} />
          <Button title={saving ? 'กำลังบันทึก...' : 'บันทึก'} style={{ flex: 1 }} onPress={save} disabled={saving || !!(preview && 'error' in preview)} />
        </View>
        {!!billId && <Button title="ลบบิลนี้" variant="danger" onPress={remove} />}
      </Card>
      {preview && 'shares' in preview && (
        <Text style={[styles.hint, { textAlign: 'center' }]}>
          รวม {money(amount / 100)} บาท · {trip.members.find((m) => m.id === payer)?.name} จ่ายไปก่อน
        </Text>
      )}
    </ScrollView>
  );
}

function Field({ label, children, style }: { label: string; children: React.ReactNode; style?: object }) {
  return (
    <View style={[{ gap: 6 }, style]}>
      <Text style={styles.label}>{label}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, gap: 12, maxWidth: 640, width: '100%', alignSelf: 'center', paddingBottom: 40 },
  label: { fontWeight: '700', color: COLORS.text },
  hint: { color: COLORS.muted, fontSize: 12 },
  link: { color: COLORS.primary, fontWeight: '700', fontSize: 13 },
  input: { borderWidth: 1, borderColor: COLORS.border, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16, color: COLORS.text, backgroundColor: COLORS.input },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingVertical: 7, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1.5, borderColor: COLORS.primary },
  chipOn: { backgroundColor: COLORS.primary },
  chipText: { color: COLORS.primary, fontWeight: '700' },
  check: { paddingVertical: 7, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.card },
  checkOn: { borderColor: COLORS.primary, backgroundColor: COLORS.primarySoft },
  segment: { flexDirection: 'row', backgroundColor: COLORS.track, borderRadius: 12, padding: 3 },
  segBtn: { paddingVertical: 8, borderRadius: 10, alignItems: 'center' },
  segOn: { backgroundColor: COLORS.card, boxShadow: '0px 2px 6px rgba(59, 47, 42, 0.15)' },
  segText: { fontWeight: '700', color: COLORS.muted, fontSize: 13 },
  preview: { gap: 8, padding: 12, borderRadius: 14, backgroundColor: COLORS.subtle },
  previewRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  name: { fontWeight: '700', color: COLORS.text },
  valueInput: { width: 90, paddingVertical: 6, textAlign: 'right' },
  share: { width: 90, textAlign: 'right', fontWeight: '800', color: COLORS.text },
});
