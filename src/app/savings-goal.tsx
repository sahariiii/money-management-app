import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import {
  AlertBanner,
  Button,
  Card,
  Chip,
  DetailRow,
  EmptyState,
  Loading,
  ProgressBar,
  Screen,
  SectionHeader,
  TextField,
  useToast,
} from '@/components';
import { colors, spacing, typography } from '@/constants/theme';
import { useAsync } from '@/hooks/use-async';
import { useLayout } from '@/hooks/use-layout';
import { currentMonth, deleteSavingsGoal, getBudgets, getSavingsGoal, getSpendingBaseline, saveSavingsGoal, today } from '@/lib/api';
import { daysFrom, formatDateWithYear, formatMonth, isISODate, lastDayOf, shiftMonth } from '@/lib/dates';
import { formatMoney } from '@/lib/format';
import { monthsBetween, planSavings } from '@/lib/savings-plan';
import type { BudgetStatus, Category, PlanCategory, SavingsGoalStatus, SpendingBaseline, YearMonth } from '@/types';

/** Quick picks for the target date: the end of the month this many months from now. */
const HORIZONS = [
  { label: '3 months', months: 3 },
  { label: '6 months', months: 6 },
  { label: '1 year', months: 12 },
];
const horizonDate = (months: number) => lastDayOf(shiftMonth(currentMonth(), months));

const MAX_YEARS = 10;
const MAX_AMOUNT = 10_000_000;
const MAX_BUDGET = 100_000;

const num = (s: string) => (s.trim() === '' ? NaN : Number(s.replace(/[$,\s]/g, '')));
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
const message = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong. Try again.');

/** "August – September 2026", or "September 2026". */
function monthsLabel(months: YearMonth[]) {
  const first = months[0];
  const last = months[months.length - 1];
  if (first === last) return formatMonth(first);
  return `${formatMonth(first, first.slice(0, 4) === last.slice(0, 4) ? 'name' : 'long')} – ${formatMonth(last)}`;
}

function awayLabel(date: string) {
  const days = daysFrom(today(), date);
  return days < 45 ? `${days} days away` : `about ${Math.round(monthsBetween(today(), date))} months away`;
}

type Row = PlanCategory & { typed?: string; value: number };

function rowHint(r: Row) {
  const parts = [`Avg ${formatMoney(r.average)}/mo`];
  if (r.typed !== undefined && r.target !== r.value) parts.push(`suggested ${formatMoney(r.target)}`);
  else if (r.value < r.average) parts.push(`${Math.round((1 - r.value / r.average) * 100)}% less`);
  if (r.fixed) parts.push('fixed cost');
  if (r.value === 0) parts.push('no budget');
  return parts.join(' · ');
}

type EditorProps = { goal: SavingsGoalStatus | null; baseline: SpendingBaseline; budgets: BudgetStatus[] };

/**
 * The goal (name, amount, date) and the monthly budgets that reach it. Budgets start as the
 * plan's suggestions (or, for a saved goal, the saved budgets) and can each be changed; saving
 * replaces every budget with these, keeping budgets for categories the plan doesn't cover.
 */
function GoalEditor({ goal, baseline, budgets }: EditorProps) {
  const toast = useToast();
  const { isWide } = useLayout();

  const [name, setName] = useState(goal?.name ?? '');
  const [amount, setAmount] = useState(goal ? String(goal.targetAmount) : '');
  const [targetDate, setTargetDate] = useState(goal?.targetDate ?? horizonDate(6));
  // What the user typed per category; the others follow the suggestion.
  const [edits, setEdits] = useState<Partial<Record<Category, string>>>(() =>
    goal ? Object.fromEntries(budgets.map((b) => [b.category, String(b.monthlyLimit)])) : {},
  );
  const [errors, setErrors] = useState<Partial<Record<string, string>>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [removing, setRemoving] = useState(false);

  const amountValue = num(amount);
  const dateOk = isISODate(targetDate) && targetDate > today();
  // A saved goal keeps its start: what's left is planned from the latest transaction it counted.
  const saved = goal?.saved ?? 0;
  const from = goal?.asOf ?? today();
  const plan =
    amountValue > 0 && dateOk && baseline.months.length > 0
      ? planSavings(baseline, { amount: Math.max(0, amountValue - saved), from, to: targetDate })
      : null;

  const rows: Row[] = (plan?.categories ?? []).map((c) => {
    const typed = edits[c.category];
    return { ...c, typed, value: typed === undefined ? c.target : num(typed) };
  });
  const monthlyBudgets = sum(rows.map((r) => (r.value >= 0 ? r.value : 0)));
  const monthlySaving = (plan?.monthlyIncome ?? 0) - monthlyBudgets;
  const projected = saved + monthlySaving * (plan?.months ?? 0);
  const short = amountValue - projected;
  const edited = Object.keys(edits).length > 0;

  function validate(): boolean {
    const e: Partial<Record<string, string>> = {};
    if (!(amountValue >= 1 && amountValue <= MAX_AMOUNT)) e.amount = 'Enter the amount to save, e.g. 6000.';
    const latest = `${Number(today().slice(0, 4)) + MAX_YEARS}${today().slice(4)}`;
    if (!isISODate(targetDate)) e.targetDate = 'Enter a date as YYYY-MM-DD, e.g. 2027-04-30.';
    else if (targetDate <= today()) e.targetDate = 'Pick a date after today.';
    else if (targetDate > latest) e.targetDate = `Pick a date within ${MAX_YEARS} years.`;
    for (const r of rows) {
      if (!(r.value >= 0 && r.value <= MAX_BUDGET)) e[r.category] = 'Enter 0 or more (0 means no budget).';
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function save() {
    if (!validate()) return;
    setSaving(true);
    setSaveError(null);
    try {
      const planned = new Set(rows.map((r) => r.category));
      await saveSavingsGoal(
        {
          name: name.trim() || 'Savings goal',
          targetAmount: Math.round(amountValue * 100) / 100,
          startDate: goal?.startDate ?? today(),
          targetDate,
        },
        [
          ...rows.map((r) => ({ category: r.category, monthlyLimit: r.value })),
          // Categories without recent spending aren't in the plan; their budgets stay.
          ...budgets.filter((b) => !planned.has(b.category)).map(({ category, monthlyLimit }) => ({ category, monthlyLimit })),
        ],
      );
      toast(goal ? 'Plan updated' : 'Goal saved. Your budgets now follow the plan.');
      router.back();
    } catch (err) {
      setSaveError(message(err));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    setRemoving(true);
    setSaveError(null);
    try {
      await deleteSavingsGoal();
      toast('Goal removed. Your budgets stay as they are.');
      router.back();
    } catch (err) {
      setSaveError(message(err));
      setConfirmingRemove(false);
    } finally {
      setRemoving(false);
    }
  }

  // Side-by-side fields on wide screens; stacked (no flex) on phones.
  const pair = [styles.pair, isWide && styles.pairWide];
  const half = isWide ? styles.flex : undefined;
  const rowPairs = isWide ? rows.flatMap((r, i) => (i % 2 ? [] : [rows.slice(i, i + 2)])) : rows.map((r) => [r]);

  return (
    <>
      <Card>
        <SectionHeader
          title="Your goal"
          subtitle={
            goal
              ? `Saving since ${formatDateWithYear(goal.startDate)}: ${formatMoney(goal.saved)} so far.`
              : 'Saving counts from today, as money in minus money out.'
          }
        />
        <View style={pair}>
          <TextField
            style={half}
            label="Name (optional)"
            placeholder="e.g. Emergency fund"
            value={name}
            onChangeText={setName}
            maxLength={60}
          />
          <TextField
            style={half}
            label="Amount to save"
            prefix="$"
            placeholder="6000"
            value={amount}
            onChangeText={setAmount}
            keyboardType="decimal-pad"
            error={errors.amount}
          />
        </View>
        <View style={styles.field}>
          <Text style={styles.label}>By</Text>
          <View style={styles.chips}>
            {HORIZONS.map((h) => (
              <Chip
                key={h.label}
                label={h.label}
                selected={targetDate === horizonDate(h.months)}
                onPress={() => setTargetDate(horizonDate(h.months))}
              />
            ))}
          </View>
        </View>
        <TextField
          label="Target date"
          placeholder="YYYY-MM-DD"
          value={targetDate}
          onChangeText={setTargetDate}
          autoCapitalize="none"
          autoCorrect={false}
          error={errors.targetDate}
          hint={dateOk ? `${formatDateWithYear(targetDate)}, ${awayLabel(targetDate)}` : 'YYYY-MM-DD, after today'}
        />
      </Card>

      <Card>
        <SectionHeader
          title="Monthly budgets"
          subtitle={baseline.months.length ? `Starting from your averages for ${monthsLabel(baseline.months)}` : undefined}
          right={edited && plan ? <Button label="Use suggestions" variant="ghost" size="sm" onPress={() => setEdits({})} /> : undefined}
        />
        {baseline.months.length === 0 ? (
          <EmptyState
            compact
            icon="document-text-outline"
            title="Not enough history yet"
            message="The plan starts from at least one full month of income and spending. Upload statements that cover one, then come back."
          />
        ) : !plan ? (
          <Text style={styles.muted}>Enter an amount and a date after today to see a plan.</Text>
        ) : (
          <>
            <View style={styles.summary}>
              <DetailRow label="Income, on average" value={`${formatMoney(plan.monthlyIncome)}/mo`} tone="income" />
              <DetailRow label="Budgets below" value={`−${formatMoney(monthlyBudgets)}/mo`} />
              <DetailRow
                label="You'd save"
                value={`${monthlySaving < 0 ? '−' : ''}${formatMoney(Math.abs(monthlySaving))}/mo`}
                tone={monthlySaving >= plan.monthlyNeeded ? 'income' : 'warning'}
                strong
              />
              <Text style={styles.caption}>
                The goal needs {formatMoney(plan.monthlyNeeded)} a month
                {goal ? ` for what's left (${formatMoney(Math.max(0, amountValue - saved))})` : ''}.
              </Text>
            </View>

            <View style={styles.field}>
              <ProgressBar value={amountValue > 0 ? Math.max(0, projected / amountValue) : 0} color={short > 0 ? colors.warning : colors.income} />
              <Text style={styles.small}>
                By {formatDateWithYear(targetDate)}: {projected < 0 ? '−' : ''}
                {formatMoney(Math.abs(projected))} of {formatMoney(amountValue)}
              </Text>
            </View>

            {short > 0.005 ? (
              <AlertBanner
                tone="warning"
                title={`${formatMoney(short)} short of your goal`}
                message={
                  !edited && !plan.reachable
                    ? 'Even with eating out, shopping and entertainment cut in half, and groceries and transport down 15%, the plan falls short. Try a later date or a smaller amount.'
                    : 'Lower some budgets, pick a later date or save a smaller amount.'
                }
              />
            ) : (
              <AlertBanner
                tone="success"
                title="These budgets reach your goal"
                message={
                  short < -1
                    ? `With ${formatMoney(-short)} to spare by ${formatDateWithYear(targetDate)}.`
                    : 'Stick to them each month and you get there on time.'
                }
              />
            )}

            {rowPairs.map((pairRows) => (
              <View key={pairRows[0].category} style={pair}>
                {pairRows.map((r) => (
                  <TextField
                    key={r.category}
                    style={half}
                    label={r.category}
                    prefix="$"
                    suffix="/mo"
                    value={r.typed ?? String(r.target)}
                    onChangeText={(v) => setEdits((e) => ({ ...e, [r.category]: v }))}
                    keyboardType="decimal-pad"
                    error={errors[r.category]}
                    hint={r.value >= 0 ? rowHint(r) : undefined}
                  />
                ))}
                {/* Keeps a lone last field half width. */}
                {isWide && pairRows.length === 1 && <View style={styles.flex} />}
              </View>
            ))}
          </>
        )}
      </Card>

      {saveError && <AlertBanner tone="danger" title={saveError} />}

      <View style={styles.actions}>
        <Button label="Cancel" variant="secondary" onPress={() => router.back()} />
        <Button
          label={goal ? 'Save plan' : 'Save goal and budgets'}
          icon="checkmark"
          onPress={save}
          loading={saving}
          disabled={removing}
        />
      </View>

      {goal && (
        <Card>
          <SectionHeader title="Remove goal" />
          {confirmingRemove ? (
            <>
              <Text style={styles.muted}>
                Remove {goal.name}? Your budgets stay as they are. A new goal starts counting from the day you set it.
              </Text>
              <View style={styles.actions}>
                <Button label="Keep goal" variant="secondary" onPress={() => setConfirmingRemove(false)} disabled={removing} />
                <Button label="Yes, remove" icon="trash-outline" variant="danger" onPress={remove} loading={removing} />
              </View>
            </>
          ) : (
            <Button
              label="Remove goal"
              icon="trash-outline"
              variant="danger"
              size="sm"
              style={styles.start}
              onPress={() => setConfirmingRemove(true)}
              disabled={saving}
            />
          )}
        </Card>
      )}
    </>
  );
}

export default function SavingsGoalScreen() {
  const data = useAsync(() => Promise.all([getSavingsGoal(), getSpendingBaseline(), getBudgets()]));

  return (
    <Screen edges={['bottom']} width="narrow">
      {data.error && !data.data ? (
        <AlertBanner tone="danger" title="Couldn't load your goal" message={message(data.error)} actions={[{ label: 'Try again', onPress: data.reload }]} />
      ) : !data.data ? (
        <Loading />
      ) : (
        <GoalEditor goal={data.data[0]} baseline={data.data[1]} budgets={data.data[2]} />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  pair: { gap: spacing.md },
  pairWide: { flexDirection: 'row' },
  field: { gap: spacing.sm },
  label: typography.label,
  muted: typography.muted,
  small: typography.small,
  caption: typography.caption,
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  summary: { gap: spacing.sm },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.md },
  start: { alignSelf: 'flex-start' },
});
