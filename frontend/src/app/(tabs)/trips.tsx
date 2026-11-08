import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { api, TripListItem } from '@/api';
import { FadeIn, PressScale, Skeleton } from '@/components/motion';
import { Button, Card, ErrorBox, IconBubble } from '@/components/ui';
import { COLORS, money, showError } from '@/format';
import { t } from '@/i18n';

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
    if (!name.trim()) return showError(new Error(t('trips.nameError')));
    if (all.length < 2) return showError(new Error(t('trips.membersError')));
    setSaving(true);
    try {
      const created = await api.createTrip(name.trim(), all);
      setCreating(false);
      setName('');
      setMembers([]);
      setMemberText('');
      router.push({ pathname: '/trip', params: { id: String(created.id) } });
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
            <Text style={styles.h2}>{t('trips.title')}</Text>
            <Text style={styles.hint}>{t('trips.hint')}</Text>
          </View>
        </Card>
      </FadeIn>

      {creating ? (
        <FadeIn from={-8}>
          <Card style={{ gap: 10 }}>
            <Text style={styles.h3}>{t('trips.new')}</Text>
            <TextInput value={name} onChangeText={setName} maxLength={60} placeholder={t('trips.namePh')} placeholderTextColor={COLORS.muted} style={styles.input} />
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TextInput
                value={memberText}
                onChangeText={setMemberText}
                onSubmitEditing={addMembers}
                placeholder={t('trips.membersPh')}
                placeholderTextColor={COLORS.muted}
                style={[styles.input, { flex: 1 }]}
              />
              <Button title={t('month.add')} variant="soft" onPress={addMembers} />
            </View>
            {members.length > 0 && (
              <View style={styles.chips}>
                {members.map((m) => (
                  <PressScale key={m} onPress={() => setMembers((ms) => ms.filter((x) => x !== m))} style={styles.chip} accessibilityLabel={t('trips.removeMember', { name: m })}>
                    <Text style={styles.chipText}>{m} ✕</Text>
                  </PressScale>
                ))}
              </View>
            )}
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Button title={t('common.cancel')} variant="outline" style={{ flex: 1 }} onPress={() => setCreating(false)} />
              <Button title={saving ? t('trips.creating') : t('trips.create')} style={{ flex: 1 }} onPress={create} disabled={saving} />
            </View>
          </Card>
        </FadeIn>
      ) : (
        <Button title={t('trips.createNew')} icon="＋" onPress={() => setCreating(true)} />
      )}

      {error ? (
        <ErrorBox message={error} onRetry={load} />
      ) : !trips ? (
        [0, 1].map((i) => <Skeleton key={i} style={{ height: 76, borderRadius: 18 }} />)
      ) : trips.length === 0 ? (
        !creating && (
          <Card style={{ alignItems: 'center', gap: 6, paddingVertical: 28 }}>
            <Text style={{ fontSize: 36 }}>🏝️</Text>
            <Text style={{ color: COLORS.muted }}>{t('trips.empty')}</Text>
          </Card>
        )
      ) : (
        trips.map((trip, i) => (
          <FadeIn key={trip.id} delay={i * 50}>
            <PressScale onPress={() => router.push({ pathname: '/trip', params: { id: String(trip.id) } })} scaleTo={0.98} style={styles.row}>
              <IconBubble icon="🧳" tint={COLORS.primarySoft} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={styles.name} numberOfLines={1}>{trip.name}</Text>
                <Text style={styles.hint}>{t('trips.counts', { members: trip.member_count, bills: trip.bill_count })}</Text>
              </View>
              <Text style={styles.total}>{money(trip.total)}</Text>
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
