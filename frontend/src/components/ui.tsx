import React from 'react';
import { StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { COLORS, SHADOW } from '../format';
import { GridLoader, PressScale } from './motion';

export function Card({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

type ButtonVariant = 'primary' | 'outline' | 'danger' | 'ghost' | 'soft';

export function Button({
  title,
  onPress,
  variant = 'primary',
  disabled,
  small,
  icon,
  style,
}: {
  title: string;
  onPress: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  small?: boolean;
  icon?: string; // emoji shown before the title
  style?: StyleProp<ViewStyle>; // layout of the button within its parent, e.g. { flex: 1 }
}) {
  const v = VARIANTS[variant];
  return (
    <PressScale
      onPress={onPress}
      disabled={disabled}
      containerStyle={style}
      style={[styles.btn, small && styles.btnSmall, { backgroundColor: v.bg, borderColor: v.border }, variant === 'primary' && styles.btnGlow]}
    >
      {!!icon && <Text style={{ fontSize: small ? 13 : 16 }}>{icon}</Text>}
      <Text style={[styles.btnText, small && { fontSize: 13 }, { color: v.fg }]}>{title}</Text>
    </PressScale>
  );
}

const VARIANTS: Record<ButtonVariant, { bg: string; fg: string; border: string }> = {
  primary: { bg: COLORS.primary, fg: '#fff', border: COLORS.primary },
  outline: { bg: COLORS.card, fg: COLORS.primary, border: COLORS.primaryBorder },
  danger: { bg: COLORS.card, fg: COLORS.out, border: COLORS.dangerBorder },
  ghost: { bg: 'transparent', fg: COLORS.text, border: 'transparent' },
  soft: { bg: COLORS.primarySoft, fg: COLORS.primary, border: COLORS.primarySoft },
};

export function Loading() {
  return (
    <View style={{ padding: 32, alignItems: 'center' }}>
      <GridLoader />
    </View>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Card style={{ alignItems: 'center', gap: 10 }}>
      <Text style={{ fontSize: 28 }}>📡</Text>
      <Text style={{ color: COLORS.out, textAlign: 'center' }}>เชื่อมต่อเซิร์ฟเวอร์ไม่ได้: {message}</Text>
      <Button title="ลองใหม่" variant="soft" small onPress={onRetry} />
    </Card>
  );
}

/** ◀ label ▶ stepper used for month and year selection. `light` is for use on a coloured header. */
export function Stepper({ label, onPrev, onNext, light }: { label: string; onPrev: () => void; onNext: () => void; light?: boolean }) {
  return (
    <View style={styles.stepper}>
      <PressScale onPress={onPrev} hitSlop={8} scaleTo={0.85} style={[styles.stepBtn, light && styles.stepBtnLight]}>
        <Text style={[styles.stepArrow, light && { color: '#fff' }]}>‹</Text>
      </PressScale>
      <Text style={[styles.stepLabel, light && { color: '#fff' }]}>{label}</Text>
      <PressScale onPress={onNext} hitSlop={8} scaleTo={0.85} style={[styles.stepBtn, light && styles.stepBtnLight]}>
        <Text style={[styles.stepArrow, light && { color: '#fff' }]}>›</Text>
      </PressScale>
    </View>
  );
}

/** Round emoji badge on a tinted background. */
export function IconBubble({ icon, tint, size = 42 }: { icon: string; tint: string; size?: number }) {
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: tint, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ fontSize: size * 0.48 }}>{icon}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.card,
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    ...SHADOW,
  },
  btn: {
    flexDirection: 'row',
    gap: 6,
    paddingVertical: 11,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnSmall: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 10 },
  btnGlow: { boxShadow: '0px 6px 16px rgba(139, 94, 60, 0.28)' },
  btnText: { fontWeight: '700', fontSize: 15 },
  stepper: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12 },
  stepBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: COLORS.primarySoft, alignItems: 'center', justifyContent: 'center' },
  stepBtnLight: { backgroundColor: 'rgba(255,255,255,0.18)' },
  stepArrow: { color: COLORS.primary, fontSize: 24, lineHeight: 26, fontWeight: '600' },
  stepLabel: { fontSize: 18, fontWeight: '800', color: COLORS.text, minWidth: 170, textAlign: 'center' },
});
