import Ionicons from '@expo/vector-icons/Ionicons';
import * as DocumentPicker from 'expo-document-picker';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, Text, View } from 'react-native';

import { AlertBanner, Button, Card, DetailRow, EmptyState, Screen, SectionHeader } from '@/components';
import { colors, layout, spacing, typography } from '@/constants/theme';
import { ApiError, uploadStatement } from '@/lib/api';
import { formatShortDate } from '@/lib/dates';
import { formatMoney } from '@/lib/format';
import type { PickedFile, StatementUpload } from '@/types';

type Phase = 'idle' | 'processing' | 'done';
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function Step({ state, label }: { state: 'pending' | 'active' | 'done'; label: string }) {
  return (
    <View style={styles.step}>
      {state === 'active' ? (
        <ActivityIndicator size="small" color={colors.primary} />
      ) : (
        <Ionicons
          name={state === 'done' ? 'checkmark-circle' : 'ellipse-outline'}
          size={layout.iconSize}
          color={state === 'done' ? colors.income : colors.border}
        />
      )}
      <Text style={[styles.stepLabel, state === 'pending' && styles.pending]}>{label}</Text>
    </View>
  );
}

export default function UploadStatement() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [file, setFile] = useState<PickedFile | null>(null);
  const [step, setStep] = useState(0);
  const [result, setResult] = useState<StatementUpload | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function pick() {
    setError(null);
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: ['text/csv', 'text/comma-separated-values', 'application/pdf'],
        // Android: upload from the picked document's own content:// uri. The picker's copy lands in a
        // cache folder that expo-file-system refuses to read in Expo Go ("missing 'read' permission"),
        // while content:// uris from other apps' providers are allowed (FileSystemPath.checkPermission).
        copyToCacheDirectory: Platform.OS !== 'android',
      });
      if (res.canceled) return;
      const a = res.assets[0];
      const picked = { name: a.name, size: a.size, mimeType: a.mimeType, uri: a.uri };

      setFile(picked);
      setResult(null);
      setStep(0);
      setPhase('processing');

      // Fake pipeline: the steps advance on timers while the (mock) upload runs.
      const upload = uploadStatement(picked);
      await wait(900);
      setStep(1);
      const r = await upload;
      setResult(r);
      await wait(700);
      setStep(2);
      await wait(900);
      setStep(3);
      setPhase('done');
    } catch (e) {
      setPhase('idle');
      // The backend says why (e.g. "Extracted, but not categorized. ..."). Anything else failed on the
      // device (attaching the file, or the request itself), so show what it was rather than blame the file.
      console.warn('Statement upload failed:', e);
      const detail = e instanceof Error ? e.message : String(e);
      setError(e instanceof ApiError ? e.message : `Couldn't upload that file: ${detail}`);
    }
  }

  const stateOf = (i: number) => (step > i ? 'done' : step === i ? 'active' : 'pending');
  const n = result?.transactionsFound;

  if (phase === 'idle') {
    return (
      <Screen edges={['bottom']} width="narrow">
        <EmptyState
          icon="cloud-upload-outline"
          title="Upload a bank statement"
          message="Pick a CSV or PDF statement from your bank. We'll extract the transactions, check the balance and merge them into one ledger."
          actionLabel="Choose file"
          onAction={pick}
        />
        {error && <AlertBanner tone="danger" title={error} />}
        <Text style={styles.footnote}>{"Demo mode: the file stays on this device and isn't read."}</Text>
      </Screen>
    );
  }

  return (
    <Screen edges={['bottom']} width="narrow">
      <Card>
        <View style={styles.fileRow}>
          <Ionicons
            name={file?.mimeType === 'application/pdf' ? 'document-text-outline' : 'grid-outline'}
            size={layout.iconSize + spacing.xs}
            color={colors.primary}
          />
          <View style={styles.flex}>
            <Text style={styles.fileName} numberOfLines={1}>
              {file?.name}
            </Text>
            {file?.size ? <Text style={styles.caption}>{Math.max(1, Math.round(file.size / 1024))} KB</Text> : null}
          </View>
        </View>
        <View style={styles.steps}>
          <Step state={stateOf(0)} label="Reading file" />
          <Step state={stateOf(1)} label={n === undefined ? 'Extracting transactions' : `Extracting ${n} transactions`} />
          <Step state={stateOf(2)} label={step > 2 ? 'Balance check passed ✓' : 'Balance check'} />
        </View>
      </Card>

      {phase === 'done' && result && (
        <>
          <AlertBanner
            tone="success"
            title="Statement imported"
            message={`${result.transactionsFound} transactions from ${formatShortDate(result.range.from)} to ${formatShortDate(result.range.to)}. Opening and closing balances match.`}
          />
          <Card>
            <SectionHeader title="Summary" />
            <DetailRow label="Statement period" value={`${formatShortDate(result.range.from)} – ${formatShortDate(result.range.to)}`} />
            <DetailRow label="Transactions found" value={String(result.transactionsFound)} />
            <DetailRow label="Money out" value={`−${formatMoney(result.totalSpent)}`} tone="expense" />
            <DetailRow label="Money in" value={`+${formatMoney(result.totalIncome)}`} tone="income" />
            <DetailRow label="Already in your ledger" value={`${result.alreadyInLedger} (skipped, no duplicates)`} />
            <DetailRow label="New transactions added" value={String(result.newTransactions)} />
          </Card>
          <View style={styles.actions}>
            <Button label="Upload another" variant="secondary" onPress={pick} />
            <Button label="Back to Home" icon="home-outline" onPress={() => router.dismissTo('/')} />
          </View>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  footnote: { ...typography.caption, textAlign: 'center' },
  fileRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  fileName: typography.subheading,
  caption: typography.caption,
  steps: { gap: spacing.md, paddingTop: spacing.sm },
  step: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  stepLabel: typography.body,
  pending: { color: colors.muted },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', flexWrap: 'wrap', gap: spacing.md },
});
