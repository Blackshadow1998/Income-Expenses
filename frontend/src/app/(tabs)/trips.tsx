import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { api, TripListItem } from '@/api';
import { FadeIn, PressScale, Skeleton } from '@/components/motion';
import { Button, Card, ErrorBox, IconBubble } from '@/components/ui';
import { COLORS, money, showError } from '@/format';

/** Trips to split bills for: list + a quick "new trip" form (name and members). */
export default function TripsScreen() {
  const [trips, setTrips] = useState<TripListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [memberText, setMemberText] = useState('');
  const [members, setMembers] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setTrips(await api.trips());
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  // Names can be typed one at a time or several at once, separated by spaces or commas.
  const addMembers = () => {
    const names = memberText.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
    setMembers((m) => [...m, ...names.filter((n) => !m.includes(n))]);
    setMemberText('');
  };

  const create = async () => {
    const pending = memberText.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
    const all = [...members, ...pending.filter((n) => !members.includes(n))];
    if (!name.trim()) return showError(new Error('กรุณาตั้งชื่อทริป'));
    if (all.length < 2) return showError(new Error('ใส่สมาชิกอย่างน้อย 2 คน'));
    setSaving(true);
    try {
      const t = await api.createTrip(name.trim(), all);
      setCreating(false);
      setName('');
      setMembers([]);
      setMemberText('');
      router.push({ pathname: '/trip', params: { id: String(t.id) } });
    } catch (e) {
      showError(e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <FadeIn>
        <Card style={styles.intro}>
          <Text style={{ fontSize: 30 }}>🧾</Text>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={styles.h2}>หารบิลทริป</Text>
            <Text style={styles.hint}>ลงบิลที่จ่ายไประหว่างเที่ยว แล้วดูว่าใครต้องโอนให้ใคร เท่าไหร่ พร้อมติดตามการจ่าย</Text>
          </View>
        </Card>
      </FadeIn>

      {creating ? (
        <FadeIn from={-8}>
          <Card style={{ gap: 10 }}>
            <Text style={styles.h3}>ทริปใหม่</Text>
            <TextInput value={name} onChangeText={setName} maxLength={60} placeholder="ชื่อทริป เช่น เชียงใหม่ ปีใหม่" placeholderTextColor={COLORS.muted} style={styles.input} />
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TextInput
                value={memberText}
                onChangeText={setMemberText}
                onSubmitEditing={addMembers}
                placeholder="ชื่อสมาชิก (เว้นวรรคเพื่อใส่หลายคน)"
                placeholderTextColor={COLORS.muted}
                style={[styles.input, { flex: 1 }]}
              />
              <Button title="เพิ่ม" variant="soft" onPress={addMembers} />
            </View>
            {members.length > 0 && (
              <View style={styles.chips}>
                {members.map((m) => (
                  <PressScale key={m} onPress={() => setMembers((ms) => ms.filter((x) => x !== m))} style={styles.chip} accessibilityLabel={`เอา ${m} ออก`}>
                    <Text style={styles.chipText}>{m} ✕</Text>
                  </PressScale>
                ))}
              </View>
            )}
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Button title="ยกเลิก" variant="outline" style={{ flex: 1 }} onPress={() => setCreating(false)} />
              <Button title={saving ? 'กำลังสร้าง...' : 'สร้างทริป'} style={{ flex: 1 }} onPress={create} disabled={saving} />
            </View>
          </Card>
        </FadeIn>
      ) : (
        <Button title="สร้างทริปใหม่" icon="＋" onPress={() => setCreating(true)} />
      )}

      {error ? (
        <ErrorBox message={error} onRetry={load} />
      ) : !trips ? (
        [0, 1].map((i) => <Skeleton key={i} style={{ height: 76, borderRadius: 18 }} />)
      ) : trips.length === 0 ? (
        !creating && (
          <Card style={{ alignItems: 'center', gap: 6, paddingVertical: 28 }}>
            <Text style={{ fontSize: 36 }}>🏝️</Text>
            <Text style={{ color: COLORS.muted }}>ยังไม่มีทริป กด &quot;สร้างทริปใหม่&quot; เพื่อเริ่ม</Text>
          </Card>
        )
      ) : (
        trips.map((t, i) => (
          <FadeIn key={t.id} delay={i * 50}>
            <PressScale onPress={() => router.push({ pathname: '/trip', params: { id: String(t.id) } })} scaleTo={0.98} style={styles.row}>
              <IconBubble icon="🧳" tint={COLORS.primarySoft} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={styles.name} numberOfLines={1}>{t.name}</Text>
                <Text style={styles.hint}>{t.member_count} คน · {t.bill_count} บิล</Text>
              </View>
              <Text style={styles.total}>{money(t.total)}</Text>
            </PressScale>
          </FadeIn>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, gap: 12, maxWidth: 820, width: '100%', alignSelf: 'center', paddingBottom: 32 },
  intro: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  h2: { fontSize: 17, fontWeight: '800', color: COLORS.text },
  h3: { fontSize: 15, fontWeight: '800', color: COLORS.text },
  hint: { color: COLORS.muted, fontSize: 12 },
  input: { borderWidth: 1, borderColor: COLORS.border, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16, color: COLORS.text, backgroundColor: COLORS.input },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 999, backgroundColor: COLORS.primarySoft },
  chipText: { color: COLORS.primary, fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 18, backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.border },
  name: { fontWeight: '800', color: COLORS.text, fontSize: 15 },
  total: { fontWeight: '800', color: COLORS.primary },
});
