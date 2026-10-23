import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { colors, spacing } from '@/constants/theme';

/** Spinner inside a card or list. `fullScreen` fills the screen, e.g. while auth loads. */
export function Loading({ fullScreen = false }: { fullScreen?: boolean }) {
  return (
    <View style={[styles.wrap, fullScreen && styles.fullScreen]}>
      <ActivityIndicator color={colors.primary} size={fullScreen ? 'large' : 'small'} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingVertical: spacing.xxl, alignItems: 'center', justifyContent: 'center' },
  fullScreen: { flex: 1, backgroundColor: colors.bg },
});
