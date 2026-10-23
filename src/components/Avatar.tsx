import { StyleSheet, Text, View } from 'react-native';

import { colors, layout, typography } from '@/constants/theme';

/** Up to two initials from a name, or the first letter of an email. */
function initials(name: string) {
  const words = name.split(/[\s@._-]+/).filter(Boolean);
  const letters = name.includes('@') ? words.slice(0, 1) : words.slice(0, 2);
  return letters.map((w) => w[0].toUpperCase()).join('') || '?';
}

/** Round initials badge for the signed-in user. */
export function Avatar({ name, size = layout.avatarSize }: { name: string; size?: number }) {
  return (
    <View style={[styles.circle, { width: size, height: size, borderRadius: size / 2 }]} accessibilityElementsHidden>
      <Text style={[styles.text, { fontSize: size * 0.4 }]}>{initials(name)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  circle: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primarySoft },
  text: { ...typography.label, color: colors.primary },
});
