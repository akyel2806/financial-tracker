import 'dotenv/config';
import { Hono } from "hono";
import { serve } from '@hono/node-server';
import { setCookie, getCookie } from 'hono/cookie';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { db } from './db/index.js';
import { users, transaction } from './db/schema.js';
import { eq, and, desc, sql } from 'drizzle-orm';
import { serveStatic } from '@hono/node-server/serve-static'

const app = new Hono();
const SECRET = process.env.JWT_SECRET;

// API REGISTER
app.post('/api/register', async (c) => {
    try {
        const { username, password } = await c.req.json();
        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = await db.insert(users)
            .values({ username, password: hashedPassword })
            .returning({ id: users.id, username: users.username });
            return c.json({ success: true, data: newUser[0] }, 201);
    } catch (error) {
        return c.json({ success: false, message: 'Registrasi gagal' }, 400);
    }
});

// API LOGIN
app.post('/api/login', async (c) => {
    const { username, password } = await c.req.json();
    const user = await db.query.users.findFirst({ where: eq(users.username, username) });
    if(!user) return c.json({ success: false, message: 'Username atau password salah' }, 401);

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if(!isPasswordValid) return c.json({ success: false, message: 'Username atau password salah' }, 401);

    const token = jwt.sign({ id: user.id, username: user.username }, SECRET, { expiresIn: '1d' });
    setCookie(c, 'token', token, { httpOnly: true, sameSite: 'Lax', maxAge: 86400 });

    return c.json({ success: true, message: 'Login berhasil' });
});

// API LOGOUT
app.post('/api/logout', (c) => {
    setCookie(c, 'token', '', { maxAge: -1 });
    return c.json({ success: true, message: 'Logout berhasil' });
});

// MIDDLEWARE & API ME
app.get('/api/me', (c) => {
    const token = getCookie(c, 'token');
    if(!token) return c.json({ success: false, message: 'Unauthorized' }, 401);
    try {
        const user = jwt.verify(token, SECRET);
        return c.json({ success: true, data: user });
    } catch (error) {
        return c.json({ success: false, message: 'Token tidak valid' }, 401);
    }
});


const authMiddleware = async (c, next) => {
    const token = getCookie(c, 'token');
    if (!token) return c.json({ success: false, message: 'Unauthorized' }, 401);
    try {
        const user = jwt.verify(token, SECRET);
        c.set('user', user);
        await next();
    } catch (error) {
        return c.json({ success: false, message: 'Token tidak valid' }, 401);
    }
};

app.post('/api/transaction', authMiddleware, async (c) => {
    try {
        const user = c.get('user');
        const { nominal, transactionDate, status, description } = await c.req.json();
        const newTransaction = await db.insert(transaction)
        .values({
            userId: user.id,
            nominal: nominal.toString(),
            transactionDate: transactionDate,
            status: status,
            description: description
        })
        .returning();
        return c.json({ success: true, data: newTransaction[0] }, 201);
    } catch (error) {
        console.error("error", error);
        return c.json({ success: false, message: 'Gagal menambah transaksi' }, 400);
    }
});

app.get('/api/transaction', authMiddleware, async (c) => {
    try {
        const user = c.get('user');
        const { year, month } = c.req.query();
        
        if (!year || !month) {
            return c.json({ success: false, message: 'Tahun dan bulan wajib diisi' }, 400);
        }

        const monthNum = parseInt(month);
        if (isNaN(monthNum) || monthNum < 1 || monthNum > 12) {
            return c.json({ success: false, message: 'Format bulan tidak valid' }, 400);
        }

        const yearNum = parseInt(year);
        if (isNaN(yearNum) || yearNum < 1900 || yearNum > 2100) {
            return c.json({ success: false, message: 'Format tahun tidak valid' }, 400);
        }

        const formattedMonth = month.padStart(2, '0');
        const startOfMonth = `${year}-${formattedMonth}-01 00:00:00`;
        
        const nextMonth = monthNum === 12 ? 1 : monthNum + 1;
        const nextYear = monthNum === 12 ? yearNum + 1 : yearNum;
        const formattedNextMonth = String(nextMonth).padStart(2, '0');
        const endOfMonth = `${nextYear}-${formattedNextMonth}-01 00:00:00`;

        const userTransaction = await db.query.transaction.findMany({
            where: (t, { eq, and, gte, lt }) => and(
                eq(t.userId, user.id),
                gte(t.transactionDate, startOfMonth),
                lt(t.transactionDate, endOfMonth)
            ),
            orderBy: (transaction, { desc }) => [desc(transaction.transactionDate)],
        });

        const totalIncome = userTransaction
            .filter(t => t.status === 'income' && t.nominal != null)
            .reduce((sum, t) => sum + parseFloat(t.nominal), 0);
        
        const totalOutcome = userTransaction
            .filter(t => t.status === 'outcome' && t.nominal != null)
            .reduce((sum, t) => sum + parseFloat(t.nominal), 0);
        
        const balance = totalIncome - totalOutcome;

        return c.json({ 
            success: true, 
            data: userTransaction, 
            summary: { 
                totalIncome: parseFloat(totalIncome.toFixed(2)), 
                totalOutcome: parseFloat(totalOutcome.toFixed(2)), 
                balance: parseFloat(balance.toFixed(2))
            } 
        });
    } catch (error) {
        console.error("Error fetching transactions:", error);
        return c.json({ success: false, message: 'Gagal mengambil transaksi' }, 500);
    }
});

app.use('/*', serveStatic({ root: './public' }))

if (process.env.VERCEL) {
    globalThis.app = app;
} else {
    const port = 3000;
    console.log(`🚀 Server is running on http://localhost:${port}`);
    serve({ fetch: app.fetch, port });
}