import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { api } from '@/api';
import { Button, Card } from '@/components/ui';
import { COLORS, showInfo } from '@/format';

export default function ChangePasswordScreen() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [next2, setNext2] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setError(null);
    if (next.length < 8) return setError('รหัสผ่านใหม่ต้องยาวอย่างน้อย 8 ตัวอักษร');
    if (next !== next2) return setError('รหัสผ่านใหม่ทั้งสองช่องไม่ตรงกัน');
    setSaving(true);
    try {
      await api.auth.changePassword(current, next);
      showInfo('เปลี่ยนรหัสผ่านแล้ว', 'อุปกรณ์อื่นที่เคยเข้าสู่ระบบไว้จะต้องเข้าสู่ระบบใหม่');
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
        <Field label="รหัสผ่านปัจจุบัน (หรือรหัสชั่วคราว)" value={current} onChange={setCurrent} />
        <Field label="รหัสผ่านใหม่ (อย่างน้อย 8 ตัว)" value={next} onChange={setNext} />
        <Field label="ยืนยันรหัสผ่านใหม่" value={next2} onChange={setNext2} onSubmit={save} />
        {!!error && <Text style={{ color: COLORS.out }}>{error}</Text>}
        <Button title={saving ? 'กำลังบันทึก...' : 'เปลี่ยนรหัสผ่าน'} onPress={save} disabled={saving} />
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
    backgroundColor: '#fff',
  },
});
