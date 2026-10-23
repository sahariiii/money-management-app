import { useEffect, useState } from 'react';
import { Animated, Platform, StyleSheet, View } from 'react-native';

import { colors, radius, spacing } from '@/constants/theme';

const DOT = spacing.sm;

/** Three pulsing dots shown while the assistant is "thinking". */
export function TypingDots() {
  const [values] = useState(() => [0, 1, 2].map(() => new Animated.Value(0.3)));

  useEffect(() => {
    const useNativeDriver = Platform.OS !== 'web';
    const loops = values.map((v, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 150),
          Animated.timing(v, { toValue: 1, duration: 300, useNativeDriver }),
          Animated.timing(v, { toValue: 0.3, duration: 300, useNativeDriver }),
          Animated.delay((2 - i) * 150),
        ]),
      ),
    );
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, [values]);

  return (
    <View style={styles.row} accessibilityLabel="Assistant is typing">
      {values.map((v, i) => (
        <Animated.View key={i} style={[styles.dot, { opacity: v }]} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.xs, paddingVertical: spacing.xs },
  dot: { width: DOT, height: DOT, borderRadius: radius.pill, backgroundColor: colors.muted },
});
