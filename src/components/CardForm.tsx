import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { borderWidth, colors, layout, spacing, typography } from '@/constants/theme';
import { useLayout } from '@/hooks/use-layout';
import { categoryColor, categoryIcon } from '@/lib/categories';
import { maskCard } from '@/lib/format';
import { CATEGORIES, type Card as CardType, type Category, type NewCardInput, type RewardRule } from '@/types';

import { AlertBanner } from './AlertBanner';
import { Button } from './Button';
import { Card } from './Card';
import { Chip } from './Chip';
import { SectionHeader } from './SectionHeader';
import { TextField } from './TextField';

type BonusRule = { category: Category; rate: string; cap: string };
type Errors = Partial<Record<string, string>>;

/** Categories you can earn a bonus on (not income or rent). */
const BONUS_CATEGORIES = CATEGORIES.filter((c) => c !== 'Income' && c !== 'Housing');

const num = (s: string) => (s.trim() === '' ? NaN : Number(s.replace(',', '.')));
const digits4 = (v: string) => v.replace(/\D/g, '').slice(-4);
const message = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong. Try again.');

type Props = {
  /** The card being edited, with its reward rules; omit to add a new card. */
  initial?: { card: CardType; rules: RewardRule[] };
  submitLabel: string;
  /** Saves the form; throw to show the error on the form. */
  onSubmit: (input: NewCardInput) => Promise<void>;
  /** Shows a "Delete card" section, with a confirmation step. */
  onDelete?: () => Promise<void>;
};

/** The add and edit card form: card details, then reward rules. */
export function CardForm({ initial, submitLabel, onSubmit, onDelete }: Props) {
  const { isWide } = useLayout();
  const card = initial?.card;
  const base = initial?.rules.find((r) => r.category === '*');

  const [nickname, setNickname] = useState(card?.nickname ?? '');
  const [institution, setInstitution] = useState(card?.institution ?? '');
  const [type, setType] = useState<CardType['type']>(card?.type ?? 'credit');
  const [last4, setLast4] = useState(card?.last4 ?? '');
  const [accountLast4, setAccountLast4] = useState(card?.accountLast4 ?? '');
  const [annualFee, setAnnualFee] = useState(String(card?.annualFee ?? 0));
  const [interestRate, setInterestRate] = useState(card?.type === 'credit' ? String(card.interestRate) : '');
  const [cycleDay, setCycleDay] = useState(String(card?.cycleDay ?? 1));
  const [baseRate, setBaseRate] = useState(initial ? (base ? String(base.ratePercent) : '') : '1');
  const [bonus, setBonus] = useState<BonusRule[]>(
    (initial?.rules ?? []).flatMap((r) =>
      r.category === '*' ? [] : [{ category: r.category, rate: String(r.ratePercent), cap: r.cap === null ? '' : String(r.cap) }],
    ),
  );
  const [picking, setPicking] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const available = BONUS_CATEGORIES.filter((c) => !bonus.some((b) => b.category === c));
  const updateBonus = (i: number, patch: Partial<BonusRule>) =>
    setBonus((rules) => rules.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  function validate(): NewCardInput | null {
    const e: Errors = {};
    if (!nickname.trim()) e.nickname = 'Give the card a name you will recognize.';
    if (!institution.trim()) e.institution = 'Which bank issued it?';
    if (!/^\d{4}$/.test(last4)) e.last4 = 'Enter exactly the last 4 digits.';
    if (accountLast4 && !/^\d{4}$/.test(accountLast4)) e.accountLast4 = 'Enter the last 4 digits, or leave it empty.';
    const fee = num(annualFee);
    if (!(fee >= 0)) e.annualFee = 'Enter 0 or more.';
    const apr = type === 'credit' ? num(interestRate) : 0;
    if (type === 'credit' && !(apr >= 0 && apr <= 60)) e.interestRate = 'Enter the APR, e.g. 20.99.';
    const day = num(cycleDay);
    if (!(Number.isInteger(day) && day >= 1 && day <= 28)) e.cycleDay = 'A day from 1 to 28.';
    const baseValue = baseRate.trim() === '' ? 0 : num(baseRate);
    if (!(baseValue >= 0 && baseValue <= 20)) e.baseRate = 'Between 0 and 20%.';
    bonus.forEach((b, i) => {
      const r = num(b.rate);
      if (!(r > 0 && r <= 20)) e[`rate${i}`] = 'Between 0 and 20%.';
      if (b.cap.trim() && !(num(b.cap) > 0)) e[`cap${i}`] = 'Leave empty or enter an amount.';
    });
    setErrors(e);
    if (Object.keys(e).length) return null;

    return {
      nickname: nickname.trim(),
      institution: institution.trim(),
      type,
      last4,
      accountLast4: accountLast4 || undefined,
      annualFee: fee,
      interestRate: apr,
      cycleDay: day,
      rules: [
        ...bonus.map((b) => ({ category: b.category, ratePercent: num(b.rate), cap: b.cap.trim() ? num(b.cap) : null })),
        ...(baseValue > 0 ? [{ category: '*' as const, ratePercent: baseValue, cap: null }] : []),
      ],
    };
  }

  async function save() {
    const input = validate();
    if (!input) return;
    setSaving(true);
    setSaveError(null);
    try {
      await onSubmit(input);
    } catch (e) {
      setSaveError(message(e));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!onDelete) return;
    setDeleting(true);
    setSaveError(null);
    try {
      await onDelete();
    } catch (e) {
      setSaveError(message(e));
      setConfirmingDelete(false);
    } finally {
      setDeleting(false);
    }
  }

  // Side-by-side fields on wide screens; stacked (no flex) on phones.
  const pair = [styles.pair, isWide && styles.pairWide];
  const half = isWide ? styles.flex : undefined;

  return (
    <>
      <Card>
        <SectionHeader title="Card details" />
        <View style={pair}>
          <TextField
            style={half}
            label="Nickname"
            placeholder="e.g. Travel Visa"
            value={nickname}
            onChangeText={setNickname}
            error={errors.nickname}
          />
          <TextField
            style={half}
            label="Bank"
            placeholder="e.g. RBC"
            value={institution}
            onChangeText={setInstitution}
            error={errors.institution}
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Type</Text>
          <View style={styles.chips}>
            <Chip label="Credit" selected={type === 'credit'} onPress={() => setType('credit')} />
            <Chip label="Debit" selected={type === 'debit'} onPress={() => setType('debit')} />
          </View>
        </View>

        <View style={pair}>
          <TextField
            style={half}
            label="Last 4 digits"
            prefix="••••"
            placeholder="1234"
            value={last4}
            // Keep the LAST 4 digits, so pasting a full number never stores more (or the wrong 4).
            // No maxLength: it would cut a paste down to its first 4 digits before we see it.
            onChangeText={(v) => setLast4(digits4(v))}
            keyboardType="number-pad"
            error={errors.last4}
            hint="Only the last 4. Full card numbers are never stored."
          />
          <TextField
            style={half}
            label="Account number (optional)"
            prefix="••••"
            placeholder="5678"
            value={accountLast4}
            // Same as the card number: keep the last 4 digits of whatever is typed or pasted.
            onChangeText={(v) => setAccountLast4(digits4(v))}
            keyboardType="number-pad"
            error={errors.accountLast4}
            hint="The account it belongs to, from your statement. Only the last 4 are kept."
          />
        </View>

        <View style={pair}>
          <TextField
            style={half}
            label="Annual fee"
            prefix="$"
            value={annualFee}
            onChangeText={setAnnualFee}
            keyboardType="decimal-pad"
            error={errors.annualFee}
          />
          {type === 'credit' && (
            <TextField
              style={half}
              label="Interest rate (APR)"
              suffix="%"
              placeholder="20.99"
              value={interestRate}
              onChangeText={setInterestRate}
              keyboardType="decimal-pad"
              error={errors.interestRate}
            />
          )}
        </View>

        <TextField
          label="Statement closes on day"
          value={cycleDay}
          onChangeText={setCycleDay}
          keyboardType="number-pad"
          maxLength={2}
          error={errors.cycleDay}
        />
      </Card>

      <Card>
        <SectionHeader title="Rewards" />
        <TextField
          label="Cashback on everything"
          suffix="%"
          value={baseRate}
          onChangeText={setBaseRate}
          keyboardType="decimal-pad"
          error={errors.baseRate}
          hint="Leave empty or 0 if the card has no rewards."
        />

        {bonus.map((b, i) => (
          <View key={b.category} style={styles.bonus}>
            <View style={styles.bonusHeader}>
              <Ionicons name={categoryIcon(b.category)} size={layout.iconSize - 4} color={categoryColor(b.category)} />
              <Text style={styles.bonusTitle}>{b.category}</Text>
              <Pressable
                onPress={() => setBonus((rules) => rules.filter((_, j) => j !== i))}
                hitSlop={spacing.sm}
                accessibilityRole="button"
                accessibilityLabel={`Remove ${b.category} bonus`}>
                <Ionicons name="close-circle" size={layout.iconSize} color={colors.muted} />
              </Pressable>
            </View>
            <View style={pair}>
              <TextField
                style={half}
                label="Cashback"
                suffix="%"
                placeholder="3"
                value={b.rate}
                onChangeText={(v) => updateBonus(i, { rate: v })}
                keyboardType="decimal-pad"
                error={errors[`rate${i}`]}
              />
              <TextField
                style={half}
                label="Monthly cap (optional)"
                prefix="$"
                suffix="/mo"
                value={b.cap}
                onChangeText={(v) => updateBonus(i, { cap: v })}
                keyboardType="decimal-pad"
                error={errors[`cap${i}`]}
              />
            </View>
          </View>
        ))}

        {picking ? (
          <View style={styles.field}>
            <Text style={styles.label}>Bonus category</Text>
            <View style={styles.chips}>
              {available.map((c) => (
                <Chip
                  key={c}
                  label={c}
                  onPress={() => {
                    setBonus((rules) => [...rules, { category: c, rate: '', cap: '' }]);
                    setPicking(false);
                  }}
                />
              ))}
            </View>
          </View>
        ) : (
          available.length > 0 && (
            <Button
              label="Add bonus category"
              icon="add"
              variant="secondary"
              size="sm"
              style={styles.start}
              onPress={() => setPicking(true)}
            />
          )
        )}
      </Card>

      {saveError && <AlertBanner tone="danger" title={saveError} />}

      <View style={styles.actions}>
        <Button label="Cancel" variant="secondary" onPress={() => router.back()} />
        <Button label={submitLabel} icon="checkmark" onPress={save} loading={saving} disabled={deleting} />
      </View>

      {onDelete && card && (
        <Card>
          <SectionHeader title="Delete card" />
          {confirmingDelete ? (
            <>
              <Text style={styles.muted}>
                Delete {card.nickname} {maskCard(card.last4)} and its reward rules? Past transactions stay in your
                activity. This can&apos;t be undone.
              </Text>
              <View style={styles.actions}>
                <Button label="Keep card" variant="secondary" onPress={() => setConfirmingDelete(false)} disabled={deleting} />
                <Button label="Yes, delete" icon="trash-outline" variant="danger" onPress={remove} loading={deleting} />
              </View>
            </>
          ) : (
            <Button
              label="Delete card"
              icon="trash-outline"
              variant="danger"
              size="sm"
              style={styles.start}
              onPress={() => setConfirmingDelete(true)}
              disabled={saving}
            />
          )}
        </Card>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  pair: { gap: spacing.md },
  pairWide: { flexDirection: 'row' },
  field: { gap: spacing.sm },
  label: typography.label,
  muted: typography.muted,
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  bonus: { gap: spacing.sm, paddingTop: spacing.md, borderTopWidth: borderWidth.hairline, borderTopColor: colors.border },
  bonusHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  bonusTitle: { ...typography.subheading, flex: 1 },
  start: { alignSelf: 'flex-start' },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.md },
});
