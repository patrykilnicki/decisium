---
name: review-latest-changes
description: Reviews the latest code changes (git diff, staged, or last commit) for correctness, security, style, and maintainability. Use when the user triggers a review of recent changes or asks to check that code is high-quality.
---

# Review Latest Changes

When triggered, review the **latest code changes** for high quality. Determine scope from context (uncommitted diff, staged files, or last commit), then apply the checklist below.

## Scope

1. **Identify what to review**: Prefer in this order:
   - Staged changes: `git diff --cached`
   - Uncommitted changes: `git diff`
   - Last commit: `git show` or `git diff HEAD~1 HEAD`
2. If the user specified a path, branch, or commit, use that instead.

## Review Checklist

Apply these checks to the changed code:

- **Correctness**: Logic is sound; edge cases and error paths are handled.
- **Security**: No obvious vulnerabilities (injection, XSS, sensitive data exposure, unsafe dependencies).
- **Style & conventions**: Matches project patterns (TypeScript/React/Next.js, naming, file structure).
- **Maintainability**: Functions are focused, duplication is minimal, types are used where appropriate.
- **Performance**: No unnecessary re-renders, heavy work, or missing memoization where it matters.
- **Tests**: New behavior is covered or existing tests still make sense.

## Feedback Format

Structure the review as:

1. **Summary** (1–2 sentences): Overall assessment and risk level.
2. **Critical** (must fix): Bugs, security issues, or blockers.
3. **Suggestions** (should consider): Style, clarity, maintainability, performance.
4. **Nice to have**: Optional improvements.

Keep feedback concrete: cite file and line or snippet, and suggest a fix or alternative where useful.

## Output

Deliver the review in markdown. If there are no issues, say so clearly and briefly note what was checked.
