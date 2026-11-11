import { useEffect, useRef, useState } from "react";
import { Icon, type IconName } from "./Icon";
import { Select } from "./Select";

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  icon,
  tone = "accent",
  children,
  footer,
  wide = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  icon?: IconName;
  tone?: "accent" | "danger";
  children: React.ReactNode;
  footer?: React.ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="backdrop open"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className={`modal ${wide ? "wide" : ""}`} role="dialog" aria-modal>
        <div className="modal-head">
          <div>
            {icon && (
              <div className={`modal-ic ${tone === "danger" ? "red" : ""}`}>
                <Icon name={icon} size={19} />
              </div>
            )}
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <Icon name="x" />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function JoinCodeModal({
  open,
  onClose,
  onContinue,
  error,
}: {
  open: boolean;
  onClose: () => void;
  onContinue: (code: string, passcode?: string) => void;
  error?: string | null;
}) {
  const [code, setCode] = useState("");
  const [passcode, setPasscode] = useState("");

  useEffect(() => {
    if (open) {
      setCode("");
      setPasscode("");
    }
  }, [open]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Join with code"
      subtitle="Enter the room code or paste an invitation link."
      icon="keyboard"
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={!code.trim()}
            onClick={() => onContinue(code.trim(), passcode.trim() || undefined)}
          >
            Continue <Icon name="arrow-right" />
          </button>
        </>
      }
    >
      <div className="input-wrap">
        <Icon name="hash" />
        <input
          className="input mono"
          value={code}
          onChange={(event) => setCode(event.target.value)}
          placeholder="abc-defg-hij"
          autoComplete="off"
          autoFocus
          onKeyDown={(event) => {
            if (event.key === "Enter" && code.trim()) {
              onContinue(code.trim(), passcode.trim() || undefined);
            }
          }}
        />
      </div>
      <div className="field">
        <label className="label">Passcode (if required)</label>
        <input
          className="input"
          type="password"
          value={passcode}
          onChange={(event) => setPasscode(event.target.value)}
          placeholder="Optional"
          autoComplete="off"
        />
      </div>
      {error && <p className="form-error">{error}</p>}
    </Modal>
  );
}

const DURATIONS = [15, 30, 45, 60, 90];

export function ScheduleModal({
  open,
  onClose,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  onSave: (entry: { title: string; start: number; duration: number }) => void;
}) {
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [duration, setDuration] = useState(30);

  useEffect(() => {
    if (!open) return;
    const start = new Date(Date.now() + 30 * 60000);
    start.setMinutes(start.getMinutes() < 30 ? 30 : 0, 0, 0);
    if (start.getMinutes() === 0) start.setHours(start.getHours() + 1);
    setTitle("");
    setDate(`${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}-${String(start.getDate()).padStart(2, "0")}`);
    setTime(`${String(start.getHours()).padStart(2, "0")}:${String(start.getMinutes()).padStart(2, "0")}`);
    setDuration(30);
  }, [open]);

  function submit() {
    const start = new Date(`${date}T${time || "10:00"}`);
    if (Number.isNaN(start.getTime())) return;
    onSave({ title: title.trim() || "Untitled meeting", start: start.getTime(), duration });
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Schedule a meeting"
      subtitle="The room code is created up front, so the invite link works later."
      icon="calendar-plus"
      wide
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={submit}>
            <Icon name="check" /> Schedule
          </button>
        </>
      }
    >
      <div className="field">
        <label className="label">Title</label>
        <input
          className="input"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="e.g. Sprint retrospective"
          autoFocus
        />
      </div>
      <div className="row2">
        <div className="field">
          <label className="label">Date</label>
          <input className="input" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        </div>
        <div className="field">
          <label className="label">Time</label>
          <input className="input" type="time" value={time} onChange={(event) => setTime(event.target.value)} />
        </div>
      </div>
      <div className="field">
        <label className="label">Duration</label>
        <Select
          icon="clock"
          value={String(duration)}
          onChange={(value) => setDuration(Number(value))}
          options={DURATIONS.map((value) => ({
            value: String(value),
            label: value < 60 ? `${value} minutes` : `${value / 60} hour`,
          }))}
        />
      </div>
      <p className="hint">
        Invites are not sent by the server. Copy the room link after scheduling and share it
        anywhere.
      </p>
    </Modal>
  );
}

export function ShortcutsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const rows: Array<[string, string]> = [
    ["New instant meeting", "N"],
    ["Join with code", "J"],
    ["Schedule meeting", "S"],
    ["Focus search", "/"],
    ["Toggle microphone", "M"],
    ["Toggle camera", "V"],
    ["Chat / people", "C / P"],
    ["Close dialogs", "Esc"],
  ];
  return (
    <Modal open={open} onClose={onClose} title="Keyboard shortcuts" subtitle="Move faster in OpenMeet.">
      <div className="shortcuts">
        {rows.map(([label, keys]) => (
          <div key={label}>
            {label}
            <span>
              {keys.split(" / ").map((key) => (
                <span className="kbd" key={key}>
                  {key}
                </span>
              ))}
            </span>
          </div>
        ))}
      </div>
    </Modal>
  );
}

export function LeaveModal({
  open,
  onClose,
  onLeave,
  onEnd,
  isHost,
}: {
  open: boolean;
  onClose: () => void;
  onLeave: () => void;
  onEnd: () => void;
  isHost: boolean;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Leave this meeting?"
      subtitle="You can rejoin with the same link while the room is active."
      icon="phone-off"
      tone="danger"
      footer={
        <button className="btn btn-ghost" onClick={onClose}>
          Cancel
        </button>
      }
    >
      <button className="btn btn-secondary btn-lg btn-block" onClick={onLeave}>
        Leave meeting
      </button>
      {isHost && (
        <button className="btn btn-danger btn-lg btn-block" onClick={onEnd}>
          End meeting for all
        </button>
      )}
    </Modal>
  );
}

export function ToastStack({ toasts }: { toasts: Array<{ id: number; message: string; icon: IconName }> }) {
  return (
    <div className="toasts">
      {toasts.map((toast) => (
        <div className="toast" key={toast.id}>
          <Icon name={toast.icon} />
          <span>{toast.message}</span>
        </div>
      ))}
    </div>
  );
}

export function useToasts() {
  const [toasts, setToasts] = useState<Array<{ id: number; message: string; icon: IconName }>>([]);
  const nextId = useRef(1);
  const timers = useRef<Array<ReturnType<typeof setTimeout>>>([]);

  useEffect(() => {
    return () => timers.current.forEach(clearTimeout);
  }, []);

  function push(message: string, icon: IconName = "check", ms = 3200) {
    const id = nextId.current++;
    setToasts((prev) => [...prev.slice(-3), { id, message, icon }]);
    timers.current.push(
      setTimeout(() => {
        setToasts((prev) => prev.filter((toast) => toast.id !== id));
      }, ms),
    );
  }

  return { toasts, push };
}
