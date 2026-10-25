import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, layout, radius, spacing, typography } from '@/constants/theme';
import { addDays } from '@/lib/dates';
import type { ChatThread } from '@/types';
import { AlertBanner } from './AlertBanner';
import { Button } from './Button';
import { EmptyState } from './EmptyState';
import { Loading } from './Loading';
import { TextField } from './TextField';

/** Shows a search field once the list is longer than this. */
const SEARCH_FROM = 6;

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** The local calendar day of an ISO timestamp, YYYY-MM-DD. */
function localDay(timestamp: string) {
  const d = new Date(timestamp);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** "Today", "Yesterday", "Previous 7 days", "Previous 30 days", then "September 2026" and so on. */
function groupLabel(timestamp: string, todayDay: string) {
  const day = localDay(timestamp);
  if (day >= todayDay) return 'Today';
  if (day === addDays(todayDay, -1)) return 'Yesterday';
  if (day > addDays(todayDay, -7)) return 'Previous 7 days';
  if (day > addDays(todayDay, -30)) return 'Previous 30 days';
  return `${MONTHS[Number(day.slice(5, 7)) - 1]} ${day.slice(0, 4)}`;
}

/** Threads come newest first, so groups come out in order. */
function grouped(threads: ChatThread[]) {
  const todayDay = localDay(new Date().toISOString());
  const groups: { label: string; items: ChatThread[] }[] = [];
  for (const t of threads) {
    const label = groupLabel(t.updatedAt, todayDay);
    const last = groups[groups.length - 1];
    if (last?.label === label) last.items.push(t);
    else groups.push({ label, items: [t] });
  }
  return groups;
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : "That didn't work. Try again.");

type RowProps = {
  thread: ChatThread;
  active: boolean;
  onOpen: () => void;
  onRename: (title: string) => Promise<void>;
  onDelete: () => Promise<void>;
};

/** A conversation: its title and latest answer, with rename and delete (each confirmed in place). */
function ThreadRow({ thread, active, onOpen, onRename, onDelete }: RowProps) {
  const [mode, setMode] = useState<'view' | 'rename' | 'delete'>('view');
  const [title, setTitle] = useState(thread.title);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(undefined);
    try {
      await action();
      setMode('view');
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  if (mode === 'rename') {
    return (
      <View style={styles.editor}>
        <TextField
          label="Conversation name"
          value={title}
          onChangeText={setTitle}
          autoFocus
          maxLength={60}
          returnKeyType="done"
          onSubmitEditing={() => title.trim() && run(() => onRename(title.trim()))}
          error={error}
        />
        <View style={styles.editorActions}>
          <Button label="Cancel" variant="secondary" size="sm" onPress={() => setMode('view')} disabled={busy} />
          <Button label="Save" size="sm" onPress={() => run(() => onRename(title.trim()))} loading={busy} disabled={!title.trim()} />
        </View>
      </View>
    );
  }

  if (mode === 'delete') {
    return (
      <View style={styles.editor}>
        <Text style={styles.small}>
          Delete <Text style={styles.bold}>{thread.title}</Text>? This can&apos;t be undone.
        </Text>
        {error && <AlertBanner tone="danger" title={error} />}
        <View style={styles.editorActions}>
          <Button label="Keep it" variant="secondary" size="sm" onPress={() => setMode('view')} disabled={busy} />
          <Button label="Delete" icon="trash-outline" variant="danger" size="sm" onPress={() => run(onDelete)} loading={busy} />
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.row, active && styles.rowActive]}>
      <Pressable
        onPress={onOpen}
        accessibilityRole="button"
        accessibilityState={{ selected: active }}
        accessibilityLabel={`Open ${thread.title}`}
        style={({ pressed }) => [styles.rowMain, pressed && styles.pressed]}>
        <Text style={[styles.title, active && styles.titleActive]} numberOfLines={1}>
          {thread.title}
        </Text>
        <Text style={styles.preview} numberOfLines={1}>
          {thread.preview}
        </Text>
      </Pressable>
      <Pressable
        onPress={() => {
          setTitle(thread.title);
          setError(undefined);
          setMode('rename');
        }}
        hitSlop={spacing.xs}
        accessibilityRole="button"
        accessibilityLabel={`Rename ${thread.title}`}
        style={({ pressed }) => [styles.icon, pressed && styles.pressed]}>
        <Ionicons name="pencil-outline" size={layout.iconSize - spacing.sm} color={colors.muted} />
      </Pressable>
      <Pressable
        onPress={() => {
          setError(undefined);
          setMode('delete');
        }}
        hitSlop={spacing.xs}
        accessibilityRole="button"
        accessibilityLabel={`Delete ${thread.title}`}
        style={({ pressed }) => [styles.icon, pressed && styles.pressed]}>
        <Ionicons name="trash-outline" size={layout.iconSize - spacing.sm} color={colors.muted} />
      </Pressable>
    </View>
  );
}

type Props = {
  /** Newest first; undefined while loading. */
  threads: ChatThread[] | undefined;
  error?: Error;
  onRetry?: () => void;
  /** The open conversation, highlighted. */
  activeId: string | null;
  onOpen: (id: string) => void;
  onNewChat: () => void;
  onRename: (id: string, title: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
};

/** Past conversations with the assistant, grouped by when they were last active, like Claude's and ChatGPT's. */
export function ChatHistoryList({ threads, error, onRetry, activeId, onOpen, onNewChat, onRename, onDelete }: Props) {
  const [search, setSearch] = useState('');
  const needle = search.trim().toLowerCase();
  const shown = (threads ?? []).filter((t) => !needle || `${t.title} ${t.preview}`.toLowerCase().includes(needle));

  return (
    <View style={styles.wrap}>
      <Button label="New chat" icon="create-outline" variant="secondary" size="sm" onPress={onNewChat} />
      {(threads?.length ?? 0) >= SEARCH_FROM && (
        <TextField label="Search chats" placeholder="Title or answer" value={search} onChangeText={setSearch} autoCorrect={false} />
      )}
      {!threads ? (
        error ? (
          <AlertBanner tone="danger" title="Couldn't load your chats" message={errorText(error)} actions={onRetry ? [{ label: 'Try again', onPress: onRetry }] : []} />
        ) : (
          <Loading />
        )
      ) : threads.length === 0 ? (
        <EmptyState compact icon="chatbubbles-outline" title="No chats yet" message="Your conversations with the assistant show up here." />
      ) : shown.length === 0 ? (
        <Text style={styles.small}>No chats match &quot;{search.trim()}&quot;.</Text>
      ) : (
        grouped(shown).map((g) => (
          <View key={g.label} style={styles.group}>
            <Text style={styles.groupLabel}>{g.label}</Text>
            {g.items.map((t) => (
              <ThreadRow
                key={t.id}
                thread={t}
                active={t.id === activeId}
                onOpen={() => onOpen(t.id)}
                onRename={(title) => onRename(t.id, title)}
                onDelete={() => onDelete(t.id)}
              />
            ))}
          </View>
        ))
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.md },
  group: { gap: spacing.xxs },
  groupLabel: { ...typography.overline, paddingHorizontal: spacing.sm, marginBottom: spacing.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, borderRadius: radius.md, paddingRight: spacing.xs },
  rowActive: { backgroundColor: colors.primarySoft },
  rowMain: { flex: 1, minWidth: 0, gap: spacing.xxs, paddingVertical: spacing.sm, paddingHorizontal: spacing.sm },
  title: typography.label,
  titleActive: { color: colors.primary },
  preview: typography.caption,
  icon: { padding: spacing.xs },
  pressed: { opacity: 0.6 },
  editor: { gap: spacing.sm, padding: spacing.sm, borderRadius: radius.md, backgroundColor: colors.bg },
  editorActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm },
  small: typography.small,
  bold: { ...typography.small, fontWeight: typography.label.fontWeight },
});
