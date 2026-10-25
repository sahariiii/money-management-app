import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';

import {
  AlertBanner,
  Button,
  Card,
  Chip,
  DetailRow,
  Divider,
  EmptyState,
  Loading,
  Screen,
  SectionHeader,
  TextField,
} from '@/components';
import { borderWidth, colors, layout, radius, spacing, typography } from '@/constants/theme';
import { useAsync } from '@/hooks/use-async';
import { useLayout } from '@/hooks/use-layout';
import { addExpense, ApiError, attachReceipt, getCards, scanReceipt, today } from '@/lib/api';
import { formatShortDate, isISODate } from '@/lib/dates';
import { formatMoney, maskCard } from '@/lib/format';
import {
  CASH_CARD_ID,
  EXPENSE_CATEGORIES,
  type Card as CardType,
  type Category,
  type PickedFile,
  type ReceiptScan,
  type Transaction,
} from '@/types';

type Photo = PickedFile & { width: number; height: number };
const isWeb = Platform.OS === 'web';

const errorMessage = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

/** Saves an unmatched receipt as an expense, starting from what was read. */
function AddExpense({ scan, cards, onAdded }: { scan: ReceiptScan; cards: CardType[]; onAdded: (t: Transaction) => void }) {
  const { isWide } = useLayout();
  const [merchant, setMerchant] = useState(scan.merchant);
  const [date, setDate] = useState(scan.date ?? today());
  const [amount, setAmount] = useState(scan.total.toFixed(2));
  const [category, setCategory] = useState<Category>(scan.category);
  const [cardId, setCardId] = useState(scan.cardId ?? CASH_CARD_ID);
  const [errors, setErrors] = useState<Partial<Record<'merchant' | 'date' | 'amount', string>>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  async function save() {
    const value = Number(amount.replace(',', '.'));
    const e: typeof errors = {};
    if (!merchant.trim()) e.merchant = 'Where was it bought?';
    if (!isISODate(date)) e.date = 'Use YYYY-MM-DD, e.g. 2026-10-23.';
    if (!(value > 0)) e.amount = 'Enter the amount paid.';
    setErrors(e);
    if (Object.keys(e).length) return;

    setSaving(true);
    setSaveError(null);
    try {
      onAdded(
        await addExpense({
          merchant: merchant.trim(),
          date,
          amount: value,
          currency: scan.currency,
          category,
          cardId,
          receiptId: scan.receiptId ?? undefined,
        }),
      );
    } catch (err) {
      setSaveError(errorMessage(err, "Couldn't save it. Try again."));
    } finally {
      setSaving(false);
    }
  }

  const pair = [styles.pair, isWide && styles.pairWide];
  const half = isWide ? styles.flex : undefined;
  const unknownCard = scan.cardLast4 && !scan.cardId;

  return (
    <Card>
      <SectionHeader title="Add as expense" subtitle="Not in your activity yet. Check the details, then save it." />
      <TextField label="Merchant" value={merchant} onChangeText={setMerchant} error={errors.merchant} />
      <View style={pair}>
        <TextField style={half} label="Date" placeholder="YYYY-MM-DD" value={date} onChangeText={setDate} error={errors.date} />
        <TextField
          style={half}
          label="Amount"
          prefix="$"
          value={amount}
          onChangeText={setAmount}
          keyboardType="decimal-pad"
          error={errors.amount}
        />
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>Category</Text>
        <View style={styles.chips}>
          {EXPENSE_CATEGORIES.map((c) => (
            <Chip key={c} label={c} selected={category === c} onPress={() => setCategory(c)} />
          ))}
        </View>
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>Paid with</Text>
        <View style={styles.chips}>
          {cards.map((c) => (
            <Chip key={c.id} label={`${c.nickname} ${maskCard(c.last4)}`} selected={cardId === c.id} onPress={() => setCardId(c.id)} />
          ))}
          <Chip label="Cash / other" selected={cardId === CASH_CARD_ID} onPress={() => setCardId(CASH_CARD_ID)} />
        </View>
        {unknownCard && (
          <Text style={styles.muted}>
            The receipt says card {maskCard(scan.cardLast4!)}, which isn&apos;t one of your cards. Add it in Cards to track it.
          </Text>
        )}
      </View>

      {saveError && <AlertBanner tone="danger" title={saveError} />}
      <Button label="Add expense" icon="add" onPress={save} loading={saving} style={styles.end} />
    </Card>
  );
}

export default function ScanReceipt() {
  const { isWide } = useLayout();
  const cards = useAsync(getCards);
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [result, setResult] = useState<ReceiptScan | null>(null);
  const [added, setAdded] = useState<Transaction | null>(null);
  const [attached, setAttached] = useState(false);
  const [attaching, setAttaching] = useState(false);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);

  async function attach(receiptId: string, transactionId: string) {
    if (attaching) return;
    setAttaching(true);
    setAttachError(null);
    try {
      await attachReceipt(receiptId, transactionId);
      setAttached(true);
    } catch (e) {
      setAttachError(errorMessage(e, "Couldn't save the receipt. Try again."));
    } finally {
      setAttaching(false);
    }
  }

  async function read(picked: Photo) {
    setResult(null);
    setAdded(null);
    setAttached(false);
    setAttachError(null);
    setScanError(null);
    try {
      setResult(await scanReceipt(picked));
    } catch (e) {
      // The backend's own errors are ApiErrors; anything else failed before it answered.
      if (!(e instanceof ApiError)) console.warn('[scan-receipt] sending the photo failed', e);
      const reason = e instanceof Error ? e.message : String(e);
      setScanError(errorMessage(e, `Couldn't send the photo (${reason}). Check your connection and try again.`));
    }
  }

  async function openPicked(res: ImagePicker.ImagePickerResult) {
    const a = res.canceled ? undefined : res.assets?.[0];
    if (!a) return;
    // Some web pickers report 0x0; fall back to a portrait receipt shape.
    const picked = { uri: a.uri, width: a.width || 3, height: a.height || 4, name: a.fileName ?? 'receipt.jpg', mimeType: a.mimeType ?? 'image/jpeg' };
    setPhoto(picked);
    await read(picked);
  }

  // Android sometimes closes the app while the camera is open; the photo then waits here.
  useEffect(() => {
    if (isWeb) return;
    ImagePicker.getPendingResultAsync()
      .then((pending) => {
        if (pending && 'assets' in pending) openPicked(pending);
      })
      .catch((e) => console.warn('[scan-receipt] pending camera result', e));
    // Only on opening the screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function capture(source: 'camera' | 'library') {
    setError(null);
    let res: ImagePicker.ImagePickerResult;
    try {
      const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.7 };
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
    } catch (e) {
      // Say what actually failed: it's the only clue when this happens on someone's phone.
      console.warn(`[scan-receipt] ${source} failed`, e);
      const reason = e instanceof Error ? e.message : String(e);
      setError(
        source === 'camera'
          ? `Couldn't open the camera (${reason}). Try "Choose from library" with a photo of the receipt instead.`
          : `Couldn't open that image (${reason}). Try another photo.`,
      );
      return;
    }
    await openPicked(res);
  }

  if (!photo) {
    return (
      <Screen edges={['bottom']}>
        <EmptyState
          icon="camera-outline"
          title="Scan a receipt"
          message="We'll read the merchant, date, total, tax and card, then match it to your activity or add it as an expense."
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

  const ownCards = (cards.data ?? []).filter((c) => !c.isPlaceholder);
  const cardName = (id: string | null | undefined) => {
    const card = cards.data?.find((c) => c.id === id);
    return card ? `${card.nickname} ${maskCard(card.last4)}` : null;
  };
  const match = result?.matchedTransaction;
  const paidWith = result
    ? (cardName(result.cardId) ?? (result.cardLast4 ? `Card ${maskCard(result.cardLast4)}` : 'Not shown'))
    : '';

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
          {scanError ? (
            <>
              <AlertBanner tone="danger" title="Couldn't read the receipt" message={scanError} />
              <View style={styles.actions}>
                <Button label="Choose another" variant="secondary" onPress={() => setPhoto(null)} />
                <Button label="Try again" icon="refresh" onPress={() => read(photo)} />
              </View>
            </>
          ) : !result ? (
            <Card>
              <SectionHeader title="Reading receipt…" />
              <Loading />
            </Card>
          ) : (
            <>
              <Card>
                <SectionHeader title="Extracted" />
                <DetailRow label="Merchant" value={result.merchant} />
                <DetailRow label="Date" value={result.date ? formatShortDate(result.date) : 'Not printed'} />
                {result.subtotal !== null && <DetailRow label="Subtotal" value={formatMoney(result.subtotal, result.currency)} />}
                {result.tax !== null && (
                  <DetailRow label={result.taxLabel ? `Tax (${result.taxLabel})` : 'Tax'} value={formatMoney(result.tax, result.currency)} />
                )}
                <Divider />
                <DetailRow label="Total" value={formatMoney(result.total, result.currency)} strong />
                <DetailRow label="Paid with" value={paidWith} />
                {result.items.length > 0 && (
                  <>
                    <Divider />
                    <Text style={styles.overline}>Items</Text>
                    {result.items.map((item, i) => (
                      <DetailRow key={i} label={item.description} value={formatMoney(item.amount, result.currency)} />
                    ))}
                  </>
                )}
              </Card>

              {match ? (
                <AlertBanner
                  tone="success"
                  title="Already recorded ✓"
                  message={
                    `Matches ${match.merchant} on ${formatShortDate(match.date)} for ${formatMoney(match.amount, match.currency)}` +
                    `${cardName(match.cardId) ? ` on ${cardName(match.cardId)}` : ''}. ` +
                    (attached
                      ? 'The receipt is saved with it.'
                      : result.receiptId
                        ? `Save the receipt with it to see the photo and items there.${match.receiptId ? ' It replaces the one saved now.' : ''}`
                        : 'Nothing new to add.')
                  }
                  actions={[
                    { label: 'View transaction', onPress: () => router.push(`/transaction/${match.id}`) },
                    ...(result.receiptId && !attached
                      ? [{ label: attaching ? 'Saving…' : 'Save receipt to it', onPress: () => attach(result.receiptId!, match.id) }]
                      : []),
                  ]}
                />
              ) : added ? (
                <AlertBanner
                  tone="success"
                  title="Added to your expenses ✓"
                  message={
                    `${added.merchant}, ${formatMoney(added.amount, added.currency)} on ${formatShortDate(added.date)}. ` +
                    (added.receiptId ? 'The receipt photo and items are saved with it. ' : '') +
                    "When this purchase shows up on a statement, it's linked instead of counted twice."
                  }
                  actions={[{ label: 'View transaction', onPress: () => router.push(`/transaction/${added.id}`) }]}
                />
              ) : (
                <AddExpense key={`${result.merchant}-${result.total}`} scan={result} cards={ownCards} onAdded={setAdded} />
              )}
              {attachError && <AlertBanner tone="danger" title={attachError} />}

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

const styles = StyleSheet.create({
  pickers: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: spacing.md },
  layout: { gap: spacing.lg },
  layoutWide: { flexDirection: 'row', alignItems: 'flex-start' },
  half: { flex: 1 },
  imageWrap: {
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: borderWidth.hairline,
    borderColor: colors.border,
    padding: spacing.sm,
  },
  image: { width: '100%', maxHeight: layout.receiptMaxHeight, borderRadius: radius.md },
  details: { gap: spacing.lg },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', flexWrap: 'wrap', gap: spacing.md },
  overline: typography.overline,
  muted: typography.muted,
  flex: { flex: 1 },
  pair: { gap: spacing.md },
  pairWide: { flexDirection: 'row' },
  field: { gap: spacing.sm },
  label: typography.label,
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  end: { alignSelf: 'flex-end' },
});
