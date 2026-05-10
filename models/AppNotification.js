const mongoose = require('mongoose');

const appNotificationSchema = new mongoose.Schema({
  type: {
    type: String,
    required: true,
    enum: ['application', 'weekly_report']
  },
  title: {
    type: String,
    required: true
  },
  message: {
    type: String,
    required: true
  },
  // For application notifications - store applicant details
  applicantName: { type: String, default: null },
  applicantId: { type: Number, default: null },
  allYes: { type: Boolean, default: null },
  answers: { type: Object, default: null },
  // For weekly report notifications - store CSV reference
  csvContent: { type: String, default: null },
  snapshotLabel: { type: String, default: null },
  memberCount: { type: Number, default: null },
  // Read tracking
  readBy: [{ type: Number }], // array of tornPlayerIds who have read it
  createdAt: { type: Date, default: Date.now }
});

// Index for efficient querying - most recent first
appNotificationSchema.index({ createdAt: -1 });
appNotificationSchema.index({ type: 1, createdAt: -1 });

module.exports = mongoose.model('AppNotification', appNotificationSchema);