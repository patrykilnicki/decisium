"use client";

import { CentralIcon as CentralIconPrimitive } from "@central-icons-react/all";
import { cn } from "@/lib/utils";

type CentralIconName = React.ComponentProps<
  typeof CentralIconPrimitive
>["name"];

interface CentralIconProps extends Omit<
  React.ComponentProps<typeof CentralIconPrimitive>,
  "join" | "fill" | "radius" | "stroke"
> {
  iconJoin?: "round" | "square";
  iconFill?: "filled" | "outlined";
  iconStroke?: "1" | "1.5" | "2";
  iconRadius?: "0" | "1" | "2" | "3";
  name: CentralIconName;
  className?: string;
}

function CentralIcon({
  iconJoin = "round",
  iconFill = "outlined",
  iconStroke = "1.5",
  iconRadius = "2",
  name,
  className,
  ...props
}: CentralIconProps) {
  return (
    <CentralIconPrimitive
      join={iconJoin}
      fill={iconFill}
      radius={iconRadius}
      stroke={iconStroke}
      name={name}
      className={cn(className)}
      {...props}
    />
  );
}

export { CentralIcon };
export type { CentralIconProps };
