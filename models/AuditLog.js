const mongoose = require('mongoose');

// ─── Audit log ───────────────────────────────────────────────────────────────
// Security-relevant events around API key handling. NEVER store key material
// here (or anywhere) — only who did what, to whom, when, and from where.
const auditLogSchema = new mongoose.Schema({
  action: {
    type: String,
    required: true,
    enum: ['key_reveal', 'key_save', 'key_login', 'key_access_check', 'faction_key_save']
  },
  // Who performed the action (tornPlayerId from the session)
  actorId: { type: Number, required: true },
  // Whose key was affected (same as actorId for self-service actions)
  targetId: { type: Number, default: null },
  outcome: { type: String, enum: ['success', 'rejected', 'grace'], default: 'success' },
  // Human-readable detail (e.g. "access level below Full", "owner mismatch").
  // Must never include the key itself or any part of it.
  detail: { type: String, default: null },
  ip: { type: String, default: null },
  createdAt: { type: Date, default: Date.now }
});

// Index for efficient querying - most recent first
auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ action: 1, createdAt: -1 });
auditLogSchema.index({ actorId: 1, createdAt: -1 });

// ─── Helper: record an audit event (fire-and-forget; never throws) ──────────
// Usage: await logAudit({ action, actorId, targetId, outcome, detail, ip, req })
// 'req' is optional — IP is pulled from it automatically.
async function logAudit(entry) {
  try {
    const { action, actorId, targetId, outcome, detail, req } = entry || {};
    const ip = req
      ? (req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || null)
      : (entry.ip || null);

    await AuditLog.create({ action, actorId, targetId, outcome, detail, ip });
  } catch (err) {
    // Audit failures must never break the request they accompany
    console.error('[AuditLog] Failed to record entry:', err.message);
  }
}

const AuditLog = mongoose.model('AuditLog', auditLogSchema);

module.exports = { AuditLog, logAudit };