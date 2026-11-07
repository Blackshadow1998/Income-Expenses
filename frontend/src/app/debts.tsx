import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { api, Debt } from '@/api';
import { AnimatedNumber, FadeIn } from '@/components/motion';
import { Button, Card, ErrorBox, IconBubble, Loading } from '@/components/ui';
import { CATEGORY_COLORS, COLORS, dateLabel, money } from '@/format';

/** Who still owes the user, and whom the user still owes, from ให้ยืม/กู้ and their repayments by payee. */
export default function DebtsScreen() {
  const [debts, setDebts] = useState<Debt[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setDebts(await api.debts());
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  if (error) return <View style={styles.page}><ErrorBox message={error} onRetry={load} /></View>;
  if (!debts) return <Loading />;

  const owedToMe = debts.filter((d) => d.owed_to_me > 0.005);
  const iOwe = debts.filter((d) => d.i_owe > 0.005);
  const settled = debts.filter((d) => d.owed_to_me <= 0.005 && d.i_owe <= 0.005);
  const sum = (list: Debt[], key: 'owed_to_me' | 'i_owe') => list.reduce((s, d) => s + d[key], 0);

  const settle = (d: Debt, kind: 'lend_return' | 'borrow_repay') =>
    router.push({
      pathname: '/transaction',
      params: { category: kind, payee: d.person, amount: String(kind === 'lend_return' ? d.owed_to_me : d.i_owe) },
    });

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Total label="คนอื่นค้างเรา" value={sum(owedToMe, 'owed_to_me')} color={CATEGORY_COLORS.lend} />
        <Total label="เราค้างคนอื่น" value={sum(iOwe, 'i_owe')} color={CATEGORY_COLORS.borrow} />
      </View>
      <Text style={styles.hint}>
        คิดจากรายการ "ให้ยืม / กู้" และ "รับคืนเงินยืม / คืนเงินกู้" แยกตามช่อง ผู้รับ — ใส่ชื่อให้ตรงกันทุกครั้ง
      </Text>

      <Section title="🤝 คนที่ยืมเราไป" empty="ไม่มีใครค้างเงินเรา">
        {owedToMe.map((d, i) => (
          <FadeIn key={`l${d.person}`} delay={i * 50}>
            <DebtRow d={d} amount={d.owed_to_me} detail={`ให้ยืม ${money(d.lent)} · คืนแล้ว ${money(d.returned)}`} color={CATEGORY_COLORS.lend}
              action="ได้คืนแล้ว" onAction={() => settle(d, 'lend_return')} />
          </FadeIn>
        ))}
      </Section>

      <Section title="🏦 เรายืมใครอยู่" empty="ไม่มีหนี้ค้าง">
        {iOwe.map((d, i) => (
          <FadeIn key={`b${d.person}`} delay={i * 50}>
            <DebtRow d={d} amount={d.i_owe} detail={`กู้ ${money(d.borrowed)} · คืนแล้ว ${money(d.repaid)}`} color={CATEGORY_COLORS.borrow}
              action="คืนแล้ว" onAction={() => settle(d, 'borrow_repay')} />
          </FadeIn>
        ))}
      </Section>

      {settled.length > 0 && (
        <Section title="✅ เคลียร์แล้ว">
          {settled.map((d) => (
            <View key={`s${d.person}`} style={styles.settled}>
              <Text style={{ color: COLORS.text }}>{d.person || '(ไม่ระบุชื่อ)'}</Text>
              <Text style={styles.hint}>ล่าสุด {dateLabel(d.last_date)}</Text>
            </View>
          ))}
        </Section>
      )}
    </ScrollView>
  );
}

function Total({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <Card style={{ flex: 1, gap: 2 }}>
      <Text style={styles.hint}>{label}</Text>
      <AnimatedNumber value={value} format={money} style={{ fontSize: 20, fontWeight: '800', color }} />
    </Card>
  );
}

function Section({ title, empty, children }: { title: string; empty?: string; children: React.ReactNode }) {
  const has = Array.isArray(children) ? children.length > 0 : !!children;
  return (
    <View style={{ gap: 8 }}>
      <Text style={styles.h2}>{title}</Text>
      {has ? children : <Text style={styles.hint}>{empty}</Text>}
    </View>
  );
}

function DebtRow({ d, amount, detail, color, action, onAction }: {
  d: Debt; amount: number; detail: string; color: string; action: string; onAction: () => void;
}) {
  return (
    <Card style={styles.row}>
      <IconBubble icon={(d.person || '?').slice(0, 1)} tint={color + '22'} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.name}>{d.person || '(ไม่ระบุชื่อ)'}</Text>
        <Text style={styles.hint}>{detail}</Text>
        <Text style={styles.hint}>ล่าสุด {dateLabel(d.last_date)}</Text>
      </View>
      <View style={{ alignItems: 'flex-end', gap: 6 }}>
        <Text style={{ fontSize: 16, fontWeight: '800', color }}>{money(amount)}</Text>
        <Button title={action} small variant="soft" onPress={onAction} />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, gap: 14, maxWidth: 640, width: '100%', alignSelf: 'center', paddingBottom: 32 },
  h2: { fontSize: 16, fontWeight: '800', color: COLORS.text },
  hint: { color: COLORS.muted, fontSize: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  name: { fontWeight: '700', color: COLORS.text, fontSize: 15 },
  settled: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, paddingHorizontal: 4 },
});
