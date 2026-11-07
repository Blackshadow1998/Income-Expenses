import { router } from 'expo-router';
import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { api, downloadCsv } from '@/api';
import { useAuth } from '@/auth';
import { GoogleButton } from '@/components/GoogleButton';
import { PressScale } from '@/components/motion';
import { Button, Card } from '@/components/ui';
import { COLORS, confirmAsync, currentMonth, setThemePref, showError, showInfo, THEME_PREF, ThemePref } from '@/format';

const EXPORTS: { label: string; range: () => [string, string] }[] = [
  { label: 'เดือนนี้', range: () => [`${currentMonth()}-01`, ''] },
  { label: 'ปีนี้', range: () => [`${new Date().getFullYear()}-01-01`, ''] },
  { label: 'ทั้งหมด', range: () => ['', ''] },
];

const exportCsv = async ([from, to]: [string, string]) => {
  try {
    await downloadCsv(from, to);
  } catch (e) {
    showError(e);
  }
};

const THEMES: { key: ThemePref; label: string }[] = [
  { key: 'system', label: '📱 ตามเครื่อง' },
  { key: 'light', label: '☀️ สว่าง' },
  { key: 'dark', label: '🌙 มืด' },
];

export default function SettingsScreen() {
  const { user, lockNow, signOut } = useAuth();

  const onSignOut = async () => {
    if (await confirmAsync('ออกจากระบบ', 'ต้องการออกจากระบบใช่หรือไม่?', 'ออกจากระบบ')) await signOut();
  };

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Card style={styles.profile}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{(user?.name ?? '?').slice(0, 1).toUpperCase()}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.name}>{user?.name}</Text>
          <Text style={{ color: COLORS.muted }}>@{user?.username}</Text>
        </View>
      </Card>

      <Card style={{ gap: 10 }}>
        <Text style={styles.h2}>ข้อมูล</Text>
        <Button title="📋 จัดการรายการ (หมวดย่อย)" variant="outline" onPress={() => router.push('/subcategories')} />
        <Button title="🎯 งบประมาณรายเดือน" variant="outline" onPress={() => router.push('/budgets')} />
        <Button title="🔁 รายการประจำ" variant="outline" onPress={() => router.push('/recurring')} />
        <Button title="🤝 หนี้ ให้ยืม / กู้" variant="outline" onPress={() => router.push('/debts')} />
      </Card>

      <Card style={{ gap: 10 }}>
        <Text style={styles.h2}>📤 ส่งออก Excel / CSV</Text>
        {Platform.OS === 'web' ? (
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {EXPORTS.map((e) => (
              <Button key={e.label} title={e.label} small variant="soft" style={{ flex: 1 }} onPress={() => exportCsv(e.range())} />
            ))}
          </View>
        ) : (
          <Text style={{ color: COLORS.muted, fontSize: 13 }}>ส่งออกได้จากหน้าเว็บ (เปิดผ่านเบราว์เซอร์)</Text>
        )}
      </Card>

      <Card style={{ gap: 10 }}>
        <Text style={styles.h2}>ธีม</Text>
        <View style={styles.segment}>
          {THEMES.map((t) => (
            <PressScale
              key={t.key}
              onPress={() => t.key !== THEME_PREF && setThemePref(t.key)}
              containerStyle={{ flex: 1 }}
              style={[styles.segBtn, THEME_PREF === t.key && styles.segBtnActive]}
            >
              <Text style={[styles.segText, THEME_PREF === t.key && { color: COLORS.primary }]}>{t.label}</Text>
            </PressScale>
          ))}
        </View>
      </Card>

      <Card style={{ gap: 10 }}>
        <Text style={styles.h2}>ความปลอดภัย</Text>
        <Text style={{ color: COLORS.muted, fontSize: 13 }}>
          แอปจะล็อกและถาม PIN เมื่อเปิดใหม่ หรือไม่ได้ใช้งาน 5 นาที
        </Text>
        <Button title="🔒 ล็อกตอนนี้" variant="outline" onPress={lockNow} />
        <Button title="เปลี่ยน PIN" variant="outline" onPress={() => router.push('/change-pin')} />
        <Button title="เปลี่ยนรหัสผ่าน" variant="outline" onPress={() => router.push('/change-password')} />
        <GoogleButton
          text="continue_with"
          onCredential={async (credential) => {
            try {
              await api.auth.linkGoogle(credential);
              showInfo('เชื่อมบัญชี Google แล้ว', 'ครั้งต่อไปกด "ลงชื่อเข้าใช้ด้วย Google" ที่หน้าเข้าสู่ระบบได้เลย');
            } catch (e) {
              showError(e);
            }
          }}
        />
      </Card>

      <Button title="ออกจากระบบ" variant="danger" onPress={onSignOut} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, gap: 12, maxWidth: 820, width: '100%', alignSelf: 'center' },
  profile: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: '#fff', fontSize: 20, fontWeight: '700' },
  name: { fontSize: 17, fontWeight: '700', color: COLORS.text },
  h2: { fontSize: 16, fontWeight: '700', color: COLORS.text },
  segment: { flexDirection: 'row', backgroundColor: COLORS.track, borderRadius: 12, padding: 3 },
  segBtn: { paddingVertical: 8, borderRadius: 10, alignItems: 'center' },
  segBtnActive: { backgroundColor: COLORS.card, boxShadow: '0px 2px 6px rgba(30, 27, 75, 0.15)' },
  segText: { fontWeight: '700', color: COLORS.muted, fontSize: 13 },
});
