import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Account, AccountsSummary, api } from '@/api';
import { AnimatedNumber, FadeIn, PressScale, Skeleton } from '@/components/motion';
import { Button, Card, ErrorBox } from '@/components/ui';
import { ACCOUNT_TYPE_COLORS, accountLabel, bankName, COLORS, confirmAsync, GRADIENTS, money, showError } from '@/format';
import { t, tCode } from '@/i18n';

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
      showError(new Error(t('accounts.hasTxns', { n: a.transaction_count })));
      return;
    }
    if (!(await confirmAsync(t('accounts.deleteTitle'), t('accounts.deleteBody', { name: accountLabel(a) })))) return;
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

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <FadeIn>
        <LinearGradient colors={GRADIENTS.night} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.totalCard}>
          <View style={[styles.blob, { width: 160, height: 160, top: -50, right: -30 }]} />
          <View style={[styles.blob, { width: 90, height: 90, bottom: -30, right: 90 }]} />
          <Text style={{ color: 'rgba(255,255,255,0.8)' }}>{t('accounts.total')}</Text>
          {data ? (
            <AnimatedNumber value={data.total} format={(n) => t('money.bahtValue', { amount: money(n) })} style={styles.totalValue} />
          ) : (
            <Skeleton style={{ width: 220, height: 34, backgroundColor: 'rgba(255,255,255,0.3)' }} />
          )}
          <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 12 }}>{data ? t('accounts.count', { n: data.accounts.length }) : ' '}</Text>
        </LinearGradient>
      </FadeIn>

      {data && data.by_type.length > 0 && (
        <View style={styles.typeGrid}>
          {data.by_type.map((ty, i) => {
            const color = ACCOUNT_TYPE_COLORS[ty.code] ?? COLORS.primary;
            return (
              <FadeIn key={ty.code} delay={80 + i * 60} style={{ flexGrow: 1, flexBasis: 140 }}>
                <Card style={styles.typeCard}>
                  <View style={[styles.typeDot, { backgroundColor: color }]} />
                  <Text style={{ color: COLORS.muted, fontSize: 12 }}>
                    {tCode('accountType', ty.code, ty.name)} ({ty.count})
                  </Text>
                  <Text style={{ fontWeight: '800', fontSize: 16, color: ty.balance < 0 ? COLORS.out : COLORS.text }}>{money(ty.balance)}</Text>
                </Card>
              </FadeIn>
            );
          })}
        </View>
      )}

      <PressScale onPress={() => router.push('/debts')} scaleTo={0.98} style={styles.debtLink}>
        <Text style={{ fontSize: 18 }}>🤝</Text>
        <Text style={{ flex: 1, color: COLORS.text, fontWeight: '700' }}>{t('accounts.debts')}</Text>
        <Text style={{ color: COLORS.primary, fontSize: 18 }}>›</Text>
      </PressScale>

      <View style={styles.header}>
        <Text style={styles.h2}>{t('accounts.list')}</Text>
        <Button title={t('accounts.add')} icon="＋" small onPress={() => router.push('/account')} />
      </View>

      {!data && <Skeleton style={{ height: 90, borderRadius: 18 }} />}

      {data?.accounts.length === 0 && (
        <Card style={{ alignItems: 'center', gap: 6, paddingVertical: 24 }}>
          <Text style={{ fontSize: 32 }}>🏦</Text>
          <Text style={{ color: COLORS.muted, textAlign: 'center' }}>{t('accounts.empty')}</Text>
        </Card>
      )}

      {data?.accounts.map((a, i) => {
        const color = ACCOUNT_TYPE_COLORS[a.type_code] ?? COLORS.primary;
        return (
          <FadeIn key={a.id} delay={150 + i * 60}>
            <PressScale
              scaleTo={0.98}
              onPress={() => router.push({ pathname: '/account', params: { id: String(a.id) } })}
              style={[styles.accountCard, { borderLeftColor: color }]}
            >
              <View style={[styles.bankBadge, { backgroundColor: color }]}>
                <Text style={styles.bankBadgeText}>{bankName(a.bank_name).slice(0, 1)}</Text>
              </View>
              <View style={{ flex: 1, gap: 3 }}>
                <Text style={styles.bank} numberOfLines={1}>
                  {bankName(a.bank_name)}
                </Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <View style={[styles.badge, { backgroundColor: color + '1f' }]}>
                    <Text style={[styles.badgeText, { color }]}>{tCode('accountType', a.type_code, a.type_name)}</Text>
                  </View>
                  {!!a.name && <Text style={{ color: COLORS.text, fontSize: 13 }}>{a.name}</Text>}
                </View>
                <Text style={{ color: COLORS.muted, fontSize: 12 }}>
                  {t('accounts.opening', { amount: money(a.opening_balance), n: a.transaction_count })}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end', gap: 6 }}>
                <Text style={[styles.balance, { color: a.balance < 0 ? COLORS.out : COLORS.text }]}>{money(a.balance)}</Text>
                <PressScale onPress={() => onDelete(a)} hitSlop={8} scaleTo={0.85} style={styles.trash} accessibilityLabel={t('accounts.deleteTitle')}>
                  <Text style={{ fontSize: 13 }}>🗑️</Text>
                </PressScale>
              </View>
            </PressScale>
          </FadeIn>
        );
      })}

      {data && data.unassigned.count > 0 && (
        <FadeIn delay={200}>
          <Card style={[styles.row, { borderStyle: 'dashed', borderColor: '#c7cbe0' }]}>
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={styles.bank}>{t('month.noAccount')}</Text>
              <Text style={{ color: COLORS.muted, fontSize: 12 }}>
                {t('accounts.unassignedHint', { n: data.unassigned.count })}
              </Text>
            </View>
            <Text style={[styles.balance, { color: COLORS.muted }]}>{money(data.unassigned.balance)}</Text>
          </Card>
        </FadeIn>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, gap: 12, maxWidth: 820, width: '100%', alignSelf: 'center', paddingBottom: 32 },
  totalCard: { borderRadius: 24, padding: 20, gap: 4, overflow: 'hidden', boxShadow: '0px 12px 28px rgba(30, 27, 75, 0.35)' },
  blob: { position: 'absolute', borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.08)' },
  totalValue: { color: '#fff', fontSize: 30, fontWeight: '800' },
  typeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  typeCard: { padding: 14, gap: 4 },
  typeDot: { width: 8, height: 8, borderRadius: 4 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 },
  debtLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 14,
    borderRadius: 18,
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  h2: { fontSize: 18, fontWeight: '800', color: COLORS.text },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  accountCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 18,
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderLeftWidth: 4,
    boxShadow: '0px 6px 20px rgba(30, 27, 75, 0.07)',
  },
  bankBadge: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  bankBadgeText: { color: '#fff', fontWeight: '800', fontSize: 18 },
  bank: { fontSize: 15, fontWeight: '700', color: COLORS.text },
  badge: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  badgeText: { fontWeight: '700', fontSize: 12 },
  balance: { fontSize: 16, fontWeight: '800' },
  trash: { width: 28, height: 28, borderRadius: 14, backgroundColor: COLORS.dangerSoft, alignItems: 'center', justifyContent: 'center' },
});
