import type { ImagePickerAsset } from 'expo-image-picker';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { api, Option, Trip, TripMember } from '@/api';
import { DeleteButton } from '@/components/DeleteButton';
import { PressScale } from '@/components/motion';
import { promptPayLabel } from '@/components/PayInfo';
import { PhotoField } from '@/components/PhotoField';
import { Button, Card, ErrorBox, Loading } from '@/components/ui';
import { COLORS, confirmAsync, showError } from '@/format';
import { t } from '@/i18n';
import { promptPayDigits } from '@/promptpay';

/** Edit a trip member (or the shared pool): name and how to pay them — PromptPay, bank account, QR picture. */
export default function TripMemberScreen() {
  const params = useLocalSearchParams<{ tripId: string; id: string }>();
  const tripId = Number(params.tripId);
  const memberId = Number(params.id);
  const [member, setMember] = useState<TripMember | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [promptpay, setPromptpay] = useState('');
  const [bankName, setBankName] = useState('');
  const [bankAccount, setBankAccount] = useState('');
  const [accountName, setAccountName] = useState('');
  const [banks, setBanks] = useState<Option[]>([]);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  const show = useCallback(
    (trip: Trip) => {
      const m = trip.members.find((x) => x.id === memberId) ?? null;
      setMember(m);
      return m;
    },
    [memberId],
  );

  const load = useCallback(async () => {
    setError(null);
    try {
      const [trip, opts] = await Promise.all([api.trip(tripId), api.accountOptions()]);
      const m = show(trip);
      setBanks(opts.banks);
      if (m) {
        setName(m.name);
        setPromptpay(m.promptpay ? promptPayLabel(m.promptpay) : '');
        setBankName(m.bank_name);
        setBankAccount(m.bank_account);
        setAccountName(m.account_name);
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }, [tripId, show]);

  useEffect(() => {
    load();
  }, [load]);

  // The QR picture is saved straight away, like a bill photo on an existing bill.
  const setQR = async (image: ImagePickerAsset | null) => {
    setUploading(true);
    try {
      show(await api.setTripMemberQR(memberId, image));
    } catch (e) {
      showError(e);
    } finally {
      setUploading(false);
    }
  };

  const ppOK = !promptpay.trim() || !!promptPayDigits(promptpay);
  const save = async () => {
    if (!member) return;
    if (!ppOK) return showError(new Error(t('member.promptpayBad')));
    setSaving(true);
    try {
      await api.updateTripMember(tripId, memberId, {
        name: member.is_pool ? member.name : name.trim(),
        promptpay: promptPayDigits(promptpay) ?? '',
        bank_name: bankName.trim(),
        bank_account: bankAccount.trim(),
        account_name: accountName.trim(),
      });
      router.back();
    } catch (e) {
      showError(e);
    } finally {
      setSaving(false);
    }
  };

  const title = member?.is_pool ? t('trip.poolTitle') : t('screen.tripMember');
  if (error) return <View style={styles.page}><Stack.Screen options={{ title }} /><ErrorBox message={error} onRetry={load} /></View>;
  if (!member) return <><Stack.Screen options={{ title }} /><Loading /></>;

  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title }} />
      <Card style={{ gap: 14 }}>
        {member.is_pool ? (
          <Text style={styles.hint}>{t('member.poolNote')}</Text>
        ) : (
          <Field label={t('member.name')}>
            <TextInput value={name} onChangeText={setName} maxLength={40} style={styles.input} />
          </Field>
        )}

        <Text style={styles.section}>{t('member.payInfo')}</Text>
        <Field label={t('member.promptpay')}>
          <TextInput
            value={promptpay}
            onChangeText={(v) => setPromptpay(v.replace(/[^0-9 -]/g, ''))}
            keyboardType="number-pad"
            placeholder="08x-xxx-xxxx"
            placeholderTextColor={COLORS.muted}
            style={[styles.input, !ppOK && { borderColor: COLORS.out }]}
          />
          {!ppOK && <Text style={[styles.hint, { color: COLORS.out }]}>{t('member.promptpayBad')}</Text>}
        </Field>
        <Field label={t('member.bankName')}>
          <TextInput value={bankName} onChangeText={setBankName} maxLength={60} style={styles.input} />
          {banks.length > 0 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
              {banks.map((b) => (
                <PressScale key={b.id} onPress={() => setBankName(b.name)} style={[styles.chip, bankName === b.name && styles.chipOn]}>
                  <Text style={[styles.chipText, bankName === b.name && { color: '#fff' }]}>{b.name}</Text>
                </PressScale>
              ))}
            </ScrollView>
          )}
        </Field>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Field label={t('member.bankAccount')} style={{ flex: 1 }}>
            <TextInput value={bankAccount} onChangeText={setBankAccount} maxLength={30} keyboardType="number-pad" style={styles.input} />
          </Field>
          <Field label={t('member.accountName')} style={{ flex: 1 }}>
            <TextInput value={accountName} onChangeText={setAccountName} maxLength={80} style={styles.input} />
          </Field>
        </View>
        <Field label={t('member.qr')}>
          <PhotoField
            uri={member.qr_url ? api.tripMemberQRUrl(member) : null}
            onPick={setQR}
            onRemove={() => setQR(null)}
            busy={uploading}
            emptyLabel={t('member.qrPick')}
          />
        </Field>

        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Button title={t('common.cancel')} variant="outline" style={{ flex: 1 }} onPress={() => router.back()} />
          <Button title={saving ? t('common.saving') : t('common.save')} style={{ flex: 1 }} onPress={save} disabled={saving} />
        </View>
        <DeleteButton
          title={member.is_pool ? t('member.deletePool') : t('member.delete')}
          confirm={() =>
            member.is_pool
              ? confirmAsync(t('member.deletePoolTitle'), t('member.deletePoolBody'))
              : confirmAsync(t('trip.removeMemberTitle'), t('trip.removeMemberBody', { name: member.name }))
          }
          onDelete={() => api.removeTripMember(tripId, memberId)}
          onDone={() => router.back()}
        />
      </Card>
    </ScrollView>
  );
}

function Field({ label, children, style }: { label: string; children: React.ReactNode; style?: object }) {
  return (
    <View style={[{ gap: 6 }, style]}>
      <Text style={styles.label}>{label}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, gap: 12, maxWidth: 640, width: '100%', alignSelf: 'center', paddingBottom: 40 },
  label: { fontWeight: '700', color: COLORS.text },
  section: { fontWeight: '800', color: COLORS.muted, fontSize: 13, marginTop: 4 },
  hint: { color: COLORS.muted, fontSize: 12 },
  input: { borderWidth: 1, borderColor: COLORS.border, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16, color: COLORS.text, backgroundColor: COLORS.input },
  chip: { paddingVertical: 5, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1.5, borderColor: COLORS.primary },
  chipOn: { backgroundColor: COLORS.primary },
  chipText: { color: COLORS.primary, fontWeight: '700', fontSize: 12 },
});
