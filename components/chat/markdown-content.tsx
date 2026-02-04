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
            <h1 className={cn("text-2xl font-bold mt-6 mb-4 first:mt-0", className)} {...props} />
          ),
          h2: ({ className, ...props }) => (
            <h2 className={cn("text-xl font-semibold mt-5 mb-3 first:mt-0", className)} {...props} />
          ),
          h3: ({ className, ...props }) => (
            <h3 className={cn("text-lg font-semibold mt-4 mb-2 first:mt-0", className)} {...props} />
          ),
          h4: ({ className, ...props }) => (
            <h4 className={cn("text-base font-semibold mt-3 mb-2 first:mt-0", className)} {...props} />
          ),
          h5: ({ className, ...props }) => (
            <h5 className={cn("text-sm font-semibold mt-2 mb-1 first:mt-0", className)} {...props} />
          ),
          h6: ({ className, ...props }) => (
            <h6 className={cn("text-sm font-medium mt-2 mb-1 first:mt-0", className)} {...props} />
          ),
          // Paragraphs
          p: ({ className, ...props }) => (
            <p className={cn("mb-4 last:mb-0 leading-relaxed", className)} {...props} />
          ),
          // Lists
          ul: ({ className, ...props }) => (
            <ul className={cn("mb-4 ml-6 list-disc space-y-1 last:mb-0", className)} {...props} />
          ),
          ol: ({ className, ...props }) => (
            <ol className={cn("mb-4 ml-6 list-decimal space-y-1 last:mb-0", className)} {...props} />
          ),
          li: ({ className, ...props }) => (
            <li className={cn("pl-1 leading-relaxed", className)} {...props} />
          ),
          // Links
          a: ({ className, ...props }) => (
            <a
              className={cn("text-primary underline underline-offset-2 hover:text-primary/80 transition-colors", className)}
              target="_blank"
              rel="noopener noreferrer"
              {...props}
            />
          ),
          // Code blocks
          code: ({ className: codeClassName, children, ...props }) => {
            const isInline = !codeClassName;
            return isInline ? (
              <code
                className="px-1.5 py-0.5 bg-muted rounded text-sm font-mono text-foreground"
                {...props}
              >
                {children}
              </code>
            ) : (
              <code className={codeClassName} {...props}>
                {children}
              </code>
            );
          },
          pre: ({ className, ...props }) => (
            <pre
              className={cn("mb-4 p-4 bg-muted rounded-lg overflow-x-auto last:mb-0", className)}
              {...props}
            />
          ),
          // Blockquotes
          blockquote: ({ className, ...props }) => (
            <blockquote
              className={cn("border-l-4 border-primary/30 pl-4 py-2 my-4 italic text-muted-foreground bg-muted/50 rounded-r last:my-0", className)}
              {...props}
            />
          ),
          // Horizontal rule
          hr: ({ className, ...props }) => (
            <hr className={cn("my-6 border-border last:my-0", className)} {...props} />
          ),
          // Tables
          table: ({ className, ...props }) => (
            <div className={cn("my-4 overflow-x-auto last:my-0", className)}>
              <table className="min-w-full border-collapse border border-border rounded-lg" {...props} />
            </div>
          ),
          thead: ({ className, ...props }) => (
            <thead className={cn("bg-muted", className)} {...props} />
          ),
          tbody: ({ className, ...props }) => (
            <tbody className={className} {...props} />
          ),
          tr: ({ className, ...props }) => (
            <tr className={cn("border-b border-border last:border-b-0", className)} {...props} />
          ),
          th: ({ className, ...props }) => (
            <th className={cn("px-4 py-2 text-left font-semibold text-sm border-r border-border last:border-r-0", className)} {...props} />
          ),
          td: ({ className, ...props }) => (
            <td className={cn("px-4 py-2 text-sm border-r border-border last:border-r-0", className)} {...props} />
          ),
          // Strong/Bold
          strong: ({ className, ...props }) => (
            <strong className={cn("font-semibold text-foreground", className)} {...props} />
          ),
          // Emphasis/Italic
          em: ({ className, ...props }) => (
            <em className={cn("italic", className)} {...props} />
          ),
          // Images (img used for dynamic markdown URLs; alt required for a11y)
          img: ({ className, src, alt, ...props }) => (
            // eslint-disable-next-line @next/next/no-img-element -- markdown images are dynamic/external
            <img
              src={src}
              alt={alt ?? ""}
              className={cn("max-w-full h-auto rounded-lg my-4 last:my-0", className)}
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