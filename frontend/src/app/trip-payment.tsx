import type { ImagePickerAsset } from 'expo-image-picker';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { api, Trip } from '@/api';
import { PressScale } from '@/components/motion';
import { PhotoField } from '@/components/PhotoField';
import { Button, Card, ErrorBox, Loading } from '@/components/ui';
import { COLORS, dateLabel, isValidDate, showError, toISODate } from '@/format';
import { toSatang } from '@/tripSplit';

/**
 * Record money handed over between two members (from the summary's "จ่ายแล้ว", prefilled with what's
 * left), with an optional slip; or edit one (amount, date, note).
 */
export default function TripPaymentScreen() {
  const params = useLocalSearchParams<{ tripId: string; id?: string; from?: string; to?: string; amount?: string }>();
  const tripId = Number(params.tripId);
  const paymentId = params.id ? Number(params.id) : null;
  const [trip, setTrip] = useState<Trip | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [from, setFrom] = useState<number | null>(params.from ? Number(params.from) : null);
  const [to, setTo] = useState<number | null>(params.to ? Number(params.to) : null);
  const [amountText, setAmountText] = useState(params.amount && Number(params.amount) > 0 ? params.amount : '');
  const [date, setDate] = useState(toISODate(new Date()));
  const [note, setNote] = useState('');
  const [slip, setSlip] = useState<ImagePickerAsset | null>(null);
  const [savedSlip, setSavedSlip] = useState(''); // the payment's saved slip, unless removed
  const [reading, setReading] = useState(false);
  const [readNote, setReadNote] = useState('');
  const [saving, setSaving] = useState(false);
  const due = params.amount ? Number(params.amount) : 0;

  const load = async () => {
    setError(null);
    try {
      const t = await api.trip(tripId);
      setTrip(t);
      const p = paymentId ? t.payments.find((x) => x.id === paymentId) : null;
      if (p) {
        setFrom(p.from_member);
        setTo(p.to_member);
        setAmountText(String(p.amount));
        setDate(p.date);
        setNote(p.note);
        setSavedSlip(p.slip_url ? api.tripSlipUrl(p) : '');
      }
    } catch (e) {
      setError((e as Error).message);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripId, paymentId]);

  // A new slip is read on the server: its amount and date fill the form (the slip is what was paid).
  const onSlip = async (a: ImagePickerAsset) => {
    setSlip(a);
    setReadNote('');
    setReading(true);
    try {
      const r = await api.tripOCR(a, 'slip');
      if (r.amount > 0) setAmountText(String(r.amount));
      if (r.date) setDate(r.date);
      setReadNote(r.amount > 0 || r.date
        ? `อ่านจากสลิป: ${r.amount > 0 ? `${r.amount.toFixed(2)} บาท` : 'ไม่พบจำนวนเงิน'}${r.date ? ` · ${dateLabel(r.date)}` : ''} — ตรวจก่อนบันทึก`
        : 'อ่านสลิปไม่ได้ กรอกเองได้เลย (รูปยังแนบไว้)');
    } catch {
      setReadNote('อ่านสลิปไม่ได้ กรอกเองได้เลย (รูปยังแนบไว้)');
    } finally {
      setReading(false);
    }
  };

  const amount = toSatang(amountText);
  const save = async () => {
    if (!from || !to || from === to) return showError(new Error('เลือกผู้จ่ายและผู้รับ (คนละคน)'));
    if (!(amount > 0)) return showError(new Error('กรุณาใส่จำนวนเงินที่มากกว่า 0'));
    if (!isValidDate(date)) return showError(new Error('วันที่ต้องเป็น ปปปป-ดด-วว (ค.ศ.)'));
    setSaving(true);
    try {
      if (paymentId) {
        await api.updateTripPayment(paymentId, { amount: amount / 100, date, note: note.trim() });
        if (slip) await api.setTripPaymentSlip(paymentId, slip);
        else if (!savedSlip && trip?.payments.find((p) => p.id === paymentId)?.slip_url) await api.setTripPaymentSlip(paymentId, null);
      } else await api.createTripPayment(tripId, { from_member: from, to_member: to, amount: amount / 100, date, note: note.trim() }, slip);
      router.back();
    } catch (e) {
      showError(e);
    } finally {
      setSaving(false);
    }
  };

  const title = paymentId ? 'แก้ไขการจ่าย' : 'บันทึกการจ่าย';
  if (error) return <View style={styles.page}><Stack.Screen options={{ title }} /><ErrorBox message={error} onRetry={load} /></View>;
  if (!trip) return <><Stack.Screen options={{ title }} /><Loading /></>;

  const picker = (role: string, value: number | null, onChange: (id: number) => void, disabled: boolean) => (
    <View style={styles.chips}>
      {trip.members.map((m) => (
        <PressScale
          key={m.id}
          disabled={disabled && value !== m.id}
          onPress={() => onChange(m.id)}
          accessibilityRole="radio"
          accessibilityState={{ selected: value === m.id }}
          accessibilityLabel={`${role} ${m.name}`}
          style={[styles.chip, value === m.id && styles.chipOn]}
        >
          <Text style={[styles.chipText, value === m.id && { color: '#fff' }]}>{m.name}</Text>
        </PressScale>
      ))}
    </View>
  );

  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title }} />
      <Card style={{ gap: 14 }}>
        <Field label="ผู้จ่าย">{picker('ผู้จ่าย', from, setFrom, !!paymentId)}</Field>
        <Field label="ผู้รับ">{picker('ผู้รับ', to, setTo, !!paymentId)}</Field>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Field label="จำนวนเงิน (บาท)" style={{ flex: 1 }}>
            <TextInput
              value={amountText}
              onChangeText={(t) => setAmountText(t.replace(/[^0-9.,]/g, ''))}
              keyboardType="decimal-pad"
              placeholder="0.00"
              placeholderTextColor={COLORS.muted}
              style={[styles.input, { fontSize: 18 }]}
            />
            {due > 0 && amount > 0 && amount < Math.round(due * 100) && (
              <Text style={[styles.hint, { color: COLORS.pending }]}>จ่ายบางส่วน · คงเหลือ {((Math.round(due * 100) - amount) / 100).toFixed(2)}</Text>
            )}
          </Field>
          <Field label="วันที่" style={{ flex: 1 }}>
            <TextInput value={date} onChangeText={setDate} maxLength={10} style={styles.input} />
            {isValidDate(date) && <Text style={styles.hint}>{dateLabel(date)}</Text>}
          </Field>
        </View>
        <Field label="หมายเหตุ">
          <TextInput value={note} onChangeText={setNote} placeholder="เช่น โอนพร้อมเพย์" placeholderTextColor={COLORS.muted} style={styles.input} />
        </Field>

        <Field label="สลิป (ไม่บังคับ · PNG/JPG/WEBP ไม่เกิน 10MB)">
          <PhotoField
            uri={slip?.uri ?? (savedSlip || null)}
            onPick={onSlip}
            onRemove={() => {
              setSlip(null);
              setSavedSlip('');
              setReadNote('');
            }}
            busy={reading}
            emptyLabel="ถ่ายสลิป"
          />
          {!!readNote && <Text style={styles.hint}>{readNote}</Text>}
        </Field>

        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Button title="ยกเลิก" variant="outline" style={{ flex: 1 }} onPress={() => router.back()} />
          <Button title={saving ? 'กำลังบันทึก...' : 'บันทึก'} style={{ flex: 1 }} onPress={save} disabled={saving} />
        </View>
      </Card>
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
  input: { borderWidth: 1, borderColor: COLORS.border, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16, color: COLORS.text, backgroundColor: COLORS.input },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingVertical: 7, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1.5, borderColor: COLORS.primary },
  chipOn: { backgroundColor: COLORS.primary },
  chipText: { color: COLORS.primary, fontWeight: '700' },});
