import { router } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '@/auth';
import { Button, Card } from '@/components/ui';
import { COLORS, confirmAsync } from '@/format';

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
      </Card>

      <Card style={{ gap: 10 }}>
        <Text style={styles.h2}>ความปลอดภัย</Text>
        <Text style={{ color: COLORS.muted, fontSize: 13 }}>
          แอปจะล็อกและถาม PIN เมื่อเปิดใหม่ หรือไม่ได้ใช้งาน 5 นาที
        </Text>
        <Button title="🔒 ล็อกตอนนี้" variant="outline" onPress={lockNow} />
        <Button title="เปลี่ยน PIN" variant="outline" onPress={() => router.push('/change-pin')} />
        <Button title="เปลี่ยนรหัสผ่าน" variant="outline" onPress={() => router.push('/change-password')} />
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
});
