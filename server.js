// server.js (UPDATED with Status Update + Manager Response support)

const express = require("express");
const path = require("path");
const pool = require("./db");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ---------------------------
// Basic Moderation Keywords
// ---------------------------
const TOXIC_KEYWORDS = [
    "idiot", "stupid", "dumb", "trash", "hate", "shut up", "moron",
    "kill", "hurt", "die", "threat", "attack",
    "steal", "corrupt", "scam"
];

function normalizeText(s) {
    return String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function detectToxicity(subject, feedbackText) {
    const text = normalizeText(subject) + " " + normalizeText(feedbackText);
    let hits = [];
    for (const kw of TOXIC_KEYWORDS) {
        if (!kw) continue;
        if (text.includes(kw)) hits.push(kw);
    }
    const toxic = hits.length > 0;

    return {
        toxic,
        reason: toxic ? ("Matched keywords: " + hits.slice(0, 6).join(", ")) : ""
    };
}

// ---------------------------
// Auth (simple base64 token)
// ---------------------------
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

// ---------------------------
// Health
// ---------------------------
app.get("/api/health", async (req, res) => {
    try {
        const [rows] = await pool.query("SELECT 1 AS ok");
        res.json({ ok: true, db: rows[0].ok === 1 });
    } catch (err) {
        console.error("DB HEALTH ERROR:", err);
        res.status(500).json({ ok: false, error: err.message });
    }
});

// ---------------------------
// Login
// ---------------------------
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

// ---------------------------
// Send banned words to emp UI
// ---------------------------
app.get("/api/moderation/keywords", requireAuth, requireRole("emp"), (req, res) => {
    res.json({ ok: true, words: TOXIC_KEYWORDS });
});

// ---------------------------
// Submit feedback (Employee)
// ---------------------------
app.post("/api/feedback", requireAuth, requireRole("emp"), async (req, res) => {
    const { department, category, subject, feedback_text } = req.body || {};
    if (!department || !category || !subject || !feedback_text) {
        return res.status(400).json({ ok: false, message: "Please fill out all fields." });
    }

    const mod = detectToxicity(subject, feedback_text);
    const moderation_status = mod.toxic ? "flagged" : "approved";

    try {
        const [result] = await pool.query(
            `INSERT INTO feedback (
          created_at, department, category, subject, feedback_text, upvotes,
          moderation_status, moderation_reason,
          status, manager_response, updated_at
       )
       VALUES (
          NOW(), ?, ?, ?, ?, IFNULL(?,0),
          ?, ?,
          'Open', NULL, NULL
       )`,
            [department, category, subject, feedback_text, 0, moderation_status, mod.reason || null]
        );

        const feedbackId = result && result.insertId ? result.insertId : null;

        // store moderation queue entry
        if (mod.toxic && feedbackId) {
            await pool.query(
                `INSERT INTO feedback_moderation_queue (feedback_id, reason, status)
         VALUES (?, ?, 'flagged')`,
                [feedbackId, mod.reason || "Flagged by rule"]
            );
        }

        if (mod.toxic) {
            return res.json({
                ok: true,
                message: "Feedback received and is pending manager review.",
                moderation: { status: "flagged", reason: mod.reason }
            });
        }

        res.json({ ok: true, message: "Feedback submitted successfully.", moderation: { status: "approved" } });
    } catch (err) {
        res.status(500).json({ ok: false, message: "DB insert error", error: err.message });
    }
});

// ---------------------------
// Browse feedback (Employee)
// only approved + not merged
// includes status + manager_response so employees can see updates
// ---------------------------
app.get("/api/feedback/employee", requireAuth, requireRole("emp"), async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT
          feedback_id, created_at, department, category, subject, feedback_text,
          IFNULL(upvotes,0) AS upvotes,
          IFNULL(status,'Open') AS status,
          manager_response
       FROM feedback
       WHERE moderation_status = 'approved'
       ORDER BY created_at DESC`
        );
        res.json({ ok: true, data: rows });
    } catch (err) {
        res.status(500).json({ ok: false, message: "DB read error", error: err.message });
    }
});

// ---------------------------
// Upvote (Employee)
// ---------------------------
app.post("/api/feedback/:id/upvote", requireAuth, requireRole("emp"), async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ ok: false, message: "Invalid feedback id" });

    try {
        await pool.query(`UPDATE feedback SET upvotes = IFNULL(upvotes,0) + 1 WHERE feedback_id = ?`, [id]);
        const [rows] = await pool.query(
            `SELECT IFNULL(upvotes,0) AS upvotes FROM feedback WHERE feedback_id = ? LIMIT 1`,
            [id]
        );
        const upvotes = rows.length ? rows[0].upvotes : 0;
        res.json({ ok: true, upvotes });
    } catch (err) {
        res.status(500).json({ ok: false, message: "DB update error", error: err.message });
    }
});

// ---------------------------
// Manager: view all feedback
// includes status + manager_response
// ---------------------------
app.get("/api/feedback", requireAuth, requireRole("manager"), async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT
          feedback_id, created_at, department, category, subject, feedback_text,
          IFNULL(upvotes,0) AS upvotes,
          IFNULL(status,'Open') AS status,
          manager_response,
          updated_at,
          moderation_status
       FROM feedback
       ORDER BY created_at DESC`
        );
        res.json({ ok: true, data: rows });
    } catch (err) {
        res.status(500).json({ ok: false, message: "DB read error", error: err.message });
    }
});

// ---------------------------
// ✅ Manager: UPDATE status + manager_response
// This is the endpoint your manager.html is calling.
// If this is missing, you get: Cannot PUT /api/feedback/:id
// ---------------------------
app.put("/api/feedback/:id", requireAuth, requireRole("manager"), async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ ok: false, message: "Invalid feedback id" });

    const { status, manager_response } = req.body || {};

    // keep your statuses consistent
    const allowed = new Set(["Open", "In Progress", "Resolved", "Closed"]);
    const newStatus = (status || "").trim();
    if (!allowed.has(newStatus)) {
        return res.status(400).json({
            ok: false,
            message: "Invalid status. Use: Open, In Progress, Resolved, Closed."
        });
    }

    try {
        await pool.query(
            `UPDATE feedback
       SET status = ?, manager_response = ?, updated_at = NOW()
       WHERE feedback_id = ?`,
            [newStatus, manager_response || null, id]
        );

        const [rows] = await pool.query(
            `SELECT feedback_id, status, manager_response, updated_at
       FROM feedback
       WHERE feedback_id = ? LIMIT 1`,
            [id]
        );

        res.json({ ok: true, message: "Updated.", data: rows.length ? rows[0] : null });
    } catch (err) {
        res.status(500).json({ ok: false, message: "DB update error", error: err.message });
    }
});

// ---------------------------
// Manager: clear all feedback (DANGEROUS on shared DB)
// ---------------------------
app.delete("/api/feedback", requireAuth, requireRole("manager"), async (req, res) => {
    try {
        await pool.query("DELETE FROM feedback");
        res.json({ ok: true, message: "All feedback cleared." });
    } catch (err) {
        res.status(500).json({ ok: false, message: "DB delete error", error: err.message });
    }
});

// ---------------------------
// Moderation Queue (Manager)
// ---------------------------
app.get("/api/moderation/flagged", requireAuth, requireRole("manager"), async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT
          f.feedback_id, f.created_at, f.department, f.category, f.subject, f.feedback_text,
          IFNULL(f.upvotes,0) AS upvotes,
          f.moderation_status, f.moderation_reason,
          mq.queue_id, mq.reason, mq.status AS flag_status, mq.created_at AS flagged_at
       FROM feedback f
       JOIN feedback_moderation_queue mq ON mq.feedback_id = f.feedback_id
       WHERE f.moderation_status = 'flagged' AND mq.status = 'flagged'
       ORDER BY mq.created_at DESC`
        );
        res.json({ ok: true, data: rows });
    } catch (err) {
        res.status(500).json({ ok: false, message: "DB read error", error: err.message });
    }
});

app.post("/api/moderation/:id/approve", requireAuth, requireRole("manager"), async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ ok: false, message: "Invalid feedback id" });

    try {
        await pool.query(
            `UPDATE feedback
       SET moderation_status = 'approved', moderated_at = NOW(), moderated_by = ?, moderation_reason = NULL
       WHERE feedback_id = ?`,
            [req.auth.user, id]
        );

        await pool.query(
            `UPDATE feedback_moderation_queue
       SET status = 'approved', reviewed_at = NOW(), reviewed_by = ?
       WHERE feedback_id = ? AND status = 'flagged'`,
            [req.auth.user, id]
        );

        res.json({ ok: true, message: "Approved." });
    } catch (err) {
        res.status(500).json({ ok: false, message: "DB update error", error: err.message });
    }
});

app.post("/api/moderation/:id/reject", requireAuth, requireRole("manager"), async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ ok: false, message: "Invalid feedback id" });

    try {
        await pool.query(
            `UPDATE feedback
       SET moderation_status = 'rejected', moderated_at = NOW(), moderated_by = ?
       WHERE feedback_id = ?`,
            [req.auth.user, id]
        );

        await pool.query(
            `UPDATE feedback_moderation_queue
       SET status = 'rejected', reviewed_at = NOW(), reviewed_by = ?
       WHERE feedback_id = ? AND status = 'flagged'`,
            [req.auth.user, id]
        );

        res.json({ ok: true, message: "Rejected." });
    } catch (err) {
        res.status(500).json({ ok: false, message: "DB update error", error: err.message });
    }
});

// ---------------------------
// Catch-all (MUST be last)
// ---------------------------
app.get("*", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});