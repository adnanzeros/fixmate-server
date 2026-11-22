
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { users } from '../config/db.js';

let jwks;
function getJwks() {
  if (!jwks) {
    jwks = createRemoteJWKSet(
      new URL('/api/auth/jwks', process.env.BETTER_AUTH_URL),
      
      { timeoutDuration: 15000 },
    );
  }
  return jwks;
}

/**
 * Verifies the BetterAuth JWT from `Authorization: Bearer <token>`.
 * Missing / invalid / expired token => 401.
 * The role is read from the database (not from the token), so a role change by the
 * admin takes effect immediately.
 */
export async function verifyToken(req, res, next) {
  const [scheme, token] = (req.headers.authorization || '').split(' ');
  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ message: 'Unauthorized: missing token' });
  }

  try {
    const origin = new URL(process.env.BETTER_AUTH_URL).origin;
    const { payload } = await jwtVerify(token, getJwks(), {
      issuer: origin,
      audience: origin,
    });

    const dbUser = await users().findOne(
      { email: payload.email },
      { projection: { name: 1, email: 1, image: 1, role: 1 } },
    );
    if (!dbUser)
      return res.status(401).json({ message: 'Unauthorized: user not found' });

    req.user = {
      id: String(dbUser._id),
      email: dbUser.email,
      name: dbUser.name,
      image: dbUser.image || '',
      role: dbUser.role || 'customer',
    };
    next();
  } catch {
    res.status(401).json({ message: 'Unauthorized: invalid or expired token' });
  }
}

/** Valid user but wrong role => 403 */
function requireRole(role) {
  return (req, res, next) => {
    if (req.user?.role !== role) {
      return res
        .status(403)
        .json({ message: `Forbidden: ${role} access only` });
    }
    next();
  };
}

export const verifyCustomer = requireRole('customer');
export const verifyTechnician = requireRole('technician');
export const verifyAdmin = requireRole('admin');