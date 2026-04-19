import equal from "fast-deep-equal";
import { memo } from "react";
import { toast } from "sonner";
import { useSWRConfig } from "swr";
import { useCopyToClipboard } from "usehooks-ts";
import type { Vote } from "@/lib/db/schema";
import { ChatbotError } from "@/lib/errors";
import type { ChatMessage } from "@/lib/types";
import { fetchWithErrorHandlers } from "@/lib/utils";
import {
  MessageAction as Action,
  MessageActions as Actions,
} from "../ai-elements/message";
import { CopyIcon, PencilEditIcon, ThumbDownIcon, ThumbUpIcon } from "./icons";

export function PureMessageActions({
  chatId,
  message,
  vote,
  isLoading,
  canVote,
  onEdit,
}: {
  chatId: string;
  message: ChatMessage;
  vote: Vote | undefined;
  isLoading: boolean;
  canVote: boolean;
  onEdit?: () => void;
}) {
  const { mutate } = useSWRConfig();
  const [_, copyToClipboard] = useCopyToClipboard();
  const voteCacheKey = `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/vote?chatId=${chatId}`;
  const votingDisabled = !canVote;

  if (isLoading) {
    return null;
  }

  const textFromParts = message.parts
    ?.filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim();

  const handleCopy = async () => {
    if (!textFromParts) {
      toast.error("There's no text to copy!");
      return;
    }

    await copyToClipboard(textFromParts);
    toast.success("Copied to clipboard!");
  };

  const sleep = (ms: number) =>
    new Promise((resolve) => {
      setTimeout(resolve, ms);
    });

  const submitVote = async (type: "up" | "down") => {
    const maxAttempts = 3;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        await fetchWithErrorHandlers(
          `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/vote`,
          {
            method: "PATCH",
            body: JSON.stringify({
              chatId,
              messageId: message.id,
              type,
            }),
          }
        );
        break;
      } catch (error) {
        const shouldRetry =
          error instanceof ChatbotError &&
          error.type === "not_found" &&
          error.surface === "vote" &&
          attempt < maxAttempts;

        if (!shouldRetry) {
          throw error;
        }

        await sleep(300 * attempt);
      }
    }

    mutate<Vote[]>(
      voteCacheKey,
      (currentVotes) => {
        if (!currentVotes) {
          return [];
        }

        const votesWithoutCurrent = currentVotes.filter(
          (currentVote) => currentVote.messageId !== message.id
        );

        return [
          ...votesWithoutCurrent,
          {
            chatId,
            messageId: message.id,
            isUpvoted: type === "up",
          },
        ];
      },
      { revalidate: false }
    );
  };

  if (message.role === "user") {
    return (
      <Actions className="-mr-0.5 justify-end opacity-0 transition-opacity duration-150 group-hover/message:opacity-100">
        <div className="flex items-center gap-0.5">
          {onEdit && (
            <Action
              className="size-7 text-muted-foreground/50 hover:text-foreground"
              data-testid="message-edit-button"
              onClick={onEdit}
              tooltip="Edit"
            >
              <PencilEditIcon />
            </Action>
          )}
          <Action
            className="size-7 text-muted-foreground/50 hover:text-foreground"
            onClick={handleCopy}
            tooltip="Copy"
          >
            <CopyIcon />
          </Action>
        </div>
      </Actions>
    );
  }

  return (
    <Actions className="-ml-0.5 opacity-0 transition-opacity duration-150 group-hover/message:opacity-100">
      <Action
        className="text-muted-foreground/50 hover:text-foreground"
        onClick={handleCopy}
        tooltip="Copy"
      >
        <CopyIcon />
      </Action>

      <Action
        className="text-muted-foreground/50 hover:text-foreground"
        data-testid="message-upvote"
        disabled={votingDisabled || vote?.isUpvoted}
        onClick={() => {
          toast.promise(submitVote("up"), {
            loading: "Upvoting Response...",
            success: "Upvoted Response!",
            error: (error) =>
              error instanceof Error
                ? error.message
                : "Failed to upvote response.",
          });
        }}
        tooltip="Upvote Response"
      >
        <ThumbUpIcon />
      </Action>

      <Action
        className="text-muted-foreground/50 hover:text-foreground"
        data-testid="message-downvote"
        disabled={votingDisabled || (vote && !vote.isUpvoted)}
        onClick={() => {
          toast.promise(submitVote("down"), {
            loading: "Downvoting Response...",
            success: "Downvoted Response!",
            error: (error) =>
              error instanceof Error
                ? error.message
                : "Failed to downvote response.",
          });
        }}
        tooltip="Downvote Response"
      >
        <ThumbDownIcon />
      </Action>
    </Actions>
  );
}

export const MessageActions = memo(
  PureMessageActions,
  (prevProps, nextProps) => {
    if (prevProps.canVote !== nextProps.canVote) {
      return false;
    }
    if (!equal(prevProps.vote, nextProps.vote)) {
      return false;
    }
    if (prevProps.isLoading !== nextProps.isLoading) {
      return false;
    }

    return true;
  }
);
