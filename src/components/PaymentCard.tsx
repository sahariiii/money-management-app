import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, Text, View } from 'react-native';

import {
  cardGradients,
  colors,
  fontFamily,
  fontSize,
  fontWeight,
  layout,
  letterSpacing,
  radius,
  spacing,
  typography,
} from '@/constants/theme';
import { formatMoney, maskCard } from '@/lib/format';
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
          <Text style={styles.institution} numberOfLines={1}>
            {card.institution} · {card.type === 'credit' ? 'Credit' : 'Debit'}
          </Text>
        </View>
        <Ionicons name={card.type === 'credit' ? 'card' : 'wallet'} size={layout.iconSize + spacing.xxs} color={colors.onPrimary} />
      </View>

      <Text style={styles.number}>{maskCard(card.last4)}</Text>

      <View style={styles.bottom}>
        <Text style={styles.meta}>{card.annualFee > 0 ? `${formatMoney(card.annualFee)}/yr fee` : 'No annual fee'}</Text>
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
  nickname: { ...typography.heading, color: colors.onPrimary },
  institution: { ...typography.small, color: colors.onPrimary, opacity: 0.8 },
  number: {
    fontFamily: fontFamily.mono,
    fontSize: fontSize.xl,
    letterSpacing: letterSpacing.card,
    color: colors.onPrimary,
  },
  bottom: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
  meta: { ...typography.small, fontWeight: fontWeight.medium, color: colors.onPrimary, opacity: 0.9 },
});
