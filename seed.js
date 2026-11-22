// server/seed.js
// Run once from YOUR computer:  npm run seed
//
// It talks straight to MongoDB (the same Atlas database the deployed client and server use),
// so the Next.js client does NOT have to be running and nothing needs to be deployed first.
// Accounts are created with BetterAuth's own sign-up code, so passwords are hashed exactly
// the way BetterAuth expects. Safe to run again: it resets the seed passwords, makes sure the
// admin has the admin role, and never duplicates services or bookings.
import 'dotenv/config';
import { betterAuth } from 'better-auth';
import { mongodbAdapter } from 'better-auth/adapters/mongodb';
import {
  connectDB,
  getClient,
  users,
  services,
  bookings,
  payments,
} from './config/db.js';

// BetterAuth needs 6+ characters with an uppercase and a lowercase letter
const strong = /^(?=.*[a-z])(?=.*[A-Z]).{6,}$/;
const PASSWORD = strong.test(process.env.SEED_PASSWORD || '')
  ? process.env.SEED_PASSWORD
  : 'FixMate123';

const ACCOUNTS = [
  {
    name: 'FixMate Admin',
    email: 'admin@fixmate.com',
    role: 'admin',
  },
  {
    name: 'Rafiqul Islam',
    email: 'rafiq@fixmate.com',
    role: 'technician',
    phone: '+8801711000001',
    area: 'Mirpur, Dhaka',
    bio: 'Phone and laptop repair specialist with 8 years of experience. Genuine parts, honest pricing.',
  },
  {
    name: 'Shumi Akter',
    email: 'shumi@fixmate.com',
    role: 'technician',
    phone: '+8801711000002',
    area: 'Dhanmondi, Dhaka',
    bio: 'Home appliance technician for AC, refrigerator and washing machine repair. Certified electrician.',
  },
  {
    name: 'Nusrat Jahan',
    email: 'nusrat@fixmate.com',
    role: 'customer',
    phone: '+8801811000001',
    area: 'Uttara, Dhaka',
  },
  {
    name: 'Tanvir Ahmed',
    email: 'tanvir@fixmate.com',
    role: 'customer',
    phone: '+8801811000002',
    area: 'Banani, Dhaka',
  },
];

const RAFIQ = 'rafiq@fixmate.com';
const SHUMI = 'shumi@fixmate.com';

// image: placeholder photos. Replace with your own ImgBB images when you have them.
const SERVICES = [
  [
    'iPhone Screen Replacement',
    'Smartphone',
    'Genuine-quality display replacement for iPhone 11 to 15 with 3 months warranty. Done while you wait.',
    80,
    '2-3 hours',
    'Shop Drop-off',
    'Mirpur, Dhaka',
    RAFIQ,
  ],
  [
    'Android Battery Replacement',
    'Smartphone',
    'Replace a weak or swollen battery on Samsung, Xiaomi and Oppo phones. Includes a battery health check.',
    35,
    '1-2 hours',
    'Shop Drop-off',
    'Mirpur, Dhaka',
    RAFIQ,
  ],
  [
    'Phone Charging Port Repair',
    'Smartphone',
    'Fix loose or dead charging ports for all major phone brands, with a free cleaning and diagnosis.',
    25,
    '1 hour',
    'Home Visit',
    'Mirpur, Dhaka',
    RAFIQ,
  ],
  [
    'Laptop Servicing and Cleaning',
    'Laptop & PC',
    'Full internal cleaning, thermal paste replacement and fan check to stop overheating and noise.',
    40,
    '2-3 hours',
    'Home Visit',
    'Mirpur, Dhaka',
    RAFIQ,
  ],
  [
    'Laptop SSD Upgrade and OS Install',
    'Laptop & PC',
    'Upgrade to a fast SSD, clone your data and install a fresh operating system with drivers.',
    55,
    '3-4 hours',
    'Shop Drop-off',
    'Pallabi, Dhaka',
    RAFIQ,
  ],
  [
    'Desktop PC Troubleshooting',
    'Laptop & PC',
    'Diagnose boot problems, blue screens and slow performance, with hardware or software fixes.',
    30,
    '2 hours',
    'Home Visit',
    'Mirpur, Dhaka',
    RAFIQ,
  ],
  [
    'AC Servicing and Gas Refill',
    'AC',
    'Indoor and outdoor unit cleaning, filter wash and gas pressure check for split and window ACs.',
    45,
    '2 hours',
    'Home Visit',
    'Dhanmondi, Dhaka',
    SHUMI,
  ],
  [
    'AC Installation and Relocation',
    'AC',
    'Safe installation of split ACs with copper piping, stand fitting and a full cooling test.',
    90,
    '4-5 hours',
    'Home Visit',
    'Dhanmondi, Dhaka',
    SHUMI,
  ],
  [
    'Refrigerator Cooling Repair',
    'Refrigerator',
    'Fix weak cooling, ice build-up and strange noises. Compressor and thermostat checks included.',
    50,
    '3 hours',
    'Home Visit',
    'Dhanmondi, Dhaka',
    SHUMI,
  ],
  [
    'LED TV Panel and Board Repair',
    'TV',
    'Repair backlight, power board and mainboard faults on LED and smart TVs.',
    70,
    '1 day',
    'Shop Drop-off',
    'Dhanmondi, Dhaka',
    SHUMI,
  ],
  [
    'Washing Machine Drain and Motor Fix',
    'Washing Machine',
    'Fix drain blockage, drum noise and motor issues on front and top load machines.',
    45,
    '2-3 hours',
    'Home Visit',
    'Dhanmondi, Dhaka',
    SHUMI,
  ],
  [
    'House Electrical Wiring Check',
    'Electrical',
    'Safety inspection of house wiring, switches and fuse box with repairs for any faults found.',
    35,
    '2 hours',
    'Home Visit',
    'Mohammadpur, Dhaka',
    SHUMI,
  ],
  [
    'Ceiling Fan and Light Fitting',
    'Electrical',
    'Installation and repair of ceiling fans, lights and regulators by a certified electrician.',
    20,
    '1 hour',
    'Home Visit',
    'Mohammadpur, Dhaka',
    SHUMI,
  ],
];

/** Creates the account (or resets its password + profile if it already exists). */
async function upsertAccount(auth, account) {
  const ctx = await auth.$context;
  const hash = await ctx.password.hash(PASSWORD);
  const profile = { role: account.role };
  for (const key of ['phone', 'area', 'bio'])
    if (account[key]) profile[key] = account[key];

  const found = await ctx.internalAdapter.findUserByEmail(account.email, {
    includeAccounts: true,
  });

  if (!found) {
    await auth.api.signUpEmail({
      body: {
        name: account.name,
        email: account.email,
        password: PASSWORD,
        ...profile,
      },
    });
    console.log(`created  ${account.email} (${account.role})`);
    return;
  }

  const credential = found.accounts?.find(a => a.providerId === 'credential');
  if (credential) await ctx.internalAdapter.updatePassword(found.user.id, hash);
  else
    await ctx.internalAdapter.linkAccount({
      userId: found.user.id,
      providerId: 'credential',
      accountId: found.user.id,
      password: hash,
    });
  await ctx.internalAdapter.updateUser(found.user.id, {
    name: account.name,
    ...profile,
  });
  console.log(`updated  ${account.email} (${account.role}, password reset)`);
}

const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-');
const daysAgo = n => new Date(Date.now() - n * 86400000);

async function main() {
  await connectDB();

  // 1. accounts (a small BetterAuth instance on the same database, no HTTP, no rate limit)
  const auth = betterAuth({
    database: mongodbAdapter(
      getClient().db(process.env.MONGODB_DB || 'fixmate'),
      {
        client: getClient(),
      },
    ),
    secret:
      process.env.BETTER_AUTH_SECRET || 'fixmate-seed-only-secret-0000000000',
    baseURL: process.env.BETTER_AUTH_URL || 'http://localhost:3000',
    emailAndPassword: {
      enabled: true,
      autoSignIn: false,
      minPasswordLength: 6,
    },
    user: {
      additionalFields: {
        role: {
          type: 'string',
          required: false,
          defaultValue: 'customer',
          input: true,
        },
        phone: { type: 'string', required: false, input: true },
        area: { type: 'string', required: false, input: true },
        bio: { type: 'string', required: false, input: true },
      },
    },
  });
  for (const a of ACCOUNTS) await upsertAccount(auth, a);

  // 2. services (approved, available)
  const techs = Object.fromEntries(
    (
      await users()
        .find({ email: { $in: [RAFIQ, SHUMI] } })
        .toArray()
    ).map(u => [u.email, u.name]),
  );
  for (const [i, s] of SERVICES.entries()) {
    const [
      title,
      category,
      description,
      basePrice,
      estimatedDuration,
      serviceMode,
      serviceArea,
      email,
    ] = s;
    await services().updateOne(
      { title, technicianEmail: email },
      {
        $setOnInsert: { createdAt: daysAgo(SERVICES.length - i) },
        $set: {
          title,
          category,
          description,
          basePrice,
          estimatedDuration,
          serviceMode,
          serviceArea,
          image: `https://picsum.photos/seed/${slug(title)}/800/600`,
          technicianName: techs[email] || 'Technician',
          technicianEmail: email,
          approvalStatus: 'approved',
          isAvailable: true,
        },
      },
      { upsert: true },
    );
  }
  console.log(`services ready (${SERVICES.length})`);

  // 3. bookings in different statuses + one payment (only when there are none yet)
  if ((await bookings().countDocuments()) === 0) {
    const all = await services().find({}).toArray();
    const find = title => all.find(s => s.title === title);
    const customers = await users()
      .find({ email: { $in: ['nusrat@fixmate.com', 'tanvir@fixmate.com'] } })
      .toArray();
    const who = email => customers.find(c => c.email === email);

    const plan = [
      [
        'iPhone Screen Replacement',
        'nusrat@fixmate.com',
        'requested',
        1,
        'My screen is cracked and the touch is not working in one corner since yesterday.',
      ],
      [
        'AC Servicing and Gas Refill',
        'nusrat@fixmate.com',
        'accepted',
        3,
        'The AC is not cooling properly and makes a rattling sound after about ten minutes.',
      ],
      [
        'Laptop Servicing and Cleaning',
        'tanvir@fixmate.com',
        'in-progress',
        4,
        'The laptop gets very hot and the fan is loud even when I only browse the internet.',
      ],
      [
        'Refrigerator Cooling Repair',
        'tanvir@fixmate.com',
        'completed',
        6,
        'Fridge is not cooling and there is a lot of ice at the back of the freezer.',
      ],
      [
        'Washing Machine Drain and Motor Fix',
        'nusrat@fixmate.com',
        'completed',
        9,
        'Water is not draining after the wash cycle and the drum makes a grinding noise.',
      ],
      [
        'Android Battery Replacement',
        'tanvir@fixmate.com',
        'rejected',
        7,
        'Battery drains within two hours and the phone back panel is slightly swollen.',
      ],
      [
        'LED TV Panel and Board Repair',
        'nusrat@fixmate.com',
        'cancelled',
        8,
        'TV shows a vertical line on the screen and sometimes turns off by itself.',
      ],
    ];

    const paidIds = [];
    for (const [title, email, status, ago, problem] of plan) {
      const service = find(title);
      const customer = who(email);
      if (!service || !customer) continue;
      const created = daysAgo(ago);
      const doc = {
        serviceId: String(service._id),
        serviceTitle: service.title,
        serviceImage: service.image,
        category: service.category,
        basePrice: service.basePrice,
        technicianName: service.technicianName,
        technicianEmail: service.technicianEmail,
        customerName: customer.name,
        customerEmail: customer.email,
        customerPhone: customer.phone || '+8801800000000',
        address: `House 10, Road 4, ${customer.area || 'Dhaka'}`,
        preferredDate: new Date(Date.now() + 2 * 86400000),
        problemDescription: problem,
        status,
        finalAmount:
          status === 'completed' ? service.basePrice + 5 : service.basePrice,
        paymentStatus: 'unpaid',
        statusHistory: [
          { status: 'requested', changedAt: created },
          ...(status !== 'requested'
            ? [{ status, changedAt: new Date(created.getTime() + 3600000) }]
            : []),
        ],
        createdAt: created,
      };
      const r = await bookings().insertOne(doc);
      if (title === 'Washing Machine Drain and Motor Fix')
        paidIds.push({ id: r.insertedId, doc });
    }

    // the washing machine job is already paid, so the examiner can see a payment record
    for (const { id, doc } of paidIds) {
      await bookings().updateOne(
        { _id: id },
        { $set: { paymentStatus: 'paid' } },
      );
      await payments().insertOne({
        bookingId: String(id),
        serviceTitle: doc.serviceTitle,
        customerName: doc.customerName,
        customerEmail: doc.customerEmail,
        technicianName: doc.technicianName,
        technicianEmail: doc.technicianEmail,
        amount: doc.finalAmount,
        currency: 'usd',
        transactionId: 'pi_seed_0001',
        stripeSessionId: 'cs_test_seed_0001',
        paymentStatus: 'paid',
        paidAt: daysAgo(8),
      });
    }
    console.log('bookings and payment ready');
  } else {
    console.log('bookings already exist, skipped');
  }

  console.log(`\nDone. Test accounts (password: ${PASSWORD})`);
  console.log('  admin       admin@fixmate.com');
  console.log('  technician  rafiq@fixmate.com / shumi@fixmate.com');
  console.log('  customer    nusrat@fixmate.com / tanvir@fixmate.com');
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
