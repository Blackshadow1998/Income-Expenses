import { StyleSheet, Text, View } from 'react-native';
import type { Insights } from '../api';
import { COLORS, dateLabel, money } from '../format';
import { Card } from './ui';

/** "💡 สรุปเดือนนี้": spending vs last month, top items, daily average, biggest expense. */
export function InsightsCard({ data }: { data: Insights }) {
  if (data.out === 0 && data.prev_out === 0) return null;
  const up = (data.change_pct ?? 0) > 0;
  return (
    <Card style={{ gap: 10 }}>
      <Text style={styles.h3}>💡 สรุปเดือนนี้</Text>
      {data.change_pct !== null && (
        <Line icon={up ? '📈' : '📉'}>
          ใช้จ่าย{up ? 'มากกว่า' : 'น้อยกว่า'}เดือนก่อน{' '}
          <Text style={{ fontWeight: '800', color: up ? COLORS.out : COLORS.in }}>{Math.abs(data.change_pct).toFixed(0)}%</Text>
          <Text style={styles.muted}> ({money(data.prev_out)} → {money(data.out)})</Text>
        </Line>
      )}
      <Line icon="📅">
        เฉลี่ยวันละ <Text style={styles.bold}>{money(data.avg_per_day)}</Text> บาท
      </Line>
      {data.top.length > 0 && (
        <Line icon="🏆">
          ใช้มากสุด:{' '}
          {data.top.map((t, i) => (
            <Text key={t.name}>
              {i > 0 ? ', ' : ''}
              <Text style={styles.bold}>{t.name}</Text>
              <Text style={styles.muted}> {money(t.amount)}</Text>
            </Text>
          ))}
        </Line>
      )}
      {data.biggest && (
        <Line icon="💥">
          ก้อนใหญ่สุด <Text style={styles.bold}>{money(data.biggest.amount)}</Text>{' '}
          <Text style={styles.muted}>
            {data.biggest.subcategory_name || data.biggest.note || data.biggest.category_name} · {dateLabel(data.biggest.date)}
          </Text>
        </Line>
      )}
    </Card>
  );
}

function Line({ icon, children }: { icon: string; children: React.ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', gap: 8 }}>
      <Text>{icon}</Text>
      <Text style={{ flex: 1, color: COLORS.text, lineHeight: 20 }}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  h3: { fontSize: 15, fontWeight: '700', color: COLORS.text },
  bold: { fontWeight: '800' },
  muted: { color: COLORS.muted, fontSize: 12 },
});
