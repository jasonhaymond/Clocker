import React, { useRef, useState } from "react";
import { Platform } from "react-native";
import { DateTimePickerModal } from "../components/DateTimePickerModal";
import { pickDateTimeAndroid } from "./pickDateTimeAndroid";

interface PendingPick {
  initial: Date;
  title: string;
  resolve: (date: Date | null) => void;
}

// One cross-platform API for "let the user pick a date+time": Android pops its native
// date dialog then time dialog (see pickDateTimeAndroid); iOS renders an inline modal
// (DateTimePickerModal) since it has no equivalent imperative API. Callers just await
// `pick(...)` and render `modal` once, near the top of their screen's JSX.
export function useDateTimePicker() {
  const [pending, setPending] = useState<PendingPick | null>(null);
  const pendingRef = useRef<PendingPick | null>(null);

  async function pick(initial: Date, title: string): Promise<Date | null> {
    if (Platform.OS === "android") {
      return pickDateTimeAndroid(initial);
    }
    return new Promise((resolve) => {
      const entry = { initial, title, resolve };
      pendingRef.current = entry;
      setPending(entry);
    });
  }

  function finish(date: Date | null) {
    pendingRef.current?.resolve(date);
    pendingRef.current = null;
    setPending(null);
  }

  const modal = pending ? (
    <DateTimePickerModal
      visible
      initialValue={pending.initial}
      title={pending.title}
      onConfirm={finish}
      onCancel={() => finish(null)}
    />
  ) : null;

  return { pick, modal };
}
