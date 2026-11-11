import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon, type IconName } from "./Icon";

export type SelectOption = {
  value: string;
  label: string;
  hint?: string;
  icon?: IconName;
};

type Props = {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  icon?: IconName;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
};

/**
 * Select matching the design system: a bordered trigger plus a portalled menu.
 * Native <select> elements cannot be styled consistently across WebView2,
 * WKWebView and WebKitGTK, so the menu is rendered by React.
 */
export function Select({
  value,
  options,
  onChange,
  icon,
  placeholder = "Select…",
  disabled = false,
  className = "",
  ariaLabel,
}: Props) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ left: number; top?: number; bottom?: number; width: number }>({
    left: 0,
    top: 0,
    width: 0,
  });
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const selected = options.find((option) => option.value === value);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const width = Math.max(rect.width, 210);
    const left = Math.min(Math.max(8, rect.left), window.innerWidth - width - 8);
    const below = window.innerHeight - rect.bottom;
    const estimated = Math.min(300, options.length * 40 + 12);
    const openUp = below < estimated && rect.top > below;
    setPosition({
      left,
      width,
      ...(openUp
        ? { bottom: window.innerHeight - rect.top + 6 }
        : { top: rect.bottom + 6 }),
    });
  }, [open, options.length]);

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    function close() {
      setOpen(false);
    }

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [open, options.length]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`select ${open ? "open" : ""} ${className}`}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((current) => !current)}
      >
        {icon && <Icon name={icon} />}
        <span className={`sel-label ${selected ? "" : "placeholder"}`}>
          {selected?.label ?? placeholder}
        </span>
        <Icon name="chevron-down" className="chev" />
      </button>

      {open &&
        createPortal(
          <div
            ref={menuRef}
            className="select-menu"
            role="listbox"
            style={{
              left: position.left,
              width: position.width,
              ...(position.bottom !== undefined
                ? { bottom: position.bottom }
                : { top: position.top }),
            }}
          >
            {options.map((option) => (
              <button
                key={option.value || "default"}
                type="button"
                role="option"
                aria-selected={option.value === value}
                className={`mi ${option.value === value ? "selected" : ""}`}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
              >
                {option.icon && <Icon name={option.icon} />}
                <span className="mi-text">
                  <span>{option.label}</span>
                  {option.hint && <small>{option.hint}</small>}
                </span>
                {option.value === value && <Icon name="check" className="check" />}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
