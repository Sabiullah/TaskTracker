import { useState, type FormEvent } from "react";
import { useAuth } from "@/hooks/useAuth";
import { ApiError } from "@/lib/api";

export default function LoginPage() {
  const { signIn } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await signIn(username.trim(), password);
    } catch (err) {
      const msg =
        err instanceof ApiError && err.status === 401
          ? "Invalid username or password."
          : err instanceof Error
            ? err.message
            : "Sign-in failed. Please try again.";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-brand-panel">
        <div
          className="header-logo-icon"
          style={{
            width: 56,
            height: 56,
            fontSize: 32,
            borderRadius: 14,
            marginBottom: 28,
          }}
        >
          📋
        </div>
        <h2>Task Tracker</h2>
        <p>Organize your work. Track progress. Deliver on time, every time.</p>
      </div>

      <div className="login-form-panel">
        <div className="login-card">
          <h1
            style={{
              fontFamily: "var(--font-heading)",
              fontSize: 28,
              fontWeight: 800,
              color: "var(--txt)",
              marginBottom: 8,
            }}
          >
            Welcome back
          </h1>
          <p style={{ fontSize: 14, color: "var(--txt2)", marginBottom: 28 }}>
            Sign in to continue to your workspace
          </p>

          <form onSubmit={handleSubmit} className="login-form">
            <div className="form-group">
              <label>Username</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="e.g. tamil"
                required
                autoFocus
              />
            </div>
            <div className="form-group">
              <label>Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                minLength={6}
              />
            </div>

            {error && <p className="login-error">{error}</p>}

            <button
              type="submit"
              className="btn btn-primary login-submit"
              disabled={loading}
            >
              {loading ? "Signing in…" : "Sign In"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
