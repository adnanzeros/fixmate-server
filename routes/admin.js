
import { Router } from 'express';
import {
  bookings,
  payments,
  services,
  users,
  toObjectId,
} from '../config/db.js';
import { verifyToken, verifyAdmin } from '../middleware/auth.js';
import { BOOKING_STATUSES, ROLES } from '../utils/constants.js';
import { httpError } from '../utils/http.js';

const router = Router();
router.use(verifyToken, verifyAdmin);

// GET /api/admin/users
router.get('/users', async (req, res) => {
  const items = await users()
    .find(
      {},
      { projection: { name: 1, email: 1, image: 1, role: 1, createdAt: 1 } },
    )
    .sort({ createdAt: -1 })
    .toArray();
  res.json(items);
});

// PATCH /api/admin/users/:id/role
router.patch('/users/:id/role', async (req, res) => {
  const _id = toObjectId(req.params.id);
  if (!_id) throw httpError(400, 'Invalid user id');

  const { role } = req.body || {};
  if (!ROLES.includes(role))
    throw httpError(400, 'Role must be customer, technician or admin');
  if (String(_id) === req.user.id)
    throw httpError(403, 'You cannot change your own role');

  const result = await users().updateOne(
    { _id },
    { $set: { role, updatedAt: new Date() } },
  );
  if (result.matchedCount === 0) throw httpError(404, 'User not found');
  res.json({ message: 'Role updated', role });
});

// GET /api/admin/services?approvalStatus=pending  (pending first)
router.get('/services', async (req, res) => {
  const status = req.query.approvalStatus;
  const match = ['pending', 'approved', 'rejected'].includes(status)
    ? { approvalStatus: status }
    : {};

  const items = await services()
    .aggregate([
      { $match: match },
      {
        $addFields: {
          rank: { $cond: [{ $eq: ['$approvalStatus', 'pending'] }, 0, 1] },
        },
      },
      { $sort: { rank: 1, createdAt: -1 } },
      { $project: { rank: 0 } },
    ])
    .toArray();
  res.json(items);
});

// PATCH /api/admin/services/:id/approval
router.patch('/services/:id/approval', async (req, res) => {
  const _id = toObjectId(req.params.id);
  if (!_id) throw httpError(400, 'Invalid service id');

  const { approvalStatus } = req.body || {};
  if (!['approved', 'rejected'].includes(approvalStatus)) {
    throw httpError(400, 'approvalStatus must be approved or rejected');
  }

  const updated = await services().findOneAndUpdate(
    { _id },
    { $set: { approvalStatus } },
    { returnDocument: 'after' },
  );
  if (!updated) throw httpError(404, 'Service not found');
  res.json(updated);
});

// GET /api/admin/bookings?status=completed  (read-only)
router.get('/bookings', async (req, res) => {
  const status = req.query.status;
  const filter = BOOKING_STATUSES.includes(status) ? { status } : {};
  const items = await bookings().find(filter).sort({ createdAt: -1 }).toArray();
  res.json(items);
});

// GET /api/admin/payments  -> { payments, totalRevenue }
router.get('/payments', async (req, res) => {
  const [items, revenue] = await Promise.all([
    payments().find({}).sort({ paidAt: -1 }).toArray(),
    payments()
      .aggregate([{ $group: { _id: null, total: { $sum: '$amount' } } }])
      .toArray(),
  ]);
  res.json({ payments: items, totalRevenue: revenue[0]?.total ?? 0 });
});

export default router;
