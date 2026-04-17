/**
 * Task Tracker – standalone server
 * Serves the built React app + handles admin API routes
 * Run: node server.js
 */

import express from "express";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load .env manually (no dotenv package needed)
const envPath = path.join(__dirname, ".env");
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, "utf8")
    .split("\n")
    .forEach((line) => {
      const [key, ...rest] = line.trim().split("=");
      if (key && !key.startsWith("#") && rest.length) {
        process.env[key.trim()] = rest.join("=").trim();
      }
    });
}

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error(
    "❌  Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env",
  );
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const toEmail = (name) =>
  `${name.toLowerCase().replace(/\s+/g, ".")}@tasktracker.local`;

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// ── Serve built React app ──────────────────────────────────────────────────
const distPath = path.join(__dirname, "dist");
app.use(express.static(distPath));

// ── POST /api/create-user ──────────────────────────────────────────────────
app.post("/api/create-user", async (req, res) => {
  const { name, password, role, manager_id } = req.body || {};
  if (!name) return res.status(400).json({ error: "name is required" });

  const email = toEmail(name);

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: password || "123456",
    email_confirm: true,
    user_metadata: { name },
  });

  if (error) return res.status(400).json({ error: error.message });

  if (data?.user) {
    const { error: pErr } = await admin.from("profiles").upsert({
      id: data.user.id,
      full_name: name,
      email,
      role: role || "employee",
      manager_id: manager_id || null,
    });
    if (pErr)
      return res
        .status(400)
        .json({ error: "User created but profile failed: " + pErr.message });
  }

  res.json({ success: true, userId: data?.user?.id });
});

// ── POST /api/reset-password ───────────────────────────────────────────────
app.post("/api/reset-password", async (req, res) => {
  const { user_id, new_password } = req.body || {};
  if (!user_id) return res.status(400).json({ error: "user_id is required" });
  if (!new_password)
    return res.status(400).json({ error: "new_password is required" });
  if (new_password.length < 6)
    return res
      .status(400)
      .json({ error: "Password must be at least 6 characters" });

  const { error } = await admin.auth.admin.updateUserById(user_id, {
    password: new_password,
  });
  if (error) return res.status(400).json({ error: error.message });

  res.json({ success: true });
});

// ── POST /api/delete-user ──────────────────────────────────────────────────
app.post("/api/delete-user", async (req, res) => {
  const { user_id } = req.body || {};
  if (!user_id) return res.status(400).json({ error: "user_id is required" });

  const { error } = await admin.auth.admin.deleteUser(user_id);
  if (error) return res.status(400).json({ error: error.message });

  // Also delete profile row
  await admin.from("profiles").delete().eq("id", user_id);

  res.json({ success: true });
});

// ── Catch-all: serve index.html for React router ───────────────────────────
app.get("/{*path}", (_req, res) => {
  res.sendFile(path.join(distPath, "index.html"));
});

app.listen(PORT, () => {
  console.log(`✅  Task Tracker running at http://localhost:${PORT}`);
  console.log(`    Open: http://49.12.190.43:${PORT}`);
});
