"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Collaboration from "@tiptap/extension-collaboration";
import Underline from "@tiptap/extension-underline";
import Link from "@tiptap/extension-link";
import DragHandle from "@tiptap/extension-drag-handle-react";
import NodeRange from "@tiptap/extension-node-range";
import * as Y from "yjs";
import { CentralIcon } from "@/components/ui/central-icon";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { markdownToHtml, htmlToMarkdown } from "@/lib/vault/markdown-utils";

interface VaultEditorProps {
  documentId: string;
  initialTitle?: string;
  initialYdocBase64?: string | null;
  initialContentMarkdown?: string | null;
  onTitleChange?: (title: string) => void;
}

const SAVE_DEBOUNCE_MS = 2000;

function MenuBar({ editor }: { editor: Editor | null }) {
  const setLink = useCallback(() => {
    if (!editor) return;
    const previousUrl = editor.getAttributes("link").href;
    const url = window.prompt("URL", previousUrl ?? "https://");
    if (url === null) return;
    if (url === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
    } else {
      editor
        .chain()
        .focus()
        .extendMarkRange("link")
        .setLink({ href: url })
        .run();
    }
  }, [editor]);

  if (!editor) return null;

  return (
    <div className="flex flex-wrap items-center gap-1 border-b px-2 py-1.5">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={cn("size-8", editor.isActive("bold") && "bg-muted")}
        onClick={() => editor.chain().focus().toggleBold().run()}
        aria-pressed={editor.isActive("bold")}
      >
        <CentralIcon name="IconBold" size={16} />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={cn("size-8", editor.isActive("italic") && "bg-muted")}
        onClick={() => editor.chain().focus().toggleItalic().run()}
        aria-pressed={editor.isActive("italic")}
      >
        <CentralIcon name="IconItalic" size={16} />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={cn("size-8", editor.isActive("underline") && "bg-muted")}
        onClick={() => editor.chain().focus().toggleUnderline().run()}
        aria-pressed={editor.isActive("underline")}
      >
        <CentralIcon name="IconUnderline" size={16} />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={cn("size-8", editor.isActive("link") && "bg-muted")}
        onClick={setLink}
        aria-pressed={editor.isActive("link")}
      >
        <CentralIcon name="IconChainLink1" size={16} />
      </Button>
      <span className="mx-1 h-4 w-px bg-border" aria-hidden />
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className={cn(
          "h-8 px-2 text-xs",
          editor.isActive("heading", { level: 1 }) && "bg-muted",
        )}
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
      >
        H1
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className={cn(
          "h-8 px-2 text-xs",
          editor.isActive("heading", { level: 2 }) && "bg-muted",
        )}
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
      >
        H2
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className={cn(
          "h-8 px-2 text-xs",
          editor.isActive("heading", { level: 3 }) && "bg-muted",
        )}
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
      >
        H3
      </Button>
      <span className="mx-1 h-4 w-px bg-border" aria-hidden />
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className={cn(
          "h-8 px-2 text-xs",
          editor.isActive("bulletList") && "bg-muted",
        )}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      >
        • List
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className={cn(
          "h-8 px-2 text-xs",
          editor.isActive("orderedList") && "bg-muted",
        )}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      >
        1. List
      </Button>
    </div>
  );
}

export function VaultEditor({
  documentId,
  initialTitle: _initialTitle = "Untitled",
  initialYdocBase64,
  initialContentMarkdown,
  onTitleChange: _onTitleChange,
}: VaultEditorProps) {
  const useMarkdown = initialContentMarkdown != null || !initialYdocBase64;
  const ydoc = useRef<Y.Doc | null>(null);
  if (ydoc.current === null && !useMarkdown) {
    ydoc.current = new Y.Doc();
  }
  const ydocInstance = ydoc.current;

  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasInitialApply = useRef(false);
  const hasInitialContent = useRef(false);
  const editorRef = useRef<Editor | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({
          heading: { levels: [1, 2, 3] },
        }),
        Underline,
        Link.configure({ openOnClick: false }),
        ...(useMarkdown
          ? [NodeRange]
          : [
              Collaboration.configure({
                document: ydocInstance!,
              }),
              NodeRange,
            ]),
      ],
      content: useMarkdown
        ? markdownToHtml(initialContentMarkdown ?? "")
        : undefined,
      editorProps: {
        attributes: {
          class:
            "vault-editor-prose prose prose-sm dark:prose-invert max-w-none focus:outline-none min-h-[200px] p-4",
        },
      },
      immediatelyRender: false,
    },
    useMarkdown ? [initialContentMarkdown] : [ydocInstance],
  );

  useEffect(() => {
    editorRef.current = editor;
    return () => {
      editorRef.current = null;
    };
  }, [editor]);

  useEffect(() => {
    if (!useMarkdown || !editor || hasInitialContent.current) return;
    const md = initialContentMarkdown ?? "";
    if (md) {
      editor.commands.setContent(markdownToHtml(md));
    }
    hasInitialContent.current = true;
  }, [useMarkdown, editor, initialContentMarkdown]);

  useEffect(() => {
    if (
      useMarkdown ||
      !initialYdocBase64 ||
      !ydocInstance ||
      hasInitialApply.current
    )
      return;
    try {
      const binary = atob(initialYdocBase64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      if (bytes.length > 0) {
        Y.applyUpdate(ydocInstance, bytes);
      }
      hasInitialApply.current = true;
    } catch (e) {
      console.error("Failed to apply initial ydoc state:", e);
    }
  }, [useMarkdown, initialYdocBase64, ydocInstance]);

  const saveToApi = useCallback(
    async (payload: {
      content_markdown?: string;
      ydoc_state?: string;
      content_text?: string;
    }) => {
      setSaveError(null);
      const res = await fetch(`/api/vault/documents/${documentId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const text = await res.text();
        setSaveError(text || "Failed to save");
        console.error("Failed to save document:", text);
        throw new Error(text || "Failed to save");
      }
    },
    [documentId],
  );

  const saveMarkdown = useCallback(async () => {
    const html = editorRef.current?.getHTML();
    if (html === undefined) return;
    const markdown = htmlToMarkdown(html);
    await saveToApi({ content_markdown: markdown });
  }, [saveToApi]);

  const saveYdoc = useCallback(async () => {
    if (!ydocInstance) return;
    const state = Y.encodeStateAsUpdate(ydocInstance);
    let binary = "";
    for (let i = 0; i < state.length; i++)
      binary += String.fromCharCode(state[i]);
    const base64 = btoa(binary);
    const textContent = editorRef.current?.getText();
    const html = editorRef.current?.getHTML();
    const payload: {
      ydoc_state: string;
      content_text?: string;
      content_markdown?: string;
    } = { ydoc_state: base64 };
    if (textContent) payload.content_text = textContent;
    if (html) payload.content_markdown = htmlToMarkdown(html);
    await saveToApi(payload);
  }, [ydocInstance, saveToApi]);

  useEffect(() => {
    if (!editor) return;
    if (useMarkdown) {
      const handleUpdate = () => {
        if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = setTimeout(() => {
          saveMarkdown().catch(() => {});
          saveTimeoutRef.current = null;
        }, SAVE_DEBOUNCE_MS);
      };
      editor.on("update", handleUpdate);
      return () => {
        editor.off("update", handleUpdate);
        if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      };
    } else if (ydocInstance) {
      const handleUpdate = () => {
        if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = setTimeout(() => {
          saveYdoc().catch(() => {});
          saveTimeoutRef.current = null;
        }, SAVE_DEBOUNCE_MS);
      };
      ydocInstance.on("update", handleUpdate);
      return () => {
        ydocInstance.off("update", handleUpdate);
        if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      };
    }
  }, [editor, useMarkdown, saveMarkdown, saveYdoc, ydocInstance]);

  const handleSave = useCallback(async () => {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = null;
    setSaving(true);
    setSaveError(null);
    try {
      if (useMarkdown) {
        await saveMarkdown();
      } else {
        await saveYdoc();
      }
    } finally {
      setSaving(false);
    }
  }, [useMarkdown, saveMarkdown, saveYdoc]);

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between gap-2 border-b px-4 py-2">
        <MenuBar editor={editor} />
        <div className="flex items-center gap-2">
          {saveError && (
            <span className="text-sm text-destructive">{saveError}</span>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? "Saving..." : "Save"}
          </Button>
        </div>
      </div>
      <div className="relative">
        {editor && (
          <DragHandle editor={editor}>
            <div
              className={cn(
                "flex size-6 cursor-grab items-center justify-center rounded bg-muted text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground",
              )}
              aria-label="Drag to reorder"
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="9" cy="5" r="1" />
                <circle cx="9" cy="12" r="1" />
                <circle cx="9" cy="19" r="1" />
                <circle cx="15" cy="5" r="1" />
                <circle cx="15" cy="12" r="1" />
                <circle cx="15" cy="19" r="1" />
              </svg>
            </div>
          </DragHandle>
        )}
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
