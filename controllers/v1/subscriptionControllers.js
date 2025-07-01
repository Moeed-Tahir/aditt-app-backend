const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const ConsumerUser = require('../../models/ConsumerUser.model');
const Subscription = require('../../models/Subscription.model');

const createSubscription = async (req, res) => {
  try {
    const { userId, priceId, paymentMethodId } = req.body;

    if (!userId || !priceId || !paymentMethodId) {
      return res.status(400).json({
        status: 'failed',
        message: 'Missing required fields: userId, priceId, or paymentMethodId'
      });
    }

    const user = await ConsumerUser.findById(userId);
    if (!user || !user.stripeCustomerId) {
      return res.status(404).json({
        status: 'failed',
        message: 'User or Stripe customer not found'
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
    });

    const startDate = new Date(subscription.current_period_start * 1000);
    const endDate = new Date(subscription.current_period_end * 1000);

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

    const paymentIntent = subscription.latest_invoice.payment_intent;

    res.json({
      status: 'success',
      openBottomSheet: paymentIntent.status === 'requires_action',
      clientSecret: paymentIntent.client_secret,
      subscriptionId: subscription.id,
    });

  } catch (error) {
    console.error('Subscription creation error:', error);
    res.status(500).json({
      status: 'failed',
      message: 'Subscription creation failed',
      details: error.message
    });
  }
};



module.exports = { createSubscription };
