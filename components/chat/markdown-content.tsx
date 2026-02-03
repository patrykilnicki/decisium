"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

interface MarkdownContentProps {
  content: string;
  className?: string;
}

export function MarkdownContent({ content, className }: MarkdownContentProps) {
  return (
    <div className={cn("markdown-content", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // Headings
          h1: ({ className, ...props }) => (
            <h1 className="text-2xl font-bold mt-6 mb-4 first:mt-0" {...props} />
          ),
          h2: ({ className, ...props }) => (
            <h2 className="text-xl font-semibold mt-5 mb-3 first:mt-0" {...props} />
          ),
          h3: ({ className, ...props }) => (
            <h3 className="text-lg font-semibold mt-4 mb-2 first:mt-0" {...props} />
          ),
          h4: ({ className, ...props }) => (
            <h4 className="text-base font-semibold mt-3 mb-2 first:mt-0" {...props} />
          ),
          h5: ({ className, ...props }) => (
            <h5 className="text-sm font-semibold mt-2 mb-1 first:mt-0" {...props} />
          ),
          h6: ({ className, ...props }) => (
            <h6 className="text-sm font-medium mt-2 mb-1 first:mt-0" {...props} />
          ),
          // Paragraphs
          p: ({ className, ...props }) => (
            <p className="mb-4 last:mb-0 leading-relaxed" {...props} />
          ),
          // Lists
          ul: ({ className, ...props }) => (
            <ul className="mb-4 ml-6 list-disc space-y-1 last:mb-0" {...props} />
          ),
          ol: ({ className, ...props }) => (
            <ol className="mb-4 ml-6 list-decimal space-y-1 last:mb-0" {...props} />
          ),
          li: ({ className, ...props }) => (
            <li className="pl-1 leading-relaxed" {...props} />
          ),
          // Links
          a: ({ className, ...props }) => (
            <a
              className="text-primary underline underline-offset-2 hover:text-primary/80 transition-colors"
              target="_blank"
              rel="noopener noreferrer"
              {...props}
            />
          ),
          // Code blocks
          code: ({ className, children, ...props }) => {
            const isInline = !className;
            return isInline ? (
              <code
                className="px-1.5 py-0.5 bg-muted rounded text-sm font-mono text-foreground"
                {...props}
              >
                {children}
              </code>
            ) : (
              <code className={className} {...props}>
                {children}
              </code>
            );
          },
          pre: ({ className, ...props }) => (
            <pre
              className="mb-4 p-4 bg-muted rounded-lg overflow-x-auto last:mb-0"
              {...props}
            />
          ),
          // Blockquotes
          blockquote: ({ className, ...props }) => (
            <blockquote
              className="border-l-4 border-primary/30 pl-4 py-2 my-4 italic text-muted-foreground bg-muted/50 rounded-r last:my-0"
              {...props}
            />
          ),
          // Horizontal rule
          hr: ({ className, ...props }) => (
            <hr className="my-6 border-border last:my-0" {...props} />
          ),
          // Tables
          table: ({ className, ...props }) => (
            <div className="my-4 overflow-x-auto last:my-0">
              <table className="min-w-full border-collapse border border-border rounded-lg" {...props} />
            </div>
          ),
          thead: ({ className, ...props }) => (
            <thead className="bg-muted" {...props} />
          ),
          tbody: ({ className, ...props }) => (
            <tbody {...props} />
          ),
          tr: ({ className, ...props }) => (
            <tr className="border-b border-border last:border-b-0" {...props} />
          ),
          th: ({ className, ...props }) => (
            <th className="px-4 py-2 text-left font-semibold text-sm border-r border-border last:border-r-0" {...props} />
          ),
          td: ({ className, ...props }) => (
            <td className="px-4 py-2 text-sm border-r border-border last:border-r-0" {...props} />
          ),
          // Strong/Bold
          strong: ({ className, ...props }) => (
            <strong className="font-semibold text-foreground" {...props} />
          ),
          // Emphasis/Italic
          em: ({ className, ...props }) => (
            <em className="italic" {...props} />
          ),
          // Images
          img: ({ className, ...props }) => (
            <img
              className="max-w-full h-auto rounded-lg my-4 last:my-0"
              {...props}
            />
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}