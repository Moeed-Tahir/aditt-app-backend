const express = require('express');
const bodyParser = require('body-parser');
const router = express.Router();
const authController = require('../../controllers/v1/authControllers');

router.post('/webhook',
    bodyParser.raw({ type: 'application/json' }),
    authController.stripeWebhookHandler
);

module.exports = router;