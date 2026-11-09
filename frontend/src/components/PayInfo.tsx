import { router } from 'expo-router';
import makeQR from 'qrcode-generator';
import { useMemo, useState } from 'react';
import { Image, Linking, Modal, Platform, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { api, TripMember } from '../api';
import { COLORS, money, SHADOW, showError } from '../format';
import { t } from '../i18n';
import { promptPayDigits, promptPayPayload } from '../promptpay';
import { FadeIn, PressScale } from './motion';
import { Button } from './ui';

/** "0812345678" -> "081-234-5678", "1234567890123" -> "1-2345-67890-12-3". */
export function promptPayLabel(d: string): string {
  if (d.length === 10) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  if (d.length === 13) return `${d[0]}-${d.slice(1, 5)}-${d.slice(5, 10)}-${d.slice(10, 12)}-${d[12]}`;
  return d;
}

/** Whether a member has any way to be paid. */
export function hasPayInfo(m: TripMember): boolean {
  return !!(m.promptpay || m.bank_account || m.qr_url);
}

/** Copies on web (true when done); the share sheet elsewhere. */
async function copy(text: string): Promise<boolean> {
  try {
    if (Platform.OS === 'web' && navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      return true;
    }
    await Share.share({ message: text });
  } catch (e) {
    showError(e);
  }
  return false;
}

/** PromptPay QR (with the amount when given) as an image the banking app can scan. */
function PromptPayQR({ id, amount }: { id: string; amount?: number }) {
  const uri = useMemo(() => {
    const payload = promptPayPayload(id, amount);
    if (!payload) return null;
    const qr = makeQR(0, 'M');
    qr.addData(payload);
    qr.make();
    return qr.createDataURL(6, 2);
  }, [id, amount]);
  if (!uri) return null;
  return <Image source={{ uri }} style={styles.qr} accessibilityLabel={t('pay.promptpay')} />;
}

/**
 * How to pay `member` `amount` baht: a PromptPay QR with the amount filled in, the PromptPay ID and
 * bank account to copy, and their own QR picture. Offers to add details when there are none.
 */
export function PayInfo({ tripId, member, amount, onEdit }: { tripId: number; member: TripMember; amount?: number; onEdit?: () => void }) {
  const edit = () => {
    onEdit?.();
    router.push({ pathname: '/trip-member', params: { tripId: String(tripId), id: String(member.id) } });
  };
  if (!hasPayInfo(member))
    return (
      <View style={{ alignItems: 'center', gap: 10, paddingVertical: 8 }}>
        <Text style={styles.muted}>{t('pay.none', { name: member.name })}</Text>
        <Button title={t('pay.add')} icon="＋" variant="soft" small onPress={edit} />
      </View>
    );
  const pp = promptPayDigits(member.promptpay);
  return (
    <View style={{ gap: 12 }}>
      {!!pp && (
        <View style={styles.block}>
          <PromptPayQR id={pp} amount={amount} />
          <Text style={styles.muted}>{amount ? t('pay.scan') : t('pay.scanNoAmount')}</Text>
          <Line label={t('pay.promptpay')} value={promptPayLabel(pp)} copyText={pp} />
        </View>
      )}
      {!!member.bank_account && (
        <View style={styles.block}>
          <Line label={member.bank_name || t('pay.bank')} value={member.bank_account} copyText={member.bank_account.replace(/[\s-]/g, '')} />
          {!!member.account_name && <Text style={styles.muted}>{member.account_name}</Text>}
        </View>
      )}
      {!!member.qr_url && (
        <View style={styles.block}>
          <Text style={styles.label}>{t('pay.qr')}</Text>
          <PressScale onPress={() => Linking.openURL(api.tripMemberQRUrl(member))} accessibilityLabel={t('pay.qr')}>
            <Image source={{ uri: api.tripMemberQRUrl(member) }} style={styles.picture} resizeMode="contain" />
          </PressScale>
        </View>
      )}
      <Text style={styles.link} onPress={edit}>
        {t('pay.edit')}
      </Text>
    </View>
  );
}

function Line({ label, value, copyText }: { label: string; value: string; copyText: string }) {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    if (!(await copy(copyText))) return;
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <View style={styles.line}>
      <View style={{ flex: 1 }}>
        <Text style={styles.label}>{label}</Text>
        <Text style={styles.value} selectable>
          {value}
        </Text>
      </View>
      <Button title={copied ? '✓' : t('pay.copy')} variant="soft" small onPress={onCopy} />
    </View>
  );
}

/** PayInfo in a pop-up, titled "โอนให้ <name>" with the amount. */
export function PayInfoModal({ tripId, member, amount, onClose }: {
  tripId: number;
  member: TripMember | null;
  amount?: number;
  onClose: () => void;
}) {
  return (
    <Modal visible={!!member} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.back} onPress={onClose}>
        {member && (
          <FadeIn from={24} style={styles.sheetWrap}>
            <Pressable style={styles.sheet} onPress={() => {}}>
              <ScrollView contentContainerStyle={{ gap: 12 }}>
                <View style={{ alignItems: 'center', gap: 2 }}>
                  <Text style={styles.title}>{t('pay.title', { name: member.name })}</Text>
                  {!!amount && <Text style={styles.amount}>{t('pay.amount', { amount: money(amount) })}</Text>}
                </View>
                <PayInfo tripId={tripId} member={member} amount={amount} onEdit={onClose} />
                <Button title={t('pay.close')} variant="outline" onPress={onClose} />
              </ScrollView>
            </Pressable>
          </FadeIn>
        )}
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  back: { flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.5)', justifyContent: 'center', padding: 16 },
  sheetWrap: { width: '100%', maxWidth: 420, maxHeight: '92%', alignSelf: 'center' },
  sheet: { backgroundColor: COLORS.card, borderRadius: 22, padding: 18, borderWidth: 1, borderColor: COLORS.border, ...SHADOW },
  title: { fontSize: 17, fontWeight: '800', color: COLORS.text, textAlign: 'center' },
  amount: { fontSize: 24, fontWeight: '800', color: COLORS.primary },
  block: { gap: 8, padding: 12, borderRadius: 16, backgroundColor: COLORS.subtle, alignItems: 'stretch' },
  qr: { width: 220, height: 220, alignSelf: 'center', borderRadius: 12, backgroundColor: '#fff' },
  picture: { width: '100%', height: 260, borderRadius: 12 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  label: { color: COLORS.muted, fontSize: 12, fontWeight: '700' },
  value: { color: COLORS.text, fontSize: 17, fontWeight: '800', fontVariant: ['tabular-nums'] },
  muted: { color: COLORS.muted, fontSize: 12, textAlign: 'center' },
  link: { color: COLORS.primary, fontWeight: '700', textAlign: 'center' },
});
