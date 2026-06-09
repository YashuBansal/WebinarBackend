const mongoose = require('mongoose');
const AutomationFlow = require('./AutomationFlow');

const saveAutomationFlow = async (req, res) => {
  try {
    const { flowId, flowName, nodes = [], edges = [], projectId, userId, status, isActive } = req.body;

    if (!flowName) {
      return res.status(400).json({ error: 'flowName is required' });
    }

    // Extract triggerType from the first node in nodes array where type === 'trigger'
    const triggerNode = nodes.find(node => node.type === 'trigger');
    const triggerType = triggerNode?.data?.triggerType || triggerNode?.data?.type || 'webhook';

    let flow;

    if (flowId) {
      // Update existing document
      flow = await AutomationFlow.findByIdAndUpdate(
        flowId,
        {
          flowName,
          nodes,
          edges,
          triggerType,
          status: status || 'draft',
          isActive: isActive !== undefined ? isActive : false
        },
        { new: true }
      );

      if (!flow) {
        return res.status(404).json({ error: 'Automation flow not found' });
      }
    } else {
      // Create a new document
      flow = new AutomationFlow({
        flowName,
        projectId: projectId || req.query.projectId || req.headers['x-project-id'] || new mongoose.Types.ObjectId(),
        userId: userId || req.user?.id,
        nodes,
        edges,
        triggerType,
        status: status || 'draft',
        isActive: isActive !== undefined ? isActive : false
      });
      await flow.save();
    }

    return res.status(200).json({
      success: true,
      message: 'Automation flow saved successfully',
      flowId: flow._id,
      flow
    });
  } catch (error) {
    console.error('Error saving automation flow:', error);
    return res.status(500).json({ error: 'Internal server error', details: error.message });
  }
};

module.exports = {
  saveAutomationFlow
};
