import { marked } from "marked";
import TurndownService from "turndown";

marked.setOptions({ gfm: true });

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
});
turndown.keep(["script", "style"]);
turndown.addRule("strikethrough", {
  filter: ["del", "s", "strike"],
  replacement(content) {
    return `~~${content}~~`;
  },
});

export function markdownToHtml(markdown: string): string {
  if (!markdown?.trim()) return "<p></p>";
  return marked(markdown, { async: false }) as string;
}

export function htmlToMarkdown(html: string): string {
  if (!html?.trim()) return "";
  return turndown.turndown(html);
}
