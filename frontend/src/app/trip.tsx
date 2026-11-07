import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Image, Linking, Platform, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import { api, Trip, TripBill, TripPair, TripPayment, TripSummary } from '@/api';
import { FadeIn, GrowBar, PressScale } from '@/components/motion';
import { Button, Card, ErrorBox, Loading } from '@/components/ui';
import { COLORS, confirmAsync, dateLabel, money, showError, showInfo } from '@/format';
import { summaryText } from '@/tripSplit';

type Tab = 'bills' | 'summary' | 'payments';
const TABS: { key: Tab; label: string }[] = [
  { key: 'bills', label: '🧾 บิล' },
  { key: 'summary', label: '📊 สรุปยอด' },
  { key: 'payments', label: '💸 การจ่ายเงิน' },
];
const MODE_LABEL: Record<TripBill['split_mode'], string> = { equal: 'หารเท่ากัน', amount: 'ระบุจำนวน', ratio: 'ตามสัดส่วน' };
const STATUS: Record<TripPair['status'], { label: string; color: string }> = {
  unpaid: { label: 'ยังไม่จ่าย', color: COLORS.out },
  partial: { label: 'จ่ายบางส่วน', color: COLORS.pending },
  paid: { label: 'จ่ายครบ', color: COLORS.in },
};

/** One trip: members on top, then three tabs — bills, who owes whom, and payments made. */
export default function TripScreen() {
  const { id: idParam } = useLocalSearchParams<{ id: string }>();
  const id = Number(idParam);
  const [trip, setTrip] = useState<Trip | null>(null);
  const [summary, setSummary] = useState<TripSummary | null>(null);
  const [mode, setMode] = useState<TripSummary['mode']>('pairwise');
  const [tab, setTab] = useState<Tab>('bills');
  const [error, setError] = useState<string | null>(null);
  const [newMember, setNewMember] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);

  const loadSummary = useCallback(
    async (m: TripSummary['mode']) => {
      try {
        setSummary(await api.tripSummary(id, m));
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [id],
  );

  const load = useCallback(async () => {
    setError(null);
    try {
      const [t, s] = await Promise.all([api.trip(id), api.tripSummary(id, mode)]);
      setTrip(t);
      setSummary(s);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id, mode]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  // Every change returns the updated trip; the summary is worked out again from it.
  const run = async (action: () => Promise<Trip>) => {
    try {
      setTrip(await action());
      await loadSummary(mode);
    } catch (e) {
      showError(e);
    }
  };

  const switchMode = (m: TripSummary['mode']) => {
    setMode(m);
    loadSummary(m);
  };

  const addMember = () => {
    const name = newMember.trim();
    if (!name) return;
    setNewMember('');
    run(() => api.addTripMember(id, name));
  };

  const removeMember = async (memberId: number, name: string) => {
    if (await confirmAsync('ลบสมาชิก', `ต้องการลบ "${name}" ออกจากทริปใช่หรือไม่?`)) run(() => api.removeTripMember(id, memberId));
  };

  const copySummary = async () => {
    if (!trip || !summary) return;
    const text = summaryText(trip.name, summary);
    try {
      if (Platform.OS === 'web' && navigator.clipboard) {
        await navigator.clipboard.writeText(text);
        showInfo('คัดลอกแล้ว', 'วางในกลุ่มไลน์ได้เลย');
      } else {
        await Share.share({ message: text });
      }
    } catch (e) {
      showError(e);
    }
  };

  const removeTrip = async () => {
    if (!trip || !(await confirmAsync('ลบทริป', `ต้องการลบทริป "${trip.name}" พร้อมบิลและการจ่ายทั้งหมดใช่หรือไม่?`))) return;
    try {
      await api.removeTrip(id);
      router.back();
    } catch (e) {
      showError(e);
    }
  };

  if (error && !trip) return <View style={styles.page}><ErrorBox message={error} onRetry={load} /></View>;
  if (!trip) return <Loading />;
  const names = Object.fromEntries(trip.members.map((m) => [m.id, m.name]));

  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: trip.name }} />

      <Card style={{ gap: 10 }}>
        {renaming !== null ? (
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <TextInput value={renaming} onChangeText={setRenaming} maxLength={60} style={[styles.input, { flex: 1 }]} />
            <Button title="บันทึก" small onPress={() => { const n = renaming.trim(); setRenaming(null); if (n) run(() => api.renameTrip(id, n)); }} />
          </View>
        ) : (
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <View>
              <Text style={styles.h2}>{trip.name}</Text>
              <Text style={styles.hint}>ยอดรวม {money(trip.total)} บาท · {trip.bills.length} บิล</Text>
            </View>
            <PressScale onPress={() => setRenaming(trip.name)} style={styles.iconBtn} accessibilityLabel="แก้ชื่อทริป">
              <Text>✏️</Text>
            </PressScale>
          </View>
        )}
        <Text style={styles.label}>สมาชิก ({trip.members.length}) — แตะชื่อเพื่อลบ</Text>
        <View style={styles.chips}>
          {trip.members.map((m) => (
            <PressScale key={m.id} onPress={() => removeMember(m.id, m.name)} style={styles.member}>
              <Text style={styles.memberText}>{m.name}</Text>
            </PressScale>
          ))}
        </View>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TextInput
            value={newMember}
            onChangeText={setNewMember}
            onSubmitEditing={addMember}
            maxLength={40}
            placeholder="เพิ่มสมาชิก"
            placeholderTextColor={COLORS.muted}
            style={[styles.input, { flex: 1 }]}
          />
          <Button title="เพิ่ม" variant="soft" onPress={addMember} />
        </View>
      </Card>

      <View style={styles.segment}>
        {TABS.map((t) => (
          <PressScale key={t.key} onPress={() => setTab(t.key)} containerStyle={{ flex: 1 }} style={[styles.segBtn, tab === t.key && styles.segOn]}>
            <Text style={[styles.segText, tab === t.key && { color: COLORS.primary }]}>{t.label}</Text>
          </PressScale>
        ))}
      </View>

      {tab === 'bills' && <BillsTab trip={trip} names={names} onDelete={(b) => run(() => api.removeTripBill(b.id))} />}
      {tab === 'summary' && (
        <SummaryTab tripId={id} summary={summary} mode={mode} onMode={switchMode} onCopy={copySummary} hasBills={trip.bills.length > 0} />
      )}
      {tab === 'payments' && (
        <PaymentsTab
          trip={trip}
          names={names}
          onConfirm={(p) => run(() => api.updateTripPayment(p.id, { confirmed: !p.confirmed }))}
          onDelete={async (p) => {
            if (await confirmAsync('ยกเลิกการจ่าย', `ลบรายการ ${names[p.from_member]} → ${names[p.to_member]} ${money(p.amount)} บาท ใช่หรือไม่?`))
              run(() => api.removeTripPayment(p.id));
          }}
        />
      )}

      <Button title="ลบทริปนี้" variant="danger" onPress={removeTrip} style={{ marginTop: 12 }} />
    </ScrollView>
  );
}

function BillsTab({ trip, names, onDelete }: { trip: Trip; names: Record<number, string>; onDelete: (b: TripBill) => void }) {
  const remove = async (b: TripBill) => {
    if (await confirmAsync('ลบบิล', `ต้องการลบบิล "${b.title}" ${money(b.amount)} บาท ใช่หรือไม่?`)) onDelete(b);
  };
  return (
    <View style={{ gap: 10 }}>
      <Button
        title="เพิ่มบิล"
        icon="＋"
        disabled={trip.members.length < 2}
        onPress={() => router.push({ pathname: '/trip-bill', params: { tripId: String(trip.id) } })}
      />
      {trip.bills.length === 0 ? (
        <Card style={{ alignItems: 'center', gap: 6, paddingVertical: 26 }}>
          <Text style={{ fontSize: 34 }}>🧾</Text>
          <Text style={{ color: COLORS.muted }}>{trip.members.length < 2 ? 'เพิ่มสมาชิกอย่างน้อย 2 คนก่อน' : 'ยังไม่มีบิล'}</Text>
        </Card>
      ) : (
        trip.bills.map((b, i) => (
          <FadeIn key={b.id} delay={Math.min(i * 40, 300)}>
            <PressScale
              onPress={() => router.push({ pathname: '/trip-bill', params: { tripId: String(trip.id), id: String(b.id) } })}
              scaleTo={0.98}
              style={styles.row}
            >
              {!!b.image_url && (
                <PressScale onPress={() => Linking.openURL(api.tripBillImageUrl(b))} accessibilityLabel="ดูรูปบิล">
                  <Image source={{ uri: api.tripBillImageUrl(b) }} style={styles.thumb} />
                </PressScale>
              )}
              <View style={{ flex: 1, gap: 3 }}>
                <Text style={styles.name} numberOfLines={1}>{b.title}</Text>
                <Text style={styles.hint}>
                  {dateLabel(b.date)} · {names[b.payer_id]} จ่าย · หาร {b.parts.length} คน ({MODE_LABEL[b.split_mode]})
                </Text>
                <Text style={styles.hint} numberOfLines={2}>
                  {b.parts.map((p) => `${names[p.member_id]} ${money(p.share)}`).join(' · ')}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end', gap: 6 }}>
                <Text style={styles.amount}>{money(b.amount)}</Text>
                <PressScale onPress={() => remove(b)} hitSlop={6} scaleTo={0.85} style={styles.trash} accessibilityLabel="ลบบิล">
                  <Text style={{ fontSize: 12 }}>🗑️</Text>
                </PressScale>
              </View>
            </PressScale>
          </FadeIn>
        ))
      )}
    </View>
  );
}

function SummaryTab({ tripId, summary, mode, onMode, onCopy, hasBills }: {
  tripId: number;
  summary: TripSummary | null;
  mode: TripSummary['mode'];
  onMode: (m: TripSummary['mode']) => void;
  onCopy: () => void;
  hasBills: boolean;
}) {
  if (!summary) return <Loading />;
  if (!hasBills)
    return (
      <Card style={{ alignItems: 'center', gap: 6, paddingVertical: 26 }}>
        <Text style={{ fontSize: 34 }}>📊</Text>
        <Text style={{ color: COLORS.muted }}>ลงบิลก่อน แล้วสรุปยอดจะขึ้นที่นี่</Text>
      </Card>
    );
  const { owed, paid } = summary.progress;
  const list = mode === 'pairwise' ? summary.pairs : summary.transfers;
  const pay = (p: TripPair) =>
    router.push({
      pathname: '/trip-payment',
      params: { tripId: String(tripId), from: String(p.from), to: String(p.to), amount: String(Math.max(p.remaining, 0)) },
    });
  return (
    <View style={{ gap: 12 }}>
      <View style={styles.segment}>
        {(['pairwise', 'minimal'] as const).map((m) => (
          <PressScale key={m} onPress={() => m !== mode && onMode(m)} containerStyle={{ flex: 1 }} style={[styles.segBtn, mode === m && styles.segOn]}>
            <Text style={[styles.segText, mode === m && { color: COLORS.primary }]}>{m === 'pairwise' ? 'รายคู่' : 'ลดจำนวนการโอน'}</Text>
          </PressScale>
        ))}
      </View>

      <Card style={{ gap: 8 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text style={styles.h3}>เก็บเงินแล้ว</Text>
          <Text style={styles.h3}>
            {money(paid)} / {money(owed)}
          </Text>
        </View>
        <View style={styles.track}>
          <GrowBar fraction={owed > 0 ? Math.min(paid / owed, 1) : 1} color={COLORS.in} style={{ height: '100%' }} />
        </View>
        <Button title="คัดลอกสรุป (ส่งไลน์)" icon="📋" variant="soft" onPress={onCopy} />
      </Card>

      <Text style={styles.label}>{mode === 'pairwise' ? 'หนี้แต่ละคู่ (หักลบกันแล้ว)' : 'โอนแค่นี้ก็เคลียร์กันหมด'}</Text>
      {list.length === 0 ? (
        <Card style={{ alignItems: 'center', paddingVertical: 18 }}>
          <Text style={{ color: COLORS.in, fontWeight: '800' }}>ทุกคนเคลียร์กันครบแล้ว 🎉</Text>
        </Card>
      ) : (
        list.map((p, i) => (
          <FadeIn key={`${p.from}-${p.to}`} delay={Math.min(i * 40, 300)}>
            <View style={styles.row}>
              <View style={{ flex: 1, gap: 3 }}>
                <Text style={styles.name}>
                  {p.from_name} → {p.to_name}
                </Text>
                {mode === 'pairwise' ? (
                  <>
                    <View style={[styles.badge, { backgroundColor: STATUS[p.status].color }]}>
                      <Text style={styles.badgeText}>{STATUS[p.status].label}</Text>
                    </View>
                    {p.paid !== 0 && (
                      <Text style={styles.hint}>
                        ทั้งหมด {money(p.owed)} · จ่ายแล้ว {money(p.paid)}
                      </Text>
                    )}
                  </>
                ) : (
                  <Text style={styles.hint}>โอนตรงไปที่ {p.to_name}</Text>
                )}
              </View>
              <View style={{ alignItems: 'flex-end', gap: 6 }}>
                <Text style={[styles.amount, { color: p.remaining > 0 ? COLORS.out : COLORS.in }]}>
                  {p.remaining > 0 ? money(p.remaining) : '✓'}
                </Text>
                {p.remaining > 0 && <Button title="จ่ายแล้ว" small onPress={() => pay(p)} />}
              </View>
            </View>
          </FadeIn>
        ))
      )}

      <Text style={styles.label}>ต่อคน</Text>
      <View style={styles.people}>
        {summary.people.map((p) => {
          const color = p.net > 0 ? COLORS.in : p.net < 0 ? COLORS.out : COLORS.muted;
          return (
            <View key={p.member_id} style={[styles.person, { borderColor: color }]}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={styles.name}>{p.name}</Text>
                <Text style={[styles.amount, { color }]}>
                  {p.net > 0 ? '+' : ''}
                  {money(p.net)}
                </Text>
              </View>
              {p.net === 0 && <Text style={styles.hint}>เคลียร์แล้ว ✓</Text>}
              {p.receive.map((r) => (
                <Text key={`r${r.member_id}`} style={[styles.hint, { color: COLORS.in }]}>
                  ต้องรับจาก {r.name} {money(r.amount)}
                </Text>
              ))}
              {p.pay.map((r) => (
                <Text key={`p${r.member_id}`} style={[styles.hint, { color: COLORS.out }]}>
                  ต้องจ่ายให้ {r.name} {money(r.amount)}
                </Text>
              ))}
            </View>
          );
        })}
      </View>
    </View>
  );
}

function PaymentsTab({ trip, names, onConfirm, onDelete }: {
  trip: Trip;
  names: Record<number, string>;
  onConfirm: (p: TripPayment) => void;
  onDelete: (p: TripPayment) => void;
}) {
  if (trip.payments.length === 0)
    return (
      <Card style={{ alignItems: 'center', gap: 6, paddingVertical: 26 }}>
        <Text style={{ fontSize: 34 }}>💸</Text>
        <Text style={{ color: COLORS.muted, textAlign: 'center' }}>ยังไม่มีการจ่ายเงิน{'\n'}กด &quot;จ่ายแล้ว&quot; ที่แท็บสรุปยอดเพื่อบันทึก</Text>
      </Card>
    );
  return (
    <View style={{ gap: 10 }}>
      {trip.payments.map((p, i) => (
        <FadeIn key={p.id} delay={Math.min(i * 40, 300)}>
          <View style={styles.row}>
            {p.slip_url ? (
              <PressScale onPress={() => Linking.openURL(api.tripSlipUrl(p))} accessibilityLabel="ดูสลิป">
                <Image source={{ uri: api.tripSlipUrl(p) }} style={styles.thumb} />
              </PressScale>
            ) : (
              <View style={[styles.thumb, styles.noSlip]}>
                <Text style={{ fontSize: 18 }}>💵</Text>
              </View>
            )}
            <View style={{ flex: 1, gap: 3 }}>
              <Text style={styles.name}>
                {names[p.from_member]} → {names[p.to_member]}
              </Text>
              <Text style={styles.hint}>
                {dateLabel(p.date)}
                {p.note ? ` · ${p.note}` : ''}
              </Text>
              <Text style={[styles.hint, { color: p.confirmed ? COLORS.in : COLORS.pending, fontWeight: '700' }]}>
                {p.confirmed ? '✓ ผู้รับยืนยันแล้ว' : 'รอผู้รับยืนยัน'}
              </Text>
            </View>
            <View style={{ alignItems: 'flex-end', gap: 6 }}>
              <Text style={styles.amount}>{money(p.amount)}</Text>
              <View style={{ flexDirection: 'row', gap: 6 }}>
                <PressScale onPress={() => onConfirm(p)} hitSlop={6} scaleTo={0.85} style={styles.smallBtn} accessibilityLabel={p.confirmed ? 'ยกเลิกยืนยัน' : 'ยืนยันว่าได้รับแล้ว'}>
                  <Text style={styles.smallText}>{p.confirmed ? '↩︎' : '✓ ได้รับ'}</Text>
                </PressScale>
                <PressScale
                  onPress={() => router.push({ pathname: '/trip-payment', params: { tripId: String(trip.id), id: String(p.id) } })}
                  hitSlop={6}
                  scaleTo={0.85}
                  style={styles.smallBtn}
                  accessibilityLabel="แก้ไขการจ่าย"
                >
                  <Text style={styles.smallText}>✏️</Text>
                </PressScale>
                <PressScale onPress={() => onDelete(p)} hitSlop={6} scaleTo={0.85} style={[styles.smallBtn, { backgroundColor: COLORS.dangerSoft }]} accessibilityLabel="ยกเลิกการจ่าย">
                  <Text style={styles.smallText}>🗑️</Text>
                </PressScale>
              </View>
            </View>
          </View>
        </FadeIn>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, gap: 12, maxWidth: 820, width: '100%', alignSelf: 'center', paddingBottom: 40 },
  h2: { fontSize: 18, fontWeight: '800', color: COLORS.text },
  h3: { fontSize: 15, fontWeight: '800', color: COLORS.text },
  label: { fontWeight: '700', color: COLORS.muted, fontSize: 13 },
  hint: { color: COLORS.muted, fontSize: 12 },
  input: { borderWidth: 1, borderColor: COLORS.border, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9, fontSize: 15, color: COLORS.text, backgroundColor: COLORS.input },
  iconBtn: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.primarySoft },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  member: { paddingVertical: 6, paddingHorizontal: 14, borderRadius: 999, backgroundColor: COLORS.primarySoft },
  memberText: { color: COLORS.primary, fontWeight: '800' },
  segment: { flexDirection: 'row', backgroundColor: COLORS.track, borderRadius: 14, padding: 3 },
  segBtn: { paddingVertical: 9, borderRadius: 11, alignItems: 'center' },
  segOn: { backgroundColor: COLORS.card, boxShadow: '0px 2px 6px rgba(59, 47, 42, 0.15)' },
  segText: { fontWeight: '800', color: COLORS.muted, fontSize: 13 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 18, backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.border },
  name: { fontWeight: '800', color: COLORS.text, fontSize: 15 },
  amount: { fontWeight: '800', fontSize: 16, color: COLORS.text },
  trash: { width: 28, height: 28, borderRadius: 14, backgroundColor: COLORS.dangerSoft, alignItems: 'center', justifyContent: 'center' },
  track: { height: 10, borderRadius: 5, overflow: 'hidden', backgroundColor: COLORS.track },
  badge: { alignSelf: 'flex-start', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 },
  badgeText: { color: '#fff', fontWeight: '700', fontSize: 11 },
  people: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  person: { flexGrow: 1, flexBasis: 150, gap: 3, padding: 12, borderRadius: 16, borderWidth: 1.5, backgroundColor: COLORS.card },
  thumb: { width: 44, height: 60, borderRadius: 8, backgroundColor: COLORS.subtle },
  noSlip: { alignItems: 'center', justifyContent: 'center' },
  smallBtn: { minWidth: 30, height: 28, paddingHorizontal: 8, borderRadius: 14, backgroundColor: COLORS.primarySoft, alignItems: 'center', justifyContent: 'center' },
  smallText: { fontSize: 12, fontWeight: '700', color: COLORS.primary },
});
