import { useState } from "react";
import type { Settings } from "../types";
import { httpBase } from "../types";
import { useDevices } from "../lib/useDevices";
import { CloseIcon } from "./Icons";

type Props = {
  settings: Settings;
  online: boolean | null;
  onSave: (settings: Settings) => void;
  onClose: () => void;
};

type TestState = "idle" | "testing" | "ok" | "fail";

export function SettingsDialog({ settings, online, onSave, onClose }: Props) {
  const [draft, setDraft] = useState<Settings>(settings);
  const [test, setTest] = useState<TestState>("idle");
  const devices = useDevices();

  function update<K extends keyof Settings>(key: K, value: Settings[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  async function testServer() {
    setTest("testing");
    try {
      const res = await fetch(`${httpBase(draft.serverUrl)}/healthz`, { method: "GET" });
      setTest(res.ok ? "ok" : "fail");
    } catch {
      setTest("fail");
    }
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal settings-modal">
        <header className="panel-header">
          <h2>Settings</h2>
          <button className="icon-button" onClick={onClose} title="Close" type="button">
            <CloseIcon />
          </button>
        </header>

        <div className="settings-body">
          <label className="field">
            <span>Display name</span>
            <input
              value={draft.displayName}
              onChange={(event) => update("displayName", event.target.value)}
              maxLength={64}
              placeholder="Your name"
            />
          </label>

          <label className="field">
            <span>Signaling server</span>
            <input
              value={draft.serverUrl}
              onChange={(event) => update("serverUrl", event.target.value)}
              placeholder="ws://127.0.0.1:8770"
              spellCheck={false}
            />
          </label>
          <div className="inline-status">
            <button className="button small ghost" onClick={testServer} type="button" disabled={test === "testing"}>
              {test === "testing" ? "Testing…" : "Test connection"}
            </button>
            {test === "ok" && <span className="ok-text">Reachable</span>}
            {test === "fail" && <span className="bad-text">Not reachable</span>}
            {test === "idle" && online !== null && (
              <span className={online ? "ok-text" : "bad-text"}>
                {online ? "Currently connected" : "Currently offline"}
              </span>
            )}
          </div>

          <label className="field">
            <span>Camera</span>
            <select value={draft.cameraId} onChange={(event) => update("cameraId", event.target.value)}>
              <option value="">System default</option>
              {devices.cams.map((device) => (
                <option key={device.id} value={device.id}>
                  {device.label}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Microphone</span>
            <select value={draft.micId} onChange={(event) => update("micId", event.target.value)}>
              <option value="">System default</option>
              {devices.mics.map((device) => (
                <option key={device.id} value={device.id}>
                  {device.label}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Speaker</span>
            <select value={draft.speakerId} onChange={(event) => update("speakerId", event.target.value)}>
              <option value="">System default</option>
              {devices.speakers.map((device) => (
                <option key={device.id} value={device.id}>
                  {device.label}
                </option>
              ))}
            </select>
          </label>

          <label className="check-row">
            <input
              type="checkbox"
              checked={draft.startMuted}
              onChange={(event) => update("startMuted", event.target.checked)}
            />
            <span>Join muted by default</span>
          </label>
          <label className="check-row">
            <input
              type="checkbox"
              checked={draft.startVideoOff}
              onChange={(event) => update("startVideoOff", event.target.checked)}
            />
            <span>Join with camera off by default</span>
          </label>

          <p className="hint">
            Settings are stored on this device only. Speaker selection is applied when the platform
            supports audio output routing.
          </p>
        </div>

        <footer className="modal-actions">
          <button className="button ghost" onClick={onClose} type="button">
            Cancel
          </button>
          <button
            className="button primary"
            onClick={() => onSave({ ...draft, displayName: draft.displayName.trim() })}
            type="button"
          >
            Save
          </button>
        </footer>
      </div>
    </div>
  );
}
