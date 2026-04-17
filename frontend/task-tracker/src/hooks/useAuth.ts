import type { AuthContextValue } from "@/types";
import { useContext } from "react";
import { AuthContext } from "@/contexts/AuthContext";

export const useAuth = (): AuthContextValue => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
};
