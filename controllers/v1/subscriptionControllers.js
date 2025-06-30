const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const ConsumerUser = require('../../models/ConsumerUser.model');
const Subscription = require('../../models/Subscription.model');

const createSetupIntent = async (req, res) => {
  try {
    const { userId } = req.body;

    const user = await ConsumerUser.findById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const setupIntent = await stripe.setupIntents.create({
      customer: user.stripeCustomerId,
      payment_method_types: ['card'], 
    });

    res.json({
      setupIntentId: setupIntent.id,
      clientSecret: setupIntent.client_secret,
    });
  } catch (error) {
    console.error('Error creating SetupIntent:', error);
    res.status(500).json({ error: 'Failed to create SetupIntent' });
  }
};

const createSubscription = async (req, res) => {
  try {
    const { userId, priceId, setupIntentId } = req.body;

    if (!userId || !priceId || !setupIntentId) {
      return res.status(400).json({ 
        status: 'failed', 
        message: 'Missing required fields: userId, priceId, or setupIntentId' 
      });
    }

    const user = await ConsumerUser.findById(userId);
    if (!user || !user.stripeCustomerId) {
      return res.status(404).json({ 
        status: 'failed', 
        message: 'User or Stripe customer not found' 
      });
    }

    const setupIntent = await stripe.setupIntents.retrieve(setupIntentId);
    const paymentMethodId = setupIntent.payment_method;
    
    if (!paymentMethodId) {
      return res.status(400).json({ 
        status: 'failed', 
        message: 'No payment method found in SetupIntent' 
      });
    }

    await stripe.paymentMethods.attach(paymentMethodId, {
      customer: user.stripeCustomerId,
    });

    await stripe.customers.update(user.stripeCustomerId, {
      invoice_settings: {
        default_payment_method: paymentMethodId,
      },
    });

    const subscription = await stripe.subscriptions.create({
      customer: user.stripeCustomerId,
      items: [{ price: priceId }],
      expand: ['latest_invoice.payment_intent'],
      payment_behavior: 'default_incomplete',
      metadata: { userId: user._id.toString() }
    });

    const startDate = new Date(subscription.current_period_start * 1000);
    const endDate = new Date(subscription.current_period_end * 1000);

    const productId = subscription.items.data[0].price.product;
    const features = {
      subscriptionPlan: "Premium",
      childProfileLimit: productId === 'prod_SEOA8MbLd4rWqL' ? 6 : 3 
    };

    const newSubscription = new Subscription({
      stripeSubscriptionId: subscription.id,
      status: subscription.status,
      planId: subscription.items.data[0].plan.id,
      priceId: priceId,
      startDate,
      endDate,
      userId: user._id
    });
    await newSubscription.save();

    user.subscriptionStatus = 'active';
    user.subscriptionPlan = features.subscriptionPlan;
    user.childProfileLimit = features.childProfileLimit;
    await user.save();

    res.json({
      status: 'success',
      requiresAction: subscription.latest_invoice.payment_intent.status === 'requires_action',
      clientSecret: subscription.latest_invoice.payment_intent.client_secret,
      subscriptionId: subscription.id,
      customerId: user.stripeCustomerId,
      paymentMethodId: paymentMethodId
    });

  } catch (error) {
    console.error('Subscription creation error:', error);
    
    if (error.type === 'StripeCardError') {
      return res.status(400).json({ 
        status: 'failed', 
        message: 'Payment failed', 
        details: error.message 
      });
    }
    
    res.status(500).json({ 
      status: 'failed', 
      message: 'Subscription creation failed',
      details: error.message 
    });
  }
};

module.exports = {createSubscription}