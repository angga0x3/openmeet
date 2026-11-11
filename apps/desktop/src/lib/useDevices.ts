import { useCallback, useEffect, useState } from "react";

export type Device = { id: string; label: string };

export type DeviceLists = {
  cams: Device[];
  mics: Device[];
  speakers: Device[];
};

const empty: DeviceLists = { cams: [], mics: [], speakers: [] };

export function useDevices(): DeviceLists & { refresh: () => Promise<void> } {
  const [devices, setDevices] = useState<DeviceLists>(empty);

  const refresh = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      const list = await navigator.mediaDevices.enumerateDevices();
      const pick = (kind: MediaDeviceKind, fallback: string) =>
        list
          .filter((device) => device.kind === kind)
          .map((device, index) => ({
            id: device.deviceId,
            label: device.label || `${fallback} ${index + 1}`,
          }));
      setDevices({
        cams: pick("videoinput", "Camera"),
        mics: pick("audioinput", "Microphone"),
        speakers: pick("audiooutput", "Speaker"),
      });
    } catch {
      setDevices(empty);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const handler = () => void refresh();
    navigator.mediaDevices?.addEventListener("devicechange", handler);
    return () => navigator.mediaDevices?.removeEventListener("devicechange", handler);
  }, [refresh]);

  return { ...devices, refresh };
}
