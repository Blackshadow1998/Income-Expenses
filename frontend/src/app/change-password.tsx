import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { api } from '@/api';
import { Button, Card } from '@/components/ui';
import { COLORS, showInfo } from '@/format';
import { t } from '@/i18n';

export default function ChangePasswordScreen() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [next2, setNext2] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setError(null);
    if (next.length < 8) return setError(t('auth.pwTooShort'));
    if (next !== next2) return setError(t('auth.pwMismatch'));
    setSaving(true);
    try {
      await api.auth.changePassword(current, next);
      showInfo(t('auth.pwChangedTitle'), t('auth.pwChangedBody'));
      router.back();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <Card style={{ gap: 12 }}>
        <Field label={t('auth.currentPw')} value={current} onChange={setCurrent} />
        <Field label={t('auth.newPw')} value={next} onChange={setNext} />
        <Field label={t('auth.newPw2')} value={next2} onChange={setNext2} onSubmit={save} />
        {!!error && <Text style={{ color: COLORS.out }}>{error}</Text>}
        <Button title={saving ? t('common.saving') : t('auth.changePw')} onPress={save} disabled={saving} />
      </Card>
    </ScrollView>
  );
}

function Field({ label, value, onChange, onSubmit }: { label: string; value: string; onChange: (v: string) => void; onSubmit?: () => void }) {
  return (
    <View style={{ gap: 4 }}>
      <Text style={{ color: COLORS.muted, fontSize: 13 }}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        onSubmitEditing={onSubmit}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        style={styles.input}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, gap: 12, maxWidth: 520, width: '100%', alignSelf: 'center' },
  input: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: COLORS.text,
    backgroundColor: COLORS.input,
  },
});
