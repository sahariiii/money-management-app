import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, Text, View } from 'react-native';

import { cardGradients, colors, fontFamily, fontSize, fontWeight, layout, radius, spacing } from '@/constants/theme';
import { formatMoneyWhole, maskCard } from '@/lib/format';
import type { Card } from '@/types';

/** A card styled like a physical payment card. Shows last 4 digits only. */
export function PaymentCard({ card }: { card: Card }) {
  return (
    <LinearGradient
      colors={cardGradients[card.type]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.card}>
      <View style={styles.top}>
        <View style={styles.titles}>
          <Text style={styles.nickname} numberOfLines={1}>
            {card.nickname}
          </Text>
          <Text style={styles.institution}>
            {card.institution} · {card.type === 'credit' ? 'Credit' : 'Debit'}
          </Text>
        </View>
        <Ionicons name={card.type === 'credit' ? 'card' : 'wallet'} size={layout.iconSize + 2} color={colors.onPrimary} />
      </View>

      <Text style={styles.number}>{maskCard(card.last4)}</Text>

      <View style={styles.bottom}>
        <Text style={styles.meta}>
          {card.annualFee > 0 ? `${formatMoneyWhole(card.annualFee)}/yr fee` : 'No annual fee'}
        </Text>
        {card.interestRate > 0 && <Text style={styles.meta}>{card.interestRate}% APR</Text>}
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  card: {
    width: '100%',
    aspectRatio: layout.cardAspectRatio,
    borderRadius: radius.xl,
    padding: spacing.xl,
    justifyContent: 'space-between',
  },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: spacing.md },
  titles: { flex: 1, gap: spacing.xxs },
  nickname: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.onPrimary },
  institution: { fontSize: fontSize.sm, color: colors.onPrimary, opacity: 0.8 },
  number: {
    fontFamily: fontFamily.mono,
    fontSize: fontSize.xl,
    letterSpacing: 2,
    color: colors.onPrimary,
  },
  bottom: { flexDirection: 'row', justifyContent: 'space-between' },
  meta: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.onPrimary, opacity: 0.9 },
});
