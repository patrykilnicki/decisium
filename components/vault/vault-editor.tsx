"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Collaboration from "@tiptap/extension-collaboration";
import Underline from "@tiptap/extension-underline";
import Link from "@tiptap/extension-link";
import DragHandle from "@tiptap/extension-drag-handle-react";
import NodeRange from "@tiptap/extension-node-range";
import * as Y from "yjs";
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Link as LinkIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface VaultEditorProps {
  documentId: string;
  initialTitle?: string;
  initialYdocBase64?: string | null;
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
        <Bold className="size-4" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={cn("size-8", editor.isActive("italic") && "bg-muted")}
        onClick={() => editor.chain().focus().toggleItalic().run()}
        aria-pressed={editor.isActive("italic")}
      >
        <Italic className="size-4" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={cn("size-8", editor.isActive("underline") && "bg-muted")}
        onClick={() => editor.chain().focus().toggleUnderline().run()}
        aria-pressed={editor.isActive("underline")}
      >
        <UnderlineIcon className="size-4" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={cn("size-8", editor.isActive("link") && "bg-muted")}
        onClick={setLink}
        aria-pressed={editor.isActive("link")}
      >
        <LinkIcon className="size-4" />
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
  onTitleChange: _onTitleChange,
}: VaultEditorProps) {
  const ydoc = useMemo(() => new Y.Doc(), []);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasInitialApply = useRef(false);
  const editorRef = useRef<Editor | null>(null);
  const [saving, setSaving] = useState(false);

  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({
          heading: { levels: [1, 2, 3] },
        }),
        Underline,
        Link.configure({ openOnClick: false }),
        Collaboration.configure({ document: ydoc }),
        NodeRange,
      ],
      content: undefined,
      editorProps: {
        attributes: {
          class:
            "prose prose-sm dark:prose-invert max-w-none focus:outline-none min-h-[200px] p-4",
        },
      },
      immediatelyRender: false,
    },
    [ydoc],
  );

  useEffect(() => {
    editorRef.current = editor;
    return () => {
      editorRef.current = null;
    };
  }, [editor]);

  useEffect(() => {
    if (!initialYdocBase64 || hasInitialApply.current) return;
    try {
      const binary = atob(initialYdocBase64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      if (bytes.length > 0) {
        Y.applyUpdate(ydoc, bytes);
      }
      hasInitialApply.current = true;
    } catch (e) {
      console.error("Failed to apply initial ydoc state:", e);
    }
  }, [initialYdocBase64, ydoc]);

  const saveToApi = useCallback(
    async (state: Uint8Array, textContent?: string) => {
      let binary = "";
      for (let i = 0; i < state.length; i++)
        binary += String.fromCharCode(state[i]);
      const base64 = btoa(binary);
      const body: { ydoc_state: string; content_text?: string } = {
        ydoc_state: base64,
      };
      if (textContent) body.content_text = textContent;
      const res = await fetch(`/api/vault/documents/${documentId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        console.error("Failed to save document:", await res.text());
      }
    },
    [documentId],
  );

  useEffect(() => {
    const handleUpdate = () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = setTimeout(() => {
        const state = Y.encodeStateAsUpdate(ydoc);
        const textContent = editorRef.current?.getText();
        saveToApi(state, textContent);
        saveTimeoutRef.current = null;
      }, SAVE_DEBOUNCE_MS);
    };
    ydoc.on("update", handleUpdate);
    return () => {
      ydoc.off("update", handleUpdate);
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, [ydoc, saveToApi]);

  const handleSave = useCallback(async () => {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = null;
    setSaving(true);
    try {
      const state = Y.encodeStateAsUpdate(ydoc);
      const textContent = editorRef.current?.getText();
      await saveToApi(state, textContent);
    } finally {
      setSaving(false);
    }
  }, [ydoc, saveToApi]);

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between gap-2 border-b px-4 py-2">
        <MenuBar editor={editor} />
        <Button
          variant="outline"
          size="sm"
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? "Saving..." : "Save"}
        </Button>
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
