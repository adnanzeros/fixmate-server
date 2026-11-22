// server/routes/users.js
import { Router } from 'express';
import { users } from '../config/db.js';
import { verifyToken } from '../middleware/auth.js';
import { httpError, isText } from '../utils/http.js';

const router = Router();

// PATCH /api/users/profile  (any logged-in user)
// Email and role can never be changed here.
router.patch('/profile', verifyToken, async (req, res) => {
  const { name, phone, area, bio, image } = req.body || {};
  const set = { updatedAt: new Date() };

  if (name !== undefined) {
    if (!isText(name, 2, 80))
      throw httpError(400, 'Name must be 2 to 80 characters');
    set.name = name.trim();
  }
  if (phone !== undefined) {
    if (phone !== '' && !/^\+?[\d\s-]{7,15}$/.test(String(phone).trim())) {
      throw httpError(400, 'Enter a valid phone number');
    }
    set.phone = String(phone).trim();
  }
  if (area !== undefined) {
    if (typeof area !== 'string' || area.length > 120)
      throw httpError(400, 'Area is too long');
    set.area = area.trim();
  }
  if (bio !== undefined) {
    if (typeof bio !== 'string' || bio.length > 600)
      throw httpError(400, 'Bio must be under 600 characters');
    set.bio = bio.trim();
  }
  if (image !== undefined) {
    if (image !== '' && !/^https?:\/\//.test(image))
      throw httpError(400, 'Image must be a URL');
    set.image = image;
  }

  const updated = await users().findOneAndUpdate(
    { email: req.user.email },
    { $set: set },
    {
      returnDocument: 'after',
      projection: {
        name: 1,
        email: 1,
        image: 1,
        role: 1,
        phone: 1,
        area: 1,
        bio: 1,
      },
    },
  );
  res.json(updated);
});

export default router;
