"use client";

import React, { useEffect, useRef, useState } from "react";
import { Send, ShieldAlert, Loader2, Mic } from "lucide-react";
import { MAX_CHAT_MESSAGE_LENGTH, type ResponseMode } from "./types";
import { ModelSelector } from "./ModelSelector";
import { cn } from "@/lib/cn";

/** Show the remaining count only once the prompt is close enough for the limit to matter. */
const COUNTER_THRESHOLD = MAX_CHAT_MESSAGE_LENGTH * 0.9;

interface SpeechAlternative {
  transcript: string;
}

interface SpeechResult {
  0: SpeechAlternative;
  isFinal: boolean;
}

interface SpeechResultEvent extends Event {
  results: ArrayLike<SpeechResult>;
}

interface SpeechErrorEvent extends Event {
  error: string;
}

interface SpeechRecognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechResultEvent) => void) | null;
  onerror: ((event: SpeechErrorEvent) => void) | null;
  onend: (() => void) | null;
}

type SpeechRecognitionCtor = new () => SpeechRecognition;

/**
 * The Web Speech API is vendor-prefixed and absent in Firefox, so the button is only rendered
 * when a constructor exists. Transcripts come from the browser vendor's speech service.
 */
function getSpeechRecognition(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const scope = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null;
}

interface ComposerProps {
  messageText: string;
  isStreaming: boolean;
  chatError: string;
  onMessageChange: (text: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  selectedModel?: string;
  onSelectModel?: (modelId: string) => void;
  manuallyPicked?: boolean;
  onManualPick?: () => void;
  responseMode?: ResponseMode;
  onResponseModeChange?: (mode: ResponseMode) => void;
}

export function Composer({
  messageText,
  isStreaming,
  chatError,
  onMessageChange,
  onSubmit,
  selectedModel = "default",
  onSelectModel,
  manuallyPicked,
  onManualPick,
}: ComposerProps) {
  // The textarea grows natively via `field-sizing: content`, clamped by `min-h`/`max-h`. The old
  // resize effect set `style.height = "auto"` and read `scrollHeight` on every keystroke, forcing
  // a synchronous reflow of the document per character, and because the composer's height feeds
  // the message list's box it also invalidated that container's scroll geometry on each character.
  // Clearing `messageText` after a send drops it back to `min-h` on its own.
  const remaining = MAX_CHAT_MESSAGE_LENGTH - messageText.length;
  const showCounter = remaining <= MAX_CHAT_MESSAGE_LENGTH - COUNTER_THRESHOLD;

  const [voiceSupported, setVoiceSupported] = useState(false);
  const [recording, setRecording] = useState(false);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const recordingRef = useRef(false);
  const textRef = useRef(messageText);
  const spokenRef = useRef("");
  const onMessageChangeRef = useRef(onMessageChange);

  useEffect(() => {
    textRef.current = messageText;
    onMessageChangeRef.current = onMessageChange;
  }, [messageText, onMessageChange]);

  useEffect(() => {
    setVoiceSupported(getSpeechRecognition() !== null);
  }, []);

  useEffect(() => {
    if (!recording) return;
    const Recognition = getSpeechRecognition();
    if (!Recognition) {
      setRecording(false);
      return;
    }

    const recognition = new Recognition();
    recognitionRef.current = recognition;
    recognition.lang = navigator.language || "en-US";
    recognition.continuous = true;
    recognition.interimResults = true;
    spokenRef.current = "";

    recognition.onresult = (event) => {
      let finals = "";
      for (let i = 0; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) finals += result[0].transcript;
      }
      // Only the new tail is appended, so a growing result list never duplicates the transcript
      // and whatever the user already typed in the textarea is kept.
      const rawDelta = finals.slice(spokenRef.current.length);
      if (!rawDelta.trim()) return;
      spokenRef.current = finals;
      const trimmedDelta = rawDelta.trimStart();
      const currentText = textRef.current;
      const needsSpace = currentText.length > 0 && !/\s$/.test(currentText);
      const next = `${currentText}${needsSpace ? " " : ""}${trimmedDelta}`.slice(
        0,
        MAX_CHAT_MESSAGE_LENGTH,
      );
      textRef.current = next;
      onMessageChangeRef.current(next);
    };
    recognition.onerror = (event) => {
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        recordingRef.current = false;
        setRecording(false);
      }
    };
    recognition.onend = () => {
      // Continuous recognition still ends on silence, so keep it alive until the user stops.
      if (recordingRef.current) {
        try {
          recognition.start();
        } catch {
          recordingRef.current = false;
          setRecording(false);
        }
      }
    };
    recognition.start();

    return () => {
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      recognition.abort();
      recognitionRef.current = null;
    };
  }, [recording]);

  const stopRecording = () => {
    recordingRef.current = false;
    recognitionRef.current?.stop();
    setRecording(false);
  };

  const toggleRecording = () => {
    if (recording) {
      stopRecording();
    } else {
      recordingRef.current = true;
      setRecording(true);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (messageText.trim() && !isStreaming) {
        if (recording) {
          stopRecording();
        }
        onSubmit(e as unknown as React.FormEvent);
      }
    }
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    if (recording) {
      stopRecording();
    }
    onSubmit(e);
  };

  return (
    <div className="border-t border-chat-line bg-chat px-4 py-3.5 sm:px-6">
      {chatError && (
        <div className="mx-auto mb-2.5 flex max-w-3xl items-center gap-2 rounded-card border border-danger-soft bg-danger-soft p-2.5 text-xs text-danger">
          <ShieldAlert className="size-4 shrink-0" aria-hidden />
          <span className="truncate">{chatError}</span>
        </div>
      )}

      <form onSubmit={handleFormSubmit} className="mx-auto max-w-3xl">
        <div className="flex flex-col rounded-card border border-input-line bg-input p-2.5 transition-colors duration-150 focus-within:border-accent focus-within:ring-0">
          <textarea
            rows={2}
            value={messageText}
            onChange={(e) => onMessageChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask a question about the codebase... (Enter to send, Shift+Enter for newline)"
            aria-label="Send a message"
            disabled={isStreaming}
            maxLength={MAX_CHAT_MESSAGE_LENGTH}
            className="w-full min-h-[52px] max-h-[180px] resize-none border-0 bg-transparent px-2 py-1 text-sm leading-6 tracking-[-0.02em] text-input-ink outline-none focus:outline-none focus-visible:outline-none ring-0 focus:ring-0 focus-visible:ring-0 [field-sizing:content] disabled:opacity-50"
          />

          <div className="flex items-center justify-between gap-2 pt-2">
            <div className="flex items-center gap-1.5">
              {onSelectModel && (
                <ModelSelector
                  selectedModel={selectedModel}
                  onSelectModel={onSelectModel}
                  dropdownPlacement="up"
                  manuallyPicked={manuallyPicked}
                  onManualPick={onManualPick}
                />
              )}
            </div>

            <div className="flex items-center gap-1.5">
              {voiceSupported && (
                <button
                  type="button"
                  onClick={toggleRecording}
                  disabled={isStreaming && !recording}
                  aria-pressed={recording}
                  aria-label={recording ? "Stop voice input" : "Voice input"}
                  title={recording ? "Listening…" : "Voice input"}
                  className={cn(
                    "relative inline-flex size-8 cursor-pointer items-center justify-center rounded-[8px] transition-colors duration-150 disabled:pointer-events-none disabled:opacity-50",
                    recording
                      ? "bg-danger-soft text-danger"
                      : "text-chat-ink-2 hover:bg-chat-3 hover:text-chat-ink",
                  )}
                >
                  <Mic className={cn("size-4", recording && "animate-voice-pulse")} aria-hidden />
                  {recording && (
                    <span
                      className="animate-voice-pulse absolute right-1 top-1 size-1.5 rounded-full bg-danger shadow-[0_0_6px_var(--danger)]"
                      aria-hidden
                    />
                  )}
                </button>
              )}

              <button
                type="submit"
                disabled={!messageText.trim() || isStreaming}
                className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-[8px] bg-chat-ink text-chat transition-opacity duration-150 hover:opacity-90 active:scale-[0.96] disabled:cursor-not-allowed disabled:bg-chat-3 disabled:text-chat-ink-3"
                title="Send message (Enter)"
                aria-label="Send message"
              >
                {isStreaming ? (
                  <Loader2 className="size-4 animate-spin text-chat-ink-3" aria-hidden />
                ) : (
                  <Send className="size-4" aria-hidden />
                )}
              </button>
            </div>
          </div>
        </div>

        {showCounter && (
          <div
            className={cn(
              "mt-1 text-right text-[11px] tabular-nums",
              remaining <= 100 ? "text-danger" : "text-chat-ink-3",
            )}
          >
            {remaining.toLocaleString()} chars left
          </div>
        )}
      </form>
    </div>
  );
}
