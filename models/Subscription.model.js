const mongoose = require('mongoose');

const subscriptionSchema = new mongoose.Schema({
  stripeSubscriptionId: {
    type: String,
    required: true,
    unique: true
  },
  status: {
    type: String,
    required: true,
    enum: ['active', 'past_due', 'unpaid', 'canceled', 'incomplete', 'incomplete_expired', 'trialing']
  },
  planId: {
    type: String
  },
  priceId: {
    type: String,
    required: true
  },
  startDate: {
    type: Date,
    required: true
  },
  endDate: {
    type: Date,
    required: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ConsumerUser',
    required: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('Subscription', subscriptionSchema);