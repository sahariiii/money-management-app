import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, View, type ViewStyle } from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';

import { colors, layout, spacing } from '@/constants/theme';

type Props = {
  children: ReactNode;
  /** Set false for screens that manage their own scrolling (e.g. chat lists). */
  scroll?: boolean;
  /** Safe-area edges to pad. Screens under a header usually need none. */
  edges?: Edge[];
  /** 'narrow' caps the column for forms, detail pages and chat on wide screens. */
  width?: 'default' | 'narrow';
  contentStyle?: ViewStyle;
};

/** Full-screen background with a centered, max-width content column. */
export function Screen({ children, scroll = true, edges = [], width = 'default', contentStyle }: Props) {
  const maxWidth = width === 'narrow' ? layout.narrowContentWidth : layout.maxContentWidth;
  const inner = <View style={[styles.content, { maxWidth }, contentStyle]}>{children}</View>;

  return (
    <SafeAreaView style={styles.root} edges={edges}>
      {scroll ? (
        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
          {inner}
        </ScrollView>
      ) : (
        <View style={styles.fill}>{inner}</View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  fill: { flex: 1 },
  scrollContent: { flexGrow: 1 },
  content: {
    flexGrow: 1,
    width: '100%',
    alignSelf: 'center',
    padding: spacing.lg,
    gap: spacing.lg,
  },
});
