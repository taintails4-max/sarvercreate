const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const { Pool } = require("pg");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 10000;

const requiredEnv = [
  "DATABASE_URL",
  "ADMIN_USER",
  "ADMIN_PASSWORD_HASH",
  "SESSION_SECRET"
];

const missingEnv = requiredEnv.filter(
  (key) => !process.env[key]
);

if (missingEnv.length) {
  console.error(
    "Missing environment variables:",
    missingEnv.join(", ")
  );
  process.exit(1);
}

const databaseUrl = process.env.DATABASE_URL;

const pool = new Pool({
  connectionString: databaseUrl,
  ssl: databaseUrl.includes("localhost")
    ? false
    : { rejectUnauthorized: false }
});

app.set("trust proxy", 1);

app.use(express.json({ limit: "32kb" }));
app.use(express.urlencoded({
  extended: false,
  limit: "32kb"
}));

app.use(session({
  name: "ffx_admin_session",
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 1000 * 60 * 60 * 8
  }
}));

app.use(express.static(path.join(__dirname, "public")));

async function initializeDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS orders (
      id BIGSERIAL PRIMARY KEY,
      player_uid TEXT NOT NULL,
      amount INTEGER NOT NULL CHECK (amount > 0),
      method TEXT NOT NULL
        CHECK (method IN ('bKash', 'Nagad')),
      trxid TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'Pending'
        CHECK (
          status IN ('Pending', 'Approved', 'Rejected')
        ),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS payment_settings (
      id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
      bkash_number TEXT NOT NULL DEFAULT '',
      nagad_number TEXT NOT NULL DEFAULT '',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    INSERT INTO payment_settings
      (id, bkash_number, nagad_number)
    VALUES (1, '', '')
    ON CONFLICT (id) DO NOTHING
  `);
}

function adminOnly(req, res, next) {
  if (req.session?.isAdmin === true) {
    return next();
  }

  return res.status(401).json({
    error: "Admin login required"
  });
}

function cleanString(value, maxLength = 200) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
}

app.get("/", (req, res) => {
  res.sendFile(
    path.join(__dirname, "public", "admin.html")
  );
});

app.get("/api/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true, database: "connected" });
  } catch (error) {
    console.error("Health check failed:", error.message);
    res.status(500).json({ ok: false });
  }
});
