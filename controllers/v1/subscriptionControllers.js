const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const ConsumerUser = require('../../models/ConsumerUser.model');


const setupStripePaymentSheet = async (req, res) => {
    try {
        const { userId,amount, currency = 'usd' } = req.body;
        
        if (!amount || isNaN(amount) || amount <= 0) {
            return res.status(400).json({ error: 'A valid amount is required' });
        }

        const user = await ConsumerUser.findById(userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        let customerId = user.stripeCustomerId;
        if (!customerId) {
            const customer = await stripe.customers.create({
                email: user.email,
                name: user.name,
                phone: user.phone,
                metadata: {
                    userId: userId.toString(),
                    app: 'AdditApp'
                }
            });
            
            customerId = customer.id;
            user.stripeCustomerId = customerId;
            await user.save();
        }

        const paymentIntent = await stripe.paymentIntents.create({
            amount: Math.round(amount * 100), 
            currency,
            customer: customerId,
            automatic_payment_methods: {
                enabled: true,
            },
            metadata: {
                userId: userId.toString(),
                purpose: 'Your payment purpose'
            }
        });

        res.json({
            clientSecret: paymentIntent.client_secret,
            customerId: customerId,
            ephemeralKey: await createEphemeralKey(customerId),
            publishableKey: process.env.STRIPE_PUBLISHABLE_KEY
        });

    } catch (error) {
        console.error('Error setting up payment sheet:', error);
        res.status(500).json({ error: 'Failed to setup payment sheet', details: error.message });
    }
};

const createEphemeralKey = async (customerId) => {
    const key = await stripe.ephemeralKeys.create(
        { customer: customerId },
        { apiVersion: '2024-06-20' }
    );
    return key.secret;
};

module.exports = {
    setupStripePaymentSheet
};