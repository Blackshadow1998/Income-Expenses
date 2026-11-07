import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Account, api, Category, YearData } from '@/api';
import { AccountFilter } from '@/components/AccountFilter';
import { BarChart, BarSeries } from '@/components/BarChart';
import { AnimatedNumber, FadeIn, PressScale, Skeleton } from '@/components/motion';
import { PeriodSwitch } from '@/components/PeriodSwitch';
import { Button, Card, ErrorBox, Stepper } from '@/components/ui';
import { CATEGORY_COLORS, COLORS, GRADIENTS, money, MONTHS_FULL, MONTHS_SHORT, pad2 } from '@/format';
import { setPendingMonth } from '@/state';

type Mode = 'inout' | 'category';

const IN_OUT: BarSeries[] = [
  { key: 'in', label: 'เงินเข้า', color: COLORS.in },
  { key: 'out', label: 'เงินออก', color: COLORS.out },
];

export default function YearlyScreen() {
  const [year, setYear] = useState(new Date().getFullYear());
  const [data, setData] = useState<YearData | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountId, setAccountId] = useState<number | null>(null); // null = all accounts
  const accountRef = useRef<number | null>(null);
  const [mode, setMode] = useState<Mode>('inout');
  const [selected, setSelected] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const yearRef = useRef(year);
  const reqId = useRef(0);

  const load = useCallback(async (y: number) => {
    const id = ++reqId.current;
    yearRef.current = y;
    setYear(y);
    setError(null);
    setData(null);
    setSelected(null);
    try {
      const [d, cs, accs] = await Promise.all([api.yearly(y, accountRef.current), api.categories(), api.accounts()]);
      if (id !== reqId.current) return;
      setData(d);
      setCategories(cs);
      setAccounts(accs.accounts);
    } catch (e) {
      if (id === reqId.current) setError((e as Error).message);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load(yearRef.current);
    }, [load]),
  );

  const series: BarSeries[] =
    mode === 'inout'
      ? IN_OUT
      : categories.map((c) => ({ key: c.code, label: c.name, color: CATEGORY_COLORS[c.code] }));
  const values =
    data?.months.map((m) => (mode === 'inout' ? { in: m.in, out: m.out } : (m.by_category as Record<string, number>))) ?? [];

  const sel = selected !== null && data ? data.months[selected] : null;

  const selectAccount = (id: number | null) => {
    accountRef.current = id;
    setAccountId(id);
    load(yearRef.current);
  };

  const openMonth = (monthIndex: number) => {
    setPendingMonth(`${year}-${pad2(monthIndex + 1)}`);
    router.navigate('/');
  };

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <PeriodSwitch current="year" />
      <FadeIn>
        <LinearGradient colors={GRADIENTS.primary} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.hero}>
          <View style={[styles.blob, { width: 170, height: 170, top: -60, right: -40 }]} />
          <Stepper light label={`ปี ${year + 543}`} onPrev={() => load(year - 1)} onNext={() => load(year + 1)} />
          <View style={styles.statsRow}>
            <Stat label="เงินเข้าทั้งปี" value={data?.totals.in} />
            <Stat label="เงินออกทั้งปี" value={data?.totals.out} />
            <Stat label="สุทธิทั้งปี" value={data?.totals.net} />
          </View>
        </LinearGradient>
      </FadeIn>
      <AccountFilter accounts={accounts} value={accountId} onChange={selectAccount} />

      {error ? (
        <ErrorBox message={error} onRetry={() => load(year)} />
      ) : !data ? (
        <Skeleton style={{ height: 300, borderRadius: 18 }} />
      ) : (
        <>
          <FadeIn delay={100}>
            <Card style={{ gap: 12 }}>
              <View style={styles.modeRow}>
                <Text style={styles.h2}>กราฟรายเดือน</Text>
                <View style={styles.segment}>
                  {(['inout', 'category'] as const).map((m) => (
                    <PressScale key={m} onPress={() => setMode(m)} style={[styles.segBtn, mode === m && styles.segBtnActive]}>
                      <Text style={[styles.segText, mode === m && { color: COLORS.primary }]}>
                        {m === 'inout' ? 'เข้า/ออก' : 'แยกหมวด'}
                      </Text>
                    </PressScale>
                  ))}
                </View>
              </View>
              <BarChart
                labels={MONTHS_SHORT}
                series={series}
                values={values}
                selected={selected}
                onSelect={(i) => setSelected(i === selected ? null : i)}
              />
              <Text style={{ color: COLORS.muted, fontSize: 12 }}>แตะที่เดือนเพื่อดูรายละเอียด</Text>
            </Card>
          </FadeIn>

          {sel && (
            <FadeIn key={sel.month}>
              <Card style={{ gap: 8 }}>
                <Text style={styles.h2}>
                  {MONTHS_FULL[sel.month - 1]} {year + 543}
                </Text>
                {categories.map((c) => (
                  <View key={c.id} style={styles.line}>
                    <Text style={{ color: CATEGORY_COLORS[c.code], fontWeight: '600' }}>{c.name}</Text>
                    <Text>{money(sel.by_category[c.code] ?? 0)}</Text>
                  </View>
                ))}
                <View style={[styles.line, { borderTopWidth: 1, borderTopColor: COLORS.border, paddingTop: 8 }]}>
                  <Text style={{ fontWeight: '700' }}>สุทธิ</Text>
                  <Text style={{ fontWeight: '700', color: sel.net >= 0 ? COLORS.in : COLORS.out }}>{money(sel.net)}</Text>
                </View>
                <Button title="ดูรายการเดือนนี้" variant="soft" onPress={() => openMonth(sel.month - 1)} />
              </Card>
            </FadeIn>
          )}

          <FadeIn delay={180}>
            <Card style={{ padding: 0, overflow: 'hidden' }}>
              <View style={[styles.tr, styles.th]}>
                <Text style={[styles.td, styles.tdMonth, styles.thText]}>เดือน</Text>
                <Text style={[styles.td, styles.thText]}>เข้า</Text>
                <Text style={[styles.td, styles.thText]}>ออก</Text>
                <Text style={[styles.td, styles.thText]}>สุทธิ</Text>
              </View>
              {data.months.map((m) => (
                <View key={m.month} style={styles.tr}>
                  <Text style={[styles.td, styles.tdMonth]} onPress={() => openMonth(m.month - 1)}>
                    {MONTHS_SHORT[m.month - 1]}
                  </Text>
                  <Text style={[styles.td, { color: COLORS.in }]}>{money(m.in)}</Text>
                  <Text style={[styles.td, { color: COLORS.out }]}>{money(m.out)}</Text>
                  <Text style={[styles.td, { color: m.net >= 0 ? COLORS.text : COLORS.out, fontWeight: '600' }]}>{money(m.net)}</Text>
                </View>
              ))}
            </Card>
          </FadeIn>
        </>
      )}
    </ScrollView>
  );
}

function Stat({ label, value }: { label: string; value?: number }) {
  return (
    <View style={styles.stat}>
      <Text style={{ color: 'rgba(255,255,255,0.8)', fontSize: 12 }}>{label}</Text>
      {value === undefined ? (
        <Text style={styles.statValue}>…</Text>
      ) : (
        <AnimatedNumber value={value} format={money} style={styles.statValue} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, gap: 12, maxWidth: 820, width: '100%', alignSelf: 'center', paddingBottom: 32 },
  hero: { borderRadius: 24, padding: 18, gap: 14, overflow: 'hidden', boxShadow: '0px 12px 28px rgba(139, 94, 60, 0.35)' },
  blob: { position: 'absolute', borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.09)' },
  statsRow: { flexDirection: 'row', gap: 8 },
  stat: { flex: 1, gap: 2, padding: 10, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.14)' },
  statValue: { color: '#fff', fontSize: 15, fontWeight: '800' },
  segment: { flexDirection: 'row', backgroundColor: COLORS.track, borderRadius: 12, padding: 3 },
  segBtn: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 10 },
  segBtnActive: { backgroundColor: COLORS.card, boxShadow: '0px 2px 6px rgba(30, 27, 75, 0.12)' },
  segText: { fontWeight: '700', color: COLORS.muted, fontSize: 13 },
  modeRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  h2: { fontSize: 17, fontWeight: '700', color: COLORS.text },
  line: { flexDirection: 'row', justifyContent: 'space-between' },
  tr: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: COLORS.border, paddingVertical: 8, paddingHorizontal: 12 },
  th: { backgroundColor: COLORS.subtle },
  thText: { fontWeight: '700', color: COLORS.muted },
  td: { flex: 1, textAlign: 'right', fontSize: 13, color: COLORS.text },
  tdMonth: { flex: 0.6, textAlign: 'left', color: COLORS.primary },
});
