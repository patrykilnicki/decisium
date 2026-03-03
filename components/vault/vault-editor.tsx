"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Collaboration from "@tiptap/extension-collaboration";
import * as Y from "yjs";

interface VaultEditorProps {
  documentId: string;
  initialTitle?: string;
  initialYdocBase64?: string | null;
  onTitleChange?: (title: string) => void;
}

const SAVE_DEBOUNCE_MS = 2000;

export function VaultEditor({
  documentId,
  initialTitle = "Untitled",
  initialYdocBase64,
  onTitleChange,
}: VaultEditorProps) {
  const ydoc = useMemo(() => new Y.Doc(), [documentId]);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasInitialApply = useRef(false);
  const editorRef = useRef<Editor | null>(null);

  const editor = useEditor(
    {
      extensions: [StarterKit, Collaboration.configure({ document: ydoc })],
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

  editorRef.current = editor;

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

  editorRef.current = editor;

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

  return (
    <div className="flex flex-col">
      <EditorContent editor={editor} />
    </div>
  );
}
