"use client";

import type { UseChatHelpers } from "@ai-sdk/react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { usePathname } from "next/navigation";
import {
  createContext,
  useCallback,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import useSWR, { useSWRConfig } from "swr";
import { unstable_serialize } from "swr/infinite";
import { useDataStream } from "@/components/chat/data-stream-provider";
import { DEFAULT_CHAT_MODEL } from "@/config/chat-models";
import {
  getChatHistoryPaginationKey,
  NEW_CHAT_TITLE,
  PENDING_CHAT_TITLE_TIMEOUT_MS,
  type ChatHistory,
} from "@/components/chat/sidebar-history";
import { toast } from "@/components/chat/toast";
import type { VisibilityType } from "@/components/chat/visibility-selector";
import { useAutoResume } from "@/hooks/use-auto-resume";
import type { Vote } from "@/lib/db/schema";
import { ChatbotError } from "@/lib/errors";
import type { ChatMessage } from "@/lib/types";
import { fetcher, fetchWithErrorHandlers, generateUUID } from "@/lib/utils";

type ActiveChatContextValue = {
  chatId: string;
  messages: ChatMessage[];
  setMessages: UseChatHelpers<ChatMessage>["setMessages"];
  sendMessage: UseChatHelpers<ChatMessage>["sendMessage"];
  status: UseChatHelpers<ChatMessage>["status"];
  stop: UseChatHelpers<ChatMessage>["stop"];
  regenerate: UseChatHelpers<ChatMessage>["regenerate"];
  addToolApprovalResponse: UseChatHelpers<ChatMessage>["addToolApprovalResponse"];
  input: string;
  setInput: Dispatch<SetStateAction<string>>;
  visibilityType: VisibilityType;
  isReadonly: boolean;
  isLoading: boolean;
  votes: Vote[] | undefined;
  currentModelId: string;
  setCurrentModelId: (id: string) => void;
  showCreditCardAlert: boolean;
  setShowCreditCardAlert: Dispatch<SetStateAction<boolean>>;
};

const ActiveChatContext = createContext<ActiveChatContextValue | null>(null);

function extractChatId(pathname: string): string | null {
  const match = pathname.match(/\/chat\/([^/]+)/);
  return match ? match[1] : null;
}

function upsertPendingChatHistory(
  existingPages: ChatHistory[] | undefined,
  {
    chatId,
    visibility,
  }: {
    chatId: string;
    visibility: VisibilityType;
  }
): ChatHistory[] {
  const optimisticChat = {
    id: chatId,
    createdAt: new Date(),
    title: NEW_CHAT_TITLE,
    userId: "",
    visibility,
    pendingTitleUntil: Date.now() + PENDING_CHAT_TITLE_TIMEOUT_MS,
  };

  if (!existingPages || existingPages.length === 0) {
    return [{ chats: [optimisticChat], hasMore: false }];
  }

  const existingChatIndex = existingPages[0]?.chats.findIndex(
    (chat) => chat.id === chatId
  );

  if (typeof existingChatIndex === "number" && existingChatIndex >= 0) {
    return existingPages.map((page, pageIndex) => {
      if (pageIndex !== 0) {
        return page;
      }

      const chats = page.chats.slice();
      const existingChat = chats[existingChatIndex];

      chats[existingChatIndex] = {
        ...existingChat,
        pendingTitleUntil: optimisticChat.pendingTitleUntil,
      };

      return { ...page, chats };
    });
  }

  return existingPages.map((page, pageIndex) => {
    if (pageIndex !== 0) {
      return page;
    }

    return {
      ...page,
      chats: [optimisticChat, ...page.chats],
    };
  });
}

export function ActiveChatProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { setDataStream } = useDataStream();
  const { mutate } = useSWRConfig();

  const chatIdFromUrl = extractChatId(pathname);
  const isNewChat = !chatIdFromUrl;
  const newChatIdRef = useRef(generateUUID());
  const prevPathnameRef = useRef(pathname);

  if (isNewChat && prevPathnameRef.current !== pathname) {
    newChatIdRef.current = generateUUID();
  }
  prevPathnameRef.current = pathname;

  const chatId = chatIdFromUrl ?? newChatIdRef.current;

  const [currentModelId, setCurrentModelId] = useState(DEFAULT_CHAT_MODEL);
  const currentModelIdRef = useRef(currentModelId);
  useEffect(() => {
    currentModelIdRef.current = currentModelId;
  }, [currentModelId]);

  const [input, setInput] = useState("");
  const [showCreditCardAlert, setShowCreditCardAlert] = useState(false);
  const { data: modelsData } = useSWR(
    `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/models`,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 3_600_000 }
  );
  const fixedModelId: string | undefined =
    Array.isArray(modelsData?.models) && modelsData.models.length === 1
      ? modelsData.defaultModelId
      : undefined;

  const { data: chatData, isLoading } = useSWR(
    isNewChat
      ? null
      : `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/messages?chatId=${chatId}`,
    fetcher,
    { revalidateOnFocus: false }
  );

  const initialMessages: ChatMessage[] = isNewChat
    ? []
    : (chatData?.messages ?? []);
  const visibility: VisibilityType = isNewChat
    ? "private"
    : (chatData?.visibility ?? "private");

  const {
    messages,
    setMessages,
    sendMessage,
    status,
    stop,
    regenerate,
    resumeStream,
    addToolApprovalResponse,
  } = useChat<ChatMessage>({
    id: chatId,
    messages: initialMessages,
    generateId: generateUUID,
    sendAutomaticallyWhen: ({ messages: currentMessages }) => {
      const lastMessage = currentMessages.at(-1);
      return (
        lastMessage?.parts?.some(
          (part) =>
            "state" in part &&
            part.state === "approval-responded" &&
            "approval" in part &&
            (part.approval as { approved?: boolean })?.approved === true
        ) ?? false
      );
    },
    transport: new DefaultChatTransport({
      api: `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/chat`,
      fetch: fetchWithErrorHandlers,
      prepareSendMessagesRequest(request) {
        const lastMessage = request.messages.at(-1);
        const isToolApprovalContinuation =
          lastMessage?.role !== "user" ||
          request.messages.some((msg) =>
            msg.parts?.some((part) => {
              const state = (part as { state?: string }).state;
              return (
                state === "approval-responded" || state === "output-denied"
              );
            })
          );

        return {
          body: {
            id: request.id,
            ...(isToolApprovalContinuation
              ? { messages: request.messages }
              : { message: lastMessage }),
            selectedChatModel: currentModelIdRef.current,
            selectedVisibilityType: visibility,
            ...request.body,
          },
        };
      },
    }),
    onData: (dataPart) => {
      setDataStream((ds) => (ds ? [...ds, dataPart] : []));
    },
    onFinish: () => {
      mutate(unstable_serialize(getChatHistoryPaginationKey));
    },
    onError: (error) => {
      if (error.message?.includes("AI Gateway requires a valid credit card")) {
        setShowCreditCardAlert(true);
      } else if (error instanceof ChatbotError) {
        toast({ type: "error", description: error.message });
      } else {
        toast({
          type: "error",
          description: error.message || "Oops, an error occurred!",
        });
      }
    },
  });

  const sendMessageWithHistorySync: typeof sendMessage = useCallback(
    (message, options) => {
      const isUserMessage =
        typeof message === "object" &&
        message !== null &&
        "role" in message &&
        message.role === "user";
      const shouldInsertPendingChat =
        isNewChat && messages.length === 0 && isUserMessage;

      if (shouldInsertPendingChat) {
        mutate(
          unstable_serialize(getChatHistoryPaginationKey),
          (existingPages?: ChatHistory[]) =>
            upsertPendingChatHistory(existingPages, {
              chatId,
              visibility,
            }),
          { revalidate: false }
        );
      }

      return sendMessage(message, options);
    },
    [chatId, isNewChat, messages.length, mutate, sendMessage, visibility]
  );

  const loadedChatIds = useRef(new Set<string>());

  if (isNewChat && !loadedChatIds.current.has(newChatIdRef.current)) {
    loadedChatIds.current.add(newChatIdRef.current);
  }

  useEffect(() => {
    if (loadedChatIds.current.has(chatId)) {
      return;
    }
    if (chatData?.messages) {
      loadedChatIds.current.add(chatId);
      setMessages(chatData.messages);
    }
  }, [chatId, chatData?.messages, setMessages]);

  const prevChatIdRef = useRef(chatId);
  useEffect(() => {
    if (prevChatIdRef.current !== chatId) {
      prevChatIdRef.current = chatId;
      if (isNewChat) {
        setMessages([]);
      }
    }
  }, [chatId, isNewChat, setMessages]);

  useEffect(() => {
    if (chatData && !isNewChat) {
      if (fixedModelId) {
        setCurrentModelId(fixedModelId);
        return;
      }

      const cookieModel = document.cookie
        .split("; ")
        .find((row) => row.startsWith("chat-model="))
        ?.split("=")[1];
      if (cookieModel) {
        setCurrentModelId(decodeURIComponent(cookieModel));
      }
    }
  }, [chatData, fixedModelId, isNewChat]);

  useEffect(() => {
    if (!fixedModelId) {
      return;
    }

    setCurrentModelId(fixedModelId);
  }, [fixedModelId]);

  const hasAppendedQueryRef = useRef(false);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const query = params.get("query");
    if (query && !hasAppendedQueryRef.current) {
      hasAppendedQueryRef.current = true;
      window.history.replaceState(
        {},
        "",
        `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/chat/${chatId}`
      );
      sendMessage({
        role: "user" as const,
        parts: [{ type: "text", text: query }],
      });
    }
  }, [sendMessage, chatId]);

  useAutoResume({
    autoResume: !isNewChat && !!chatData,
    initialMessages,
    resumeStream,
    setMessages,
  });

  const isReadonly = isNewChat ? false : (chatData?.isReadonly ?? false);

  const { data: votes } = useSWR<Vote[]>(
    !isReadonly && messages.length >= 2
      ? `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/vote?chatId=${chatId}`
      : null,
    fetcher,
    { revalidateOnFocus: false }
  );

  const value = useMemo<ActiveChatContextValue>(
    () => ({
      chatId,
      messages,
      setMessages,
      sendMessage: sendMessageWithHistorySync,
      status,
      stop,
      regenerate,
      addToolApprovalResponse,
      input,
      setInput,
      visibilityType: visibility,
      isReadonly,
      isLoading: !isNewChat && isLoading,
      votes,
      currentModelId,
      setCurrentModelId,
      showCreditCardAlert,
      setShowCreditCardAlert,
    }),
    [
      chatId,
      messages,
      setMessages,
      sendMessageWithHistorySync,
      status,
      stop,
      regenerate,
      addToolApprovalResponse,
      input,
      visibility,
      isReadonly,
      isNewChat,
      isLoading,
      votes,
      currentModelId,
      showCreditCardAlert,
    ]
  );

  return (
    <ActiveChatContext.Provider value={value}>
      {children}
    </ActiveChatContext.Provider>
  );
}

export function useActiveChat() {
  const context = useContext(ActiveChatContext);
  if (!context) {
    throw new Error("useActiveChat must be used within ActiveChatProvider");
  }
  return context;
}
