"use client";
import { getCurrentUserClient } from "@/lib/user-client";
import type { CurrentUser } from "@/lib/user";
import { memo, useEffect, useState } from "react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { MarkdownContent } from "./markdown-content";
import { AnimatedSystemAvatar } from "./animated-system-avatar";
import type { ChatMessageProps } from "./types";

function ChatMessageComponent({
  message,
  showAvatar = true,
  isStreaming = false,
}: ChatMessageProps) {
  const isUser = message.role === "user";
  const isAssistant = message.role === "assistant";
  const isSystem = message.role === "system";
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);

  useEffect(() => {
    async function fetchUser() {
      const user = await getCurrentUserClient();
      setCurrentUser(user);
    }
    fetchUser();
  }, []);

  function getInitials(name?: string | null, email?: string | null) {
    if (name) {
      return name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2);
    }
    if (email) {
      return email[0].toUpperCase();
    }
    return "?";
  }

  return (
    <div
      className={cn(
        "flex w-full gap-4 animate-in fade-in-0 slide-in-from-bottom-2 duration-300",
        isUser && "flex-row-reverse",
        isAssistant && "gap-6",
        isSystem && "justify-center "
      )}
    >
      {/* Avatar */}
      {showAvatar && !isSystem && (
        <div className="flex-shrink-0">
          {isAssistant && isStreaming ? (
            <AnimatedSystemAvatar size="lg" />
          ) : (
            <Avatar size="lg">
              {isUser && currentUser?.photo && (
                <AvatarImage src={currentUser.photo} alt={currentUser.name || "User"} />
              )}
              <AvatarFallback
                className={cn(
                  isAssistant && "rounded-2xl bg-gradient-to-br from-emerald-400 to-teal-500 text-white"
                )}
              >
                {isUser ? (
                  getInitials(currentUser?.name, currentUser?.email)
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" width="25" height="25" viewBox="0 0 25 25" fill="none">
                    <path d="M11.3207 1.47944C11.3721 1.20423 11.5181 0.955663 11.7335 0.776789C11.9489 0.597916 12.22 0.5 12.5 0.5C12.78 0.5 13.0511 0.597916 13.2665 0.776789C13.4819 0.955663 13.6279 1.20423 13.6793 1.47944L14.9402 8.14744C15.0298 8.62151 15.2602 9.05757 15.6013 9.39871C15.9424 9.73985 16.3785 9.97023 16.8526 10.0598L23.5206 11.3207C23.7958 11.3721 24.0443 11.5181 24.2232 11.7335C24.4021 11.9489 24.5 12.22 24.5 12.5C24.5 12.78 24.4021 13.0511 24.2232 13.2665C24.0443 13.4819 23.7958 13.6279 23.5206 13.6793L16.8526 14.9402C16.3785 15.0298 15.9424 15.2602 15.6013 15.6013C15.2602 15.9424 15.0298 16.3785 14.9402 16.8526L13.6793 23.5206C13.6279 23.7958 13.4819 24.0443 13.2665 24.2232C13.0511 24.4021 12.78 24.5 12.5 24.5C12.22 24.5 11.9489 24.4021 11.7335 24.2232C11.5181 24.0443 11.3721 23.7958 11.3207 23.5206L10.0598 16.8526C9.97023 16.3785 9.73985 15.9424 9.39871 15.6013C9.05757 15.2602 8.62151 15.0298 8.14744 14.9402L1.47944 13.6793C1.20423 13.6279 0.955663 13.4819 0.776789 13.2665C0.597916 13.0511 0.5 12.78 0.5 12.5C0.5 12.22 0.597916 11.9489 0.776789 11.7335C0.955663 11.5181 1.20423 11.3721 1.47944 11.3207L8.14744 10.0598C8.62151 9.97023 9.05757 9.73985 9.39871 9.39871C9.73985 9.05757 9.97023 8.62151 10.0598 8.14744L11.3207 1.47944Z" fill="url(#paint0_radial_60_878)"/>
                    <path d="M12.5 0.25C12.8381 0.25 13.1656 0.368101 13.4258 0.583984C13.6858 0.799929 13.8625 1.10043 13.9248 1.43262L15.1855 8.10059C15.2658 8.52526 15.4727 8.91608 15.7783 9.22168C16.0457 9.48904 16.3778 9.68089 16.7412 9.77832L16.8994 9.81445L23.5674 11.0752H23.5664C23.899 11.1373 24.1999 11.314 24.416 11.5742C24.6319 11.8344 24.75 12.1619 24.75 12.5C24.75 12.8381 24.6319 13.1656 24.416 13.4258C24.1999 13.686 23.8989 13.8617 23.5664 13.9238L23.5674 13.9248L16.8994 15.1855C16.4747 15.2658 16.0839 15.4727 15.7783 15.7783C15.4727 16.0839 15.2658 16.4747 15.1855 16.8994L13.9248 23.5674C13.8625 23.8996 13.6858 24.2001 13.4258 24.416C13.1656 24.6319 12.8381 24.75 12.5 24.75C12.1619 24.75 11.8344 24.6319 11.5742 24.416C11.3142 24.2001 11.1375 23.8996 11.0752 23.5674L9.81445 16.8994C9.73423 16.4747 9.52728 16.0839 9.22168 15.7783C8.91608 15.4727 8.52526 15.2658 8.10059 15.1855L1.43262 13.9248V13.9238C1.1005 13.8615 0.79989 13.6857 0.583984 13.4258C0.368101 13.1656 0.25 12.8381 0.25 12.5C0.25 12.1619 0.3681 11.8344 0.583984 11.5742C0.799929 11.3142 1.10043 11.1375 1.43262 11.0752L8.10059 9.81445C8.52526 9.73423 8.91608 9.52728 9.22168 9.22168C9.52728 8.91608 9.73423 8.52526 9.81445 8.10059L11.0752 1.43262C11.1375 1.10043 11.3142 0.799929 11.5742 0.583984C11.8344 0.3681 12.1619 0.25 12.5 0.25Z" stroke="black" strokeOpacity="0.1" strokeWidth="0.5" strokeLinecap="round" strokeLinejoin="round"/>
                    <defs>
                      <radialGradient id="paint0_radial_60_878" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(0.5 24.5) rotate(-45) scale(33.9411)">
                        <stop stopColor="#C7FAEE"/>
                        <stop offset="1" stopColor="#E3FDF7"/>
                      </radialGradient>
                    </defs>
                  </svg>
                )}
              </AvatarFallback>
            </Avatar>
          )}
        </div>
      )}

      {/* Message Content */}
      <div
        className={cn(
          "flex flex-col gap-1",
          isUser && "items-end",
          isSystem && "items-center",
          !isSystem && "max-w-[85%] sm:max-w-[75%]"
        )}
      >
        <div
          className={cn(
    
            isUser && "bg-secondary/50 text-foreground rounded-2xl px-4 py-3 border border-border",
            isAssistant && " rounded-none",
            isSystem && "bg-muted/50 text-muted-foreground text-sm px-3 py-1.5",
            isStreaming && "animate-pulse"
          )}
        >
          {isAssistant ? (
            <>
              <MarkdownContent content={message.content} className="text-base" />
              {isStreaming && (
                <span className="inline-block w-1.5 h-4 ml-0.5 bg-current animate-pulse rounded-sm" />
              )}
            </>
          ) : (
            <div
              className={cn(
                "whitespace-pre-wrap break-words text-base leading-relaxed",
                isUser && "text-base font-medium"
              )}
            >
              {message.content}
            </div>
          )}
        </div>

        {/* Timestamp */}
        {message.createdAt && !isSystem && (
          <span
            className={cn(
              "text-xs text-muted-foreground",
              isAssistant && "mt-2",
              isUser && "text-right"
            )}
          >
            {format(new Date(message.createdAt), "h:mm a")}
          </span>
        )}
      </div>
    </div>
  );
}

// Memoize to prevent unnecessary re-renders
export const ChatMessage = memo(ChatMessageComponent, (prev, next) => {
  return (
    prev.message.id === next.message.id &&
    prev.message.content === next.message.content &&
    prev.isStreaming === next.isStreaming
  );
});

ChatMessage.displayName = "ChatMessage";
