import * as ImagePicker from 'expo-image-picker';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Account, api, Category, MonthData, Slip, Transaction } from '@/api';
import { AccountFilter } from '@/components/AccountFilter';
import { PendingSlipCard } from '@/components/PendingSlipCard';
import { Button, Card, ErrorBox, Loading, Stepper } from '@/components/ui';
import {
  CATEGORY_COLORS, COLORS, confirmAsync, currentMonth, dateLabel, money, monthLabel, MONTHS_SHORT, shiftMonth, showError, showInfo,
} from '@/format';
import { takePendingMonth } from '@/state';

export default function MonthScreen() {
  const [months, setMonths] = useState<string[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountId, setAccountId] = useState<number | null>(null); // null = all accounts
  const accountRef = useRef<number | null>(null);
  const [month, setMonth] = useState<string | null>(null);
  const [data, setData] = useState<MonthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const monthRef = useRef<string | null>(null);
  const reqId = useRef(0);

  const loadMonth = useCallback(async (m: string) => {
    const id = ++reqId.current;
    monthRef.current = m;
    setMonth(m);
    setLoading(true);
    setError(null);
    try {
      const d = await api.month(m, accountRef.current);
      if (id === reqId.current) setData(d);
    } catch (e) {
      if (id === reqId.current) setError((e as Error).message);
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  }, []);

  const loadAll = useCallback(
    async (target: string | null) => {
      try {
        const [ms, cs, accs] = await Promise.all([api.months(), api.categories(), api.accounts()]);
        setMonths(ms);
        setCategories(cs);
        setAccounts(accs.accounts);
        // The filtered account may have been deleted meanwhile.
        if (accountRef.current && !accs.accounts.some((a) => a.id === accountRef.current)) {
          accountRef.current = null;
          setAccountId(null);
        }
        // Default to the latest month that has data (the API always includes the current month).
        await loadMonth(target ?? ms[0] ?? currentMonth());
      } catch (e) {
        setError((e as Error).message);
        setLoading(false);
      }
    },
    [loadMonth],
  );

  useFocusEffect(
    useCallback(() => {
      loadAll(takePendingMonth() ?? monthRef.current);
    }, [loadAll]),
  );

  const onDelete = async (t: Transaction) => {
    const ok = await confirmAsync(
      'ลบรายการ',
      `ต้องการลบ "${t.category_name} ${money(t.amount)} บาท" วันที่ ${dateLabel(t.date)} ใช่หรือไม่?`,
    );
    if (!ok) return;
    try {
      await api.remove(t.id);
      await loadAll(monthRef.current);
    } catch (e) {
      showError(e);
    }
  };

  const selectAccount = (id: number | null) => {
    accountRef.current = id;
    setAccountId(id);
    if (monthRef.current) loadMonth(monthRef.current);
  };

  // Pick one or more slip images, let the server read them, then jump to the month of the slip.
  const onReadSlips = async () => {
    const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, quality: 1 });
    if (picked.canceled || !picked.assets?.length) return;
    setUploading(true);
    try {
      const results = await api.uploadSlips(picked.assets);
      const ok = results.filter((r) => r.slip && !r.error);
      const lines = results.map((r) =>
        r.error
          ? `✗ ${r.file}: ${r.error}`
          : `✓ ${r.file}: ${r.slip!.amount > 0 ? money(r.slip!.amount) + ' บาท' : 'ไม่พบจำนวนเงิน'} (${dateLabel(r.slip!.date)})`,
      );
      showInfo(`อ่านสลิปสำเร็จ ${ok.length}/${results.length} ใบ`, `${lines.join('\n')}\n\nกด "คอนเฟิร์ม" เพื่อตรวจและใส่รายละเอียด`);
      const target = (ok[0] ?? results.find((r) => r.slip))?.slip?.date.slice(0, 7);
      await loadAll(target ?? monthRef.current);
    } catch (e) {
      showError(e);
    } finally {
      setUploading(false);
    }
  };

  const onDeleteSlip = async (sl: Slip) => {
    if (!(await confirmAsync('ลบสลิป', `ต้องการลบสลิป ${sl.amount > 0 ? money(sl.amount) + ' บาท ' : ''}วันที่ ${dateLabel(sl.date)} ใช่หรือไม่?`))) return;
    try {
      await api.removeSlip(sl.id);
      await loadAll(monthRef.current);
    } catch (e) {
      showError(e);
    }
  };

  const goConfirm = (sl: Slip) => router.push({ pathname: '/transaction', params: { slipId: String(sl.id) } });

  const goAdd = () =>
    router.push({
      pathname: '/transaction',
      params: { ...(month ? { month } : {}), ...(accountId ? { accountId: String(accountId) } : {}) },
    });
  const goEdit = (t: Transaction) => router.push({ pathname: '/transaction', params: { id: String(t.id) } });

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Card style={{ gap: 12 }}>
        <Stepper
          label={month ? monthLabel(month) : '...'}
          onPrev={() => month && loadMonth(shiftMonth(month, -1))}
          onNext={() => month && loadMonth(shiftMonth(month, 1))}
        />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
          {months.map((m) => {
            const active = m === month;
            const [y, mm] = m.split('-').map(Number);
            return (
              <Pressable key={m} onPress={() => loadMonth(m)} style={[styles.chip, active && styles.chipActive]}>
                <Text style={[styles.chipText, active && { color: '#fff' }]}>
                  {MONTHS_SHORT[mm - 1]} {String(y + 543).slice(2)}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
        <AccountFilter accounts={accounts} value={accountId} onChange={selectAccount} />
      </Card>

      {error ? (
        <ErrorBox message={error} onRetry={() => loadAll(monthRef.current)} />
      ) : !data ? (
        <Loading />
      ) : (
        <>
          <View style={styles.statsRow}>
            <Stat label="เงินเข้า (เดือนนี้)" value={data.totals.in} color={COLORS.in} />
            <Stat label="เงินออก (เดือนนี้)" value={data.totals.out} color={COLORS.out} />
          </View>
          <View style={styles.statsRow}>
            <Stat label="สุทธิเดือนนี้" value={data.totals.net} color={data.totals.net >= 0 ? COLORS.in : COLORS.out} />
            <Stat label={accountId ? 'เงินคงเหลือบัญชีนี้' : 'เงินคงเหลือทุกบัญชี'} value={data.balance} color={COLORS.primary} />
          </View>

          <Card style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {categories.map((c) => (
              <View key={c.id} style={[styles.catPill, { borderColor: CATEGORY_COLORS[c.code] }]}>
                <Text style={{ color: CATEGORY_COLORS[c.code], fontWeight: '600' }}>{c.name}</Text>
                <Text style={{ color: COLORS.text }}>{money(data.totals.by_category[c.code] ?? 0)}</Text>
              </View>
            ))}
          </Card>

          <View style={styles.listHeader}>
            <Text style={styles.h2}>รายการ ({data.items.length})</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Button title={uploading ? 'กำลังอ่านสลิป...' : '📷 อ่านสลิป'} variant="outline" onPress={onReadSlips} disabled={uploading} />
              <Button title="+ เพิ่มรายการ" onPress={goAdd} />
            </View>
          </View>

          {data.pending.length > 0 && (
            <View style={{ gap: 8 }}>
              <Text style={styles.pendingHeader}>🧾 รอคอนเฟิร์ม ({data.pending.length}) — ยังไม่นับรวมในยอดเงิน</Text>
              {data.pending.map((sl) => (
                <PendingSlipCard key={sl.id} slip={sl} onConfirm={() => goConfirm(sl)} onDelete={() => onDeleteSlip(sl)} />
              ))}
            </View>
          )}

          {loading && <Loading />}
          {!loading && data.items.length === 0 && data.pending.length === 0 && (
            <Card>
              <Text style={{ color: COLORS.muted, textAlign: 'center' }}>ยังไม่มีรายการในเดือนนี้</Text>
            </Card>
          )}
          {!loading &&
            data.items.map((t) => (
              <Card key={t.id} style={styles.row}>
                <View style={{ flex: 1, gap: 4 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <View style={[styles.badge, { backgroundColor: CATEGORY_COLORS[t.category_code] }]}>
                      <Text style={styles.badgeText}>{t.category_name}</Text>
                    </View>
                    <Text style={{ color: COLORS.muted }}>{dateLabel(t.date)}</Text>
                  </View>
                  <Text style={[styles.accountLine, !t.account_label && { color: COLORS.muted, fontStyle: 'italic' }]}>
                    🏦 {t.account_label || 'ไม่ระบุบัญชี'}
                  </Text>
                  {!!t.slip_id && (
                    <Text style={styles.accountLine} numberOfLines={1}>
                      🧾 {t.slip_from || '-'} → {t.slip_to || '-'}
                    </Text>
                  )}
                  {!!t.payee && <Text style={styles.payee}>👤 ผู้รับ: {t.payee}</Text>}
                  {!!t.subcategory_name && <Text style={styles.subName}>{t.subcategory_name}</Text>}
                  {!!t.note && <Text style={{ color: t.subcategory_name ? COLORS.muted : COLORS.text }}>{t.note}</Text>}
                </View>
                <View style={{ alignItems: 'flex-end', gap: 6 }}>
                  <Text style={[styles.amount, { color: t.direction > 0 ? COLORS.in : COLORS.out }]}>
                    {t.direction > 0 ? '+' : '−'}
                    {money(t.amount)}
                  </Text>
                  <View style={{ flexDirection: 'row', gap: 6 }}>
                    <Button title="แก้ไข" variant="outline" small onPress={() => goEdit(t)} />
                    <Button title="ลบ" variant="danger" small onPress={() => onDelete(t)} />
                  </View>
                </View>
              </Card>
            ))}
        </>
      )}
    </ScrollView>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <Card style={{ flex: 1, gap: 4 }}>
      <Text style={{ color: COLORS.muted, fontSize: 13 }}>{label}</Text>
      <Text style={{ color, fontSize: 18, fontWeight: '700' }}>{money(value)}</Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, gap: 12, maxWidth: 820, width: '100%', alignSelf: 'center' },
  chip: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 16, backgroundColor: '#eef0ff' },
  chipActive: { backgroundColor: COLORS.primary },
  chipText: { color: COLORS.primary, fontWeight: '600' },
  statsRow: { flexDirection: 'row', gap: 12 },
  catPill: { flexDirection: 'row', gap: 6, borderWidth: 1, borderRadius: 16, paddingVertical: 4, paddingHorizontal: 10 },
  listHeader: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between', alignItems: 'center', marginTop: 4 },
  h2: { fontSize: 17, fontWeight: '700', color: COLORS.text },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  badge: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 },
  badgeText: { color: '#fff', fontWeight: '600', fontSize: 12 },
  amount: { fontSize: 16, fontWeight: '700' },
  subName: { color: COLORS.text, fontWeight: '600' },
  accountLine: { color: COLORS.muted, fontSize: 12 },
  payee: { color: COLORS.text, fontSize: 13 },
  pendingHeader: { color: COLORS.pending, fontWeight: '700' },
});
