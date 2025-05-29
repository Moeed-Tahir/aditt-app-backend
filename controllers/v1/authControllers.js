const sendOtp = require("../../services/otpService");
const User = require('../../models/ConsumerUser.model');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const jwt = require("jsonwebtoken");
const dotenv = require("dotenv");
dotenv.config();

const initiateSignup = async (req, res) => {
   try {
      const { name, phone } = req.body;

      if (!name || !phone) {
         return res.status(400).json({
            success: false,
            message: 'Name and phone number are required'
         });
      }

      const existingUser = await User.findOne({ phone });
      if (existingUser?.isVerified) {
         return res.status(400).json({
            success: false,
            message: 'This phone number is already registered'
         });
      }

      const otp = Math.floor(1000 + Math.random() * 9000).toString();
      const otpExpires = new Date(Date.now() + 10 * 60 * 1000);

      const user = existingUser || new User({ name, phone });
      user.otp = otp;
      user.otpExpires = otpExpires;
      await user.save();

      await sendOtp(phone, otp);

      res.status(200).json({
         success: true,
         message: 'OTP sent successfully',
         phone: phone
      });

   } catch (error) {
      res.status(500).json({
         success: false,
         message: 'Server error during signup initiation',
         error: error.message
      });
   }
};

const verifySignupOtp = async (req, res) => {
   try {
      const { phone, otp } = req.body;

      if (!phone || !otp) {
         return res.status(400).json({
            success: false,
            message: 'Phone number and OTP are required'
         });
      }

      const user = await User.findOne({ phone });
      if (!user) {
         return res.status(404).json({
            success: false,
            message: 'User not found. Please start registration again.'
         });
      }

      if (user.otp !== otp || user.otpExpires < new Date()) {
         return res.status(400).json({
            success: false,
            message: 'Invalid or expired OTP'
         });
      }

      user.isOtpVerified = true;
      await user.save();

      res.status(200).json({
         success: true,
         message: 'Phone number verified successfully',
         nextStep: '/complete-profile'
      });

   } catch (error) {
      res.status(500).json({
         success: false,
         message: 'Server error during OTP verification',
         error: error.message
      });
   }
};



const savePersonalInfo = async (req, res) => {
   try {
      const { phone, dateOfBirth, gender, zipCode } = req.body;

      if (!phone || !dateOfBirth || !gender || !zipCode) {
         return res.status(400).json({
            success: false,
            message: 'All personal information fields are required'
         });
      }

      const user = await User.findOne({ phone, isOtpVerified: true });
      if (!user) {
         return res.status(403).json({
            success: false,
            message: 'Please complete phone verification first'
         });
      }

      user.dateOfBirth = new Date(dateOfBirth);
      user.gender = gender;
      user.zipCode = zipCode;
      await user.save();

      res.status(200).json({
         success: true,
         message: 'Personal information saved successfully',
         nextStep: '/identity-verification'
      });

   } catch (error) {
      res.status(500).json({
         success: false,
         message: 'Server error saving personal information',
         error: error.message
      });
   }
};


const initiateIdentityVerification = async (req, res) => {
   try {
      let { phone } = req.body;

      if (!phone) {
         return res.status(400).json({ success: false, message: 'Phone number is required' });
      }

      const user = await User.findOne({ phone, isOtpVerified: true });

      if (!user) {
         return res.status(403).json({
            success: false,
            message: 'Please complete OTP verification first'
         });
      }

      phone = phone.replace(/^\+/, '');

      const customers = await stripe.customers.search({
         query: `phone:'${phone}'`,
         limit: 1
      });

      if (customers.data.length === 0) {
         return res.status(404).json({
            success: false,
            message: 'No Stripe customer account found for this phone number'
         });
      }

      const customer = customers.data[0];

const session = await stripe.identity.verificationSessions.create({
  type: 'document',
  metadata: {
    userId: user._id.toString()
  },
  return_url: 'https://aditt-app-backend-henna.vercel.app/verification-success',
  options: {
    document: {
      require_id_number: false,
      allowed_types: ['driving_license', 'passport', 'id_card'],
      require_matching_selfie: true, // 🔍 Enables face recognition (selfie match)
    }
  }
});



      res.status(200).json({
         success: true,
         message: 'Stripe identity verification session created',
         verificationUrl: session.url
      });

   } catch (error) {
      console.error('Identity verification error:', error);
      res.status(500).json({
         success: false,
         message: 'Server error during identity verification',
         error: error.message
      });
   }
};

const stripeWebhookHandler = async (req, res) => {
  const sig = req.headers['stripe-signature'];

  if (!sig) {
    console.error('No Stripe signature found');
    return res.status(400).send('No Stripe signature found');
  }

  let event;
  
  try {
    // Use the raw body buffer directly (no toString conversion)
    const rawBody = req.body; // This is already a Buffer from bodyParser.raw()

    event = stripe.webhooks.constructEvent(
      rawBody,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error(`Webhook signature verification failed:`, err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Process the event
  console.log(`Event type: ${event.type}`);

  if (event.type.startsWith('identity.verification_session.')) {
    const session = event.data.object;
    const userId = session.metadata?.userId;

    if (!userId) {
      console.error('Missing user ID in metadata');
      return res.status(400).send('Missing user ID');
    }

    const statusMap = {
      'identity.verification_session.verified': 'verified',
      'identity.verification_session.requires_input': 'requires_input',
      'identity.verification_session.canceled': 'canceled',
      'identity.verification_session.processing': 'processing',
    };

    const status = statusMap[event.type] || 'unknown';
    
    const updateData = {
      verificationStatus: status,
      lastVerifiedAt: new Date()
    };

    if (status === 'verified') {
      updateData.isVerified = true;
    }

    await User.findByIdAndUpdate(userId, updateData);
    console.log(`Would update user ${userId} to status: ${status}`);
  }

  res.json({ received: true });
};

const signin = async (req, res) => {
   try {
      const { phone } = req.body;

      if (!phone) {
         return res.status(400).json({
            success: false,
            message: 'Phone number is required'
         });
      }

      const user = await User.findOne({ phone });

      if (!user) {
         return res.status(400).json({
            success: false,
            message: 'User not found'
         });
      }


      if (!user.isVerified) {
         return res.status(400).json({
            success: false,
            message: 'User not verified'
         });
      }

      const otp = Math.floor(1000 + Math.random() * 9000).toString();
      const otpExpires = new Date(Date.now() + 10 * 60 * 1000);

      user.otp = otp;
      user.otpExpires = otpExpires;
      user.isOtpVerified = false;

      await user.save();

      await sendOtp(phone, otp);

      return res.status(200).json({
         success: true,
         message: 'OTP sent to phone number',
         phone
      });

   } catch (error) {
      return res.status(500).json({
         success: false,
         message: 'Server error during sign in',
         error: error.message
      });
   }
};

const verifySigninOtp = async (req, res) => {
   try {
      const { phone, otp } = req.body;

      if (!phone || !otp) {
         return res.status(400).json({
            success: false,
            message: 'Phone number and OTP are required'
         });
      }

      const user = await User.findOne({ phone });

      if (!user) {
         return res.status(404).json({
            success: false,
            message: 'User not found. Please start registration again.'
         });
      }

      if (user.otp !== otp || user.otpExpires < new Date()) {
         return res.status(400).json({
            success: false,
            message: 'Invalid or expired OTP'
         });
      }


      user.isOtpVerified = true;
      user.otp = "Not Present";
      user.otpExpires = null;
      await user.save();

      const token = jwt.sign({ userId: user._id }, process.env.SECRET_KEY, {
         expiresIn: '7d'
      });

      res.status(200).json({
         success: true,
         message: 'Phone number verified successfully',
         token,
         user: {
            id: user._id,
            name: user.name,
            phone: user.phone,
            dateOfBirth: user.dateOfBirth,
            gender: user.gender,
            zipCode: user.zipCode
         }
      });

   } catch (error) {
      res.status(500).json({
         success: false,
         message: 'Server error during OTP verification',
         error: error.message
      });
   }
};


module.exports = { initiateSignup, stripeWebhookHandler, verifySignupOtp, initiateIdentityVerification, savePersonalInfo, signin, verifySigninOtp }