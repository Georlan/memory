import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import AuthGate from "./AuthGate.jsx";
import SupabaseAuthGate from "./SupabaseAuthGate.jsx";

// Local development stays SQLite for backwards compatibility.
// Hosted builds use managed Supabase Auth unless explicitly overridden.
const provider = import.meta.env.VITE_AUTH_PROVIDER ||
  (import.meta.env.PROD ? "supabase" : "sqlite");
const Gate = provider === "supabase" ? SupabaseAuthGate : AuthGate;

createRoot(document.getElementById("root")).render(
  <Gate><App /></Gate>
);
