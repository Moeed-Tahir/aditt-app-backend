const express = require('express');
const router = express.Router();
const campaignController = require('../../controllers/v1/campaignController');
const jwtMiddleware = require('../../middlewares/authMiddleware');

router.post('/campaign/getAllSortedCampaigns',jwtMiddleware, campaignController.getAllSortedCampaigns);

module.exports = router;