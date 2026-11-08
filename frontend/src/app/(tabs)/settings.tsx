import { router } from 'expo-router';
import { ReactNode, useState } from 'react';
import { Animated, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { api, downloadCsv } from '@/api';
import { useAuth } from '@/auth';
import { GoogleButton } from '@/components/GoogleButton';
import { FadeIn, PressScale } from '@/components/motion';
import { Button, Card } from '@/components/ui';
import { COLORS, confirmAsync, currentMonth, setThemePref, showError, showInfo, THEME_PREF, ThemePref } from '@/format';
import { Lang, LANG, setLang, t } from '@/i18n';

const EXPORTS: { label: string; range: () => [string, string] }[] = [
  { label: t('settings.exportThisMonth'), range: () => [`${currentMonth()}-01`, ''] },
  { label: t('settings.exportThisYear'), range: () => [`${new Date().getFullYear()}-01-01`, ''] },
  { label: t('settings.exportAll'), range: () => ['', ''] },
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
      showInfo(t('settings.emailSavedTitle'), t('settings.emailSavedBody'));
    } catch (e) {
      showError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card style={{ gap: 10 }}>
      <Text style={styles.h2}>{t('settings.recoveryEmail')}</Text>
      {user?.email ? (
        <Text style={{ color: COLORS.text }}>{user.email}</Text>
      ) : (
        <Text style={{ color: COLORS.out }}>{t('settings.noEmail')}</Text>
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
            placeholder={t('settings.currentPassword')}
            placeholderTextColor={COLORS.muted}
            secureTextEntry
            autoCapitalize="none"
            onSubmitEditing={save}
            style={styles.input}
          />
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Button title={t('common.cancel')} variant="outline" style={{ flex: 1 }} onPress={() => setEditing(false)} />
            <Button title={busy ? t('common.saving') : t('common.save')} style={{ flex: 1 }} onPress={save} disabled={busy} />
          </View>
        </>
      ) : (
        <Button title={user?.email ? t('settings.changeEmail') : t('settings.setEmail')} variant="outline" onPress={() => setEditing(true)} />
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
  { key: 'system', label: t('settings.themeSystem') },
  { key: 'light', label: t('settings.themeLight') },
  { key: 'dark', label: t('settings.themeDark') },
];

const LANGS: { key: Lang; label: string }[] = [
  { key: 'th', label: t('lang.th') },
  { key: 'en', label: t('lang.en') },
];

export default function SettingsScreen() {
  const { user, lockNow, signOut } = useAuth();

  const onSignOut = async () => {
    if (await confirmAsync(t('settings.signOut'), t('settings.signOutConfirm'), t('settings.signOut'))) await signOut();
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

      <Collapsible title={t('settings.data')} hint={t('settings.dataHint')}>
        <Button title={t('settings.subcategories')} variant="outline" onPress={() => router.push('/subcategories')} />
        <Button title={t('settings.budgets')} variant="outline" onPress={() => router.push('/budgets')} />
        <Button title={t('settings.recurring')} variant="outline" onPress={() => router.push('/recurring')} />
        <Button title={t('settings.slipRules')} variant="outline" onPress={() => router.push('/slip-rules')} />
        <Button title={t('settings.debts')} variant="outline" onPress={() => router.push('/debts')} />
      </Collapsible>

      <Card style={{ gap: 10 }}>
        <Text style={styles.h2}>{t('settings.export')}</Text>
        {Platform.OS === 'web' ? (
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {EXPORTS.map((e) => (
              <Button key={e.label} title={e.label} small variant="soft" style={{ flex: 1 }} onPress={() => exportCsv(e.range())} />
            ))}
          </View>
        ) : (
          <Text style={{ color: COLORS.muted, fontSize: 13 }}>{t('settings.exportWebOnly')}</Text>
        )}
      </Card>

      <Card style={{ gap: 10 }}>
        <Text style={styles.h2}>{t('settings.theme')}</Text>
        <View style={styles.segment}>
          {THEMES.map((o) => (
            <PressScale
              key={o.key}
              onPress={() => o.key !== THEME_PREF && setThemePref(o.key)}
              containerStyle={{ flex: 1 }}
              style={[styles.segBtn, THEME_PREF === o.key && styles.segBtnActive]}
            >
              <Text style={[styles.segText, THEME_PREF === o.key && { color: COLORS.primary }]}>{o.label}</Text>
            </PressScale>
          ))}
        </View>
      </Card>

      <Card style={{ gap: 10 }}>
        <Text style={styles.h2}>{t('lang.title')}</Text>
        <View style={styles.segment}>
          {LANGS.map((o) => (
            <PressScale
              key={o.key}
              onPress={() => o.key !== LANG && setLang(o.key)}
              containerStyle={{ flex: 1 }}
              style={[styles.segBtn, LANG === o.key && styles.segBtnActive]}
            >
              <Text style={[styles.segText, LANG === o.key && { color: COLORS.primary }]}>{o.label}</Text>
            </PressScale>
          ))}
        </View>
      </Card>

      <RecoveryEmail />

      <Collapsible title={t('settings.security')} hint={t('settings.securityHint')}>
        <Text style={{ color: COLORS.muted, fontSize: 13 }}>
          {t('settings.lockInfo')}
        </Text>
        <Button title={t('settings.lockNow')} variant="outline" onPress={lockNow} />
        <Button title={t('settings.changePin')} variant="outline" onPress={() => router.push('/change-pin')} />
        <Button title={t('settings.changePassword')} variant="outline" onPress={() => router.push('/change-password')} />
        <GoogleButton
          text="continue_with"
          onCredential={async (credential) => {
            try {
              await api.auth.linkGoogle(credential);
              showInfo(t('settings.googleLinkedTitle'), t('settings.googleLinkedBody'));
            } catch (e) {
              showError(e);
            }
          }}
        />
      </Collapsible>

      <Button title={t('settings.signOut')} variant="danger" onPress={onSignOut} />
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
