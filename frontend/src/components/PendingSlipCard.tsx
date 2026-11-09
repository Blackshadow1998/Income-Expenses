import { Image, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { api, Slip } from '../api';
import { COLORS, dateLabel, money } from '../format';
import { DeleteButton } from './DeleteButton';
import { Button } from './ui';
import { t } from '../i18n';

/** Amber card for a bank slip that was read but not confirmed yet (not counted in balances). */
export function PendingSlipCard({
  slip,
  onConfirm,
  confirmDelete,
  onDeleted,
}: {
  slip: Slip;
  onConfirm: () => void;
  confirmDelete: () => Promise<boolean>;
  onDeleted: () => void;
}) {
  const imageUrl = api.slipImageUrl(slip);
  return (
    <View style={styles.card}>
      <Pressable onPress={() => Linking.openURL(imageUrl)} accessibilityLabel={t('slip.viewImage')}>
        <Image source={{ uri: imageUrl }} style={styles.thumb} resizeMode="cover" />
      </Pressable>
      <View style={{ flex: 1, gap: 3 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{t('slip.pending')}</Text>
          </View>
          {!!slip.suggestion && (
            <View style={styles.rule}>
              <Text style={styles.ruleText} numberOfLines={1}>
                {slip.suggestion.action === 'transfer' ? '🔁' : '📋'} {slip.suggestion.rule_name}
              </Text>
            </View>
          )}
          <Text style={{ color: COLORS.muted }}>
            {dateLabel(slip.date)}
            {!slip.date_found && t('slip.noDate')}
          </Text>
        </View>
        <Text style={styles.line} numberOfLines={1}>
          <Text style={styles.label}>{t('slip.from')}</Text>
          {slip.from_name || '-'}
        </Text>
        <Text style={styles.line} numberOfLines={1}>
          <Text style={styles.label}>{t('slip.to')}</Text>
          {slip.to_name || '-'}
        </Text>
        {!!(slip.bank_name || slip.to_bank_name) && (
          <Text style={styles.small} numberOfLines={1}>
            🏦 {slip.bank_name || '?'}
            {!!slip.to_bank_name && ` → ${slip.to_bank_name}`}
          </Text>
        )}
      </View>
      <View style={{ alignItems: 'flex-end', gap: 6 }}>
        <Text style={styles.amount}>{slip.amount > 0 ? money(slip.amount) : t('slip.noAmount')}</Text>
        <View style={{ flexDirection: 'row', gap: 6 }}>
          <Button title={t('slip.confirm')} small onPress={onConfirm} />
          <DeleteButton title={t('common.delete')} small confirm={confirmDelete} onDelete={() => api.removeSlip(slip.id)} onDone={onDeleted} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 16,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: COLORS.pendingBorder,
    backgroundColor: COLORS.pendingBg,
  },
  thumb: { width: 48, height: 72, borderRadius: 6, backgroundColor: '#fde68a' },
  badge: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2, backgroundColor: COLORS.pending },
  badgeText: { color: '#fff', fontWeight: '700', fontSize: 12 },
  rule: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2, backgroundColor: COLORS.primarySoft },
  ruleText: { color: COLORS.primary, fontWeight: '700', fontSize: 12 },
  line: { color: COLORS.text, fontSize: 13 },
  label: { color: COLORS.muted },
  small: { color: COLORS.muted, fontSize: 12 },
  amount: { fontSize: 16, fontWeight: '700', color: COLORS.pending },
});
