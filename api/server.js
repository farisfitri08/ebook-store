const express = require("express");
const Stripe = require("stripe");
require("dotenv").config();

const { Pool } = require("pg");

const pool = new Pool({
    connectionString: process.env.DATABASE_URL
});

const fs = require("fs");

const path = require("path");

const bcrypt = require("bcrypt");

const session = require("express-session");

pool.query("SELECT NOW()")
.then(result => {
    console.log("PostgreSQL connected!");
    console.log(result.rows[0]);
})
.catch(error => {
    console.error("PostgreSQL connection failed:", error);
});

pool.query("SELECT * FROM orders")
.then(result => {
    console.log("Orders from PostgreSQL:");
    console.log(result.rows);
})
.catch(error => {
    console.error(error);
});

const app = express();

const PORT = 3000;

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

const orders = [];

app.use(express.static(path.join(__dirname, "..")));

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "..", "index.html"));
});

app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        secure: false
    }
}));

// HOME
app.get("/", (req, res) => {
    res.send("Server is running!");
});


// STRIPE CHECKOUT
app.post("/create-checkout-session", async (req, res) => {

    try {

        const session = await stripe.checkout.sessions.create({

            mode: "payment",

            line_items: [
                {
                    price: "price_1U2DffERiOmf1NwHOeaFTx4s",
                    quantity: 1
                }
            ],

            success_url: "http://localhost:3000/success?session_id={CHECKOUT_SESSION_ID}",

            cancel_url: "http://localhost:3000/cancel"

        });

        res.json({
            url: session.url
        });

    } catch (error) {

        console.error(error);

        res.status(500).json({
            error: "Something went wrong"
        });

    }

});

app.get("/success", (req, res) => {

    const sessionId = req.query.session_id;

    res.send(`
        <h1>Payment successful! 🎉</h1>

        <p>Thank you for your purchase.</p>

        <a href="/download?session=${sessionId}">
            Download Ebook
        </a>
    `);

});

app.post(
    "/webhook",
    express.raw({ type: "application/json" }),
    async (req, res) => {

        const signature = req.headers["stripe-signature"];

        let event;

        try {

            event = stripe.webhooks.constructEvent(
                req.body,
                signature,
                process.env.STRIPE_WEBHOOK_SECRET
            );

        } catch (error) {

            console.error("Webhook verification failed:", error.message);

            return res.sendStatus(400);
        }

        console.log("Webhook verified!");
        console.log("Event type:", event.type);
        console.log("Event ID:", event.id);


        if (event.type === "checkout.session.completed") {

            const session = event.data.object;

            const order = {
                email: session.customer_details.email,
                sessionId: session.id,
                status: "PAID",
                amount: session.amount_total / 100
            };

            const result = await pool.query(`
                SELECT *
                FROM orders
                WHERE session_id = $1
            `, [order.sessionId]);

            const existingOrder = result.rows[0];

            if (existingOrder) {
                console.log("Order already exists. Skipping duplicate.");
                return res.json({ received: true });
            }

            await pool.query(`
                INSERT INTO orders (email, session_id, status, amount)
                VALUES ($1, $2, $3, $4)
            `, [
                order.email,
                order.sessionId,
                order.status,
                order.amount
            ]);

            console.log("Order saved to database!");
            console.log("Order:", order);

            console.log("Payment completed!");
            console.log("Customer email:", order.email);
            console.log("Session ID:", order.sessionId);
            console.log("Order:", order);
            console.log("Amount:", order.amount);
        }


        res.sendStatus(200);
    }
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get("/download", async (req, res) => {

    const sessionId = req.query.session;

    const result = await pool.query(`
        SELECT *
        FROM orders
        WHERE session_id = $1
    `, [sessionId]);

    const order = result.rows[0];

    if (!order || order.status !== "PAID") {
        return res.status(403).send("Payment required.");
    }

    const filePath = path.join(
        __dirname,
        "..",
        "ebook",
        "ebook.pdf"
    );

    res.sendFile(filePath);

});

app.get("/test-pdf", (req, res) => {

    const filePath = path.join(
        __dirname,
        "..",
        "ebook",
        "ebook.pdf"
    );

    res.sendFile(filePath);

});

app.get("/force-download", (req, res) => {

    const filePath = path.join(
        __dirname,
        "..",
        "ebook",
        "ebook.pdf"
    );

    res.setHeader(
        "Content-Type",
        "application/octet-stream"
    );

    res.setHeader(
        "Content-Disposition",
        'attachment; filename="ebook.pdf"'
    );

    res.sendFile(filePath);

});

app.get("/admin/login", (req, res) => {

    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Admin Login</title>
        </head>

        <body>

            <h1>Admin Login</h1>

            <form method="POST" action="/admin/login">

                <input
                    type="text"
                    name="username"
                    placeholder="Username"
                    required
                >

                <br><br>

                <input
                    type="password"
                    name="password"
                    placeholder="Password"
                    required
                >

                <br><br>

                <button type="submit">
                    Login
                </button>

            </form>

        </body>
        </html>
    `);

});

app.post("/admin/login", async (req, res) => {

    const { username, password } = req.body;

    if (username !== process.env.ADMIN_USERNAME) {
        return res.status(401).send("Invalid username or password.");
    }

    const passwordMatch = await bcrypt.compare(
        password,
        process.env.ADMIN_PASSWORD
    );

    if (!passwordMatch) {
        return res.status(401).send("Invalid username or password.");
    }

    req.session.isAdmin = true;

    res.send("Login successful!");

});

function requireAdmin(req, res, next) {

    if (!req.session.isAdmin) {
        return res.redirect("/admin/login");
    }

    next();
}

app.get("/admin/orders", requireAdmin, async (req, res) => {

    const result = await pool.query(`
        SELECT *
        FROM orders
        ORDER BY created_at DESC
    `);

    const orders = result.rows;

    const totalOrders = orders.length;

    const paidOrders = orders.filter(
        order => order.status === "PAID"
    ).length;

    let rows = "";

    for (const order of orders) {
        rows += `
            <tr>
                <td>${order.id}</td>
                <td>${order.email}</td>
                <td>${order.session_id}</td>
                <td>${order.status}</td>
                <td>$${Number(order.amount).toFixed(2)}</td>
                <td>${order.created_at}</td>
                <td>
                    <a href="/admin/orders/${order.id}">
                        View
                    </a>
                </td>
            </tr>
        `;
    }

    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Orders</title>

            <style>
                body {
                    font-family: Arial, sans-serif;
                    padding: 40px;
                }

                table {
                    width: 100%;
                    border-collapse: collapse;
                }

                th, td {
                    border: 1px solid #ddd;
                    padding: 10px;
                    text-align: left;
                }

                th {
                    background: #f5f5f5;
                }
            </style>

            <a href="/admin/logout">
                Logout
            </a>
        </head>

        <body>

            <h1>Orders</h1>

            <div>
                <h2>Total Orders: ${totalOrders}</h2>
                <h2>Paid Orders: ${paidOrders}</h2>
            </div>

            <table>
                <thead>
                    <tr>
                        <th>ID</th>
                        <th>Email</th>
                        <th>Session ID</th>
                        <th>Status</th>
                        <th>Amount</th>
                        <th>Date</th>
                        <th>Actions</th>
                    </tr>
                </thead>

                <tbody>
                    ${rows}
                </tbody>
            </table>

        </body>
        </html>
    `);
});

app.get("/admin/orders/:id", requireAdmin, async (req, res) => {

    const result = await pool.query(`
        SELECT *
        FROM orders
        WHERE id = $1
    `, [req.params.id]);

    const order = result.rows[0];

    if (!order) {
        return res.status(404).send("Order not found.");
    }

    res.send(`
        <h1>Order #${order.id}</h1>

        <p>Email: ${order.email}</p>

        <p>Status: ${order.status}</p>

        <p>Amount: $${Number(order.amount).toFixed(2)}</p>

        <p>Session ID: ${order.session_id}</p>

        <p>Date: ${order.created_at}</p>

        <br>

        <a href="/admin/orders">
            ← Back to Orders
        </a>
    `);
});

app.get("/admin/logout", (req, res) => {

    req.session.destroy((error) => {

        if (error) {
            return res.status(500).send("Logout failed.");
        }

        res.redirect("/admin/login");

    });

});

// START SERVER
app.listen(PORT, () => {

    console.log(
        `Server running at http://localhost:${PORT}`
    );

});

module.exports = app;