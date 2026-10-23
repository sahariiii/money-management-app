import Ionicons from '@expo/vector-icons/Ionicons';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { AlertBanner, Button, Card, Chip, EmptyState, Loading, Screen, SectionHeader } from '@/components';
import { colors, fontFamily, fontSize, fontWeight, layout, radius, spacing } from '@/constants/theme';
import { useAsync } from '@/hooks/use-async';
import { getCards, getTransaction, updateCategory } from '@/lib/api';
import { categoryColor, categoryIcon } from '@/lib/categories';
import { formatLongDate } from '@/lib/dates';
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
      <Screen edges={['bottom']}>
        <Loading />
      </Screen>
    );
  }

  const t = tx.data;
  if (!t) {
    return (
      <Screen edges={['bottom']}>
        <EmptyState icon="help-circle-outline" title="Transaction not found" message={`No transaction with id ${id}.`} />
      </Screen>
    );
  }

  const card = cards.data?.find((c) => c.id === t.cardId);
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
    <Screen edges={['bottom']}>
      <View style={styles.hero}>
        <View style={[styles.heroIcon, { borderColor: categoryColor(t.category) }]}>
          <Ionicons name={categoryIcon(t.category)} size={layout.iconSize + 6} color={categoryColor(t.category)} />
        </View>
        <Text style={styles.merchant}>{t.merchant}</Text>
        <Text style={[styles.amount, { color: t.isIncome ? colors.income : colors.expense }]}>
          {t.isIncome ? '+' : '−'}
          {formatMoney(t.amount, t.currency)}
        </Text>
        <Text style={styles.muted}>{formatLongDate(t.date)}</Text>
      </View>

      <Card>
        <SectionHeader title="Details" />
        <View style={styles.cleanup}>
          <Text style={styles.label}>From your bank</Text>
          <Text style={styles.raw} selectable>
            {t.rawDescription}
          </Text>
          <View style={styles.cleanupArrow}>
            <Ionicons name="arrow-down" size={fontSize.md} color={colors.muted} />
            <Text style={styles.muted}>cleaned up</Text>
          </View>
          <Text style={styles.label}>Merchant</Text>
          <Text style={styles.cleaned}>{t.merchant}</Text>
        </View>
        <View style={styles.divider} />
        <DetailRow label="Amount" value={`${formatMoney(t.amount, t.currency)} ${t.currency}`} />
        <DetailRow label="Card" value={card ? `${card.nickname} ${maskCard(card.last4)}` : '—'} />
        <DetailRow label="Date" value={formatLongDate(t.date)} />
        <DetailRow label="Category" value={t.category} />
      </Card>

      <Card>
        <SectionHeader title="Category" />
        <Text style={styles.muted}>Wrong category? Pick the right one.</Text>
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

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.md },
  heroIcon: {
    width: layout.avatarSize + spacing.lg,
    height: layout.avatarSize + spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 2,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  merchant: { fontSize: fontSize.lg, fontWeight: fontWeight.semibold, color: colors.text },
  amount: { fontSize: fontSize.display, fontWeight: fontWeight.bold },
  muted: { fontSize: fontSize.sm, color: colors.muted },
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
  },
  cleaned: { fontSize: fontSize.md, fontWeight: fontWeight.semibold, color: colors.text },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.lg },
  label: { fontSize: fontSize.sm, color: colors.muted },
  value: { flexShrink: 1, textAlign: 'right', fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.text },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  confirm: {
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.primarySoft,
  },
  confirmText: { fontSize: fontSize.md, color: colors.text },
  bold: { fontWeight: fontWeight.bold },
  confirmActions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
