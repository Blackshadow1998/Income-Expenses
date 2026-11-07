import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { api, Category, Transaction } from '@/api';
import { FadeIn, PressScale } from '@/components/motion';
import { Card, IconBubble, Loading } from '@/components/ui';
import { CATEGORY_COLORS, CATEGORY_ICONS, CATEGORY_TINTS, COLORS, dateLabel, money, toISODate } from '@/format';

type Range = 'all' | 'month' | '3m' | 'year';
const RANGES: { key: Range; label: string }[] = [
  { key: 'all', label: 'ทั้งหมด' },
  { key: 'month', label: 'เดือนนี้' },
  { key: '3m', label: '3 เดือน' },
  { key: 'year', label: 'ปีนี้' },
];

function rangeFrom(r: Range): string {
  const d = new Date();
  if (r === 'month') return toISODate(new Date(d.getFullYear(), d.getMonth(), 1));
  if (r === '3m') return toISODate(new Date(d.getFullYear(), d.getMonth() - 2, 1));
  if (r === 'year') return toISODate(new Date(d.getFullYear(), 0, 1));
  return '';
}

/** Search transactions by text with quick filters for period, category and amount. */
export default function SearchScreen() {
  const [q, setQ] = useState('');
  const [range, setRange] = useState<Range>('all');
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [min, setMin] = useState('');
  const [max, setMax] = useState('');
  const [categories, setCategories] = useState<Category[]>([]);
  const [result, setResult] = useState<{ items: Transaction[]; totals: { in: number; out: number }; capped: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reqId = useRef(0);

  useEffect(() => {
    api.categories().then(setCategories).catch(() => {});
  }, []);

  // Search as the user types (debounced).
  useEffect(() => {
    const id = ++reqId.current;
    const timer = setTimeout(async () => {
      try {
        const r = await api.search({ q: q.trim(), from: rangeFrom(range), category_id: categoryId, min, max });
        if (id === reqId.current) {
          setResult(r);
          setError(null);
        }
      } catch (e) {
        if (id === reqId.current) setError((e as Error).message);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [q, range, categoryId, min, max]);

  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <TextInput
        value={q}
        onChangeText={setQ}
        placeholder="🔍 ค้นหา: รายละเอียด, ผู้รับ, รายการ"
        placeholderTextColor="#9ca3af"
        autoFocus
        style={[styles.input, { fontSize: 16 }]}
      />
      <View style={styles.chips}>
        {RANGES.map((r) => (
          <Chip key={r.key} label={r.label} active={range === r.key} onPress={() => setRange(r.key)} />
        ))}
      </View>
      <View style={styles.chips}>
        <Chip label="ทุกหมวด" active={categoryId === null} onPress={() => setCategoryId(null)} />
        {categories.map((c) => (
          <Chip key={c.id} label={`${CATEGORY_ICONS[c.code]} ${c.name}`} active={categoryId === c.id} color={CATEGORY_COLORS[c.code]} onPress={() => setCategoryId(c.id)} />
        ))}
      </View>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <TextInput value={min} onChangeText={(t) => setMin(t.replace(/[^0-9.]/g, ''))} placeholder="ขั้นต่ำ (บาท)" placeholderTextColor="#9ca3af" keyboardType="decimal-pad" style={[styles.input, { flex: 1, minWidth: 0 }]} />
        <TextInput value={max} onChangeText={(t) => setMax(t.replace(/[^0-9.]/g, ''))} placeholder="สูงสุด (บาท)" placeholderTextColor="#9ca3af" keyboardType="decimal-pad" style={[styles.input, { flex: 1, minWidth: 0 }]} />
      </View>

      {error ? (
        <Text style={{ color: COLORS.out }}>{error}</Text>
      ) : !result ? (
        <Loading />
      ) : (
        <>
          <Text style={styles.summary}>
            พบ {result.items.length}{result.capped ? '+' : ''} รายการ · เข้า <Text style={{ color: COLORS.in }}>{money(result.totals.in)}</Text> · ออก{' '}
            <Text style={{ color: COLORS.out }}>{money(result.totals.out)}</Text>
          </Text>
          {result.items.length > 0 && (
            <Card style={{ padding: 0, overflow: 'hidden' }}>
              {result.items.map((t, i) => (
                <FadeIn key={t.id} delay={Math.min(i * 25, 300)} from={6}>
                  <PressScale
                    onPress={() => router.push({ pathname: '/transaction', params: { id: String(t.id) } })}
                    scaleTo={0.98}
                    style={[styles.row, i > 0 && styles.divider]}
                  >
                    <IconBubble icon={CATEGORY_ICONS[t.category_code]} tint={CATEGORY_TINTS[t.category_code]} size={38} />
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={styles.title} numberOfLines={1}>{t.subcategory_name || t.note || t.category_name}</Text>
                      <Text style={styles.sub} numberOfLines={1}>
                        {dateLabel(t.date)}
                        {t.payee ? ` · 👤 ${t.payee}` : ''}
                        {t.subcategory_name && t.note ? ` · ${t.note}` : ''}
                      </Text>
                    </View>
                    <Text style={{ fontWeight: '800', color: t.direction > 0 ? COLORS.in : COLORS.out }}>
                      {t.direction > 0 ? '+' : '−'}{money(t.amount)}
                    </Text>
                  </PressScale>
                </FadeIn>
              ))}
            </Card>
          )}
        </>
      )}
    </ScrollView>
  );
}

function Chip({ label, active, onPress, color = COLORS.primary }: { label: string; active: boolean; onPress: () => void; color?: string }) {
  return (
    <PressScale onPress={onPress} style={[styles.chip, active && { backgroundColor: color, borderColor: color }]}>
      <Text style={{ color: active ? '#fff' : COLORS.text, fontWeight: '600', fontSize: 13 }}>{label}</Text>
    </PressScale>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, gap: 10, maxWidth: 720, width: '100%', alignSelf: 'center', paddingBottom: 32 },
  input: { borderWidth: 1, borderColor: COLORS.border, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: COLORS.text, backgroundColor: COLORS.input },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.card },
  summary: { color: COLORS.muted, fontSize: 13, marginTop: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 12, backgroundColor: COLORS.card },
  divider: { borderTopWidth: 1, borderTopColor: COLORS.border },
  title: { fontWeight: '700', color: COLORS.text },
  sub: { color: COLORS.muted, fontSize: 12 },
});
