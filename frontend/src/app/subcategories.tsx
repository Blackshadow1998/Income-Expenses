import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { api, Category, Subcategory } from '@/api';
import { FadeIn, PressScale } from '@/components/motion';
import { Button, Card, ErrorBox, IconBubble, Loading } from '@/components/ui';
import { CATEGORY_ICONS, CATEGORY_TINTS, COLORS, confirmAsync, showError } from '@/format';

/** Add, rename and delete the items ("รายการ") offered in the add/edit form, per category. */
export default function SubcategoriesScreen() {
  const [categories, setCategories] = useState<Category[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setError(null);
    try {
      setCategories(await api.categories());
    } catch (e) {
      setError((e as Error).message);
    }
  };

  useEffect(() => {
    load();
  }, []);

  if (error) return <View style={styles.page}><ErrorBox message={error} onRetry={load} /></View>;
  if (!categories) return <Loading />;

  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <Text style={styles.hint}>รายการเหล่านี้จะขึ้นให้เลือกในหน้าเพิ่ม/แก้ไขรายการ ตามหมวดหมู่</Text>
      {categories.map((c, i) => (
        <FadeIn key={c.id} delay={i * 60}>
          <CategoryCard category={c} onChanged={load} />
        </FadeIn>
      ))}
    </ScrollView>
  );
}

function CategoryCard({ category, onChanged }: { category: Category; onChanged: () => Promise<void> }) {
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);

  const add = async () => {
    if (!newName.trim() || busy) return;
    setBusy(true);
    try {
      await api.createSubcategory(category.id, newName.trim());
      setNewName('');
      await onChanged();
    } catch (e) {
      showError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card style={{ gap: 10 }}>
      <View style={styles.cardHeader}>
        <IconBubble icon={CATEGORY_ICONS[category.code]} tint={CATEGORY_TINTS[category.code]} size={34} />
        <Text style={styles.h2}>{category.name}</Text>
        <Text style={styles.count}>{category.subcategories.length} รายการ</Text>
      </View>
      {category.subcategories.map((s) => (
        <ItemRow key={s.id} item={s} onChanged={onChanged} />
      ))}
      <View style={styles.addRow}>
        <TextInput
          value={newName}
          onChangeText={setNewName}
          onSubmitEditing={add}
          placeholder={`เพิ่มรายการใน "${category.name}"`}
          placeholderTextColor="#9ca3af"
          style={[styles.input, { flex: 1 }]}
        />
        <Button title="เพิ่ม" icon="＋" small onPress={add} disabled={busy || !newName.trim()} />
      </View>
    </Card>
  );
}

function ItemRow({ item, onChanged }: { item: Subcategory; onChanged: () => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(item.name);

  const save = async () => {
    if (!name.trim() || name.trim() === item.name) {
      setEditing(false);
      setName(item.name);
      return;
    }
    try {
      await api.renameSubcategory(item.id, name.trim());
      setEditing(false);
      await onChanged();
    } catch (e) {
      showError(e);
    }
  };

  const remove = async () => {
    const ok = await confirmAsync(
      'ลบรายการ',
      `ต้องการลบ "${item.name}" ใช่หรือไม่?\nรายการรับ/จ่ายที่เคยเลือกไว้จะยังอยู่ แต่จะเป็น "ไม่ระบุ"`,
    );
    if (!ok) return;
    try {
      await api.removeSubcategory(item.id);
      await onChanged();
    } catch (e) {
      showError(e);
    }
  };

  if (editing) {
    return (
      <View style={styles.addRow}>
        <TextInput value={name} onChangeText={setName} onSubmitEditing={save} autoFocus style={[styles.input, { flex: 1 }]} />
        <Button title="บันทึก" small onPress={save} />
        <Button title="ยกเลิก" small variant="ghost" onPress={() => { setEditing(false); setName(item.name); }} />
      </View>
    );
  }
  return (
    <View style={styles.item}>
      <PressScale onPress={() => setEditing(true)} scaleTo={0.98} containerStyle={{ flex: 1 }} style={{ paddingVertical: 4 }}>
        <Text style={{ color: COLORS.text, fontSize: 15 }}>{item.name}</Text>
      </PressScale>
      <PressScale onPress={() => setEditing(true)} hitSlop={6} scaleTo={0.85} style={styles.iconBtn} accessibilityLabel="แก้ชื่อ">
        <Text style={{ fontSize: 13 }}>✏️</Text>
      </PressScale>
      <PressScale onPress={remove} hitSlop={6} scaleTo={0.85} style={[styles.iconBtn, { backgroundColor: '#fef2f2' }]} accessibilityLabel="ลบ">
        <Text style={{ fontSize: 13 }}>🗑️</Text>
      </PressScale>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, gap: 12, maxWidth: 640, width: '100%', alignSelf: 'center', paddingBottom: 32 },
  hint: { color: COLORS.muted, fontSize: 13 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  h2: { fontSize: 16, fontWeight: '800', color: COLORS.text, flex: 1 },
  count: { color: COLORS.muted, fontSize: 12 },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 4,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  iconBtn: { width: 30, height: 30, borderRadius: 15, backgroundColor: COLORS.primarySoft, alignItems: 'center', justifyContent: 'center' },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  input: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 15,
    color: COLORS.text,
    backgroundColor: '#fff',
  },
});
