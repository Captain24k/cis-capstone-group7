const express = require("express");
const path = require("path");
const pool = require("./db");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

function makeToken(user, role) {
  const raw = `${user}|${role}|${Date.now()}`;
  return Buffer.from(raw, "utf8").toString("base64");
}

function parseToken(token) {
  try {
    const raw = Buffer.from(token, "base64").toString("utf8");
    const parts = raw.split("|");
    if (parts.length < 3) return null;
    return { user: parts[0], role: parts[1] };
  } catch {
    return null;
  }
}

function requireAuth(req, res, next) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const data = parseToken(token);
  if (!data) return res.status(401).json({ ok: false, message: "Unauthorized" });
  req.auth = data;
  next();
}

function requireRole(role) {
  return (req, res, next) => {
    if (!req.auth || req.auth.role !== role) {
      return res.status(403).json({ ok: false, message: "Forbidden" });
    }
    next();
  };
}

app.get("/api/health", async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT 1 AS ok");
    res.json({ ok: true, db: rows[0].ok === 1 });
  } catch (err) {
    console.error("DB HEALTH ERROR:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/api/login", async (req, res) => {
  const { user, password } = req.body || {};
  if (!user || !password) {
    return res.status(400).json({ ok: false, message: "Missing user/password" });
  }

  try {
    const [rows] = await pool.query(
      "SELECT user, password, role FROM employees WHERE user = ? LIMIT 1",
      [user]
    );

    if (rows.length === 0 || rows[0].password !== password) {
      return res.status(401).json({ ok: false, message: "Invalid credentials" });
    }

    const token = makeToken(rows[0].user, rows[0].role);
    res.json({ ok: true, token, role: rows[0].role });
  } catch (err) {
    res.status(500).json({ ok: false, message: "Server error", error: err.message });
  }
});

app.post("/api/feedback", requireAuth, requireRole("emp"), async (req, res) => {
  const { department, category, subject, feedback_text } = req.body || {};
  if (!department || !category || !subject || !feedback_text) {
    return res.status(400).json({ ok: false, message: "Please fill out all fields." });
  }

  try {
    await pool.query(
      `INSERT INTO feedback (created_at, department, category, subject, feedback_text)
       VALUES (NOW(), ?, ?, ?, ?)`,
      [department, category, subject, feedback_text]
    );

    res.json({ ok: true, message: "Feedback submitted successfully." });
  } catch (err) {
    res.status(500).json({ ok: false, message: "DB insert error", error: err.message });
  }
});

app.get("/api/feedback", requireAuth, requireRole("manager"), async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT feedback_id, created_at, department, category, subject, feedback_text
       FROM feedback ORDER BY created_at DESC`
    );
    res.json({ ok: true, data: rows });
  } catch (err) {
    res.status(500).json({ ok: false, message: "DB read error", error: err.message });
  }
});

app.delete("/api/feedback", requireAuth, requireRole("manager"), async (req, res) => {
  try {
    await pool.query("DELETE FROM feedback");
    res.json({ ok: true, message: "All feedback cleared." });
  } catch (err) {
    res.status(500).json({ ok: false, message: "DB delete error", error: err.message });
  }
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
