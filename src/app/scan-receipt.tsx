import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';

import { AlertBanner, Button, Card, EmptyState, Loading, Screen, SectionHeader } from '@/components';
import { colors, fontSize, fontWeight, layout, radius, spacing } from '@/constants/theme';
import { useAsync } from '@/hooks/use-async';
import { useLayout } from '@/hooks/use-layout';
import { getCards, scanReceipt } from '@/lib/api';
import { formatLongDate, formatShortDate } from '@/lib/dates';
import { formatMoney, maskCard } from '@/lib/format';
import type { ReceiptScan } from '@/types';

type Photo = { uri: string; width: number; height: number; name: string };
const isWeb = Platform.OS === 'web';

export default function ScanReceipt() {
  const { isWide } = useLayout();
  const cards = useAsync(getCards);
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [result, setResult] = useState<ReceiptScan | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function capture(source: 'camera' | 'library') {
    setError(null);
    const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.7 };
    let res: ImagePicker.ImagePickerResult;
    if (source === 'camera') {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        setError('Camera access was denied. You can allow it in Settings, or choose a photo instead.');
        return;
      }
      res = await ImagePicker.launchCameraAsync(options);
    } else {
      res = await ImagePicker.launchImageLibraryAsync(options);
    }
    if (res.canceled) return;

    const a = res.assets[0];
    const picked = { uri: a.uri, width: a.width || 3, height: a.height || 4, name: a.fileName ?? 'receipt.jpg' };
    setPhoto(picked);
    setResult(null);
    setResult(await scanReceipt({ name: picked.name, uri: picked.uri, mimeType: a.mimeType }));
  }

  if (!photo) {
    return (
      <Screen edges={['bottom']}>
        <EmptyState
          icon="camera-outline"
          title="Scan a receipt"
          message="We'll read the merchant, date, total and tax, then match it to a transaction in your ledger."
        />
        <View style={styles.pickers}>
          {isWeb ? (
            <Button label="Choose image" icon="image-outline" onPress={() => capture('library')} />
          ) : (
            <>
              <Button label="Take photo" icon="camera-outline" onPress={() => capture('camera')} />
              <Button label="Choose from library" icon="image-outline" variant="secondary" onPress={() => capture('library')} />
            </>
          )}
        </View>
        {error && <AlertBanner tone="danger" title={error} />}
      </Screen>
    );
  }

  const match = result?.matchedTransaction;
  const matchCard = cards.data?.find((c) => c.id === match?.cardId);

  return (
    <Screen edges={['bottom']}>
      <View style={[styles.layout, isWide && styles.layoutWide]}>
        <View style={[styles.imageWrap, isWide && styles.half]}>
          <Image
            source={{ uri: photo.uri }}
            style={[styles.image, { aspectRatio: photo.width / photo.height }]}
            contentFit="contain"
            accessibilityLabel="Receipt photo"
          />
        </View>

        <View style={[styles.details, isWide && styles.half]}>
          {!result ? (
            <Card>
              <SectionHeader title="Reading receipt…" />
              <Loading />
            </Card>
          ) : (
            <>
              <Card>
                <SectionHeader title="Extracted" />
                <Row label="Merchant" value={result.merchant} />
                <Row label="Date" value={formatLongDate(result.date)} />
                <Row label="Subtotal" value={formatMoney(result.subtotal, result.currency)} />
                <Row label={`Tax (${result.taxLabel})`} value={formatMoney(result.tax, result.currency)} />
                <View style={styles.divider} />
                <Row label="Total" value={formatMoney(result.total, result.currency)} strong />
              </Card>

              {match ? (
                <AlertBanner
                  tone="success"
                  title="Already recorded ✓"
                  message={
                    `Matches ${match.merchant} on ${formatShortDate(match.date)} for ${formatMoney(match.amount, match.currency)}` +
                    `${matchCard ? ` on ${matchCard.nickname} ${maskCard(matchCard.last4)}` : ''}. Nothing new to add.`
                  }
                  actions={[{ label: 'View transaction', onPress: () => router.push(`/transaction/${match.id}`) }]}
                />
              ) : (
                <AlertBanner tone="info" title="No matching transaction yet" message="We'll match it when the statement arrives." />
              )}

              <View style={styles.actions}>
                <Button label="Scan another" variant="secondary" onPress={() => setPhoto(null)} />
                <Button label="Done" onPress={() => router.back()} />
              </View>
            </>
          )}
        </View>
      </View>
    </Screen>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={[styles.label, strong && styles.strongLabel]}>{label}</Text>
      <Text style={[styles.value, strong && styles.strongValue]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pickers: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: spacing.md },
  layout: { gap: spacing.lg },
  layoutWide: { flexDirection: 'row', alignItems: 'flex-start' },
  half: { flex: 1 },
  imageWrap: {
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: spacing.sm,
  },
  image: { width: '100%', maxHeight: layout.receiptMaxHeight, borderRadius: radius.md },
  details: { gap: spacing.lg },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.lg },
  label: { fontSize: fontSize.sm, color: colors.muted },
  value: { flexShrink: 1, textAlign: 'right', fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.text },
  strongLabel: { fontSize: fontSize.md, color: colors.text, fontWeight: fontWeight.semibold },
  strongValue: { fontSize: fontSize.lg, fontWeight: fontWeight.bold },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', flexWrap: 'wrap', gap: spacing.md },
});
