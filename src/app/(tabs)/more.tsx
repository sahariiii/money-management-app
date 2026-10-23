import Ionicons from '@expo/vector-icons/Ionicons';
import { Fragment, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import {
  AlertItem,
  BudgetRow,
  Button,
  Card,
  CategoryBadge,
  Divider,
  EmptyState,
  Loading,
  Screen,
  SectionHeader,
  TextField,
  useToast,
} from '@/components';
import { colors, layout, radius, spacing, typography } from '@/constants/theme';
import { useAsync } from '@/hooks/use-async';
import { useLayout } from '@/hooks/use-layout';
import {
  currentMonth,
  dismissAlert,
  getAlerts,
  getBudgets,
  getRecurringBills,
  getSpendSummary,
  setBudget,
} from '@/lib/api';
import { categoryColor, categoryIcon } from '@/lib/categories';
import { formatMonth, formatShortDate } from '@/lib/dates';
import { formatMoney } from '@/lib/format';
import { useSession } from '@/lib/session';
import type { Category, RecurringBillStatus } from '@/types';

const INTERVAL_LABEL: Record<RecurringBillStatus['interval'], string> = {
  weekly: 'Weekly',
  biweekly: 'Every 2 weeks',
  monthly: 'Monthly',
  yearly: 'Yearly',
};

function dueLabel(days: number) {
  if (days < 0) return 'overdue';
  if (days === 0) return 'due today';
  if (days === 1) return 'due tomorrow';
  return `in ${days} days`;
}

/** Suggested limit for a category without a budget: this month's spend, rounded up to $50. */
const suggestLimit = (spent: number) => Math.max(50, Math.ceil(spent / 50) * 50);

function BillRow({ bill }: { bill: RecurringBillStatus }) {
  return (
    <View style={styles.bill}>
      <CategoryBadge category={bill.category} />
      <View style={styles.billMain}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {bill.merchant}
        </Text>
        <Text style={styles.caption}>
          {INTERVAL_LABEL[bill.interval]} · next {formatShortDate(bill.nextDue)} ({dueLabel(bill.daysUntilDue)})
        </Text>
        {bill.unusual && (
          <View style={styles.flag}>
            <Ionicons name="trending-up" size={layout.iconSize - spacing.sm} color={colors.expense} />
            <Text style={styles.flagText}>{Math.round(bill.changeFromUsual * 100)}% above usual</Text>
          </View>
        )}
      </View>
      <View style={styles.billAmounts}>
        <Text style={[styles.rowTitle, bill.unusual && styles.high]}>{formatMoney(bill.lastAmount)}</Text>
        <Text style={styles.caption}>usual {formatMoney(bill.expectedAmount)}</Text>
      </View>
    </View>
  );
}

type EditorProps = {
  category: Category;
  value: string;
  error?: string;
  saving: boolean;
  onChange: (v: string) => void;
  onSave: () => void;
  onCancel: () => void;
};

function LimitEditor({ category, value, error, saving, onChange, onSave, onCancel }: EditorProps) {
  return (
    <View style={styles.editor}>
      <TextField
        label={`Monthly limit for ${category}`}
        prefix="$"
        value={value}
        onChangeText={onChange}
        keyboardType="decimal-pad"
        error={error}
        autoFocus
        returnKeyType="done"
        onSubmitEditing={onSave}
      />
      <View style={styles.editorActions}>
        <Button label="Cancel" variant="secondary" size="sm" onPress={onCancel} />
        <Button label="Save" size="sm" onPress={onSave} loading={saving} />
      </View>
    </View>
  );
}

export default function More() {
  const { isWide, contentWidth } = useLayout();
  const toast = useToast();
  const { signOut } = useSession();
  const month = currentMonth();

  const budgets = useAsync(() => getBudgets(month), month);
  const spend = useAsync(() => getSpendSummary('this-month'));
  const bills = useAsync(getRecurringBills);
  const alerts = useAsync(() => getAlerts());

  const [editing, setEditing] = useState<Category | null>(null);
  const [draft, setDraft] = useState('');
  const [draftError, setDraftError] = useState<string>();
  const [saving, setSaving] = useState(false);

  const gap = spacing.lg;
  const half = isWide ? (contentWidth - gap) / 2 : contentWidth;

  const startEdit = (category: Category, limit: number) => {
    setEditing(category);
    setDraft(String(limit));
    setDraftError(undefined);
  };

  const saveEdit = async () => {
    if (!editing) return;
    const value = Number(draft.replace(/[$,\s]/g, ''));
    if (!(value > 0 && value <= 100_000)) {
      setDraftError('Enter an amount between $1 and $100,000.');
      return;
    }
    setSaving(true);
    try {
      const saved = await setBudget(editing, value);
      setEditing(null);
      budgets.reload();
      toast(`${saved.category} budget set to ${formatMoney(saved.monthlyLimit)} a month`);
    } finally {
      setSaving(false);
    }
  };

  const onDismiss = async (id: string) => {
    alerts.setData((alerts.data ?? []).map((a) => (a.id === id ? { ...a, status: 'dismissed' as const } : a)));
    await dismissAlert(id);
  };

  const editorFor = (category: Category) =>
    editing === category && (
      <LimitEditor
        category={category}
        value={draft}
        error={draftError}
        saving={saving}
        onChange={setDraft}
        onSave={saveEdit}
        onCancel={() => setEditing(null)}
      />
    );

  // Closest to the limit first.
  const budgetList = [...(budgets.data ?? [])].sort((a, b) => b.ratio - a.ratio);
  const budgeted = new Set(budgetList.map((b) => b.category));
  const unbudgeted = (spend.data?.byCategory ?? []).filter((c) => !budgeted.has(c.category) && c.category !== 'Income');

  const billList = bills.data ?? [];
  const monthlyBills = billList.filter((b) => b.interval === 'monthly').reduce((s, b) => s + b.expectedAmount, 0);

  const alertList = alerts.data ?? [];
  const openCount = alertList.filter((a) => a.status === 'open').length;

  return (
    <Screen>
      <View style={[styles.grid, { gap }]}>
        <Card style={{ width: half }}>
          <SectionHeader title="Budgets" subtitle={`${formatMonth(month)} · tap the pencil to change a limit`} />
          {!budgets.data || !spend.data ? (
            <Loading />
          ) : budgetList.length === 0 && unbudgeted.length === 0 ? (
            <EmptyState compact icon="pie-chart-outline" title="No budgets yet" message="Spending will show up here once you upload a statement." />
          ) : (
            <>
              {budgetList.map((b, i) => (
                <Fragment key={b.category}>
                  {i > 0 && <Divider />}
                  <BudgetRow budget={b} onEdit={() => startEdit(b.category, b.monthlyLimit)} />
                  {editorFor(b.category)}
                </Fragment>
              ))}
              {unbudgeted.length > 0 && (
                <>
                  <Text style={styles.overline}>No budget yet</Text>
                  {unbudgeted.map((c) => (
                    <Fragment key={c.category}>
                      <View style={styles.unbudgeted}>
                        <Ionicons name={categoryIcon(c.category)} size={layout.iconSize - spacing.xs} color={categoryColor(c.category)} />
                        <View style={styles.flex}>
                          <Text style={styles.rowLabel}>{c.category}</Text>
                          <Text style={styles.caption}>{formatMoney(c.amount)} this month</Text>
                        </View>
                        <Button
                          label="Set limit"
                          variant="ghost"
                          size="sm"
                          onPress={() => startEdit(c.category, suggestLimit(c.amount))}
                        />
                      </View>
                      {editorFor(c.category)}
                    </Fragment>
                  ))}
                </>
              )}
            </>
          )}
        </Card>

        <Card style={{ width: half }}>
          <SectionHeader
            title="Recurring bills"
            subtitle={bills.data && billList.length > 0 ? `Usually about ${formatMoney(monthlyBills)} a month` : undefined}
          />
          {!bills.data ? (
            <Loading />
          ) : billList.length === 0 ? (
            <EmptyState compact icon="repeat-outline" title="No recurring bills found" message="Bills show up after two matching charges." />
          ) : (
            billList.map((b, i) => (
              <Fragment key={b.id}>
                {i > 0 && <Divider />}
                <BillRow bill={b} />
              </Fragment>
            ))
          )}
        </Card>
      </View>

      <View style={styles.section}>
        <SectionHeader
          title="Alerts"
          subtitle={alerts.data ? `${openCount} open · ${alertList.length - openCount} dismissed` : undefined}
        />
        {!alerts.data ? (
          <Loading />
        ) : alertList.length === 0 ? (
          <Card>
            <EmptyState compact icon="notifications-outline" title="No alerts" message="We'll let you know about bill changes and budgets." />
          </Card>
        ) : (
          alertList.map((a) => <AlertItem key={a.id} alert={a} onDismiss={onDismiss} />)
        )}
      </View>

      <View style={[styles.grid, { gap }]}>
        <Card style={{ width: half }}>
          <SectionHeader title="Export" subtitle="Download every transaction as a spreadsheet." />
          <Button
            label="Export to Excel"
            icon="download-outline"
            variant="secondary"
            style={styles.start}
            onPress={() => toast('Excel export is coming soon. The backend will build the file.')}
          />
        </Card>
        <Card style={{ width: half }}>
          <SectionHeader title="Account" subtitle="Demo account · signed in with Google" />
          <Button label="Sign out" icon="log-out-outline" variant="danger" style={styles.start} onPress={signOut} />
        </Card>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start' },
  section: { gap: spacing.md },
  start: { alignSelf: 'flex-start' },
  caption: typography.caption,
  overline: { ...typography.overline, marginTop: spacing.sm },
  rowTitle: typography.subheading,
  rowLabel: typography.label,
  high: { color: colors.expense },
  editor: {
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.primarySoft,
  },
  editorActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm },
  unbudgeted: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  bill: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  billMain: { flex: 1, gap: spacing.xxs },
  billAmounts: { alignItems: 'flex-end', gap: spacing.xxs },
  flag: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: spacing.xs,
    marginTop: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
    borderRadius: radius.pill,
    backgroundColor: colors.expenseSoft,
  },
  flagText: { ...typography.caption, color: colors.expense },
});
