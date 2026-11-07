import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Account, api, Budget, Category, Insights, MonthData, Slip, Transaction, Transfer } from '@/api';
import { AccountFilter } from '@/components/AccountFilter';
import { BudgetCard } from '@/components/BudgetCard';
import { InsightsCard } from '@/components/InsightsCard';
import { AnimatedNumber, FadeIn, GrowBar, PressScale, Skeleton } from '@/components/motion';
import { PendingSlipCard } from '@/components/PendingSlipCard';
import { Button, Card, ErrorBox, IconBubble, Stepper } from '@/components/ui';
import {
  CATEGORY_COLORS, CATEGORY_ICONS, CATEGORY_TINTS, COLORS, confirmAsync, currentMonth, dateLabel, GRADIENTS, money, monthLabel,
  MONTHS_SHORT, SHADOW, shiftMonth, showError, showInfo,
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
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [insights, setInsights] = useState<Insights | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [slipMenu, setSlipMenu] = useState(false);
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
      const [d, b, ins] = await Promise.all([api.month(m, accountRef.current), api.budgets(m), api.insights(m)]);
      if (id === reqId.current) {
        setData(d);
        setBudgets(b);
        setInsights(ins);
      }
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

  // Take a photo of a slip or pick slip images, let the server read them, then jump to the month of the slip.
  const onReadSlips = async (source: 'camera' | 'library') => {
    setSlipMenu(false);
    let picked: ImagePicker.ImagePickerResult;
    if (source === 'camera') {
      // On web the camera must open straight from the tap, so there is no permission round-trip first.
      if (Platform.OS !== 'web' && !(await ImagePicker.requestCameraPermissionsAsync()).granted) {
        showError(new Error('ไม่ได้รับอนุญาตให้ใช้กล้อง — เปิดสิทธิ์กล้องให้แอปในการตั้งค่าเครื่อง'));
        return;
      }
      picked = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.9 });
    } else {
      picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, quality: 1 });
    }
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
  const goTransfer = (tr?: Transfer) =>
    router.push({
      pathname: '/transfer',
      params: tr
        ? { id: String(tr.id) }
        : { ...(month ? { month } : {}), ...(accountId ? { accountId: String(accountId) } : {}) },
    });

  const onDeleteTransfer = async (tr: Transfer) => {
    if (!(await confirmAsync('ลบรายการโอน', `ต้องการลบรายการโอน ${money(tr.amount)} บาท วันที่ ${dateLabel(tr.date)} ใช่หรือไม่?`))) return;
    try {
      await api.removeTransfer(tr.id);
      await loadAll(monthRef.current);
    } catch (e) {
      showError(e);
    }
  };

  const days = data ? groupByDay(data.items, data.transfers) : [];
  const entryCount = data ? data.items.length + data.transfers.length : 0;

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <FadeIn>
        <LinearGradient colors={GRADIENTS.primary} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.hero}>
          <View style={[styles.blob, { width: 180, height: 180, top: -60, right: -40 }]} />
          <View style={[styles.blob, { width: 120, height: 120, bottom: -50, left: -30 }]} />
          <Stepper
            light
            label={month ? monthLabel(month) : '...'}
            onPrev={() => month && loadMonth(shiftMonth(month, -1))}
            onNext={() => month && loadMonth(shiftMonth(month, 1))}
          />
          <View style={{ alignItems: 'center', gap: 2, marginTop: 6 }}>
            <Text style={styles.heroLabel}>{accountId ? 'เงินคงเหลือบัญชีนี้' : 'เงินคงเหลือทุกบัญชี'}</Text>
            {data ? (
              <AnimatedNumber value={data.balance} format={money} style={styles.heroValue} />
            ) : (
              <Skeleton style={{ width: 200, height: 40, backgroundColor: 'rgba(255,255,255,0.35)' }} />
            )}
            <Text style={styles.heroLabel}>บาท</Text>
          </View>
          <View style={styles.heroStats}>
            <HeroStat icon="↓" label="เงินเข้า" value={data?.totals.in} dot="#4ade80" />
            <HeroStat icon="↑" label="เงินออก" value={data?.totals.out} dot="#fca5a5" />
          </View>
          {data && (
            <Text style={styles.heroNet}>
              สุทธิเดือนนี้ {data.totals.net >= 0 ? '+' : ''}
              {money(data.totals.net)}
            </Text>
          )}
        </LinearGradient>
      </FadeIn>

      <FadeIn delay={80} style={{ gap: 10 }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 2 }}>
          {months.map((m) => {
            const active = m === month;
            const [y, mm] = m.split('-').map(Number);
            return (
              <PressScale key={m} onPress={() => loadMonth(m)} style={[styles.chip, active && styles.chipActive]}>
                <Text style={[styles.chipText, active && { color: '#fff' }]}>
                  {MONTHS_SHORT[mm - 1]} {String(y + 543).slice(2)}
                </Text>
              </PressScale>
            );
          })}
        </ScrollView>
        <AccountFilter accounts={accounts} value={accountId} onChange={selectAccount} />
      </FadeIn>

      {error ? (
        <ErrorBox message={error} onRetry={() => loadAll(monthRef.current)} />
      ) : !data ? (
        <ListSkeleton />
      ) : (
        <>
          <FadeIn delay={140}>
            <CategoryBreakdown key={`${month}-${accountId}`} categories={categories} totals={data.totals.by_category} />
          </FadeIn>

          <FadeIn delay={170}>
            <BudgetCard key={month} budgets={budgets} />
          </FadeIn>

          {insights && (
            <FadeIn delay={185}>
              <InsightsCard data={insights} />
            </FadeIn>
          )}

          <FadeIn delay={200} style={styles.actions}>
            <Button
              title={uploading ? 'กำลังอ่าน...' : 'สลิป'}
              icon="📷"
              variant="soft"
              onPress={() => setSlipMenu((v) => !v)}
              disabled={uploading}
              style={{ flex: 1 }}
            />
            <Button title="โอน" icon="⇄" variant="soft" onPress={() => goTransfer()} style={{ flex: 1 }} />
            <Button title="เพิ่ม" icon="＋" onPress={goAdd} style={{ flex: 1.2 }} />
          </FadeIn>
          {slipMenu && (
            <FadeIn from={-8} style={styles.slipMenu}>
              <Button title="ถ่ายรูปสลิป" icon="📸" variant="outline" onPress={() => onReadSlips('camera')} style={{ flex: 1 }} />
              <Button title="เลือกจากคลังภาพ" icon="🖼️" variant="outline" onPress={() => onReadSlips('library')} style={{ flex: 1 }} />
            </FadeIn>
          )}

          {data.pending.length > 0 && (
            <View style={{ gap: 8 }}>
              <Text style={styles.pendingHeader}>🧾 รอคอนเฟิร์ม ({data.pending.length}) — ยังไม่นับรวมในยอดเงิน</Text>
              {data.pending.map((sl, i) => (
                <FadeIn key={sl.id} delay={240 + i * 50}>
                  <PendingSlipCard slip={sl} onConfirm={() => goConfirm(sl)} onDelete={() => onDeleteSlip(sl)} />
                </FadeIn>
              ))}
            </View>
          )}

          <View style={styles.listHeader}>
            <Text style={styles.h2}>รายการ ({entryCount})</Text>
            <PressScale onPress={() => router.push('/search')} scaleTo={0.92} style={styles.searchBtn} accessibilityLabel="ค้นหารายการ">
              <Text style={{ color: COLORS.primary, fontWeight: '700' }}>🔍 ค้นหา</Text>
            </PressScale>
          </View>

          {loading ? (
            <ListSkeleton />
          ) : entryCount === 0 && data.pending.length === 0 ? (
            <FadeIn>
              <Card style={{ alignItems: 'center', gap: 6, paddingVertical: 28 }}>
                <Text style={{ fontSize: 36 }}>🪴</Text>
                <Text style={{ color: COLORS.muted }}>ยังไม่มีรายการในเดือนนี้</Text>
              </Card>
            </FadeIn>
          ) : (
            days.map((day, di) => (
              <FadeIn key={`${month}-${day.date}`} delay={Math.min(di * 70, 420)} style={{ gap: 6 }}>
                <View style={styles.dayHeader}>
                  <Text style={styles.dayLabel}>{dateLabel(day.date)}</Text>
                  {day.entries.some((e) => e.kind === 'txn') && (
                    <Text style={[styles.dayNet, { color: day.net >= 0 ? COLORS.in : COLORS.out }]}>
                      {day.net >= 0 ? '+' : '−'}
                      {money(Math.abs(day.net))}
                    </Text>
                  )}
                </View>
                <Card style={{ padding: 0, overflow: 'hidden' }}>
                  {day.entries.map((e, i) =>
                    e.kind === 'txn' ? (
                      <TxnRow key={`t${e.t.id}`} t={e.t} first={i === 0} onPress={() => goEdit(e.t)} onDelete={() => onDelete(e.t)} />
                    ) : (
                      <TransferRow
                        key={`tr${e.tr.id}`}
                        tr={e.tr}
                        accountId={accountId}
                        first={i === 0}
                        onPress={() => goTransfer(e.tr)}
                        onDelete={() => onDeleteTransfer(e.tr)}
                      />
                    ),
                  )}
                </Card>
              </FadeIn>
            ))
          )}
        </>
      )}
    </ScrollView>
  );
}

function HeroStat({ icon, label, value, dot }: { icon: string; label: string; value?: number; dot: string }) {
  return (
    <View style={styles.heroStat}>
      <View style={[styles.heroIcon, { backgroundColor: dot }]}>
        <Text style={{ color: '#1e1b4b', fontWeight: '900' }}>{icon}</Text>
      </View>
      <View style={{ flexShrink: 1 }}>
        <Text style={{ color: 'rgba(255,255,255,0.8)', fontSize: 12 }}>{label}</Text>
        {value === undefined ? (
          <Text style={styles.heroStatValue}>…</Text>
        ) : (
          <AnimatedNumber value={value} format={money} style={styles.heroStatValue} />
        )}
      </View>
    </View>
  );
}

/** Share of each category this month as one stacked bar, plus a legend with amounts. */
function CategoryBreakdown({ categories, totals }: { categories: Category[]; totals: MonthData['totals']['by_category'] }) {
  const sum = categories.reduce((s, c) => s + (totals[c.code] ?? 0), 0);
  return (
    <Card style={{ gap: 12 }}>
      <Text style={styles.h3}>สัดส่วนเดือนนี้</Text>
      <View style={styles.track}>
        {sum > 0 &&
          categories.map((c, i) => (
            <GrowBar key={c.id} fraction={(totals[c.code] ?? 0) / sum} color={CATEGORY_COLORS[c.code]} delay={200 + i * 120} />
          ))}
      </View>
      <View style={styles.legend}>
        {categories.map((c) => {
          const v = totals[c.code] ?? 0;
          return (
            <View key={c.id} style={styles.legendItem}>
              <IconBubble icon={CATEGORY_ICONS[c.code]} tint={CATEGORY_TINTS[c.code]} size={34} />
              <View style={{ flexShrink: 1 }}>
                <Text style={{ color: COLORS.muted, fontSize: 12 }}>
                  {c.name}
                  {sum > 0 && v > 0 ? ` · ${Math.round((v / sum) * 100)}%` : ''}
                </Text>
                <Text style={{ color: COLORS.text, fontWeight: '700' }}>{money(v)}</Text>
              </View>
            </View>
          );
        })}
      </View>
    </Card>
  );
}

function TxnRow({ t, first, onPress, onDelete }: { t: Transaction; first: boolean; onPress: () => void; onDelete: () => void }) {
  const title = t.subcategory_name || t.note || t.category_name;
  const sub = [t.subcategory_name || t.note ? t.category_name : '', t.account_label || 'ไม่ระบุบัญชี'].filter(Boolean).join(' · ');
  return (
    <PressScale onPress={onPress} scaleTo={0.98} style={[styles.row, !first && styles.rowDivider]}>
      <IconBubble icon={CATEGORY_ICONS[t.category_code]} tint={CATEGORY_TINTS[t.category_code]} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {t.recurring_id ? '🔁 ' : ''}
          {title}
        </Text>
        <Text style={[styles.rowSub, !t.account_label && { fontStyle: 'italic' }]} numberOfLines={1}>
          {sub}
        </Text>
        {!!t.payee && (
          <Text style={styles.rowSub} numberOfLines={1}>
            👤 {t.payee}
          </Text>
        )}
        {!!t.slip_id && (
          <Text style={styles.rowSub} numberOfLines={1}>
            🧾 {t.slip_from || '-'} → {t.slip_to || '-'}
          </Text>
        )}
        {!!t.subcategory_name && !!t.note && (
          <Text style={[styles.rowSub, { color: COLORS.text }]} numberOfLines={2}>
            {t.note}
          </Text>
        )}
      </View>
      <View style={{ alignItems: 'flex-end', gap: 6 }}>
        <Text style={[styles.amount, { color: t.direction > 0 ? COLORS.in : COLORS.out }]}>
          {t.direction > 0 ? '+' : '−'}
          {money(t.amount)}
        </Text>
        <PressScale onPress={onDelete} hitSlop={8} scaleTo={0.85} style={styles.trash} accessibilityLabel="ลบรายการ">
          <Text style={{ fontSize: 13 }}>🗑️</Text>
        </PressScale>
      </View>
    </PressScale>
  );
}

/** Transfer between own accounts: neutral colour, or +/− when the list is filtered to one of its accounts. */
function TransferRow({ tr, accountId, first, onPress, onDelete }: {
  tr: Transfer;
  accountId: number | null;
  first: boolean;
  onPress: () => void;
  onDelete: () => void;
}) {
  const sign = accountId === tr.to_account_id ? '+' : accountId === tr.from_account_id ? '−' : '';
  return (
    <PressScale onPress={onPress} scaleTo={0.98} style={[styles.row, !first && styles.rowDivider]}>
      <IconBubble icon="⇄" tint={COLORS.primarySoft} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {tr.note || 'โอนระหว่างบัญชี'}
        </Text>
        <Text style={styles.rowSub} numberOfLines={2}>
          {tr.from_label} → {tr.to_label}
        </Text>
      </View>
      <View style={{ alignItems: 'flex-end', gap: 6 }}>
        <Text style={[styles.amount, { color: sign === '+' ? COLORS.in : sign === '−' ? COLORS.out : COLORS.primary }]}>
          {sign}
          {money(tr.amount)}
        </Text>
        <PressScale onPress={onDelete} hitSlop={8} scaleTo={0.85} style={styles.trash} accessibilityLabel="ลบรายการโอน">
          <Text style={{ fontSize: 13 }}>🗑️</Text>
        </PressScale>
      </View>
    </PressScale>
  );
}

function ListSkeleton() {
  return (
    <Card style={{ gap: 14 }}>
      {[0, 1, 2].map((i) => (
        <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Skeleton style={{ width: 42, height: 42, borderRadius: 21 }} />
          <View style={{ flex: 1, gap: 6 }}>
            <Skeleton style={{ height: 12, width: '60%' }} />
            <Skeleton style={{ height: 10, width: '40%' }} />
          </View>
          <Skeleton style={{ height: 14, width: 70 }} />
        </View>
      ))}
    </Card>
  );
}

type Entry = { kind: 'txn'; date: string; t: Transaction } | { kind: 'transfer'; date: string; tr: Transfer };

/** Newest day first; a day's net counts income/expense only (transfers move money, they don't add or spend it). */
function groupByDay(items: Transaction[], transfers: Transfer[]) {
  const entries: Entry[] = [
    ...items.map((t) => ({ kind: 'txn' as const, date: t.date, t })),
    ...transfers.map((tr) => ({ kind: 'transfer' as const, date: tr.date, tr })),
  ].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const days: { date: string; net: number; entries: Entry[] }[] = [];
  for (const e of entries) {
    let d = days[days.length - 1];
    if (!d || d.date !== e.date) {
      d = { date: e.date, net: 0, entries: [] };
      days.push(d);
    }
    d.entries.push(e);
    if (e.kind === 'txn') d.net += e.t.direction * e.t.amount;
  }
  return days;
}

const styles = StyleSheet.create({
  page: { padding: 16, gap: 14, maxWidth: 820, width: '100%', alignSelf: 'center', paddingBottom: 32 },
  hero: { borderRadius: 24, padding: 18, gap: 12, overflow: 'hidden', boxShadow: '0px 12px 28px rgba(79, 70, 229, 0.35)' },
  blob: { position: 'absolute', borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.09)' },
  heroLabel: { color: 'rgba(255,255,255,0.8)', fontSize: 13 },
  heroValue: { color: '#fff', fontSize: 38, fontWeight: '800', letterSpacing: 0.5 },
  heroStats: { flexDirection: 'row', gap: 10 },
  heroStat: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  heroIcon: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  heroStatValue: { color: '#fff', fontSize: 16, fontWeight: '800' },
  heroNet: { color: 'rgba(255,255,255,0.9)', textAlign: 'center', fontSize: 13, fontWeight: '600' },
  chip: { paddingVertical: 7, paddingHorizontal: 14, borderRadius: 999, backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.border },
  chipActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary, ...SHADOW },
  chipText: { color: COLORS.primary, fontWeight: '700' },
  track: { flexDirection: 'row', height: 12, borderRadius: 6, overflow: 'hidden', backgroundColor: COLORS.track },
  legend: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 12 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 8, width: '50%' },
  actions: { flexDirection: 'row', gap: 10 },
  slipMenu: { flexDirection: 'row', gap: 10, marginTop: -4 },
  h2: { fontSize: 18, fontWeight: '800', color: COLORS.text },
  listHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 },
  searchBtn: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 999, backgroundColor: COLORS.primarySoft },
  h3: { fontSize: 15, fontWeight: '700', color: COLORS.text },
  dayHeader: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 4 },
  dayLabel: { color: COLORS.muted, fontWeight: '700', fontSize: 13 },
  dayNet: { fontWeight: '700', fontSize: 13 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 14, backgroundColor: COLORS.card },
  rowDivider: { borderTopWidth: 1, borderTopColor: COLORS.border },
  rowTitle: { fontSize: 15, fontWeight: '700', color: COLORS.text },
  rowSub: { color: COLORS.muted, fontSize: 12 },
  amount: { fontSize: 16, fontWeight: '800' },
  trash: { width: 28, height: 28, borderRadius: 14, backgroundColor: COLORS.dangerSoft, alignItems: 'center', justifyContent: 'center' },
  pendingHeader: { color: COLORS.pending, fontWeight: '700' },
});
