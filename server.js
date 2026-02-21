const express = require("express");
const path = require("path");
const pool = require("./db");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// --- Basic Moderation add word here 

const TOXIC_KEYWORDS = [
  //
  "idiot","stupid","dumb","trash","hate","shut up","moron",
  
  "kill","hurt","die","threat","attack",
  
  "steal","corrupt","scam"
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

//send baned word to emp 
app.get("/api/moderation/keywords", requireAuth, requireRole("emp"), (req, res) => {
  res.json({ ok: true, words: TOXIC_KEYWORDS });
});

app.post("/api/feedback", requireAuth, requireRole("emp"), async (req, res) => {
  const { department, category, subject, feedback_text } = req.body || {};
  if (!department || !category || !subject || !feedback_text) {
    return res.status(400).json({ ok: false, message: "Please fill out all fields." });
  }

  // Run moderation check (server-side)
  const mod = detectToxicity(subject, feedback_text);
  const moderation_status = mod.toxic ? "flagged" : "approved";

  try {
    const [result] = await pool.query(
      `INSERT INTO feedback (created_at, department, category, subject, feedback_text, upvotes, moderation_status, moderation_reason)
       VALUES (NOW(), ?, ?, ?, ?, IFNULL(?,0), ?, ?)`,
      [department, category, subject, feedback_text, 0, moderation_status, mod.reason || null]
    );

    const feedbackId = result && result.insertId ? result.insertId : null;

    // Duplicate detection 
    if (feedbackId) {
      queuePotentialDuplicatesForFeedback(feedbackId, department, category, subject, feedback_text).catch(()=>{});
    }

    // Store moderation flag details for manager review
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


// Employees can browse all anonymous feedback (read-only list with upvotes)
app.get("/api/feedback/employee", requireAuth, requireRole("emp"), async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT feedback_id, created_at, department, category, subject, feedback_text, IFNULL(upvotes,0) AS upvotes
       FROM feedback WHERE moderation_status = 'approved' ORDER BY created_at DESC`
    );
    res.json({ ok: true, data: rows });
  } catch (err) {
    res.status(500).json({ ok: false, message: "DB read error", error: err.message });
  }
});

// Employees can upvote a feedback item
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

app.get("/api/feedback", requireAuth, requireRole("manager"), async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT feedback_id, created_at, department, category, subject, feedback_text, IFNULL(upvotes,0) AS upvotes
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


// --- Moderation Queue (Manager) ---
app.get("/api/moderation/flagged", requireAuth, requireRole("manager"), async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT f.feedback_id, f.created_at, f.department, f.category, f.subject, f.feedback_text,
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

// Duplicate Detection + Merge (ADD-ON)
// Lightweight stopword list for keyword extraction
const DUP_STOPWORDS = new Set([
  "a","an","the","and","or","but","if","then","else","when","where","why","how",
  "what","happened","happen","happening","impact","suggestion","suggest","prompt","prompts",
  "to","of","in","on","for","with","as","at","by","from","into","about","over","under",
  "is","are","was","were","be","been","being","it","its","this","that","these","those",
  "i","me","my","we","our","you","your","he","she","they","them","their",
  "do","does","did","done","have","has","had","can","could","should","would","will","may","might",
  "not","no","yes","very","really","just","like"
]);

function extractKeywords(subject, feedbackText, max = 12) {
  const raw = normalizeText(subject) + " " + normalizeText(feedbackText);
  const cleaned = raw.replace(/[^a-z0-9\s]/g, " ");
  const parts = cleaned.split(/\s+/g).filter(Boolean);

  const freq = new Map();
  for (const p of parts) {
    if (p.length < 3) continue;
    if (DUP_STOPWORDS.has(p)) continue;
    freq.set(p, (freq.get(p) || 0) + 1);
  }

  const sorted = Array.from(freq.entries())
    .sort((a, b) => (b[1] - a[1]) || (b[0].length - a[0].length))
    .map(x => x[0]);

  return sorted.slice(0, max);
}

function jaccard(aArr, bArr) {
  const a = new Set(aArr || []);
  const b = new Set(bArr || []);
  if (a.size === 0 && b.size === 0) return 0;

  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;

  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

function overlapList(aArr, bArr) {
  const a = new Set(aArr || []);
  const b = new Set(bArr || []);
  const out = [];
  for (const x of a) if (b.has(x)) out.push(x);
  return out;
}

async function queuePotentialDuplicatesForFeedback(newFeedbackId, department, category, subject, feedbackText) {
  try {
    const [cands] = await pool.query(
      `SELECT feedback_id, created_at, department, category, subject, feedback_text, IFNULL(upvotes,0) AS upvotes, moderation_status
       FROM feedback
       WHERE feedback_id <> ?
         AND category = ?
         AND (department = ? OR ? IS NULL)
         AND moderation_status IN ('approved','flagged')
         AND created_at >= DATE_SUB(NOW(), INTERVAL 180 DAY)
       ORDER BY created_at DESC
       LIMIT 200`,
      [newFeedbackId, category, department, department]
    );

    const baseKeys = extractKeywords(subject, feedbackText);
    if (baseKeys.length === 0) return;

    for (const cand of (cands || [])) {
      const candKeys = extractKeywords(cand.subject, cand.feedback_text);
      const score = jaccard(baseKeys, candKeys);
      const overlap = overlapList(baseKeys, candKeys);

      const pass = (overlap.length >= 2 && score >= 0.20) || (overlap.length >= 3 && score >= 0.12);
      if (!pass) continue;

      await pool.query(
        `INSERT INTO feedback_duplicate_queue
          (base_feedback_id, candidate_feedback_id, category, score, overlap_keywords, status, created_at)
         VALUES (?, ?, ?, ?, ?, 'pending', NOW())`,
        [
          newFeedbackId,
          cand.feedback_id,
          category,
          score,
          overlap.slice(0, 8).join(",")
        ]
      );
    }
  } catch (err) {
    console.warn("Duplicate queue skipped:", err && err.message ? err.message : err);
  }
}

// --- Duplicate Queue (Manager) ---
// List pending duplicate pairs
app.get("/api/duplicates/pending", requireAuth, requireRole("manager"), async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT q.pair_id, q.created_at AS flagged_at, q.category, q.score, q.overlap_keywords, q.status,
              b.feedback_id AS base_id, b.created_at AS base_created_at, b.department AS base_department, b.subject AS base_subject,
              IFNULL(b.upvotes,0) AS base_upvotes, b.moderation_status AS base_status,
              c.feedback_id AS candidate_id, c.created_at AS cand_created_at, c.department AS cand_department, c.subject AS cand_subject,
              IFNULL(c.upvotes,0) AS cand_upvotes, c.moderation_status AS cand_status
       FROM feedback_duplicate_queue q
       JOIN feedback b ON b.feedback_id = q.base_feedback_id
       JOIN feedback c ON c.feedback_id = q.candidate_feedback_id
       WHERE q.status = 'pending'
       ORDER BY q.created_at DESC
       LIMIT 300`
    );
    res.json({ ok: true, data: rows });
  } catch (err) {
    res.status(500).json({ ok: false, message: "DB read error", error: err.message });
  }
});

// Ignore a suggested duplicate pair
app.post("/api/duplicates/:pairId/ignore", requireAuth, requireRole("manager"), async (req, res) => {
  const pairId = parseInt(req.params.pairId, 10);
  if (!pairId) return res.status(400).json({ ok: false, message: "Invalid pair id" });

  try {
    await pool.query(
      `UPDATE feedback_duplicate_queue
       SET status = 'ignored', reviewed_at = NOW(), reviewed_by = ?
       WHERE pair_id = ? AND status = 'pending'`,
      [req.auth.user, pairId]
    );
    res.json({ ok: true, message: "Ignored." });
  } catch (err) {
    res.status(500).json({ ok: false, message: "DB update error", error: err.message });
  }
});

// Merge two feedback items 
app.post("/api/duplicates/merge", requireAuth, requireRole("manager"), async (req, res) => {
  const { master_id, duplicate_id, pair_id } = req.body || {};
  const masterId = parseInt(master_id, 10);
  const dupId = parseInt(duplicate_id, 10);
  const pairId = pair_id ? parseInt(pair_id, 10) : null;

  if (!masterId || !dupId || masterId === dupId) {
    return res.status(400).json({ ok: false, message: "Provide master_id and duplicate_id (different ids)." });
  }

  // Use a transaction to keep counts consistent
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [[m]] = await conn.query(
      `SELECT feedback_id, created_at, IFNULL(upvotes,0) AS upvotes, moderation_status
       FROM feedback WHERE feedback_id = ? FOR UPDATE`,
      [masterId]
    );
    const [[d]] = await conn.query(
      `SELECT feedback_id, created_at, IFNULL(upvotes,0) AS upvotes, moderation_status
       FROM feedback WHERE feedback_id = ? FOR UPDATE`,
      [dupId]
    );

    if (!m || !d) {
      await conn.rollback();
      return res.status(404).json({ ok: false, message: "One or both feedback items not found." });
    }

    let finalMaster = m;
    let finalDup = d;
    if (new Date(d.created_at).getTime() < new Date(m.created_at).getTime()) {
      finalMaster = d;
      finalDup = m;
    }

    // Combine upvotes into the master
    const newUpvotes = Number(finalMaster.upvotes || 0) + Number(finalDup.upvotes || 0);

    await conn.query(
      `UPDATE feedback
       SET upvotes = ?
       WHERE feedback_id = ?`,
      [newUpvotes, finalMaster.feedback_id]
    );

    // Hide the duplicate from employees 
    await conn.query(
      `UPDATE feedback
       SET moderation_status = 'merged',
           moderation_reason = CONCAT('Merged into #', ?),
           moderated_at = NOW(),
           moderated_by = ?
       WHERE feedback_id = ?`,
      [finalMaster.feedback_id, req.auth.user, finalDup.feedback_id]
    );

    await conn.query(
      `INSERT INTO feedback_merge_log
         (master_feedback_id, merged_feedback_id, merged_by, merged_at,
          master_created_at, merged_created_at,
          master_upvotes_before, merged_upvotes, master_upvotes_after)
       VALUES (?, ?, ?, NOW(), ?, ?, ?, ?, ?)`,
      [
        finalMaster.feedback_id,
        finalDup.feedback_id,
        req.auth.user,
        finalMaster.created_at,
        finalDup.created_at,
        Number(finalMaster.upvotes || 0),
        Number(finalDup.upvotes || 0),
        newUpvotes
      ]
    );

    if (pairId) {
      await conn.query(
        `UPDATE feedback_duplicate_queue
         SET status = 'merged', reviewed_at = NOW(), reviewed_by = ?
         WHERE pair_id = ?`,
        [req.auth.user, pairId]
      );
    } else {
   
      await conn.query(
        `UPDATE feedback_duplicate_queue
         SET status = 'merged', reviewed_at = NOW(), reviewed_by = ?
         WHERE status = 'pending'
           AND (
             (base_feedback_id = ? AND candidate_feedback_id = ?)
             OR (base_feedback_id = ? AND candidate_feedback_id = ?)
           )`,
        [req.auth.user, masterId, dupId, dupId, masterId]
      );
    }

    await conn.commit();
    res.json({ ok: true, message: "Merged.", master_id: finalMaster.feedback_id, upvotes: newUpvotes });
  } catch (err) {
    try { await conn.rollback(); } catch {}
    res.status(500).json({ ok: false, message: "Merge failed", error: err.message });
  } finally {
    conn.release();
  }
});

// Manually trigger a rescan (optional)
app.post("/api/duplicates/scan", requireAuth, requireRole("manager"), async (req, res) => {
  const { limit } = req.body || {};
  const n = Math.min(Math.max(parseInt(limit || 50, 10), 1), 200);

  try {
    const [recent] = await pool.query(
      `SELECT feedback_id, department, category, subject, feedback_text
       FROM feedback
       WHERE moderation_status IN ('approved','flagged')
       ORDER BY created_at DESC
       LIMIT ?`,
      [n]
    );

    for (const f of (recent || [])) {
      await queuePotentialDuplicatesForFeedback(
        f.feedback_id,
        f.department,
        f.category,
        f.subject,
        f.feedback_text
      );
    }

    res.json({ ok: true, message: `Scan complete (checked ${n}).` });
  } catch (err) {
    res.status(500).json({ ok: false, message: "Scan failed", error: err.message });
  }
});


app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
