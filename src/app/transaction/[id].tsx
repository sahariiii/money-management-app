import Ionicons from '@expo/vector-icons/Ionicons';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import {
  AlertBanner,
  Button,
  Card,
  CategoryBadge,
  Chip,
  DetailRow,
  Divider,
  EmptyState,
  Loading,
  Screen,
  SectionHeader,
} from '@/components';
import { colors, fontFamily, fontSize, fontWeight, radius, spacing, typography } from '@/constants/theme';
import { useAsync } from '@/hooks/use-async';
import { getCards, getTransaction, updateCategory } from '@/lib/api';
import { formatShortDate } from '@/lib/dates';
import { formatMoney, maskCard } from '@/lib/format';
import { CATEGORIES, type Category } from '@/types';

export default function TransactionDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const tx = useAsync(() => getTransaction(id), id);
  const cards = useAsync(getCards);

  const [pending, setPending] = useState<Category | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  if (tx.loading && !tx.data) {
    return (
      <Screen edges={['bottom']} width="narrow">
        <Loading />
      </Screen>
    );
  }

  const t = tx.data;
  if (!t) {
    return (
      <Screen edges={['bottom']} width="narrow">
        <EmptyState icon="help-circle-outline" title="Transaction not found" message={`No transaction with id ${id}.`} />
      </Screen>
    );
  }

  const card = cards.data?.find((c) => c.id === t.cardId);
  const cardLabel = card ? `${card.nickname} ${maskCard(card.last4)}` : cards.data ? 'Unknown card' : '…';
  const options = t.isIncome ? CATEGORIES : CATEGORIES.filter((c) => c !== 'Income');

  const pick = (c: Category) => {
    setNotice(null);
    setPending(c === t.category || c === pending ? null : c);
  };

  const save = async (always: boolean) => {
    if (!pending) return;
    setSaving(true);
    try {
      const res = await updateCategory(t.id, pending, always);
      tx.setData(res.transaction);
      setNotice(
        always
          ? `Done. ${res.affectedCount} ${t.merchant} transaction${res.affectedCount === 1 ? '' : 's'} now say ${pending}, and future ones will too.`
          : `Changed to ${pending} for this transaction only.`,
      );
      setPending(null);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen edges={['bottom']} width="narrow">
      <View style={styles.hero}>
        <CategoryBadge category={t.category} size="lg" />
        <Text style={styles.merchant}>{t.merchant}</Text>
        <Text style={[styles.amount, { color: t.isIncome ? colors.income : colors.expense }]}>
          {t.isIncome ? '+' : '−'}
          {formatMoney(t.amount, t.currency)}
        </Text>
        <Text style={styles.muted}>{formatShortDate(t.date)}</Text>
      </View>

      <Card>
        <SectionHeader title="Details" />
        <View style={styles.cleanup}>
          <Text style={styles.muted}>From your bank</Text>
          <Text style={styles.raw} selectable>
            {t.rawDescription}
          </Text>
          <View style={styles.cleanupArrow}>
            <Ionicons name="arrow-down" size={fontSize.md} color={colors.muted} />
            <Text style={styles.caption}>cleaned up</Text>
          </View>
          <Text style={styles.muted}>Merchant</Text>
          <Text style={styles.cleaned}>{t.merchant}</Text>
        </View>
        <Divider />
        <DetailRow label="Amount" value={`${formatMoney(t.amount, t.currency)} ${t.currency}`} />
        <DetailRow label="Card" value={cardLabel} />
        <DetailRow label="Date" value={formatShortDate(t.date)} />
        <DetailRow label="Category" value={t.category} />
      </Card>

      <Card>
        <SectionHeader title="Category" subtitle="Wrong category? Pick the right one." />
        <View style={styles.chips}>
          {options.map((c) => (
            <Chip key={c} label={c} selected={(pending ?? t.category) === c} onPress={() => pick(c)} />
          ))}
        </View>

        {pending && (
          <View style={styles.confirm}>
            <Text style={styles.confirmText}>
              Always categorize <Text style={styles.bold}>{t.merchant}</Text> as{' '}
              <Text style={styles.bold}>{pending}</Text>?
            </Text>
            <View style={styles.confirmActions}>
              <Button label="Yes" onPress={() => save(true)} loading={saving} size="sm" />
              <Button label="Just this once" variant="secondary" onPress={() => save(false)} disabled={saving} size="sm" />
            </View>
          </View>
        )}

        {notice && <AlertBanner tone="success" title={notice} />}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.md },
  merchant: { ...typography.heading, marginTop: spacing.sm, textAlign: 'center' },
  amount: typography.amount,
  muted: typography.muted,
  caption: typography.caption,
  cleanup: { gap: spacing.xs },
  cleanupArrow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.xs },
  raw: {
    fontFamily: fontFamily.mono,
    fontSize: fontSize.sm,
    color: colors.text,
    backgroundColor: colors.bg,
    borderRadius: radius.sm,
    padding: spacing.sm,
    alignSelf: 'flex-start',
    maxWidth: '100%',
  },
  cleaned: typography.subheading,
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  confirm: { gap: spacing.md, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.primarySoft },
  confirmText: typography.body,
  bold: { fontWeight: fontWeight.bold },
  confirmActions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
