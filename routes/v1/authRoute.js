const express = require('express');
const router = express.Router();
const authController = require('../../controllers/v1/authControllers');

router.post('/stripe/webhook', authController.stripeWebhookHandler);
router.post('/signup/initiate', authController.initiateSignup);
router.post('/signup/verify-signup-otp', authController.verifySignupOtp);
router.post('/signin/verify-signin-otp', authController.verifySigninOtp);
router.post('/signin', authController.signin);
router.post('/signup/personal-info', authController.savePersonalInfo);
router.post('/signup/verify-identity', authController.initiateIdentityVerification);

module.exports = router;