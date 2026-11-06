import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Account, AccountsSummary, api } from '@/api';
import { Button, Card, ErrorBox, Loading } from '@/components/ui';
import { ACCOUNT_TYPE_COLORS, COLORS, confirmAsync, money, showError } from '@/format';

export default function AccountsScreen() {
  const [data, setData] = useState<AccountsSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await api.accounts());
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const onDelete = async (a: Account) => {
    if (a.transaction_count > 0) {
      showError(new Error(`บัญชีนี้มีรายการรับ/จ่ายอยู่ ${a.transaction_count} รายการ ลบไม่ได้`));
      return;
    }
    if (!(await confirmAsync('ลบบัญชี', `ต้องการลบบัญชี "${a.label}" ใช่หรือไม่?`))) return;
    try {
      await api.removeAccount(a.id);
      await load();
    } catch (e) {
      showError(e);
    }
  };

  if (error) {
    return (
      <View style={styles.page}>
        <ErrorBox message={error} onRetry={load} />
      </View>
    );
  }
  if (!data) return <Loading />;

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Card style={styles.totalCard}>
        <Text style={{ color: '#e0e7ff' }}>ยอดเงินรวมทุกบัญชี</Text>
        <Text style={styles.totalValue}>{money(data.total)} บาท</Text>
        <Text style={{ color: '#c7d2fe', fontSize: 12 }}>{data.accounts.length} บัญชี</Text>
      </Card>

      {data.by_type.length > 0 && (
        <View style={styles.typeGrid}>
          {data.by_type.map((t) => (
            <Card key={t.code} style={[styles.typeCard, { borderLeftColor: ACCOUNT_TYPE_COLORS[t.code] ?? COLORS.primary }]}>
              <Text style={{ color: COLORS.muted, fontSize: 12 }}>
                {t.name} ({t.count})
              </Text>
              <Text style={{ fontWeight: '700', color: t.balance < 0 ? COLORS.out : COLORS.text }}>{money(t.balance)}</Text>
            </Card>
          ))}
        </View>
      )}

      <View style={styles.header}>
        <Text style={styles.h2}>บัญชีทั้งหมด</Text>
        <Button title="+ เพิ่มบัญชี" onPress={() => router.push('/account')} />
      </View>

      {data.accounts.length === 0 && (
        <Card>
          <Text style={{ color: COLORS.muted, textAlign: 'center' }}>
            ยังไม่มีบัญชี กด "เพิ่มบัญชี" เพื่อสร้างบัญชีแรก
          </Text>
        </Card>
      )}

      {data.accounts.map((a) => {
        const color = ACCOUNT_TYPE_COLORS[a.type_code] ?? COLORS.primary;
        return (
          <Card key={a.id} style={styles.row}>
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={styles.bank}>{a.bank_name}</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <View style={[styles.badge, { backgroundColor: color }]}>
                  <Text style={styles.badgeText}>{a.type_name}</Text>
                </View>
                {!!a.name && <Text style={{ color: COLORS.text }}>{a.name}</Text>}
              </View>
              <Text style={{ color: COLORS.muted, fontSize: 12 }}>
                เริ่มต้น {money(a.opening_balance)} · {a.transaction_count} รายการ
              </Text>
            </View>
            <View style={{ alignItems: 'flex-end', gap: 6 }}>
              <Text style={[styles.balance, { color: a.balance < 0 ? COLORS.out : COLORS.text }]}>{money(a.balance)}</Text>
              <View style={{ flexDirection: 'row', gap: 6 }}>
                <Button
                  title="แก้ไข"
                  variant="outline"
                  small
                  onPress={() => router.push({ pathname: '/account', params: { id: String(a.id) } })}
                />
                <Button title="ลบ" variant="danger" small onPress={() => onDelete(a)} />
              </View>
            </View>
          </Card>
        );
      })}

      {data.unassigned.count > 0 && (
        <Card style={[styles.row, { borderStyle: 'dashed' }]}>
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={styles.bank}>ไม่ระบุบัญชี</Text>
            <Text style={{ color: COLORS.muted, fontSize: 12 }}>
              รายการเก่า {data.unassigned.count} รายการที่บันทึกก่อนมีระบบบัญชี — กด "แก้ไข" ที่รายการเพื่อเลือกบัญชี
            </Text>
          </View>
          <Text style={[styles.balance, { color: COLORS.muted }]}>{money(data.unassigned.balance)}</Text>
        </Card>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, gap: 12, maxWidth: 820, width: '100%', alignSelf: 'center' },
  totalCard: { backgroundColor: COLORS.primary, borderColor: COLORS.primary, gap: 4 },
  totalValue: { color: '#fff', fontSize: 26, fontWeight: '800' },
  typeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  typeCard: { flexGrow: 1, flexBasis: 140, padding: 12, gap: 2, borderLeftWidth: 4 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 },
  h2: { fontSize: 17, fontWeight: '700', color: COLORS.text },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  bank: { fontSize: 15, fontWeight: '700', color: COLORS.text },
  badge: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 },
  badgeText: { color: '#fff', fontWeight: '600', fontSize: 12 },
  balance: { fontSize: 16, fontWeight: '700' },
});
