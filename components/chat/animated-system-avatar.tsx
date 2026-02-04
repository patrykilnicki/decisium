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
  const circumference = 2 * Math.PI * radius;
  const strokeWidth = 2.5;
  const uniqueId = useId();

  return (
    <div
      className={cn(
        "flex items-center justify-center",
        size === "sm" && "size-6",
        size === "default" && "size-8",
        size === "lg" && "size-10",
        className
      )}
    >
      <svg
        width={sizeMap[size]}
        height={sizeMap[size]}
        viewBox={`0 0 ${viewBoxSize} ${viewBoxSize}`}
        className="overflow-visible"
      >
        <defs>
          <linearGradient
            id={uniqueId}
            x1="0%"
            y1="0%"
            x2="100%"
            y2="100%"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0%" stopColor="#10b981" />
            <stop offset="50%" stopColor="#14b8a6" />
            <stop offset="100%" stopColor="#06b6d4" />
          </linearGradient>
        </defs>
        
        {/* White background circle */}
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="white"
        />
        
        {/* Animated gradient stroke - smooth loading effect */}
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke={`url(#${uniqueId})`}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={`${circumference * 0.7} ${circumference}`}
          className="animate-spin"
          style={{
            transformOrigin: "center",
            animationDuration: "1.5s",
            animationTimingFunction: "linear",
          }}
        />
      </svg>
    </div>
  );
}
