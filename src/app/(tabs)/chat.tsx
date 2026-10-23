import Ionicons from '@expo/vector-icons/Ionicons';
import { useHeaderHeight } from 'expo-router/react-navigation';
import { useRef, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Chip, Loading, Screen, TypingDots } from '@/components';
import { borderWidth, colors, fontSize, layout, radius, spacing, typography } from '@/constants/theme';
import { useAsync } from '@/hooks/use-async';
import { getChatHistory, sendChatMessage } from '@/lib/api';
import type { ChatMessage } from '@/types';

const SUGGESTIONS = [
  'Am I on track this month?',
  'How much on restaurants since July?',
  'Which card should I use for groceries?',
];

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
        I know your transactions, budgets and cards, and I remember your habits over time.
      </Text>
      <View style={styles.suggestions}>
        {SUGGESTIONS.map((q) => (
          <Chip key={q} label={q} onPress={() => onPick(q)} />
        ))}
      </View>
    </View>
  );
}

export default function Chat() {
  const headerHeight = useHeaderHeight();
  const history = useAsync(getChatHistory);
  // Local list once the user starts chatting; history seeds it after tab switches.
  const [local, setLocal] = useState<ChatMessage[] | null>(null);
  const [draft, setDraft] = useState('');
  const [typing, setTyping] = useState(false);
  const listRef = useRef<FlatList<ChatMessage>>(null);

  const messages = local ?? history.data ?? [];

  async function send(text: string) {
    const q = text.trim();
    if (!q || typing) return;
    setDraft('');
    const mine: ChatMessage = { id: `local_${Date.now()}`, role: 'user', text: q, createdAt: new Date().toISOString() };
    setLocal([...messages, mine]);
    setTyping(true);
    try {
      const reply = await sendChatMessage(q);
      setLocal((m) => [...(m ?? []), reply]);
    } finally {
      setTyping(false);
    }
  }

  const canSend = draft.trim().length > 0 && !typing;

  return (
    // "padding" on Android too: with edge-to-edge (SDK 54+) the window no longer resizes for the keyboard.
    <KeyboardAvoidingView style={styles.flex} behavior="padding" keyboardVerticalOffset={headerHeight}>
      <Screen scroll={false} width="narrow" contentStyle={styles.content}>
        <FlatList
          ref={listRef}
          style={styles.flex}
          contentContainerStyle={styles.list}
          data={messages}
          keyExtractor={(m) => m.id}
          renderItem={({ item }) => <Bubble message={item} />}
          ListEmptyComponent={history.data ? <Welcome onPick={send} /> : <Loading />}
          ListFooterComponent={
            typing ? (
              <View style={[styles.bubble, styles.theirs]}>
                <TypingDots />
              </View>
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
      </Screen>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { flex: 1, paddingBottom: spacing.md, gap: spacing.md },
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
