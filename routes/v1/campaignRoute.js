const express = require('express');
const router = express.Router();
const campaignController = require('../../controllers/v1/campaignController');
const jwtMiddleware = require('../../middlewares/authMiddleware');

router.post('/campaign/getAllSortedCampaigns', campaignController.getAllSortedCampaigns);
router.post('/campaign/submitQuizQuestionResponse', campaignController.submitQuizQuestionResponse);
router.post('/campaign/submitSurveyQuestion1Response', campaignController.submitSurveyQuestion1Response);
router.post('/campaign/submitSurveyQuestion2Response', campaignController.submitSurveyQuestion2Response);


module.exports = router;