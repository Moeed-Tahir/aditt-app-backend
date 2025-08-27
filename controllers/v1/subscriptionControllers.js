const dotenv = require("dotenv");
dotenv.config();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const ConsumerUser = require('../../models/ConsumerUser.model');
const Subscription = require('../../models/Subscription.model');
const TransactionHistory = require('../../models/TransactionHistory.model');
const moment = require("moment");

exports.createPlan = async (req, res) => {
  try {
    const { name, amount, interval } = req.body;

    const validIntervals = ['month', 'year', 'week', 'day'];
    if (!validIntervals.includes(interval)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid interval',
        error: 'Recurring interval must be one of: month, year, week, or day'
      });
    }

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
      setupIntentID: setupIntent.id
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

    const startDate = new Date();
    const endDate = new Date();
    endDate.setDate(startDate.getDate() + 30);


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

    let clientSecret = null;
    if (
      subscription.latest_invoice &&
      subscription.latest_invoice.payment_intent &&
      subscription.latest_invoice.payment_intent.client_secret
    ) {
      clientSecret = subscription.latest_invoice.payment_intent.client_secret;
    }

    const updatedUser = await ConsumerUser.findById(userId);

    res.status(200).json({
      status: "success",
      subscriptionId: subscription.id,
      clientSecret,
      user: updatedUser,
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

exports.payout = async (req, res) => {
  try {
    const { userId, amount } = req.body;

    if (!userId || !amount) {
      return res.status(400).json({
        status: "failed",
        message: "Missing required fields: userId and amount",
      });
    }

    const user = await ConsumerUser.findById(userId);
    if (!user) {
      return res.status(404).json({
        status: "failed",
        message: "User not found"
      });
    }

    if (!user.stripeCustomerId) {
      return res.status(400).json({
        status: "failed",
        message: "User doesn't have a Stripe customer account"
      });
    }

    const setupIntent = await stripe.setupIntents.create({
      customer: user.stripeCustomerId,
      payment_method_types: ['us_bank_account'],
      payment_method_options: {
        us_bank_account: {
          financial_connections: {
            permissions: ['payment_method', 'balances'],
          },
        },
      },
    });

    res.status(200).json({
      status: "success",
      clientSecret: setupIntent.client_secret,
      setupIntentId: setupIntent.id,
      message: "SetupIntent created for collecting bank details"
    });

  } catch (error) {
    console.error("Error in payout:", error);
    res.status(500).json({
      status: "failed",
      message: error.message
    });
  }
};

exports.confirmPayout = async (req, res) => {
  try {
    const { userId, setupIntentId, amount, currency = 'usd', description } = req.body;

    if (!userId || !setupIntentId || !amount) {
      return res.status(400).json({
        status: "failed",
        message: "Missing required fields: userId, setupIntentId, and amount",
      });
    }

    const user = await ConsumerUser.findById(userId);
    if (!user) {
      return res.status(404).json({
        status: "failed",
        message: "User not found"
      });
    }

    const setupIntent = await stripe.setupIntents.retrieve(setupIntentId);
    const paymentMethodId = setupIntent.payment_method;

    if (!paymentMethodId) {
      return res.status(400).json({
        status: "failed",
        message: "No payment method attached to this SetupIntent",
      });
    }

    const payout = await stripe.payouts.create({
      amount: Math.round(amount * 100),
      currency: currency.toLowerCase(),
      method: 'instant',
      destination: paymentMethodId,
      description: description || `Payout to ${user.name}`,
    });

    const transaction = new TransactionHistory({
      userId: userId,
      type: 'payout',
      amount: payout.amount / 100,
    });

    await transaction.save();

    res.status(200).json({
      status: "success",
      payoutId: payout.id,
      amount: payout.amount / 100,
      currency: payout.currency,
      arrivalDate: payout.arrival_date,
      status: payout.status,
      transactionId: transaction._id,
      message: "Payout initiated successfully"
    });

  } catch (error) {
    console.error("Error in confirmPayout:", error);
    res.status(500).json({
      status: "failed",
      message: error.message
    });
  }
};

exports.createConnectedAccount = async (req, res) => {
  try {
    const { userId, email } = req.body;

    const user = await ConsumerUser.findById(userId);
    if (!user) return res.status(404).json({ status: "failed", message: "User not found" });

    if (user.stripeAccountId) {
      return res.status(200).json({
        status: "success",
        stripeAccountId: user.stripeAccountId,
      });
    }

    const account = await stripe.accounts.create({
      type: "express",
      country: "US",
      email: email,
      capabilities: {
        transfers: { requested: true },
      },
    });

    user.stripeAccountId = account.id;
    await user.save();

    res.status(200).json({
      status: "success",
      stripeAccountId: account.id,
    });
  } catch (error) {
    res.status(500).json({
      status: "failed",
      message: error.message,
    });
  }
};

exports.createAccountLink = async (req, res) => {
  try {
    const { userId } = req.body;

    const user = await ConsumerUser.findById(userId);
    if (!user || !user.stripeAccountId) {
      return res.status(400).json({ status: "failed", message: "Stripe connected account not found." });
    }

    const accountLink = await stripe.accountLinks.create({
      account: user.stripeAccountId,
      refresh_url: "https://yourapp.com/stripe/onboarding/refresh",
      return_url: "https://yourapp.com/stripe/onboarding/complete",
      type: "account_onboarding",
    });

    res.status(200).json({
      status: "success",
      url: accountLink.url,
    });
  } catch (error) {
    res.status(500).json({
      status: "failed",
      message: error.message,
    });
  }
};

exports.createPayout = async (req, res) => {
  try {
    const { userId, amount } = req.body;

    const user = await ConsumerUser.findById(userId);
    if (!user) {
      return res.status(400).json({ status: "failed", message: "User not found." });
    }

    if (!user.stripeAccountId) {
      return res.status(400).json({ status: "failed", message: "User doesn't have a Stripe connected account." });
    }

    const transfer = await stripe.transfers.create({
      amount: Math.floor(amount * 100),
      currency: "usd",
      destination: user.stripeAccountId,

    });

    const payout = await stripe.payouts.create({
      amount: Math.floor(amount * 100),
      currency: "usd",
    }, {
      stripeAccount: user.stripeAccountId,
    });

    const transaction = new TransactionHistory({
      userId: userId,
      amount: amount,
      type: 'withdraw'
    });

    await transaction.save();

    res.status(200).json({
      status: "success",
      payoutId: payout.id,
      transferId: transfer.id,
    });
  } catch (error) {
    res.status(500).json({
      status: "failed",
      message: error.message,
    });
  }
};

exports.getUserTransactionHistory = async (req, res) => {
  const { userId, page = 1, limit = 10 } = req.body;

  if (!userId) {
    return res.status(400).json({ error: "User ID is required" });
  }

  try {
    const sevenDaysAgo = moment().subtract(7, 'days').toDate();
    const now = moment().toDate();

    const query = {
      userId,
      createdAt: {
        $gte: sevenDaysAgo,
        $lte: now
      }
    };

    const pageNumber = parseInt(page);
    const limitNumber = parseInt(limit);
    const skip = (pageNumber - 1) * limitNumber;

    const transactions = await TransactionHistory.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNumber)
      .lean();

    const totalCount = await TransactionHistory.countDocuments(query);

    // Delete transactions older than 7 days
    await cleanupOldTransactions();

    res.status(200).json({
      success: true,
      data: transactions,
      pagination: {
        totalRecords: totalCount,
        currentPage: pageNumber,
        totalPages: Math.ceil(totalCount / limitNumber),
        recordsPerPage: limitNumber
      },
    });

  } catch (error) {
    console.error("Error fetching transaction history:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error"
    });
  }
};

async function cleanupOldTransactions() {
  try {
    const cutoffDate = moment().subtract(7, 'days').toDate();

    const result = await TransactionHistory.deleteMany({
      createdAt: { $lt: cutoffDate }
    });

    console.log(`🧹 Cleaned up ${result.deletedCount} transactions older than 7 days`);
    return result;
  } catch (error) {
    console.error("Error cleaning up old transactions:", error);
    throw error;
  }
}
