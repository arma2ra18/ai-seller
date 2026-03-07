const functions = require('firebase-functions');
const admin = require('firebase-admin');
const crypto = require('crypto');

admin.initializeApp();
const db = admin.firestore();

const YUKASSA_SHOP_ID = functions.config().yukassa?.shop_id || 'test';
const YUKASSA_SECRET_KEY = functions.config().yukassa?.secret_key || 'test';

const PLAN_TOKENS = {
    'start': 30,
    'business': 200,
    'pro': 999999
};

exports.yukassaWebhook = functions.https.onRequest(async (req, res) => {
    if (req.method !== 'POST') {
        return res.status(405).send('Method Not Allowed');
    }

    try {
        const signature = req.headers['authorization']?.replace('Bearer ', '');
        if (!verifySignature(req.body, signature)) {
            return res.status(401).send('Unauthorized');
        }

        const event = req.body;
        if (event.event !== 'payment.succeeded') {
            return res.status(200).send('Ignored');
        }

        const payment = event.object;
        const { userId, plan } = payment.metadata || {};
        
        if (!userId || !plan) {
            return res.status(400).send('Bad Request');
        }

        const userRef = db.collection('users').doc(userId);
        const tokensToAdd = PLAN_TOKENS[plan] || 30;

        await db.runTransaction(async (transaction) => {
            const userDoc = await transaction.get(userRef);
            const currentData = userDoc.data() || {};
            const newBalance = (currentData.balance || 0) + tokensToAdd;
            
            transaction.update(userRef, {
                balance: newBalance,
                plan: plan,
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });
        });

        await db.collection('payments').add({
            userId: userId,
            plan: plan,
            amount: payment.amount.value,
            paymentId: payment.id,
            status: 'succeeded',
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        });

        return res.status(200).send('OK');
    } catch (error) {
        return res.status(500).send('Internal Server Error');
    }
});

function verifySignature(body, signature) {
    if (!signature) return false;
    try {
        const hmac = crypto.createHmac('sha256', YUKASSA_SECRET_KEY);
        hmac.update(JSON.stringify(body));
        const expected = hmac.digest('hex');
        return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
    } catch {
        return false;
    }
}

exports.createPayment = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Login required');
    }

    const { plan, price } = data;
    if (!plan || !price) {
        throw new functions.https.HttpsError('invalid-argument', 'Plan and price required');
    }

    return {
        id: 'test-' + Date.now(),
        confirmation: { confirmation_url: 'https://yookassa.ru/payment-test' }
    };
});

exports.getAdminStats = functions.https.onCall(async (data, context) => {
    if (!context.auth || !context.auth.token.admin) {
        throw new functions.https.HttpsError('permission-denied', 'Admin only');
    }

    const usersSnapshot = await db.collection('users').get();
    const paymentsSnapshot = await db.collection('payments').get();
    
    let totalRevenue = 0;
    paymentsSnapshot.forEach(doc => totalRevenue += doc.data().amount || 0);

    return {
        users: { total: usersSnapshot.size },
        payments: { revenue: totalRevenue },
        generations: { total: usersSnapshot.size * 5 }
    };
});

exports.addTokensManually = functions.https.onCall(async (data, context) => {
    if (!context.auth || !context.auth.token.admin) {
        throw new functions.https.HttpsError('permission-denied', 'Admin only');
    }

    const { email, amount, reason } = data;
    const userSnapshot = await db.collection('users').where('email', '==', email).limit(1).get();
    
    if (userSnapshot.empty) {
        throw new functions.https.HttpsError('not-found', 'User not found');
    }

    const userDoc = userSnapshot.docs[0];
    await userDoc.ref.update({
        balance: admin.firestore.FieldValue.increment(parseInt(amount))
    });

    await db.collection('adminLogs').add({
        action: 'add_tokens',
        targetUser: email,
        amount: amount,
        reason: reason,
        timestamp: admin.firestore.FieldValue.serverTimestamp()
    });

    return { success: true };
});