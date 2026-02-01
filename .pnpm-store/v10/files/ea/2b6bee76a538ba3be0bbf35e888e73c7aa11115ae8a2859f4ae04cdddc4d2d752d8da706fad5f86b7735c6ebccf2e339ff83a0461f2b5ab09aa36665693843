import React from "react";
export const CentralIconBase = ({ children, size = 24, ariaLabel, color, ariaHidden = true, style, ...props }) => {
    return (React.createElement("svg", { ...props, "aria-hidden": ariaHidden, role: ariaHidden ? undefined : "img", width: typeof size === "number" ? `${size}px` : size, height: typeof size === "number" ? `${size}px` : size, viewBox: "0 0 24 24", fill: "none", xmlns: "http://www.w3.org/2000/svg", style: { color, ...style } },
        ariaLabel && !ariaHidden && React.createElement("title", null, ariaLabel),
        children));
};
//# sourceMappingURL=index.js.map