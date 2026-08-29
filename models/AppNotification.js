const mongoose = require('mongoose');

const appNotificationSchema = new mongoose.Schema({
  type: {
    type: String,
    required: true,
    enum: ['application', 'weekly_report', 'employee_removal', 'utilities_request', 'utilities_fulfilled', 'director_change']
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
  // For employee_removal notifications - store departed employee details
  employeeName: { type: String, default: null },
  employeeId: { type: Number, default: null },
  companyName: { type: String, default: null },
  companyId: { type: Number, default: null },
  // For utilities armory request notifications - store requester + item details
  requesterId: { type: Number, default: null },
  requesterName: { type: String, default: null },
  itemId: { type: Number, default: null },
  itemName: { type: String, default: null },
  // Targeted recipient for notifications addressed to a single player (e.g. the
  // requester receiving a 'utilities_fulfilled' notification). Null = visible to all.
  recipientId: { type: Number, default: null },
  // Read tracking
  readBy: [{ type: Number }], // array of tornPlayerIds who have read it
  createdAt: { type: Date, default: Date.now }
});

// Index for efficient querying - most recent first
appNotificationSchema.index({ createdAt: -1 });
appNotificationSchema.index({ type: 1, createdAt: -1 });
appNotificationSchema.index({ recipientId: 1, createdAt: -1 });

module.exports = mongoose.model('AppNotification', appNotificationSchema);