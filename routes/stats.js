
import { Router } from 'express';
import { bookings, payments, services, users } from '../config/db.js';
import {
  verifyToken,
  verifyCustomer,
  verifyTechnician,
  verifyAdmin,
} from '../middleware/auth.js';

const router = Router();

const statusCounts = async match => {
  const rows = await bookings()
    .aggregate([
      { $match: match },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ])
    .toArray();
  return rows.map(r => ({ status: r._id, count: r.count }));
};

const countOf = (rows, ...statuses) =>
  rows
    .filter(r => statuses.includes(r.status))
    .reduce((sum, r) => sum + r.count, 0);

// GET /api/stats/customer  -> cards + chart data for the customer overview
router.get('/customer', verifyToken, verifyCustomer, async (req, res) => {
  const byStatus = await statusCounts({ customerEmail: req.user.email });
  const spent = await payments()
    .aggregate([
      { $match: { customerEmail: req.user.email } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ])
    .toArray();

  res.json({
    totalRequests: byStatus.reduce((s, r) => s + r.count, 0),
    activeJobs: countOf(byStatus, 'requested', 'accepted', 'in-progress'),
    completedJobs: countOf(byStatus, 'completed'),
    totalSpent: spent[0]?.total ?? 0,
    byStatus,
  });
});

// GET /api/stats/technician
router.get('/technician', verifyToken, verifyTechnician, async (req, res) => {
  const email = req.user.email;
  const [byStatus, totalServices, approvedServices, earned] = await Promise.all(
    [
      statusCounts({ technicianEmail: email }),
      services().countDocuments({ technicianEmail: email }),
      services().countDocuments({
        technicianEmail: email,
        approvalStatus: 'approved',
      }),
      payments()
        .aggregate([
          { $match: { technicianEmail: email } },
          { $group: { _id: null, total: { $sum: '$amount' } } },
        ])
        .toArray(),
    ],
  );

  res.json({
    totalServices,
    approvedServices,
    pendingRequests: countOf(byStatus, 'requested'),
    totalEarned: earned[0]?.total ?? 0,
    byStatus,
  });
});

// GET /api/stats/admin  -> cards + status chart + revenue of the last 6 months
router.get('/admin', verifyToken, verifyAdmin, async (req, res) => {
  const since = new Date();
  since.setMonth(since.getMonth() - 5, 1);
  since.setHours(0, 0, 0, 0);

  const [
    totalUsers,
    totalTechnicians,
    pendingServices,
    byStatus,
    revenue,
    monthly,
  ] = await Promise.all([
    users().countDocuments({}),
    users().countDocuments({ role: 'technician' }),
    services().countDocuments({ approvalStatus: 'pending' }),
    statusCounts({}),
    payments()
      .aggregate([{ $group: { _id: null, total: { $sum: '$amount' } } }])
      .toArray(),
    payments()
      .aggregate([
        { $match: { paidAt: { $gte: since } } },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m', date: '$paidAt' } },
            revenue: { $sum: '$amount' },
          },
        },
        { $sort: { _id: 1 } },
      ])
      .toArray(),
  ]);

  res.json({
    totalUsers,
    totalTechnicians,
    pendingServices,
    totalRevenue: revenue[0]?.total ?? 0,
    byStatus,
    monthlyRevenue: monthly.map(m => ({ month: m._id, revenue: m.revenue })),
  });
});

export default router;
