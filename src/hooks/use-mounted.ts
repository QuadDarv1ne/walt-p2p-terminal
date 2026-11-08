import { useSyncExternalStore } from "react";

const emptySubscribe = () => () => {};

/** Безопасное определение гидратации без setState в эффектах */
export function useMounted(): boolean {
  return useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );
}
