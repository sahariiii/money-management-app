import { StyleSheet, View } from 'react-native';

import { borderWidth, colors } from '@/constants/theme';

/** Hairline separator. `inset` indents it from the left, e.g. past a row's icon. */
export function Divider({ inset = 0 }: { inset?: number }) {
  return <View style={[styles.line, { marginLeft: inset }]} />;
}

const styles = StyleSheet.create({
  line: { height: borderWidth.hairline, backgroundColor: colors.border },
});
