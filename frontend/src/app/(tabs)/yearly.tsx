import { router, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Account, api, Category, YearData } from '@/api';
import { AccountFilter } from '@/components/AccountFilter';
import { BarChart, BarSeries } from '@/components/BarChart';
import { Button, Card, ErrorBox, Loading, Stepper } from '@/components/ui';
import { CATEGORY_COLORS, COLORS, money, MONTHS_FULL, MONTHS_SHORT, pad2 } from '@/format';
import { setPendingMonth } from '@/state';

type Mode = 'inout' | 'category';

const IN_OUT: BarSeries[] = [
  { key: 'in', label: 'เงินเข้า (รับ + กู้)', color: COLORS.in },
  { key: 'out', label: 'เงินออก (จ่าย + ให้ยืม)', color: COLORS.out },
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
      <Card style={{ gap: 12 }}>
        <Stepper label={`ปี ${year + 543} (${year})`} onPrev={() => load(year - 1)} onNext={() => load(year + 1)} />
        <AccountFilter accounts={accounts} value={accountId} onChange={selectAccount} />
      </Card>

      {error ? (
        <ErrorBox message={error} onRetry={() => load(year)} />
      ) : !data ? (
        <Loading />
      ) : (
        <>
          <View style={styles.statsRow}>
            <Stat label="เงินเข้าทั้งปี" value={data.totals.in} color={COLORS.in} />
            <Stat label="เงินออกทั้งปี" value={data.totals.out} color={COLORS.out} />
            <Stat label="สุทธิทั้งปี" value={data.totals.net} color={data.totals.net >= 0 ? COLORS.in : COLORS.out} />
          </View>

          <Card style={{ gap: 12 }}>
            <View style={styles.modeRow}>
              <Text style={styles.h2}>กราฟรายเดือน</Text>
              <View style={{ flexDirection: 'row', gap: 6 }}>
                <Button title="เข้า/ออก" small variant={mode === 'inout' ? 'primary' : 'outline'} onPress={() => setMode('inout')} />
                <Button title="แยกหมวด" small variant={mode === 'category' ? 'primary' : 'outline'} onPress={() => setMode('category')} />
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

          {sel && (
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
              <Button title="ดูรายการเดือนนี้" variant="outline" onPress={() => openMonth(sel.month - 1)} />
            </Card>
          )}

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
        </>
      )}
    </ScrollView>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <Card style={{ flex: 1, gap: 4, padding: 12 }}>
      <Text style={{ color: COLORS.muted, fontSize: 12 }}>{label}</Text>
      <Text style={{ color, fontSize: 15, fontWeight: '700' }} numberOfLines={1} adjustsFontSizeToFit>
        {money(value)}
      </Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, gap: 12, maxWidth: 820, width: '100%', alignSelf: 'center' },
  statsRow: { flexDirection: 'row', gap: 8 },
  modeRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  h2: { fontSize: 17, fontWeight: '700', color: COLORS.text },
  line: { flexDirection: 'row', justifyContent: 'space-between' },
  tr: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: COLORS.border, paddingVertical: 8, paddingHorizontal: 12 },
  th: { backgroundColor: '#f9fafb' },
  thText: { fontWeight: '700', color: COLORS.muted },
  td: { flex: 1, textAlign: 'right', fontSize: 13, color: COLORS.text },
  tdMonth: { flex: 0.6, textAlign: 'left', color: COLORS.primary },
});
