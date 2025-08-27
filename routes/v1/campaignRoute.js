const express = require('express');
const router = express.Router();
const campaignController = require('../../controllers/v1/campaignController');
const jwtMiddleware = require('../../middlewares/authMiddleware');

router.post('/campaign/getAllSortedCampaigns', campaignController.getAllSortedCampaigns);
router.post('/campaign/submitQuizQuestionResponse', campaignController.submitQuizQuestionResponse);
router.post('/campaign/submitSurveyResponses', campaignController.submitSurveyResponses);
router.post('/campaign/recordCampaignClick', campaignController.recordCampaignClick );
router.post('/campaign/paymentDeduct', campaignController.paymentDeduct );

module.exports = router;