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
router.post('/user/updateProfile', jwtMiddleware, authController.updateProfile);
router.get('/verification-success', authController.handleVerificationSuccess);
router.post('/deleteUserProfile', jwtMiddleware, authController.deleteUserProfile);
router.post("/verify-email", jwtMiddleware, authController.verifyEmail);
router.post("/verify-otp", jwtMiddleware, authController.verifyOTP);
router.post("/resend-otp", jwtMiddleware, authController.resendOTP);
router.post('/create-pin', jwtMiddleware, authController.createPin);
router.post('/verify-pin', jwtMiddleware, authController.verifyPin);
router.post('/enable-face-id',jwtMiddleware, authController.userFaceIdEnabled);

module.exports = router;