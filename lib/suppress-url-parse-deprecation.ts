/**
 * Suppress Node.js DEP0169 / url.parse() deprecation warnings from dependencies
 * (e.g. @supabase/supabase-js). Import this module early in entry paths that use
 * Supabase or other code that still uses legacy url.parse().
 *
 * Node can emit the warning as (messageString, "DeprecationWarning", "DEP0169")
 * or as an Error-like object with name "DeprecationWarning".
 */
if (typeof process !== "undefined" && process.emitWarning) {
  const originalEmitWarning = process.emitWarning.bind(process);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (process.emitWarning as any) = function (
    warning: string | Error,
    type?: string,
    code?: string,
    ctor?: new () => Error,
  ) {
    const message =
      typeof warning === "string"
        ? warning
        : typeof warning === "object" && warning && "message" in warning
          ? String((warning as Error).message)
          : "";
    const isDeprecation =
      type === "DeprecationWarning" ||
      code === "DEP0169" ||
      (typeof warning === "object" && warning?.name === "DeprecationWarning");
    if (isDeprecation && message.includes("url.parse()")) {
      return;
    }
    return originalEmitWarning(warning, type, code, ctor);
  };
}
