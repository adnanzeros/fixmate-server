// server/routes/bookings.js
import { Router } from 'express';
import { bookings, services, toObjectId } from '../config/db.js';
import {
  verifyToken,
  verifyCustomer,
  verifyTechnician,
} from '../middleware/auth.js';
import {
  ACTIVE_STATUSES,
  BOOKING_STATUSES,
  TECHNICIAN_TRANSITIONS,
} from '../utils/constants.js';
import { httpError, isText } from '../utils/http.js';

const router = Router();

// POST /api/bookings  (customer) -> create a repair request
router.post('/', verifyToken, verifyCustomer, async (req, res) => {
  const {
    serviceId,
    customerPhone,
    address,
    preferredDate,
    problemDescription,
  } = req.body || {};

  const _id = toObjectId(serviceId);
  if (!_id) throw httpError(400, 'Invalid service');
  if (!/^\+?[\d\s-]{7,15}$/.test(String(customerPhone || '').trim())) {
    throw httpError(400, 'Enter a valid phone number');
  }
  if (!isText(address, 3, 300)) throw httpError(400, 'Address is required');
  if (!isText(problemDescription, 20, 3000)) {
    throw httpError(400, 'Problem description must be at least 20 characters');
  }

  // preferred date: today or a future date (one day of slack for time zones)
  const date = new Date(`${preferredDate}T00:00:00.000Z`);
  const earliest = new Date();
  earliest.setUTCDate(earliest.getUTCDate() - 1);
  earliest.setUTCHours(0, 0, 0, 0);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(String(preferredDate)) ||
    Number.isNaN(date.getTime())
  ) {
    throw httpError(400, 'Choose a valid preferred date');
  }
  if (date < earliest)
    throw httpError(400, 'Preferred date must be today or later');

  const service = await services().findOne({
    _id,
    approvalStatus: 'approved',
    isAvailable: true,
  });
  if (!service) throw httpError(404, 'Service not found or not available');

  if (service.technicianEmail === req.user.email) {
    throw httpError(403, 'You cannot request your own service');
  }

  // a customer cannot have two active requests for the same service
  const active = await bookings().findOne({
    serviceId: String(service._id),
    customerEmail: req.user.email,
    status: { $in: ACTIVE_STATUSES },
  });
  if (active)
    throw httpError(409, 'You already have an active request for this service');

  const now = new Date();
  const doc = {
    serviceId: String(service._id),
    serviceTitle: service.title,
    serviceImage: service.image,
    category: service.category,
    basePrice: service.basePrice,
    technicianName: service.technicianName,
    technicianEmail: service.technicianEmail,
    customerName: req.user.name,
    customerEmail: req.user.email,
    customerPhone: String(customerPhone).trim(),
    address: address.trim(),
    preferredDate: date,
    problemDescription: problemDescription.trim(),
    status: 'requested',
    finalAmount: service.basePrice,
    paymentStatus: 'unpaid',
    statusHistory: [{ status: 'requested', changedAt: now }],
    createdAt: now,
  };
  const result = await bookings().insertOne(doc);
  res.status(201).json({ ...doc, _id: result.insertedId });
});

// GET /api/bookings/my  (customer) -> only the logged-in customer's bookings
router.get('/my', verifyToken, verifyCustomer, async (req, res) => {
  const items = await bookings()
    .find({ customerEmail: req.user.email })
    .sort({ createdAt: -1 })
    .toArray();
  res.json(items);
});

// PATCH /api/bookings/:id/cancel  (customer owner, only while 'requested')
router.patch('/:id/cancel', verifyToken, verifyCustomer, async (req, res) => {
  const _id = toObjectId(req.params.id);
  if (!_id) throw httpError(400, 'Invalid booking id');

  const booking = await bookings().findOne({ _id });
  if (!booking) throw httpError(404, 'Booking not found');
  if (booking.customerEmail !== req.user.email) {
    throw httpError(403, 'Forbidden: this is not your booking');
  }
  if (booking.status !== 'requested') {
    throw httpError(
      409,
      "You can only cancel a request that is still 'requested'",
    );
  }

  const updated = await bookings().findOneAndUpdate(
    { _id, customerEmail: req.user.email, status: 'requested' },
    {
      $set: { status: 'cancelled' },
      $push: { statusHistory: { status: 'cancelled', changedAt: new Date() } },
    },
    { returnDocument: 'after' },
  );
  if (!updated)
    throw httpError(409, 'This booking was just updated. Please refresh.');
  res.json(updated);
});

// GET /api/bookings/technician  (technician) -> only jobs that belong to this technician
router.get('/technician', verifyToken, verifyTechnician, async (req, res) => {
  const filter = { technicianEmail: req.user.email };
  const status = typeof req.query.status === 'string' ? req.query.status : '';
  if (BOOKING_STATUSES.includes(status)) filter.status = status;

  const items = await bookings().find(filter).sort({ createdAt: -1 }).toArray();
  res.json(items);
});

// PATCH /api/bookings/:id/status  (technician owner) -> server-enforced job pipeline
router.patch('/:id/status', verifyToken, verifyTechnician, async (req, res) => {
  const _id = toObjectId(req.params.id);
  if (!_id) throw httpError(400, 'Invalid booking id');

  const { status, finalAmount } = req.body || {};
  const booking = await bookings().findOne({ _id });
  if (!booking) throw httpError(404, 'Booking not found');

  if (booking.technicianEmail !== req.user.email) {
    throw httpError(
      403,
      'Forbidden: only the technician who owns this job can update it',
    );
  }

  const allowed = TECHNICIAN_TRANSITIONS[booking.status] || [];
  if (!allowed.includes(status)) {
    throw httpError(
      409,
      `A '${booking.status}' job cannot be changed to '${status}'`,
    );
  }

  const set = { status };
  if (status === 'completed') {
    const amount = Number(finalAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw httpError(
        400,
        'Send a final amount greater than 0 to complete the job',
      );
    }
    set.finalAmount = Math.round(amount * 100) / 100;
  }

  // the filter includes the current status so two quick clicks cannot skip a step
  const updated = await bookings().findOneAndUpdate(
    { _id, technicianEmail: req.user.email, status: booking.status },
    { $set: set, $push: { statusHistory: { status, changedAt: new Date() } } },
    { returnDocument: 'after' },
  );
  if (!updated)
    throw httpError(409, 'This job was just updated. Please refresh.');
  res.json(updated);
});

export default router;
