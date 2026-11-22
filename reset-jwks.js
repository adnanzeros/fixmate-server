
import 'dotenv/config';
import { MongoClient } from 'mongodb';

const uri = (process.env.MONGODB_URI || '').trim().replace(/^["']|["']$/g, '');
const client = new MongoClient(uri);

try {
  await client.connect();
  const db = client.db(process.env.MONGODB_DB || 'fixmate');
  const exists = await db.listCollections({ name: 'jwks' }).hasNext();
  if (exists) {
    await db.collection('jwks').drop();
    console.log(
      'jwks collection dropped. A new key is created on the next login.',
    );
  } else {
    console.log('No jwks collection found. Nothing to do.');
  }
} finally {
  await client.close();
}
