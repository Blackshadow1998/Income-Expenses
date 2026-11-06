import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import type { Account } from '../api';
import { COLORS, shortAccountLabel } from '../format';

/** Chips to show everything ("ทุกบัญชี") or just one account. null = all accounts. */
export function AccountFilter({
  accounts,
  value,
  onChange,
}: {
  accounts: Account[];
  value: number | null;
  onChange: (id: number | null) => void;
}) {
  if (accounts.length === 0) return null;
  const chips: { id: number | null; label: string }[] = [
    { id: null, label: 'ทุกบัญชี' },
    ...accounts.map((a) => ({ id: a.id, label: shortAccountLabel(a) })),
  ];
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
      {chips.map((c) => {
        const active = c.id === value;
        return (
          <Pressable key={c.id ?? 'all'} onPress={() => onChange(c.id)} style={[styles.chip, active && styles.chipActive]}>
            <Text style={[styles.text, active && { color: '#fff' }]}>🏦 {c.label}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  chip: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: '#fff',
  },
  chipActive: { backgroundColor: COLORS.text, borderColor: COLORS.text },
  text: { color: COLORS.text, fontSize: 13 },
});
