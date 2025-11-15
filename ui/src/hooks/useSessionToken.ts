import { useSelector } from "react-redux";
import type { RootState } from "../store";

export function useSessionToken(): string | null {
  return useSelector((state: RootState) => state.auth.token);
}
