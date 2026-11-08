import * as ImagePicker from 'expo-image-picker';
import { ActivityIndicator, Image, Linking, Platform, StyleSheet, Text, View } from 'react-native';
import { PressScale } from '@/components/motion';
import { Button } from '@/components/ui';
import { COLORS, showError } from '@/format';
import { t } from '@/i18n';

/** Take a photo or pick one from the library; resolves to null when cancelled or not allowed. */
export async function pickPhoto(source: 'camera' | 'library'): Promise<ImagePicker.ImagePickerAsset | null> {
  let r: ImagePicker.ImagePickerResult;
  if (source === 'camera') {
    // On web the camera must open straight from the tap, so there is no permission round-trip first.
    if (Platform.OS !== 'web' && !(await ImagePicker.requestCameraPermissionsAsync()).granted) {
      showError(new Error(t('photo.cameraDenied')));
      return null;
    }
    r = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.8 });
  } else {
    r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
  }
  return !r.canceled && r.assets?.[0] ? r.assets[0] : null;
}

/**
 * A photo slot: shows the picked or saved picture (tap to open it full size) with change/remove,
 * or camera + library buttons when empty. `busy` shows that the picture is being read.
 */
export function PhotoField({ uri, onPick, onRemove, busy, emptyLabel }: {
  uri: string | null;
  onPick: (a: ImagePicker.ImagePickerAsset) => void;
  onRemove: () => void;
  busy?: boolean;
  emptyLabel: string; // e.g. "ถ่ายบิล"
}) {
  const pick = async (source: 'camera' | 'library') => {
    const a = await pickPhoto(source);
    if (a) onPick(a);
  };
  if (!uri)
    return (
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Button title={emptyLabel} icon="📷" variant="soft" style={{ flex: 1 }} onPress={() => pick('camera')} />
        <Button title={t('photo.pick')} icon="🖼️" variant="soft" style={{ flex: 1 }} onPress={() => pick('library')} />
      </View>
    );
  return (
    <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
      <PressScale onPress={() => Linking.openURL(uri).catch(() => {})} accessibilityLabel={t('photo.viewFull')}>
        <Image source={{ uri }} style={styles.preview} />
        {busy && (
          <View style={styles.busy}>
            <ActivityIndicator color="#fff" />
          </View>
        )}
      </PressScale>
      <View style={{ gap: 8, flex: 1 }}>
        {busy && <Text style={styles.hint}>{t('photo.reading')}</Text>}
        <Button title={t('photo.retake')} icon="📷" variant="soft" small onPress={() => pick('camera')} />
        <Button title={t('photo.pickOther')} icon="🖼️" variant="soft" small onPress={() => pick('library')} />
        <Button title={t('photo.remove')} variant="outline" small onPress={onRemove} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  preview: { width: 90, height: 130, borderRadius: 10, backgroundColor: COLORS.subtle },
  busy: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: 10, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center' },
  hint: { color: COLORS.muted, fontSize: 12 },
});
