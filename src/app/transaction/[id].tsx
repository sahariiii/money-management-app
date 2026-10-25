import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';
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
  ReceiptDetails,
  SectionHeader,
  useToast,
} from '@/components';
import { colors, fontFamily, fontSize, fontWeight, radius, spacing, typography } from '@/constants/theme';
import { useAsync } from '@/hooks/use-async';
import { ApiError, deleteReceipt, deleteTransaction, getCards, getReceipt, getTransaction, updateCategory } from '@/lib/api';
import { formatShortDate } from '@/lib/dates';
import { formatMoney, maskCard } from '@/lib/format';
import { CASH_CARD_ID, EXPENSE_CATEGORIES, INCOME_CATEGORIES, type Category } from '@/types';

export default function TransactionDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const tx = useAsync(() => getTransaction(id), id);
  const cards = useAsync(getCards);
  const receiptId = tx.data?.receiptId ?? null;
  const receipt = useAsync(() => (receiptId ? getReceipt(receiptId) : Promise.resolve(null)), receiptId ?? '');

  const [pending, setPending] = useState<Category | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const toast = useToast();

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
  const cardLabel = card
    ? `${card.nickname} ${maskCard(card.last4)}`
    : t.cardId === CASH_CARD_ID
      ? 'Cash / other'
      : cards.data
        ? 'Unknown card'
        : '…';
  const fromReceipt = t.source === 'receipt';

  const remove = async () => {
    setDeleting(true);
    try {
      await deleteTransaction(t.id);
      toast('Expense deleted');
      router.back();
    } catch (e) {
      setNotice(null);
      setDeleteError(e instanceof Error ? e.message : "Couldn't delete it. Try again.");
      setDeleting(false);
    }
  };
  // Money in can be income or a refund, which keeps a spending category; money out is spending.
  const options: readonly Category[] = t.isIncome ? [...INCOME_CATEGORIES, ...EXPENSE_CATEGORIES] : EXPENSE_CATEGORIES;

  const pick = (c: Category) => {
    setNotice(null);
    setPending(c === t.category || c === pending ? null : c);
  };

  const save = async (always: boolean) => {
    if (!pending) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await updateCategory(t.id, pending, always);
      tx.setData(res.transaction);
      setNotice(
        always
          ? `Done. ${res.affectedCount} ${t.merchant} transaction${res.affectedCount === 1 ? '' : 's'} now say ${pending}, and future ones will too.`
          : `Changed to ${pending} for this transaction only.`,
      );
      setPending(null);
    } catch (e) {
      // e.g. a backend started before this category existed answers 422.
      const status = e instanceof ApiError ? e.status : 0;
      setSaveError(
        status === 422
          ? `The server doesn't accept "${pending}" yet. Restart the backend and try again.`
          : e instanceof Error
            ? e.message
            : "Couldn't change the category. Try again.",
      );
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
        {fromReceipt ? (
          <Text style={styles.muted}>
            Added from a scanned receipt. When this purchase shows up on a statement, it&apos;s linked to it instead of
            counted twice.
          </Text>
        ) : (
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
        )}
        <Divider />
        <DetailRow label="Amount" value={`${formatMoney(t.amount, t.currency)} ${t.currency}`} />
        <DetailRow label="Card" value={cardLabel} />
        <DetailRow label="Date" value={formatShortDate(t.date)} />
        <DetailRow label="Category" value={t.category} />
      </Card>

      {receiptId &&
        (receipt.data ? (
          <ReceiptDetails
            receipt={receipt.data}
            onRemove={async () => {
              await deleteReceipt(receipt.data!.id);
              tx.setData({ ...t, receiptId: null });
              toast('Receipt removed');
            }}
          />
        ) : receipt.loading ? (
          <Card>
            <SectionHeader title="Receipt" />
            <Loading />
          </Card>
        ) : null)}

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
        {saveError && <AlertBanner tone="danger" title={saveError} />}
      </Card>

      {fromReceipt && (
        <Card>
          <SectionHeader title="Delete expense" />
          {confirmingDelete ? (
            <>
              <Text style={styles.muted}>Delete this expense? This can&apos;t be undone.</Text>
              <View style={styles.confirmActions}>
                <Button label="Yes, delete" icon="trash-outline" variant="danger" size="sm" onPress={remove} loading={deleting} />
                <Button label="Keep it" variant="secondary" size="sm" onPress={() => setConfirmingDelete(false)} disabled={deleting} />
              </View>
            </>
          ) : (
            <Button
              label="Delete expense"
              icon="trash-outline"
              variant="danger"
              size="sm"
              style={styles.start}
              onPress={() => setConfirmingDelete(true)}
            />
          )}
          {deleteError && <AlertBanner tone="danger" title={deleteError} />}
        </Card>
      )}
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
  start: { alignSelf: 'flex-start' },
});
