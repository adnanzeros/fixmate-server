
import 'dotenv/config';
import { MongoClient, ObjectId } from 'mongodb';

let client;
let db;
let connecting;


export async function connectDB() {
  if (db) return db;

  if (!connecting) {
    connecting = (async () => {
      const uri = (process.env.MONGODB_URI || '')
        .trim()
        .replace(/^["']|["']$/g, '');

      if (!/^mongodb(?:\+srv)?:\/\//i.test(uri)) {
        throw new Error(
          'Invalid or missing MONGODB_URI. Check your root .env file.',
        );
      }

      client = new MongoClient(uri);

      await client.connect();

      const database = client.db(process.env.MONGODB_DB || 'fixmate');

      await Promise.all([
        database.collection('services').createIndex({
          approvalStatus: 1,
          isAvailable: 1,
          createdAt: -1,
        }),

        database.collection('services').createIndex({
          technicianEmail: 1,
        }),

        database.collection('bookings').createIndex({
          customerEmail: 1,
          createdAt: -1,
        }),

        database.collection('bookings').createIndex({
          technicianEmail: 1,
          createdAt: -1,
        }),

        database.collection('bookings').createIndex({
          serviceId: 1,
          customerEmail: 1,
        }),

        database
          .collection('payments')
          .createIndex({ stripeSessionId: 1 }, { unique: true }),

        database
          .collection('payments')
          .createIndex({ bookingId: 1 }, { unique: true }),

        database.collection('payments').createIndex({
          customerEmail: 1,
          paidAt: -1,
        }),
      ]);

      db = database;

      console.log('MongoDB connected successfully!');
      console.log('Database:', database.databaseName);

      return db;
    })().catch(async error => {
      connecting = undefined;

      if (client) {
        await client.close().catch(() => {});
        client = undefined;
      }

      console.error('MongoDB connection failed:', error.message);
      throw error;
    });
  }

  return connecting;
}

export function getClient() {
  return client;
}

export function getDb() {
  if (!db) {
    throw new Error('Database is not connected yet');
  }

  return db;
}

// Better Auth users collection
export const users = () => getDb().collection('user');

export const services = () => getDb().collection('services');

export const bookings = () => getDb().collection('bookings');

export const payments = () => getDb().collection('payments');

/**
 * Returns an ObjectId or null for invalid IDs.
 */
export function toObjectId(id) {
  if (typeof id !== 'string' || !/^[a-f\d]{24}$/i.test(id)) {
    return null;
  }

  return new ObjectId(id);
}
