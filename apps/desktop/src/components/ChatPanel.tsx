import { useEffect, useRef, useState } from "react";
import type { ChatMessage } from "../types";
import { CloseIcon, SendIcon } from "./Icons";

type Props = {
  messages: ChatMessage[];
  onSend: (text: string) => void;
  onClose: () => void;
};

export function ChatPanel({ messages, onSend, onClose }: Props) {
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [messages.length]);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    if (!text) return;
    onSend(text);
    setDraft("");
  }

  return (
    <aside className="panel">
      <header className="panel-header">
        <h2>Chat</h2>
        <button className="icon-button" onClick={onClose} title="Close chat" type="button">
          <CloseIcon />
        </button>
      </header>
      <div className="chat-list" ref={listRef}>
        {messages.length === 0 ? (
          <p className="muted chat-empty">No messages yet. Say hello.</p>
        ) : (
          messages.map((message) => (
            <div key={message.id} className={`chat-message ${message.self ? "self" : ""}`}>
              <div className="chat-meta">
                <span className="chat-author">{message.self ? "You" : message.name}</span>
                <span className="chat-time">
                  {new Date(message.ts).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </div>
              <div className="chat-bubble">{message.text}</div>
            </div>
          ))
        )}
      </div>
      <form className="chat-compose" onSubmit={submit}>
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Message everyone"
          maxLength={2000}
        />
        <button className="icon-button send" type="submit" disabled={!draft.trim()} title="Send">
          <SendIcon />
        </button>
      </form>
    </aside>
  );
}
