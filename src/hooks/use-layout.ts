import { useWindowDimensions } from 'react-native';

import { layout, spacing } from '@/constants/theme';

/** Responsive helpers shared by screens. Matches Screen's padding and max width. */
export function useLayout() {
  const { width } = useWindowDimensions();
  const contentWidth = Math.min(width, layout.maxContentWidth) - spacing.lg * 2;
  return { isWide: width >= layout.wideBreakpoint, contentWidth };
}
