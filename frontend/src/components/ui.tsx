import React from 'react';
import { ActivityIndicator, Pressable, StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { COLORS } from '../format';

export function Card({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

type ButtonVariant = 'primary' | 'outline' | 'danger' | 'ghost';

export function Button({
  title,
  onPress,
  variant = 'primary',
  disabled,
  small,
}: {
  title: string;
  onPress: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  small?: boolean;
}) {
  const v = VARIANTS[variant];
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.btn,
        small && styles.btnSmall,
        { backgroundColor: v.bg, borderColor: v.border },
        (pressed || disabled) && { opacity: 0.6 },
      ]}
    >
      <Text style={[styles.btnText, small && { fontSize: 13 }, { color: v.fg }]}>{title}</Text>
    </Pressable>
  );
}

const VARIANTS: Record<ButtonVariant, { bg: string; fg: string; border: string }> = {
  primary: { bg: COLORS.primary, fg: '#fff', border: COLORS.primary },
  outline: { bg: '#fff', fg: COLORS.primary, border: COLORS.primary },
  danger: { bg: '#fff', fg: COLORS.out, border: COLORS.out },
  ghost: { bg: 'transparent', fg: COLORS.text, border: 'transparent' },
};

export function Loading() {
  return (
    <View style={{ padding: 32, alignItems: 'center' }}>
      <ActivityIndicator color={COLORS.primary} />
    </View>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Card style={{ alignItems: 'center', gap: 8 }}>
      <Text style={{ color: COLORS.out, textAlign: 'center' }}>เชื่อมต่อเซิร์ฟเวอร์ไม่ได้: {message}</Text>
      <Button title="ลองใหม่" variant="outline" small onPress={onRetry} />
    </Card>
  );
}

/** ◀ label ▶ stepper used for month and year selection. */
export function Stepper({ label, onPrev, onNext }: { label: string; onPrev: () => void; onNext: () => void }) {
  return (
    <View style={styles.stepper}>
      <Pressable onPress={onPrev} style={styles.stepBtn} hitSlop={8}>
        <Text style={styles.stepArrow}>◀</Text>
      </Pressable>
      <Text style={styles.stepLabel}>{label}</Text>
      <Pressable onPress={onNext} style={styles.stepBtn} hitSlop={8}>
        <Text style={styles.stepArrow}>▶</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.card,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  btn: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnSmall: { paddingVertical: 5, paddingHorizontal: 10 },
  btnText: { fontWeight: '600', fontSize: 15 },
  stepper: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12 },
  stepBtn: { padding: 8, borderRadius: 8, backgroundColor: '#eef0ff' },
  stepArrow: { color: COLORS.primary, fontSize: 14 },
  stepLabel: { fontSize: 18, fontWeight: '700', color: COLORS.text, minWidth: 170, textAlign: 'center' },
});
