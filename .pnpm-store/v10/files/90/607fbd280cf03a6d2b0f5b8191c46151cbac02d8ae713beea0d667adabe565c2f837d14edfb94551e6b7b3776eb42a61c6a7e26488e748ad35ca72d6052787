"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getNumberProperty = getNumberProperty;
function getNumberProperty(obj, key) {
    if (!obj || typeof obj !== "object" || !(key in obj)) {
        return undefined;
    }
    const value = Reflect.get(obj, key);
    return typeof value === "number" ? value : undefined;
}
