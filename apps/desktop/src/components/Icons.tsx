type Props = { size?: number; className?: string };

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
});

export function MicIcon({ size = 20, className }: Props) {
  return (
    <svg {...base(size)} className={className}>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3M8 21h8" />
    </svg>
  );
}

export function MicOffIcon({ size = 20, className }: Props) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M9 6a3 3 0 0 1 6 0v5M9 9v2a3 3 0 0 0 4.6 2.5" />
      <path d="M5 11a7 7 0 0 0 10.7 6M19 11v1M12 18v3M8 21h8M3 3l18 18" />
    </svg>
  );
}

export function VideoIcon({ size = 20, className }: Props) {
  return (
    <svg {...base(size)} className={className}>
      <rect x="3" y="6" width="12" height="12" rx="2.5" />
      <path d="M15 10.5 21 7v10l-6-3.5z" />
    </svg>
  );
}

export function VideoOffIcon({ size = 20, className }: Props) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M15 10.5 21 7v10l-3-1.8M15 8.5A2.5 2.5 0 0 0 12.5 6H6M3 8.5V15a2.5 2.5 0 0 0 2.5 2.5H13M3 3l18 18" />
    </svg>
  );
}

export function ScreenIcon({ size = 20, className }: Props) {
  return (
    <svg {...base(size)} className={className}>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20h8M12 16v4" />
    </svg>
  );
}

export function ChatIcon({ size = 20, className }: Props) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M20 12a7.5 7.5 0 0 1-10.9 6.7L4 20l1.3-4.4A7.5 7.5 0 1 1 20 12z" />
    </svg>
  );
}

export function PeopleIcon({ size = 20, className }: Props) {
  return (
    <svg {...base(size)} className={className}>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 20a5.5 5.5 0 0 1 11 0M16 5.5a3 3 0 0 1 0 5.8M17.5 20a5.5 5.5 0 0 0-2.2-4.4" />
    </svg>
  );
}

export function LeaveIcon({ size = 22, className }: Props) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M4 14.5V9.5A2.5 2.5 0 0 1 6.5 7h1.2c.9 0 1.7.5 2.1 1.3l.6 1.2h5.2c.9 0 1.7.5 2.1 1.3l.8 1.7H4z" />
      <path d="M6 18h12" />
    </svg>
  );
}

export function CopyIcon({ size = 18, className }: Props) {
  return (
    <svg {...base(size)} className={className}>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M15 5.5V5a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h.5" />
    </svg>
  );
}

export function GearIcon({ size = 20, className }: Props) {
  return (
    <svg {...base(size)} className={className}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </svg>
  );
}

export function SendIcon({ size = 18, className }: Props) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M4 12 20 4l-4 16-4-6-8-2z" />
    </svg>
  );
}

export function SmileIcon({ size = 20, className }: Props) {
  return (
    <svg {...base(size)} className={className}>
      <circle cx="12" cy="12" r="9" />
      <path d="M8.5 14.5a4.5 4.5 0 0 0 7 0M9 9.5h.01M15 9.5h.01" />
    </svg>
  );
}

export function CloseIcon({ size = 18, className }: Props) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

export function CheckIcon({ size = 16, className }: Props) {
  return (
    <svg {...base(size)} className={className}>
      <path d="m4 12 5 5L20 6" />
    </svg>
  );
}

export function ArrowIcon({ size = 18, className }: Props) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

export function LinkIcon({ size = 18, className }: Props) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1" />
      <path d="M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1" />
    </svg>
  );
}
