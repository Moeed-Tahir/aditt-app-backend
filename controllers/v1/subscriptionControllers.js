const dotenv = require("dotenv");
dotenv.config();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const ConsumerUser = require('../../models/ConsumerUser.model');
const Subscription = require('../../models/Subscription.model');

exports.createPlan = async (req, res) => {
  try {
    const { name, amount, interval } = req.body;

    const product = await stripe.products.create({ name });
    const price = await stripe.prices.create({
      product: product.id,
      unit_amount: amount,
      currency: 'usd',
      recurring: { interval },
    });

    res.status(200).json({
      success: true,
      message: 'Plan created successfully',
      productId: product.id,
      priceId: price.id,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to create plan',
      error: error.message,
    });
  }
};

exports.fetchAllPlans = async (req, res) => {
  try {
    const prices = await stripe.prices.list({
      active: true,
      expand: ['data.product'],
    });

    const plans = prices.data.map((price) => {
      const product = price.product;
      return {
        id: price.id,
        title: product.name,
        amount: price.unit_amount / 100,
        currency: price.currency,
        frequency: price.recurring?.interval || "one-time",
      };
    });

    plans.sort((a, b) => a.amount - b.amount);

    res.status(200).json({
      status: "success",
      plans,
    });
  } catch (error) {
    res.status(500).json({
      status: "failed",
      message: error.message,
    });
  }
};

exports.createCustomerAndSetupIntent = async (req, res) => {
  try {
    const { name, email, userId } = req.body;

    if (!name || !email || !userId) {
      return res.status(400).json({
        status: "failed",
        message: "Missing required fields.",
      });
    }

    let user = await ConsumerUser.findById(userId);
    if (!user) {
      return res.status(404).json({ status: "failed", message: "User not found" });
    }

    let customerId = user.stripeCustomerId;
    let customer;

    if (!customerId) {
      customer = await stripe.customers.create({
        name,
        email,
        description: "Aditt User",
      });

      customerId = customer.id;

      user.stripeCustomerId = customerId;
      await user.save();
    }

    const setupIntent = await stripe.setupIntents.create({
      customer: customerId,
      automatic_payment_methods: { enabled: true },
    });

    res.status(200).json({
      status: "success",
      clientSecret: setupIntent.client_secret,
      customerId,
      setupIntentID:setupIntent.id
    });
  } catch (error) {
    res.status(500).json({
      status: "failed",
      message: error.message,
    });
  }
};

exports.subscribeCustomer = async (req, res) => {
  try {
    const { priceId, setupIntentId, userId } = req.body;

    if (!priceId || !setupIntentId || !userId) {
      return res.status(400).json({
        status: "failed",
        message: "Missing required fields.",
      });
    }

    const setupIntent = await stripe.setupIntents.retrieve(setupIntentId);

    const paymentMethodId = setupIntent.payment_method;
    const customerId = setupIntent.customer;

    const subscription = await stripe.subscriptions.create({
      customer: customerId,
      default_payment_method: paymentMethodId,
      items: [{ price: priceId }],
      expand: ['latest_invoice.payment_intent'],
    });

    const startDate = new Date(subscription.current_period_start * 1000);
    const endDate = new Date(subscription.current_period_end * 1000);

    const newSubscription = await Subscription.create({
      stripeSubscriptionId: subscription.id,
      status: subscription.status,
      planId: priceId,
      priceId: priceId,
      startDate,
      endDate,
      userId,
    });

    await ConsumerUser.findByIdAndUpdate(userId, {
      subscriptionPlan: 'Premium',
    });

    res.status(200).json({
      status: "success",
      subscriptionId: subscription.id,
      clientSecret: subscription.latest_invoice.payment_intent.client_secret,
    });
  } catch (error) {
    res.status(500).json({
      status: "failed",
      message: error.message,
    });
  }
};

exports.checkAndCancelExpiredSubscriptions = async () => {
  try {
    console.log("Call this")
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    const expiredSubscriptions = await Subscription.find({
      endDate: { $lte: yesterday },
      status: 'active'
    });

    for (const subscription of expiredSubscriptions) {
      try {
        await stripe.subscriptions.del(subscription.stripeSubscriptionId);

        subscription.status = 'canceled';
        subscription.updatedAt = new Date();
        await subscription.save();

        await ConsumerUser.findByIdAndUpdate(subscription.userId, {
          subscriptionPlan: 'Free',
        });

        console.log(`Canceled expired subscription: ${subscription.stripeSubscriptionId}`);
      } catch (error) {
        console.error(`Error canceling subscription ${subscription.stripeSubscriptionId}:`, error.message);
      }
    }

    return { success: true, message: `Processed ${expiredSubscriptions.length} expired subscriptions` };
  } catch (error) {
    console.error('Error in checkAndCancelExpiredSubscriptions:', error.message);
    return { success: false, message: error.message };
  }
};

exports.manualTriggerSubscriptionCheck = async (req, res) => {
  try {
    const result = await exports.checkAndCancelExpiredSubscriptions();
    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};


