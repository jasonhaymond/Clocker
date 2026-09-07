import { useFocusEffect } from "@react-navigation/native";
import { useCallback, useEffect } from "react";
import { dbEvents } from "./events";

// Re-runs `load` whenever the screen gains focus or any local mutation/sync happens.
export function useDbRefresh(load: () => void): void {
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  useEffect(() => dbEvents.subscribe(load), [load]);
}
