const express = require('express');
const router = express.Router();
const { saveAutomationFlow } = require('./automationController');

// Standard dummy authentication middleware for Node/Express environment
const mockAuth = (req, res, next) => {
  // If req.user is not populated, mock it or proceed
  req.user = req.user || { id: 'mock-user-id' };
  next();
};

router.post('/save', mockAuth, saveAutomationFlow);

module.exports = router;
