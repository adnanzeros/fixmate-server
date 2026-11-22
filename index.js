
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { connectDB } from './config/db.js';
import servicesRouter from './routes/services.js';
import bookingsRouter from './routes/bookings.js';
import usersRouter from './routes/users.js';
import adminRouter from './routes/admin.js';
import statsRouter from './routes/stats.js';
import paymentsRouter, { stripeWebhook } from './routes/payments.js';
import { allowedOrigins as getAllowedOrigins } from './utils/origins.js';

// Warn early about missing configuration (does not stop the server)
for (const key of [
  'MONGODB_URI',
  'CLIENT_URL',
  'BETTER_AUTH_URL',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
]) {
  if (!process.env[key]) console.warn(`[env] ${key} is not set in .env`);
}

const app = express();

// CORS: only the client URL(s) from .env (add your production domain there)
const allowedOrigins = getAllowedOrigins();

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin))
        return callback(null, true);
      callback(
        Object.assign(new Error('Not allowed by CORS'), { status: 403 }),
      );
    },
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    maxAge: 86400,
  }),
);

// Health checks must answer even if the database is slow, so they come first
app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.use(async (req, res, next) => {
  try {
    await connectDB();
    next();
  } catch (err) {
    next(err);
  }
});

// Stripe webhook needs the raw body, so it is registered before express.json()
app.post(
  '/api/payments/webhook',
  express.raw({ type: 'application/json' }),
  stripeWebhook,
);

app.use(express.json({ limit: '1mb' }));

app.get('/', (req, res) => res.json({ name: 'FixMate API', status: 'ok' }));

app.use('/api/services', servicesRouter);
app.use('/api/bookings', bookingsRouter);
app.use('/api/payments', paymentsRouter);
app.use('/api/users', usersRouter);
app.use('/api/admin', adminRouter);
app.use('/api/stats', statsRouter);

app.use((req, res) => res.status(404).json({ message: 'Route not found' }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res
    .status(status)
    .json({ message: status >= 500 ? 'Internal server error' : err.message });
});

if (!process.env.VERCEL) {
  const port = process.env.PORT || 5000;
  app.listen(port, '0.0.0.0', () =>
    console.log(`FixMate API running on port ${port}`),
  );
}

export default app;
