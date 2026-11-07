import { Picker } from '@react-native-picker/picker';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { api, Budget, Category } from '@/api';
import { budgetColor } from '@/components/BudgetCard';
import { FadeIn, PressScale } from '@/components/motion';
import { Button, Card, ErrorBox, Loading } from '@/components/ui';
import { CATEGORY_COLORS, CATEGORY_ICONS, COLORS, confirmAsync, currentMonth, money, showError } from '@/format';

/** Monthly budgets per category or item; saving the same category/item again replaces its amount. */
export default function BudgetsScreen() {
  const [budgets, setBudgets] = useState<Budget[] | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [subcategoryId, setSubcategoryId] = useState<number | null>(null);
  const [amountText, setAmountText] = useState('');
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setError(null);
    try {
      const [b, cs] = await Promise.all([api.budgets(currentMonth()), api.categories()]);
      setBudgets(b);
      setCategories(cs);
      setCategoryId((prev) => prev ?? cs.find((c) => c.code === 'expense')?.id ?? null);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const spendCategories = categories.filter((c) => c.direction < 0);
  const category = categories.find((c) => c.id === categoryId);
  const amount = Number(amountText.replace(/,/g, ''));

  const save = async () => {
    if (!categoryId || !(amount > 0)) return showError(new Error('กรุณาเลือกหมวดและใส่จำนวนเงินที่มากกว่า 0'));
    setSaving(true);
    try {
      await api.saveBudget(categoryId, subcategoryId, amount);
      setAmountText('');
      setSubcategoryId(null);
      await load();
    } catch (e) {
      showError(e);
    } finally {
      setSaving(false);
    }
  };

  const edit = (b: Budget) => {
    setCategoryId(b.category_id);
    setSubcategoryId(b.subcategory_id);
    setAmountText(String(b.amount));
  };

  const remove = async (b: Budget) => {
    if (!(await confirmAsync('ลบงบประมาณ', `ต้องการลบงบ "${b.subcategory_name || b.category_name}" ใช่หรือไม่?`))) return;
    try {
      await api.removeBudget(b.id);
      await load();
    } catch (e) {
      showError(e);
    }
  };

  if (error) return <View style={styles.page}><ErrorBox message={error} onRetry={load} /></View>;
  if (!budgets) return <Loading />;

  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <Card style={{ gap: 12 }}>
        <Text style={styles.h2}>ตั้งงบต่อเดือน</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {spendCategories.map((c) => {
            const active = c.id === categoryId;
            const color = CATEGORY_COLORS[c.code];
            return (
              <PressScale
                key={c.id}
                onPress={() => {
                  setCategoryId(c.id);
                  setSubcategoryId(null);
                }}
                style={[styles.catBtn, { borderColor: color }, active && { backgroundColor: color }]}
              >
                <Text style={{ color: active ? '#fff' : color, fontWeight: '700' }}>
                  {CATEGORY_ICONS[c.code]} {c.name}
                </Text>
              </PressScale>
            );
          })}
        </View>
        {!!category?.subcategories.length && (
          <View style={styles.pickerWrap}>
            <Picker selectedValue={subcategoryId ?? 0} onValueChange={(v) => setSubcategoryId(Number(v) || null)} style={styles.picker}>
              <Picker.Item label={`ทั้งหมวด "${category.name}"`} value={0} />
              {category.subcategories.map((s) => (
                <Picker.Item key={s.id} label={s.name} value={s.id} />
              ))}
            </Picker>
          </View>
        )}
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
          <TextInput
            value={amountText}
            onChangeText={(t) => setAmountText(t.replace(/[^0-9.,]/g, ''))}
            onSubmitEditing={save}
            placeholder="งบต่อเดือน (บาท)"
            placeholderTextColor="#9ca3af"
            keyboardType="decimal-pad"
            style={[styles.input, { flex: 1 }]}
          />
          <Button title={saving ? '...' : 'บันทึก'} onPress={save} disabled={saving} />
        </View>
        <Text style={styles.hint}>ตั้งซ้ำหมวด/รายการเดิม = แก้จำนวนเงิน · นับรายจ่ายจากทุกบัญชี</Text>
      </Card>

      {budgets.length === 0 ? (
        <Text style={[styles.hint, { textAlign: 'center' }]}>ยังไม่มีงบประมาณ</Text>
      ) : (
        budgets.map((b, i) => {
          const ratio = b.spent / b.amount;
          return (
            <FadeIn key={b.id} delay={i * 50}>
              <PressScale onPress={() => edit(b)} scaleTo={0.98} style={styles.row}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={styles.name}>
                    {CATEGORY_ICONS[b.category_code]} {b.subcategory_name || `${b.category_name} (ทั้งหมวด)`}
                  </Text>
                  <Text style={styles.hint}>
                    {money(b.amount)} / เดือน · เดือนนี้ใช้ไป{' '}
                    <Text style={{ color: budgetColor(ratio), fontWeight: '700' }}>{money(b.spent)}</Text>
                  </Text>
                </View>
                <PressScale onPress={() => remove(b)} hitSlop={8} scaleTo={0.85} style={styles.trash} accessibilityLabel="ลบงบ">
                  <Text style={{ fontSize: 13 }}>🗑️</Text>
                </PressScale>
              </PressScale>
            </FadeIn>
          );
        })
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, gap: 12, maxWidth: 640, width: '100%', alignSelf: 'center', paddingBottom: 32 },
  h2: { fontSize: 16, fontWeight: '800', color: COLORS.text },
  hint: { color: COLORS.muted, fontSize: 12 },
  catBtn: { borderWidth: 1.5, borderRadius: 999, paddingVertical: 7, paddingHorizontal: 14 },
  pickerWrap: { borderWidth: 1, borderColor: COLORS.border, borderRadius: 12, backgroundColor: '#fff', overflow: 'hidden' },
  picker: { fontSize: 16, color: COLORS.text, padding: 10, borderWidth: 0, backgroundColor: 'transparent' },
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
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 14,
    borderRadius: 18,
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  name: { fontWeight: '700', color: COLORS.text },
  trash: { width: 28, height: 28, borderRadius: 14, backgroundColor: '#fef2f2', alignItems: 'center', justifyContent: 'center' },
});
