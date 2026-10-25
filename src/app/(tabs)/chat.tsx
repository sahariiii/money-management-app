import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { useHeaderHeight } from 'expo-router/react-navigation';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { AlertBanner, Button, ChatHistoryList, Chip, EmptyState, Loading, Screen, TypingDots, useToast } from '@/components';
import { borderWidth, colors, fontSize, layout, radius, spacing, typography } from '@/constants/theme';
import { useAsync } from '@/hooks/use-async';
import { useLayout } from '@/hooks/use-layout';
import {
  CHAT_SUGGESTIONS,
  deleteChatThread,
  getChatThread,
  getChatThreads,
  renameChatThread,
  sendChatMessage,
  USE_MOCK,
} from '@/lib/api';
import type { ChatMessage } from '@/types';

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

function Bubble({ message }: { message: ChatMessage }) {
  const mine = message.role === 'user';
  const s = message.summary;
  return (
    <View style={[styles.bubble, mine ? styles.mine : styles.theirs]}>
      <Text style={[styles.bubbleText, mine && styles.mineText]}>{message.text}</Text>
      {s && (
        <View style={styles.summary}>
          <Text style={[styles.summaryValue, { color: colors[s.tone ?? 'primary'] }]}>{s.value}</Text>
          <Text style={styles.summaryLabel}>{s.label}</Text>
        </View>
      )}
    </View>
  );
}

function Welcome({ onPick }: { onPick: (q: string) => void }) {
  return (
    <View style={styles.welcome}>
      <View style={styles.welcomeIcon}>
        <Ionicons name="sparkles" size={fontSize.xxl} color={colors.primary} />
      </View>
      <Text style={styles.welcomeTitle}>Ask me about your money</Text>
      <Text style={styles.welcomeText}>
        {USE_MOCK
          ? 'I know your transactions, budgets and cards, and I remember your habits over time.'
          : 'I can look through your statements and receipts: spending by month, card, category or merchant, and what stands out.'}
      </Text>
      <View style={styles.suggestions}>
        {CHAT_SUGGESTIONS.map((q) => (
          <Chip key={q} label={q} onPress={() => onPick(q)} />
        ))}
      </View>
    </View>
  );
}

/** Which conversation a pending answer or a failed question belongs to; 'new' for a new chat. */
const keyOf = (threadId: string | null) => threadId ?? 'new';

export default function Chat() {
  const headerHeight = useHeaderHeight();
  const navigation = useNavigation();
  const toast = useToast();
  const { isWide } = useLayout();
  // Set by the Chats screen (phones): `thread` is a conversation id or 'new'; `at` makes a repeat pick count.
  const params = useLocalSearchParams<{ thread?: string; at?: string }>();

  // The open conversation; null is a new chat, which is saved once its first answer is in.
  const [threadId, setThreadId] = useState<string | null>(null);
  const [seenAt, setSeenAt] = useState(params.at);
  const threads = useAsync(getChatThreads);
  // Tagged with the id it's for: useAsync keeps the previous conversation's data while the next one loads.
  const detail = useAsync(async () => ({ forId: threadId, thread: threadId ? await getChatThread(threadId) : null }), keyOf(threadId));
  // Messages sent and received in this session for one conversation; the saved ones seed it.
  const [local, setLocal] = useState<{ threadId: string | null; messages: ChatMessage[] } | null>(null);
  const [draft, setDraft] = useState('');
  // The conversation whose answer is on its way.
  const [waitingFor, setWaitingFor] = useState<string | null>(null);
  // The last question when its answer failed; it stays in the list so it can be sent again.
  const [failed, setFailed] = useState<{ key: string; question: string; error: string } | null>(null);
  const listRef = useRef<FlatList<ChatMessage>>(null);
  // The open conversation, for answers that arrive after the user moved on.
  const openKey = useRef(keyOf(threadId));
  useEffect(() => {
    openKey.current = keyOf(threadId);
  }, [threadId]);

  function open(id: string | null) {
    setThreadId(id);
    setFailed(null);
  }

  // A pick from the Chats screen.
  if (params.at !== seenAt) {
    setSeenAt(params.at);
    open(params.thread && params.thread !== 'new' ? params.thread : null);
  }

  const key = keyOf(threadId);
  const fromLocal = local && local.threadId === threadId ? local.messages : null;
  const loaded = detail.data && detail.data.forId === threadId ? detail.data : null;
  const saved = loaded?.thread?.messages ?? null;
  const messages = fromLocal ?? saved ?? [];
  const loadingThread = threadId !== null && !fromLocal && !saved;
  const notFound = loadingThread && loaded !== null && loaded.thread === null;
  const typing = waitingFor === key;
  const title = threadId ? (threads.data?.find((t) => t.id === threadId)?.title ?? loaded?.thread?.title) : undefined;

  async function ask(q: string, asked: string | null, sent: ChatMessage[]) {
    const askedKey = keyOf(asked);
    setFailed(null);
    setWaitingFor(askedKey);
    try {
      const reply = await sendChatMessage(q, asked);
      threads.reload();
      if (openKey.current === askedKey) {
        // A new chat now has its id.
        setThreadId(reply.thread.id);
        setLocal({ threadId: reply.thread.id, messages: [...sent, reply.message] });
      } else {
        // The user moved on; the answer is saved and loads when they come back.
        setLocal((l) => (l && l.threadId === asked ? null : l));
      }
    } catch (e) {
      setFailed({ key: askedKey, question: q, error: errorText(e) });
    } finally {
      setWaitingFor((w) => (w === askedKey ? null : w));
    }
  }

  function send(text: string) {
    const q = text.trim();
    if (!q || waitingFor !== null) return;
    setDraft('');
    const mine: ChatMessage = { id: `local_${Date.now()}`, role: 'user', text: q, createdAt: new Date().toISOString() };
    const sent = [...messages, mine];
    setLocal({ threadId, messages: sent });
    void ask(q, threadId, sent);
  }

  async function rename(id: string, newTitle: string) {
    await renameChatThread(id, newTitle);
    threads.reload();
  }

  async function remove(id: string) {
    await deleteChatThread(id);
    threads.reload();
    if (id === threadId) {
      open(null);
      setLocal(null);
    }
    toast('Chat deleted');
  }

  const canSend = draft.trim().length > 0 && waitingFor === null;
  const canStartNew = (messages.length > 0 || threadId !== null) && !typing;

  useLayoutEffect(() => {
    navigation.setOptions({
      headerTitle: title ?? 'Assistant',
      // Wide screens list the chats beside the conversation instead.
      headerRight: isWide
        ? undefined
        : () => (
            <View style={styles.headerActions}>
              <Button
                label="Chats"
                icon="chatbubbles-outline"
                variant="ghost"
                size="sm"
                onPress={() => router.push({ pathname: '/chat-history', params: { active: threadId ?? '' } })}
              />
              {canStartNew && <Button label="New" icon="create-outline" variant="ghost" size="sm" onPress={() => open(null)} />}
            </View>
          ),
    });
  }, [navigation, isWide, title, threadId, canStartNew]);

  const empty = loadingThread ? (
    notFound ? (
      <EmptyState
        icon="chatbubbles-outline"
        title="Conversation not found"
        message="It may have been deleted."
        actionLabel="New chat"
        onAction={() => open(null)}
      />
    ) : detail.error ? (
      <EmptyState
        icon="cloud-offline-outline"
        title="Couldn't load the conversation"
        message={errorText(detail.error)}
        actionLabel="Try again"
        onAction={detail.reload}
      />
    ) : (
      <Loading />
    )
  ) : (
    <Welcome onPick={send} />
  );

  const conversation = (
    <View style={styles.flex}>
      <FlatList
        ref={listRef}
        style={styles.flex}
        contentContainerStyle={styles.list}
        data={messages}
        keyExtractor={(m) => m.id}
        renderItem={({ item }) => <Bubble message={item} />}
        ListEmptyComponent={empty}
        ListFooterComponent={
          typing ? (
            <View style={[styles.bubble, styles.theirs, !USE_MOCK && styles.thinking]}>
              <TypingDots />
              {/* With the backend an answer can take half a minute; say what's going on. */}
              {!USE_MOCK && <Text style={styles.thinkingText}>Looking through your transactions…</Text>}
            </View>
          ) : failed && failed.key === key ? (
            <AlertBanner
              tone="danger"
              title="No answer this time"
              message={failed.error}
              actions={[
                // The question is still in the list; only the answer is asked for again.
                { label: 'Try again', onPress: () => void ask(failed.question, threadId, messages) },
                { label: 'Dismiss', onPress: () => setFailed(null) },
              ]}
            />
          ) : undefined
        }
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
        keyboardShouldPersistTaps="handled"
      />

      <View style={styles.inputBar}>
        <TextInput
          style={styles.input}
          value={draft}
          onChangeText={setDraft}
          placeholder="Ask about your money…"
          placeholderTextColor={colors.muted}
          returnKeyType="send"
          onSubmitEditing={() => send(draft)}
          submitBehavior="submit"
          accessibilityLabel="Message"
        />
        <Pressable
          onPress={() => send(draft)}
          disabled={!canSend}
          accessibilityRole="button"
          accessibilityLabel="Send"
          accessibilityState={{ disabled: !canSend }}
          style={({ pressed }) => [styles.send, !canSend && styles.sendDisabled, pressed && styles.pressed]}>
          <Ionicons name="arrow-up" size={layout.iconSize} color={colors.onPrimary} />
        </Pressable>
      </View>
    </View>
  );

  return (
    // "padding" on Android too: with edge-to-edge (SDK 54+) the window no longer resizes for the keyboard.
    <KeyboardAvoidingView style={styles.flex} behavior="padding" keyboardVerticalOffset={headerHeight}>
      <Screen scroll={false} width={isWide ? 'default' : 'narrow'} contentStyle={isWide ? styles.contentWide : styles.content}>
        {isWide && (
          <ScrollView style={styles.sidebar} contentContainerStyle={styles.sidebarContent} keyboardShouldPersistTaps="handled">
            <ChatHistoryList
              threads={threads.data}
              error={threads.error}
              onRetry={threads.reload}
              activeId={threadId}
              onOpen={open}
              onNewChat={() => open(null)}
              onRename={rename}
              onDelete={remove}
            />
          </ScrollView>
        )}
        {conversation}
      </Screen>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { flex: 1, paddingBottom: spacing.md, gap: spacing.md },
  contentWide: { flex: 1, flexDirection: 'row', paddingBottom: spacing.md, gap: spacing.lg },
  sidebar: {
    width: layout.chatSidebarWidth,
    flexGrow: 0,
    borderRightWidth: borderWidth.hairline,
    borderRightColor: colors.border,
  },
  sidebarContent: { paddingRight: spacing.md, paddingBottom: spacing.md },
  headerActions: { flexDirection: 'row', marginRight: spacing.sm },
  list: { flexGrow: 1, gap: spacing.md, paddingBottom: spacing.sm },
  bubble: {
    maxWidth: layout.chatBubbleMaxWidth,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.lg,
    gap: spacing.sm,
  },
  mine: { alignSelf: 'flex-end', backgroundColor: colors.primary, borderBottomRightRadius: radius.sm },
  theirs: {
    alignSelf: 'flex-start',
    backgroundColor: colors.card,
    borderWidth: borderWidth.hairline,
    borderColor: colors.border,
    borderBottomLeftRadius: radius.sm,
  },
  thinking: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  thinkingText: typography.caption,
  bubbleText: typography.body,
  mineText: { color: colors.onPrimary },
  summary: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.bg,
    gap: spacing.xxs,
  },
  summaryValue: typography.stat,
  summaryLabel: typography.caption,
  welcome: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingVertical: spacing.xxl },
  welcomeIcon: { padding: spacing.lg, borderRadius: radius.pill, backgroundColor: colors.primarySoft, marginBottom: spacing.sm },
  welcomeTitle: { ...typography.heading, textAlign: 'center' },
  welcomeText: { ...typography.muted, textAlign: 'center', maxWidth: layout.readableWidth },
  suggestions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: spacing.sm, marginTop: spacing.md },
  inputBar: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  input: {
    flex: 1,
    minWidth: 0,
    minHeight: layout.inputHeight,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    borderWidth: borderWidth.thin,
    borderColor: colors.border,
    backgroundColor: colors.card,
    fontSize: fontSize.md,
    color: colors.text,
  },
  send: {
    width: layout.inputHeight,
    height: layout.inputHeight,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendDisabled: { opacity: 0.4 },
  pressed: { opacity: 0.8 },
});
