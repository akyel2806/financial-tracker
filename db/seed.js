import "dotenv/config";
import { db } from "./index.js";
import bcrypt from 'bcryptjs';
import { transaction, users } from "./schema.js";

async function seed() {
    console.log('Seeding database...');
    await db.delete(transaction);
    await db.delete(users);

    const HashedPassword = await bcrypt.hash('password123', 10);

    const user1 = await db.insert(users).values({
        username: 'tester',
        password: HashedPassword,
    })
    .returning();

    await db.insert(transaction).values([
    { nominal: 5000000.00, transactionDate: '2025-10-01', status: 'income', description: 'Gaji Bulanan', userId: user1[0].id },
    { nominal: 500000.00, transactionDate: '2025-10-05', status: 'outcome', description: 'Bayar Listrik', userId: user1[0].id },
  ]);

  console.log('✅ Seeding completed!');
  process.exit(0);
}

seed().catch((err) => {
    console.error('❌ Seeding failed:', err);
    process.exit(1);
});