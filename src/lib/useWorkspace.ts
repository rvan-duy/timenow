import { createContext, useContext } from "react";
import type { WorkspaceData } from "./model";

type Store = {
  workspace: WorkspaceData;
  pending: boolean;
  mutate: (method: "POST" | "PATCH", path: string, data: unknown) => Promise<void>;
  notify: (message: string) => void;
};
export const WorkspaceContext = createContext<Store | null>(null);
export function useWorkspace() {
  const store = useContext(WorkspaceContext);
  if (!store) throw new Error("WorkspaceProvider is missing");
  return store;
}
