// server/routes/services.js
import { Router } from 'express';
import { services, users, toObjectId } from '../config/db.js';
import { verifyToken, verifyTechnician } from '../middleware/auth.js';
import { CATEGORIES, SERVICE_MODES } from '../utils/constants.js';
import { httpError, isText } from '../utils/http.js';

const router = Router();

const escapeRegex = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const SORTS = {
  newest: { createdAt: -1, _id: -1 },
  'price-asc': { basePrice: 1, _id: -1 },
  'price-desc': { basePrice: -1, _id: -1 },
};

/** Validates the add / edit form. Returns the clean fields or throws a 400. */
function parseServiceBody(body, { requireImage }) {
  const b = body || {};
  if (!isText(b.title, 3, 120))
    throw httpError(400, 'Title must be 3 to 120 characters');
  if (!CATEGORIES.includes(b.category))
    throw httpError(400, 'Choose a valid category');
  if (!isText(b.description, 10, 3000))
    throw httpError(400, 'Description must be at least 10 characters');
  const basePrice = Number(b.basePrice);
  if (!Number.isFinite(basePrice) || basePrice <= 0)
    throw httpError(400, 'Base price must be a positive number');
  if (!isText(b.estimatedDuration, 1, 60))
    throw httpError(400, 'Estimated duration is required');
  if (!SERVICE_MODES.includes(b.serviceMode))
    throw httpError(400, 'Choose a valid service mode');
  if (!isText(b.serviceArea, 2, 120))
    throw httpError(400, 'Service area is required');
  if (requireImage && !/^https?:\/\//.test(b.image || ''))
    throw httpError(400, 'Service image is required');

  const data = {
    title: b.title.trim(),
    category: b.category,
    description: b.description.trim(),
    basePrice: Math.round(basePrice * 100) / 100,
    estimatedDuration: b.estimatedDuration.trim(),
    serviceMode: b.serviceMode,
    serviceArea: b.serviceArea.trim(),
  };
  if (/^https?:\/\//.test(b.image || '')) data.image = b.image;
  return data;
}

// GET /api/services  (public)  -> search, filter, sort and pagination all happen in MongoDB
router.get('/', async (req, res) => {
  const str = v => (typeof v === 'string' ? v.trim() : '');
  const search = str(req.query.search);
  const category = str(req.query.category);
  const mode = str(req.query.mode);
  const sort = SORTS[str(req.query.sort)] ? str(req.query.sort) : 'newest';
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 12));

  const filter = { approvalStatus: 'approved', isAvailable: true };
  if (CATEGORIES.includes(category)) filter.category = category;
  if (SERVICE_MODES.includes(mode)) filter.serviceMode = mode;
  if (search) {
    const rx = new RegExp(escapeRegex(search), 'i');
    filter.$or = [{ title: rx }, { category: rx }];
  }

  const [items, total] = await Promise.all([
    services()
      .find(filter)
      .sort(SORTS[sort])
      .skip((page - 1) * limit)
      .limit(limit)
      .toArray(),
    services().countDocuments(filter),
  ]);

  res.json({
    services: items,
    total,
    page,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  });
});

// GET /api/services/mine  (technician) -> all services created by the logged-in technician
router.get('/mine', verifyToken, verifyTechnician, async (req, res) => {
  const items = await services()
    .find({ technicianEmail: req.user.email })
    .sort({ createdAt: -1 })
    .toArray();
  res.json(items);
});

// GET /api/services/:id  (public) -> only approved + available services
router.get('/:id', async (req, res) => {
  const _id = toObjectId(req.params.id);
  if (!_id) throw httpError(404, 'Service not found');

  const service = await services().findOne({
    _id,
    approvalStatus: 'approved',
    isAvailable: true,
  });
  if (!service) throw httpError(404, 'Service not found');

  const tech = await users().findOne(
    { email: service.technicianEmail },
    { projection: { name: 1, image: 1, area: 1, bio: 1 } },
  );
  res.json({
    ...service,
    technician: tech
      ? {
          name: tech.name,
          image: tech.image || '',
          area: tech.area || '',
          bio: tech.bio || '',
        }
      : { name: service.technicianName },
  });
});

// POST /api/services  (technician)
router.post('/', verifyToken, verifyTechnician, async (req, res) => {
  const data = parseServiceBody(req.body, { requireImage: true });
  const doc = {
    ...data,
    technicianName: req.user.name, // copied from the logged-in technician, never from the body
    technicianEmail: req.user.email,
    approvalStatus: 'pending',
    isAvailable: true,
    createdAt: new Date(),
  };
  const result = await services().insertOne(doc);
  res.status(201).json({ ...doc, _id: result.insertedId });
});

// PATCH /api/services/:id  (technician owner)
//  - { isAvailable } only  -> toggle availability (approval stays as it is)
//  - full edit             -> saved, and approvalStatus goes back to 'pending'
router.patch('/:id', verifyToken, verifyTechnician, async (req, res) => {
  const _id = toObjectId(req.params.id);
  if (!_id) throw httpError(400, 'Invalid service id');

  const service = await services().findOne({ _id });
  if (!service) throw httpError(404, 'Service not found');
  if (service.technicianEmail !== req.user.email) {
    throw httpError(403, 'Forbidden: you can only change your own services');
  }

  const keys = Object.keys(req.body || {});
  let update;
  if (keys.length === 1 && keys[0] === 'isAvailable') {
    if (typeof req.body.isAvailable !== 'boolean')
      throw httpError(400, 'isAvailable must be true or false');
    update = { isAvailable: req.body.isAvailable };
  } else {
    update = {
      ...parseServiceBody(req.body, { requireImage: false }),
      approvalStatus: 'pending',
    };
  }

  const updated = await services().findOneAndUpdate(
    { _id, technicianEmail: req.user.email },
    { $set: update },
    { returnDocument: 'after' },
  );
  res.json(updated);
});

// DELETE /api/services/:id  (technician owner)
router.delete('/:id', verifyToken, verifyTechnician, async (req, res) => {
  const _id = toObjectId(req.params.id);
  if (!_id) throw httpError(400, 'Invalid service id');

  const service = await services().findOne({ _id });
  if (!service) throw httpError(404, 'Service not found');
  if (service.technicianEmail !== req.user.email) {
    throw httpError(403, 'Forbidden: you can only delete your own services');
  }

  await services().deleteOne({ _id });
  res.json({ message: 'Service deleted' });
});

export default router;
