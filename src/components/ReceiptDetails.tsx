import { Image } from 'expo-image';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { borderWidth, colors, layout, radius, spacing, typography } from '@/constants/theme';
import { formatShortDate } from '@/lib/dates';
import { formatMoney, maskCard } from '@/lib/format';
import type { Receipt } from '@/types';

import { AlertBanner } from './AlertBanner';
import { Button } from './Button';
import { Card } from './Card';
import { DetailRow } from './DetailRow';
import { Divider } from './Divider';
import { SectionHeader } from './SectionHeader';

type Props = {
  receipt: Receipt;
  /** Shows "Remove receipt", with a confirmation step; throw to show the error. */
  onRemove?: () => Promise<void>;
};

/** A saved receipt on its transaction: the photo and what was read from it. */
export function ReceiptDetails({ receipt, onRemove }: Props) {
  const [aspect, setAspect] = useState(3 / 4); // until the photo says otherwise
  const [confirming, setConfirming] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const money = (n: number) => formatMoney(n, receipt.currency);

  async function remove() {
    if (!onRemove) return;
    setRemoving(true);
    setError(null);
    try {
      await onRemove();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't remove it. Try again.");
      setRemoving(false);
    }
  }

  return (
    <Card>
      <SectionHeader title="Receipt" subtitle={`Scanned ${formatShortDate(receipt.scannedAt.slice(0, 10))}`} />
      {receipt.imageDataUrl && (
        <View style={styles.imageWrap}>
          <Image
            source={{ uri: receipt.imageDataUrl }}
            style={[styles.image, { aspectRatio: aspect }]}
            contentFit="contain"
            onLoad={(e) => {
              if (e.source.width && e.source.height) setAspect(e.source.width / e.source.height);
            }}
            accessibilityLabel={`Receipt from ${receipt.merchant}`}
          />
        </View>
      )}

      <DetailRow label="Merchant" value={receipt.merchant} />
      <DetailRow label="Date" value={receipt.date ? formatShortDate(receipt.date) : 'Not printed'} />
      {receipt.subtotal !== null && <DetailRow label="Subtotal" value={money(receipt.subtotal)} />}
      {receipt.tax !== null && <DetailRow label={receipt.taxLabel ? `Tax (${receipt.taxLabel})` : 'Tax'} value={money(receipt.tax)} />}
      <DetailRow label="Total" value={money(receipt.total)} strong />
      <DetailRow label="Paid with" value={receipt.cardLast4 ? `Card ${maskCard(receipt.cardLast4)}` : 'Not shown'} />

      {receipt.items.length > 0 && (
        <>
          <Divider />
          <Text style={styles.overline}>Items</Text>
          {receipt.items.map((item, i) => (
            <DetailRow key={i} label={item.description} value={money(item.amount)} />
          ))}
        </>
      )}

      {onRemove && (
        <>
          <Divider />
          {confirming ? (
            <View style={styles.confirm}>
              <Text style={styles.muted}>Remove the receipt photo and its details? The transaction stays.</Text>
              <View style={styles.actions}>
                <Button label="Yes, remove" icon="trash-outline" variant="danger" size="sm" onPress={remove} loading={removing} />
                <Button label="Keep it" variant="secondary" size="sm" onPress={() => setConfirming(false)} disabled={removing} />
              </View>
            </View>
          ) : (
            <Button
              label="Remove receipt"
              icon="trash-outline"
              variant="ghost"
              size="sm"
              style={styles.start}
              onPress={() => setConfirming(true)}
            />
          )}
          {error && <AlertBanner tone="danger" title={error} />}
        </>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  imageWrap: {
    alignItems: 'center',
    backgroundColor: colors.bg,
    borderRadius: radius.md,
    borderWidth: borderWidth.hairline,
    borderColor: colors.border,
    padding: spacing.sm,
  },
  image: { width: '100%', maxHeight: layout.receiptMaxHeight, borderRadius: radius.sm },
  overline: typography.overline,
  muted: typography.muted,
  confirm: { gap: spacing.sm },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  start: { alignSelf: 'flex-start' },
});
