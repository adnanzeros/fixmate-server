
import { Router } from 'express';
import Stripe from 'stripe';
import { bookings, payments, toObjectId } from '../config/db.js';
import { verifyToken, verifyCustomer } from '../middleware/auth.js';
import { httpError } from '../utils/http.js';
import { clientUrlFor } from '../utils/origins.js';

const router = Router();

let stripe;
const getStripe = () => {
  const key = (process.env.STRIPE_SECRET_KEY || '').trim();
  // This project runs in Stripe TEST mode only
  if (!/^sk_test_/.test(key)) {
    console.error(
      'STRIPE_SECRET_KEY is missing or not a test key. Put your Stripe TEST secret key (sk_test_...) in the server .env',
    );
    throw httpError(500, 'Payment service is not configured');
  }
  return (stripe ??= new Stripe(key));
};



export async function savePaidSession(session) {
  const bookingId = session.metadata?.bookingId;
  const _id = toObjectId(bookingId);
  if (!_id) throw httpError(400, 'Checkout session has no valid booking');

  const booking = await bookings().findOne({ _id });
  if (!booking) throw httpError(404, 'Booking not found');

  let payment = await payments().findOne({
    $or: [{ stripeSessionId: session.id }, { bookingId }],
  });

  if (!payment) {
    const doc = {
      bookingId,
      serviceTitle: booking.serviceTitle,
      customerName: booking.customerName,
      customerEmail: booking.customerEmail,
      technicianName: booking.technicianName,
      technicianEmail: booking.technicianEmail,
      amount: (session.amount_total ?? 0) / 100,
      currency: session.currency || 'usd',
      transactionId:
        typeof session.payment_intent === 'string'
          ? session.payment_intent
          : session.payment_intent?.id,
      stripeSessionId: session.id,
      paymentStatus: 'paid',
      paidAt: new Date(),
    };
    try {
      const result = await payments().insertOne(doc);
      payment = { ...doc, _id: result.insertedId };
    } catch (err) {
      if (err.code !== 11000) throw err;
      // another request saved it first (webhook vs success page)
      payment = await payments().findOne({
        $or: [{ stripeSessionId: session.id }, { bookingId }],
      });
    }
  }

  // only flips unpaid -> paid, so it is safe to run more than once
  await bookings().updateOne(
    { _id, paymentStatus: 'unpaid' },
    {
      $set: { paymentStatus: 'paid' },
      $push: { statusHistory: { status: 'paid', changedAt: new Date() } },
    },
  );
  return payment;
}

// POST /api/payments/create-checkout-session  (customer)
router.post(
  '/create-checkout-session',
  verifyToken,
  verifyCustomer,
  async (req, res) => {
    const _id = toObjectId(req.body?.bookingId);
    if (!_id) throw httpError(400, 'Invalid booking id');

    // the amount always comes from the database, never from the client
    const booking = await bookings().findOne({ _id });
    if (!booking) throw httpError(404, 'Booking not found');
    if (booking.customerEmail !== req.user.email) {
      throw httpError(403, 'Forbidden: this is not your booking');
    }
    if (booking.status !== 'completed') {
      throw httpError(409, 'You can pay only after the job is completed');
    }
    if (booking.paymentStatus !== 'unpaid') {
      throw httpError(409, 'This booking is already paid');
    }
    if (!(booking.finalAmount > 0))
      throw httpError(409, 'This job has no final amount yet');

    const clientUrl = clientUrlFor(req);
    if (!clientUrl) throw httpError(500, 'CLIENT_URL is not configured');

    const session = await getStripe().checkout.sessions.create({
      mode: 'payment',
      customer_email: req.user.email,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: 'usd',
            unit_amount: Math.round(booking.finalAmount * 100),
            product_data: { name: booking.serviceTitle },
          },
        },
      ],
      metadata: {
        bookingId: String(booking._id),
        customerEmail: req.user.email,
      },
      success_url: `${clientUrl}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${clientUrl}/payment/cancel`,
    });

    res.json({ url: session.url });
  },
);

// GET /api/payments/verify?session_id=...  (customer)
router.get('/verify', verifyToken, verifyCustomer, async (req, res) => {
  const sessionId = req.query.session_id;
  if (typeof sessionId !== 'string' || !sessionId.startsWith('cs_')) {
    throw httpError(400, 'Invalid session id');
  }

  const session = await getStripe().checkout.sessions.retrieve(sessionId);
  if (session.metadata?.customerEmail !== req.user.email) {
    throw httpError(403, 'Forbidden: this payment is not yours');
  }
  if (session.payment_status !== 'paid') {
    throw httpError(402, 'Payment is not completed');
  }

  const payment = await savePaidSession(session);
  res.json({ payment });
});

// GET /api/payments/my  (customer) -> payment history
router.get('/my', verifyToken, verifyCustomer, async (req, res) => {
  const items = await payments()
    .find({ customerEmail: req.user.email })
    .sort({ paidAt: -1 })
    .toArray();
  res.json(items);
});

/**
 * POST /api/payments/webhook  (Stripe -> server)
 * Mounted in index.js with express.raw() BEFORE express.json(), because the signature
 * check needs the untouched request body.
 */
export async function stripeWebhook(req, res) {
  let event;
  try {
    event = getStripe().webhooks.constructEvent(
      req.body,
      req.headers['stripe-signature'],
      process.env.STRIPE_WEBHOOK_SECRET,
    );
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (
    event.type === 'checkout.session.completed' ||
    event.type === 'checkout.session.async_payment_succeeded'
  ) {
    const session = event.data.object;
    if (session.payment_status === 'paid') {
      try {
        await savePaidSession(session);
      } catch (err) {
        // 4xx = this event can never succeed (not our booking, missing data), so answer 200
        // and Stripe stops retrying. Only real server errors (5xx, e.g. database down) are retried.
        if (err.status && err.status < 500) {
          console.warn('Webhook event ignored:', err.message);
          return res.json({ received: true, ignored: true });
        }
        console.error('Webhook save failed:', err.message);
        return res.status(500).json({ message: 'Could not save payment' }); // Stripe will retry
      }
    }
  }
  res.json({ received: true });
}

export default router;
