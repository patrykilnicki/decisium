"use client";

import { cn } from "@/lib/utils";
import { useId } from "react";

interface AnimatedSystemAvatarProps {
  size?: "sm" | "default" | "lg";
  className?: string;
}

export function AnimatedSystemAvatar({
  size = "lg",
  className,
}: AnimatedSystemAvatarProps) {
  const sizeMap = {
    sm: 24,
    default: 32,
    lg: 40,
  };

  const id = useId();
  const shimmerId = `${id}-shimmer`;

  return (
    <div
      className={cn(
        "inline-flex items-center justify-center animate-[pulse-scale_2.4s_ease-in-out_infinite]",
        size === "sm" && "size-6",
        size === "default" && "size-8",
        size === "lg" && "size-10",
        className,
      )}
    >
      <svg
        width={sizeMap[size]}
        height={sizeMap[size]}
        viewBox="0 0 32 32"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        role="img"
        aria-label="System avatar"
      >
        <defs>
          <linearGradient id={shimmerId} x1="-100%" y1="0%" x2="200%" y2="0%">
            <stop offset="0%" stopColor="hsl(var(--muted))" />
            <stop offset="30%" stopColor="hsl(var(--muted))" />
            <stop offset="42%" stopColor="hsl(var(--muted-foreground) / 0.2)" />
            <stop
              offset="50%"
              stopColor="hsl(var(--muted-foreground) / 0.45)"
            />
            <stop offset="58%" stopColor="hsl(var(--muted-foreground) / 0.2)" />
            <stop offset="70%" stopColor="hsl(var(--muted))" />
            <stop offset="100%" stopColor="hsl(var(--muted))" />
            <animateTransform
              attributeName="gradientTransform"
              type="translate"
              from="-0.5 0"
              to="1.5 0"
              dur="2.5s"
              repeatCount="indefinite"
            />
          </linearGradient>
        </defs>
        <path
          fillRule="evenodd"
          clipRule="evenodd"
          d="M23.3846 0C28.1428 0 32 3.85724 32 8.61539V23.3846C32 28.1428 28.1428 32 23.3846 32H8.61539C3.85724 32 0 28.1428 0 23.3846V8.61539C0 3.85724 3.85724 0 8.61539 0H23.3846ZM16 3.69231C14.6405 3.69231 13.5719 4.80607 13.3222 6.14242C12.5927 10.0473 10.0473 12.5927 6.14242 13.3222C4.80607 13.5719 3.69231 14.6405 3.69231 16C3.69231 17.3595 4.80607 18.4281 6.14242 18.6778C10.0473 19.4073 12.5927 21.9527 13.3222 25.8576C13.5719 27.1939 14.6405 28.3077 16 28.3077C17.3595 28.3077 18.4281 27.1939 18.6778 25.8576C19.4073 21.9527 21.9527 19.4073 25.8576 18.6778C27.1939 18.4281 28.3077 17.3595 28.3077 16C28.3077 14.6405 27.1939 13.5719 25.8576 13.3222C21.9527 12.5927 19.4073 10.0473 18.6778 6.14242C18.4281 4.80607 17.3595 3.69231 16 3.69231Z"
          fill={`url(#${shimmerId})`}
        />
      </svg>
    </div>
  );
}
