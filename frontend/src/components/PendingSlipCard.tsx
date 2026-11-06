import { Image, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { api, Slip } from '../api';
import { COLORS, dateLabel, money } from '../format';
import { Button } from './ui';

/** Amber card for a bank slip that was read but not confirmed yet (not counted in balances). */
export function PendingSlipCard({
  slip,
  onConfirm,
  onDelete,
}: {
  slip: Slip;
  onConfirm: () => void;
  onDelete: () => void;
}) {
  const imageUrl = api.slipImageUrl(slip.id);
  return (
    <View style={styles.card}>
      <Pressable onPress={() => Linking.openURL(imageUrl)} accessibilityLabel="ดูรูปสลิป">
        <Image source={{ uri: imageUrl }} style={styles.thumb} resizeMode="cover" />
      </Pressable>
      <View style={{ flex: 1, gap: 3 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <View style={styles.badge}>
            <Text style={styles.badgeText}>รอคอนเฟิร์ม</Text>
          </View>
          <Text style={{ color: COLORS.muted }}>
            {dateLabel(slip.date)}
            {!slip.date_found && ' (อ่านวันที่ไม่ได้)'}
          </Text>
        </View>
        <Text style={styles.line} numberOfLines={1}>
          <Text style={styles.label}>จาก </Text>
          {slip.from_name || '-'}
        </Text>
        <Text style={styles.line} numberOfLines={1}>
          <Text style={styles.label}>ถึง </Text>
          {slip.to_name || '-'}
        </Text>
        {!!slip.bank_name && <Text style={styles.small}>🏦 {slip.bank_name}</Text>}
      </View>
      <View style={{ alignItems: 'flex-end', gap: 6 }}>
        <Text style={styles.amount}>{slip.amount > 0 ? money(slip.amount) : 'ไม่พบจำนวนเงิน'}</Text>
        <View style={{ flexDirection: 'row', gap: 6 }}>
          <Button title="คอนเฟิร์ม" small onPress={onConfirm} />
          <Button title="ลบ" variant="danger" small onPress={onDelete} />
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
    borderRadius: 12,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: COLORS.pendingBorder,
    backgroundColor: COLORS.pendingBg,
  },
  thumb: { width: 48, height: 72, borderRadius: 6, backgroundColor: '#fde68a' },
  badge: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2, backgroundColor: COLORS.pending },
  badgeText: { color: '#fff', fontWeight: '700', fontSize: 12 },
  line: { color: COLORS.text, fontSize: 13 },
  label: { color: COLORS.muted },
  small: { color: COLORS.muted, fontSize: 12 },
  amount: { fontSize: 16, fontWeight: '700', color: COLORS.pending },
});
