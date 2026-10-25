import { router, useLocalSearchParams } from 'expo-router';

import { ChatHistoryList, Screen, useToast } from '@/components';
import { useAsync } from '@/hooks/use-async';
import { deleteChatThread, getChatThreads, renameChatThread } from '@/lib/api';

/**
 * Past conversations, on phones (wide screens list them beside the chat instead). Picking one
 * goes back to the Assistant tab with `thread` set; `at` makes picking the same one again count.
 */
export default function ChatHistory() {
  const { active } = useLocalSearchParams<{ active?: string }>();
  const threads = useAsync(getChatThreads);
  const toast = useToast();

  const open = (thread: string) => router.dismissTo({ pathname: '/chat', params: { thread, at: String(Date.now()) } });

  return (
    <Screen edges={['bottom']} width="narrow">
      <ChatHistoryList
        threads={threads.data}
        error={threads.error}
        onRetry={threads.reload}
        activeId={active ?? null}
        onOpen={open}
        onNewChat={() => open('new')}
        onRename={async (id, title) => {
          await renameChatThread(id, title);
          threads.reload();
        }}
        onDelete={async (id) => {
          await deleteChatThread(id);
          threads.reload();
          toast('Chat deleted');
        }}
      />
    </Screen>
  );
}
