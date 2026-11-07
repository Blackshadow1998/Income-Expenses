import type { ImagePickerAsset } from 'expo-image-picker';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ScrollView, ScrollViewInstance, StyleSheet, Text, TextInput, View } from 'react-native';
import { api, SplitMode, Trip, TripOCR } from '@/api';
import { PressScale } from '@/components/motion';
import { PhotoField } from '@/components/PhotoField';
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
  // Photo: a newly picked one, or the saved one (savedImage) unless removed.
  const [image, setImage] = useState<ImagePickerAsset | null>(null);
  const [savedImage, setSavedImage] = useState('');
  const [reading, setReading] = useState(false);
  const [ocr, setOcr] = useState<TripOCR | null>(null);
  const [picked, setPicked] = useState<number[]>([]); // receipt items tapped (-1 = the total)
  const [autoTitle, setAutoTitle] = useState(''); // the title last filled from items, replaced on the next tap
  const [used, setUsed] = useState<number[]>([]); // receipt items already saved as bills from this form
  const [savedNote, setSavedNote] = useState('');
  const scroll = useRef<ScrollViewInstance>(null);

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
        setSavedImage(b.image_url ? api.tripBillImageUrl(b) : '');
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

  // A new photo is read on the server; its items can then be tapped to fill the title and amount.
  const onPhoto = async (a: ImagePickerAsset) => {
    setImage(a);
    setOcr(null);
    setPicked([]);
    setUsed([]);
    setSavedNote('');
    setReading(true);
    try {
      const r = await api.tripOCR(a, 'receipt');
      setOcr(r);
      if (!billId && r.date) setDate(r.date);
    } catch {
      setOcr({ date: '', amount: 0, items: [] });
    } finally {
      setReading(false);
    }
  };

  const pickItem = (i: number) => {
    if (!ocr || used.includes(i)) return;
    const next = i === -1 ? (picked.includes(-1) ? [] : [-1]) : picked.includes(i) ? picked.filter((x) => x !== i) : [...picked.filter((x) => x !== -1), i];
    setPicked(next);
    const items = next.filter((x) => x >= 0).map((x) => ocr.items[x]);
    const sum = next.includes(-1) ? ocr.amount : items.reduce((s, it) => s + it.amount, 0);
    setAmountText(sum > 0 ? String(Math.round(sum * 100) / 100) : '');
    if (!title.trim() || title === autoTitle) {
      const t = items.map((it) => it.name).join(' + ').slice(0, 80);
      setTitle(t);
      setAutoTitle(t);
    }
  };

  const amount = toSatang(amountText);
  const toggle =(id: number) =>
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
    let id = billId;
    try {
      if (billId) await api.updateTripBill(billId, body);
      else id = Math.max(...(await api.createTripBill(tripId, body)).bills.map((b) => b.id)); // the new bill
    } catch (e) {
      setSaving(false);
      return showError(e);
    }
    try {
      if (image) await api.setTripBillImage(id!, image);
      else if (billId && !savedImage && trip?.bills.find((b) => b.id === billId)?.image_url) await api.setTripBillImage(billId, null);
    } catch (e) {
      showError(new Error(`บันทึกบิลแล้ว แต่แนบรูปไม่สำเร็จ: ${(e as Error).message}`));
    }
    setSaving(false);
    // A new bill from some receipt items: stay so the remaining items can be split as more bills.
    const nowUsed = [...used, ...picked];
    if (!billId && ocr && !picked.includes(-1) && picked.length && ocr.items.some((_, i) => !nowUsed.includes(i))) {
      setUsed(nowUsed);
      setPicked([]);
      setSavedNote(`บันทึก "${body.title}" แล้ว · เลือกรายการที่เหลือต่อได้`);
      setTitle('');
      setAutoTitle('');
      setAmountText('');
      setMode('equal');
      setValues({});
      setChosen(trip!.members.map((m) => m.id));
      scroll.current?.scrollTo({ y: 0, animated: true });
      return;
    }
    router.back();
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
    <ScrollView ref={scroll} contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: screenTitle }} />
      <Card style={{ gap: 14 }}>
        <Field label="รูปบิล (ไม่บังคับ)">
          <PhotoField
            uri={image?.uri ?? (savedImage || null)}
            onPick={onPhoto}
            onRemove={() => {
              setImage(null);
              setSavedImage('');
              setOcr(null);
              setPicked([]);
              setUsed([]);
              setSavedNote('');
            }}
            busy={reading}
            emptyLabel="ถ่ายบิล"
          />
          {ocr && (ocr.items.length > 0 || ocr.amount > 0) ? (
            <View style={styles.preview}>
              {savedNote ? <Text style={styles.savedNote}>✓ {savedNote}</Text> : null}
              <Text style={styles.hint}>อ่านจากรูป (อาจผิด ตรวจก่อนบันทึก) · แตะรายการที่จะหาร เลือกได้หลายรายการ</Text>
              {ocr.items.map((it, i) =>
                used.includes(i) ? (
                  <View key={i} style={[styles.ocrRow, styles.ocrUsed]} accessibilityState={{ disabled: true }}>
                    <Text style={[styles.chipText, { flex: 1 }]} numberOfLines={1}>✓ {it.name} (บันทึกแล้ว)</Text>
                    <Text style={styles.share}>{money(it.amount)}</Text>
                  </View>
                ) : (
                  <PressScale key={i} onPress={() => pickItem(i)} style={[styles.ocrRow, picked.includes(i) && styles.checkOn]} accessibilityRole="checkbox" accessibilityState={{ checked: picked.includes(i) }}>
                    <Text style={[styles.chipText, { flex: 1 }]} numberOfLines={1}>{picked.includes(i) ? '☑' : '☐'} {it.name}</Text>
                    <Text style={styles.share}>{money(it.amount)}</Text>
                  </PressScale>
                ),
              )}
              {ocr.amount > 0 && used.length === 0 && (
                <PressScale onPress={() => pickItem(-1)} style={[styles.ocrRow, picked.includes(-1) && styles.checkOn]} accessibilityRole="checkbox" accessibilityState={{ checked: picked.includes(-1) }}>
                  <Text style={[styles.chipText, { flex: 1 }]}>{picked.includes(-1) ? '☑' : '☐'} ทั้งบิล (ยอดสุทธิ)</Text>
                  <Text style={styles.share}>{money(ocr.amount)}</Text>
                </PressScale>
              )}
            </View>
          ) : (
            ocr && <Text style={styles.hint}>อ่านรายการจากรูปไม่ได้ กรอกเองได้เลย (รูปยังแนบไว้)</Text>
          )}
        </Field>
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
          <Button title={used.length ? 'เสร็จ' : 'ยกเลิก'} variant="outline" style={{ flex: 1 }} onPress={() => router.back()} />
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
  ocrUsed: { opacity: 0.45 },
  savedNote: { color: COLORS.primary, fontSize: 13, fontWeight: '700' },
  ocrRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 10, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.card },
  name: { fontWeight: '700', color: COLORS.text },
  valueInput: { width: 90, paddingVertical: 6, textAlign: 'right' },
  share: { width: 90, textAlign: 'right', fontWeight: '800', color: COLORS.text },
});
