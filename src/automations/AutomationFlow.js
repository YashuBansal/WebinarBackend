const mongoose = require('mongoose');

const AutomationFlowSchema = new mongoose.Schema({
  flowName: {
    type: String,
    required: true
  },
  status: {
    type: String,
    enum: ['draft', 'published'],
    default: 'draft'
  },
  projectId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Project',
    required: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  triggerType: {
    type: String,
    index: true
  },
  nodes: {
    type: mongoose.Schema.Types.Mixed,
    default: []
  },
  edges: {
    type: mongoose.Schema.Types.Mixed,
    default: []
  },
  isActive: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('AutomationFlow', AutomationFlowSchema);
