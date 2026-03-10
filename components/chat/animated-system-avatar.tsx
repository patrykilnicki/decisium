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

  const viewBoxSize = 44;
  const center = viewBoxSize / 2;
  const radius = 18;
  const uniqueId = useId();
  const clipId = `${uniqueId}-clip`;
  const bgGradientId = `${uniqueId}-bg`;
  const shimmerId = `${uniqueId}-shimmer`;
  const ringId = `${uniqueId}-ring`;

  return (
    <div
      className={cn(
        "flex items-center justify-center",
        size === "sm" && "size-6",
        size === "default" && "size-8",
        size === "lg" && "size-10",
        className,
      )}
    >
      <svg
        width={sizeMap[size]}
        height={sizeMap[size]}
        viewBox={`0 0 ${viewBoxSize} ${viewBoxSize}`}
        className="overflow-visible"
        role="img"
        aria-label="System avatar"
      >
        <defs>
          <linearGradient id={bgGradientId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#0f172a" />
            <stop offset="100%" stopColor="#1f2937" />
          </linearGradient>

          <radialGradient id={ringId} cx="50%" cy="50%" r="55%">
            <stop offset="0%" stopColor="#2dd4bf" stopOpacity="0.9" />
            <stop offset="100%" stopColor="#22d3ee" stopOpacity="0.7" />
          </radialGradient>

          <linearGradient id={shimmerId} x1="-120%" y1="0%" x2="-20%" y2="0%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0" />
            <stop offset="45%" stopColor="#ffffff" stopOpacity="0" />
            <stop offset="52%" stopColor="#ffffff" stopOpacity="0.7" />
            <stop offset="60%" stopColor="#ffffff" stopOpacity="0" />
            <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
            <animate
              attributeName="x1"
              values="-120%;120%"
              dur="2.1s"
              repeatCount="indefinite"
            />
            <animate
              attributeName="x2"
              values="-20%;220%"
              dur="2.1s"
              repeatCount="indefinite"
            />
          </linearGradient>

          <clipPath id={clipId}>
            <circle cx={center} cy={center} r={radius} />
          </clipPath>
        </defs>

        <circle
          cx={center}
          cy={center}
          r={radius}
          fill={`url(#${bgGradientId})`}
        />

        <circle
          cx={center}
          cy={center}
          r={radius - 1}
          fill="none"
          stroke={`url(#${ringId})`}
          strokeWidth={2.25}
          opacity={0.7}
        />

        <g clipPath={`url(#${clipId})`}>
          <image
            href="/logo.svg"
            x={4}
            y={4}
            width={36}
            height={36}
            preserveAspectRatio="xMidYMid meet"
          />

          <rect
            x={center - radius}
            y={center - radius}
            width={radius * 2}
            height={radius * 2}
            fill={`url(#${shimmerId})`}
            opacity={0.9}
            style={{ mixBlendMode: "screen" }}
          />
        </g>

        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke="rgba(255,255,255,0.14)"
          strokeWidth={1}
        />
      </svg>
    </div>
  );
}
