import { ScrollView, StyleSheet, Text } from 'react-native';
import type { Account } from '../api';
import { COLORS, shortAccountLabel } from '../format';
import { PressScale } from './motion';

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
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 2 }}>
      {chips.map((c) => {
        const active = c.id === value;
        return (
          <PressScale key={c.id ?? 'all'} onPress={() => onChange(c.id)} style={[styles.chip, active && styles.chipActive]}>
            <Text style={[styles.text, active && { color: '#fff' }]}>🏦 {c.label}</Text>
          </PressScale>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  chip: {
    paddingVertical: 7,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.card,
  },
  chipActive: { backgroundColor: '#1e1b4b', borderColor: '#1e1b4b' },
  text: { color: COLORS.text, fontSize: 13, fontWeight: '600' },
});
