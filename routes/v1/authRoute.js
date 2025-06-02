const express = require('express');
const router = express.Router();
const authController = require('../../controllers/v1/authControllers');
const jwtMiddleware = require('../../middlewares/authMiddleware');

router.post('/stripe/webhook', authController.stripeWebhookHandler);
router.post('/signup/initiate', authController.initiateSignup);
router.post('/signup/verify-signup-otp', jwtMiddleware, authController.verifySignupOtp);
router.post('/signin/verify-signin-otp', authController.verifySigninOtp);
router.post('/signin', authController.signin);
router.post('/signup/personal-info', jwtMiddleware, authController.savePersonalInfo);
router.post('/signup/verify-identity', jwtMiddleware, authController.initiateIdentityVerification);
router.get('/verification-success', authController.handleVerificationSuccess);

module.exports = router;