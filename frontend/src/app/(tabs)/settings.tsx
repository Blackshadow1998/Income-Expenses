import { router } from 'expo-router';
import { ReactNode, useState } from 'react';
import { Animated, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { api, downloadCsv } from '@/api';
import { useAuth } from '@/auth';
import { GoogleButton } from '@/components/GoogleButton';
import { FadeIn, PressScale } from '@/components/motion';
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

/** E-mail that "forgot password" codes are sent to; changing it needs the current password. */
function RecoveryEmail() {
  const { user, refreshUser } = useAuth();
  const [editing, setEditing] = useState(false);
  const [email, setEmail] = useState(user?.email ?? '');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await api.auth.setEmail(email.trim(), password);
      await refreshUser();
      setEditing(false);
      setPassword('');
      showInfo('บันทึกอีเมลแล้ว', 'ถ้าลืมรหัสผ่าน รหัสยืนยันจะถูกส่งไปที่อีเมลนี้');
    } catch (e) {
      showError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card style={{ gap: 10 }}>
      <Text style={styles.h2}>✉️ อีเมลสำหรับกู้รหัสผ่าน</Text>
      {user?.email ? (
        <Text style={{ color: COLORS.text }}>{user.email}</Text>
      ) : (
        <Text style={{ color: COLORS.out }}>ยังไม่ได้ตั้งอีเมล — ถ้าลืมรหัสผ่านจะขอรหัสยืนยันไม่ได้</Text>
      )}
      {editing ? (
        <>
          <TextInput
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            placeholderTextColor={COLORS.muted}
            autoCapitalize="none"
            keyboardType="email-address"
            style={styles.input}
          />
          <TextInput
            value={password}
            onChangeText={setPassword}
            placeholder="รหัสผ่านปัจจุบัน (ยืนยันว่าเป็นคุณ)"
            placeholderTextColor={COLORS.muted}
            secureTextEntry
            autoCapitalize="none"
            onSubmitEditing={save}
            style={styles.input}
          />
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Button title="ยกเลิก" variant="outline" style={{ flex: 1 }} onPress={() => setEditing(false)} />
            <Button title={busy ? 'กำลังบันทึก...' : 'บันทึก'} style={{ flex: 1 }} onPress={save} disabled={busy} />
          </View>
        </>
      ) : (
        <Button title={user?.email ? 'เปลี่ยนอีเมล' : 'ตั้งอีเมล'} variant="outline" onPress={() => setEditing(true)} />
      )}
    </Card>
  );
}

/** Card that shows only its header until tapped; the content pops out below it. */
function Collapsible({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const turn = useState(() => new Animated.Value(0))[0];
  const toggle = () => {
    Animated.spring(turn, { toValue: open ? 0 : 1, speed: 20, bounciness: 8, useNativeDriver: Platform.OS !== 'web' }).start();
    setOpen(!open);
  };
  return (
    <Card style={{ gap: 10 }}>
      <PressScale onPress={toggle} scaleTo={0.98} style={styles.sectionHead} accessibilityRole="button" accessibilityState={{ expanded: open }}>
        <View style={{ flex: 1 }}>
          <Text style={styles.h2}>{title}</Text>
          {!open && <Text style={styles.sectionHint} numberOfLines={1}>{hint}</Text>}
        </View>
        <Animated.Text style={[styles.chevron, { transform: [{ rotate: turn.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '180deg'] }) }] }]}>
          ⌄
        </Animated.Text>
      </PressScale>
      {open && (
        <FadeIn from={-10} style={{ gap: 10 }}>
          {children}
        </FadeIn>
      )}
    </Card>
  );
}

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

      <Collapsible title="📂 ข้อมูล" hint="รายการ · งบประมาณ · รายการประจำ · เงื่อนไขสลิป · หนี้">
        <Button title="📋 จัดการรายการ (หมวดย่อย)" variant="outline" onPress={() => router.push('/subcategories')} />
        <Button title="🎯 งบประมาณรายเดือน" variant="outline" onPress={() => router.push('/budgets')} />
        <Button title="🔁 รายการประจำ" variant="outline" onPress={() => router.push('/recurring')} />
        <Button title="🧠 เงื่อนไขสลิป (ค่าหอ, โอนให้ตัวเอง...)" variant="outline" onPress={() => router.push('/slip-rules')} />
        <Button title="🤝 หนี้ ให้ยืม / กู้" variant="outline" onPress={() => router.push('/debts')} />
      </Collapsible>

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

      <RecoveryEmail />

      <Collapsible title="🛡️ ความปลอดภัย" hint="ล็อก · เปลี่ยน PIN · เปลี่ยนรหัสผ่าน · Google">
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
      </Collapsible>

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
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  sectionHint: { color: COLORS.muted, fontSize: 12, marginTop: 2 },
  chevron: { fontSize: 22, color: COLORS.primary, fontWeight: '800', lineHeight: 24 },
  segment: { flexDirection: 'row', backgroundColor: COLORS.track, borderRadius: 12, padding: 3 },
  segBtn: { paddingVertical: 8, borderRadius: 10, alignItems: 'center' },
  segBtnActive: { backgroundColor: COLORS.card, boxShadow: '0px 2px 6px rgba(59, 47, 42, 0.15)' },
  segText: { fontWeight: '700', color: COLORS.muted, fontSize: 13 },
  input: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: COLORS.text,
    backgroundColor: COLORS.input,
  },
});
