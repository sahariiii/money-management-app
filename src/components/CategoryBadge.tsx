import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, View } from 'react-native';

import { borderWidth, colors, layout, radius, spacing } from '@/constants/theme';
import { categoryColor, categoryIcon } from '@/lib/categories';
import type { Category } from '@/types';

type Props = { category: Category; size?: 'md' | 'lg' };

/** Category icon in a square outlined with the category's color. */
export function CategoryBadge({ category, size = 'md' }: Props) {
  const large = size === 'lg';
  const tint = categoryColor(category);
  return (
    <View style={[styles.badge, large && styles.large, { borderColor: tint }]}>
      <Ionicons name={categoryIcon(category)} size={large ? layout.iconSize + spacing.xs : layout.iconSize - spacing.xs} color={tint} />
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    width: layout.avatarSize,
    height: layout.avatarSize,
    borderRadius: radius.md,
    borderWidth: borderWidth.thick,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  large: {
    width: layout.avatarSize + spacing.lg,
    height: layout.avatarSize + spacing.lg,
    borderRadius: radius.lg,
  },
});
