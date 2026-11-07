import * as ImagePicker from 'expo-image-picker';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { api, Trip } from '@/api';
import { PressScale } from '@/components/motion';
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
  const [slip, setSlip] = useState<ImagePicker.ImagePickerAsset | null>(null);
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
      }
    } catch (e) {
      setError((e as Error).message);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripId, paymentId]);

  const pickSlip = async () => {
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.9 });
    if (!r.canceled && r.assets?.[0]) setSlip(r.assets[0]);
  };

  const amount = toSatang(amountText);
  const save = async () => {
    if (!from || !to || from === to) return showError(new Error('เลือกผู้จ่ายและผู้รับ (คนละคน)'));
    if (!(amount > 0)) return showError(new Error('กรุณาใส่จำนวนเงินที่มากกว่า 0'));
    if (!isValidDate(date)) return showError(new Error('วันที่ต้องเป็น ปปปป-ดด-วว (ค.ศ.)'));
    setSaving(true);
    try {
      if (paymentId) await api.updateTripPayment(paymentId, { amount: amount / 100, date, note: note.trim() });
      else await api.createTripPayment(tripId, { from_member: from, to_member: to, amount: amount / 100, date, note: note.trim() }, slip);
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

        {!paymentId && (
          <Field label="สลิป (ไม่บังคับ · PNG/JPG/WEBP ไม่เกิน 10MB)">
            {slip ? (
              <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
                <Image source={{ uri: slip.uri }} style={styles.preview} />
                <View style={{ gap: 8 }}>
                  <Button title="เปลี่ยนรูป" variant="soft" small onPress={pickSlip} />
                  <Button title="เอาออก" variant="outline" small onPress={() => setSlip(null)} />
                </View>
              </View>
            ) : (
              <Button title="แนบรูปสลิป" icon="📎" variant="soft" onPress={pickSlip} />
            )}
          </Field>
        )}

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
  chipText: { color: COLORS.primary, fontWeight: '700' },
  preview: { width: 90, height: 130, borderRadius: 10, backgroundColor: COLORS.subtle },
});
