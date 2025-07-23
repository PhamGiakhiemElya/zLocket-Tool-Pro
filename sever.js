   const express = require('express');
   const { Pool } = require('pg');
   const path = require('path');
   const { exec } = require('child_process');
   const util = require('util');
   const axios = require('axios');
   const app = express();
   const execPromise = util.promisify(exec);

   const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "7632283705:AAH4b_yX6xgK1SZX6uXo7yXDZDEh1VGSRJ0";
   const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || -4664606881;
   const LINK4M_API = "https://link4m.co/api-shorten/v2?api=67907af83011c359a503bfb8&url=";

   // Initialize PostgreSQL connection
   const pool = new Pool({
       connectionString: process.env.PG_CONNECTION_STRING || "postgres://localhost:5432/buff_view_spam_sms_db",
       ssl: process.env.PG_CONNECTION_STRING ? { rejectUnauthorized: false } : false
   });

   // Test database connection
   pool.connect((err, client, release) => {
       if (err) {
           console.error('Lỗi kết nối PostgreSQL:', err.message);
           return;
       }
       console.log('Kết nối PostgreSQL thành công');
       release();
   });

   app.use(express.json());
   app.use(express.static(path.join(__dirname)));

   const ipCooldowns = new Map();
   const linkCooldowns = new Map();
   const phoneCooldowns = new Map();

   app.post('/api/saveKey', async (req, res) => {
       const { ip, key } = req.body;
       try {
           await pool.query('INSERT INTO keys (ip, key) VALUES ($1, $2)', [ip, key]);
           res.json({ success: true });
       } catch (error) {
           console.error('Error saving key:', error);
           res.status(500).json({ error: 'Lỗi khi lưu key' });
       }
   });

   app.post('/api/verifyKey', async (req, res) => {
       const { ip, key } = req.body;
       try {
           const result = await pool.query('SELECT * FROM keys WHERE ip = $1 AND key = $2', [ip, key]);
           if (result.rows.length === 0) {
               return res.json({ valid: false });
           }
           await pool.query('DELETE FROM keys WHERE ip = $1 AND key = $2', [ip, key]);
           const expiry = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
           await pool.query('INSERT INTO keys_valid (ip, key, expiry) VALUES ($1, $2, $3)', [ip, key, expiry]);
           res.json({ valid: true, expiry });
       } catch (error) {
           console.error('Error verifying key:', error);
           res.status(500).json({ error: 'Lỗi khi kiểm tra key' });
       }
   });

   app.post('/api/checkIP', async (req, res) => {
       const { ip } = req.body;
       try {
           const result = await pool.query('SELECT * FROM keys_valid WHERE ip = $1 AND expiry > NOW()', [ip]);
           if (result.rows.length > 0) {
               return res.json({ hasValidKey: true });
           }
           res.json({ hasValidKey: false });
       } catch (error) {
           console.error('Error checking IP:', error);
           res.status(500).json({ error: 'Lỗi khi kiểm tra IP' });
       }
   });

   app.post('/api/checkCooldown', async (req, res) => {
       const { ip, link } = req.body;
       const now = Date.now();
       const ipLastUsed = ipCooldowns.get(ip) || 0;
       const linkLastUsed = linkCooldowns.get(link) || 0;
       if (now - ipLastUsed < 30 * 1000) {
           return res.json({ canBuff: false, waitTime: Math.ceil((30 * 1000 - (now - ipLastUsed)) / 1000) });
       }
       if (now - linkLastUsed < 60 * 1000) {
           return res.json({ canBuff: false, waitTime: Math.ceil((60 * 1000 - (now - linkLastUsed)) / 1000) });
       }
       ipCooldowns.set(ip, now);
       linkCooldowns.set(link, now);
       res.json({ canBuff: true });
   });

   app.post('/api/checkSMSCooldown', async (req, res) => {
       const { ip, phone } = req.body;
       const now = Date.now();
       const ipLastUsed = ipCooldowns.get(ip) || 0;
       const phoneLastUsed = phoneCooldowns.get(phone) || 0;
       if (now - ipLastUsed < 5 * 60 * 1000) {
           return res.json({ canSpam: false, waitTime: Math.ceil((5 * 60 * 1000 - (now - ipLastUsed)) / 1000) });
       }
       if (now - phoneLastUsed < 10 * 60 * 1000) {
           return res.json({ canSpam: false, waitTime: Math.ceil((10 * 60 * 1000 - (now - phoneLastUsed)) / 1000) });
       }
       ipCooldowns.set(ip, now);
       phoneCooldowns.set(phone, now);
       res.json({ canSpam: true });
   });

   app.post('/api/spamSMS', async (req, res) => {
       const { phone, count } = req.body;
       try {
           const { stdout, stderr } = await execPromise(`python3 sms.py ${phone} ${count}`);
           if (stderr) throw new Error(stderr);
           res.json({ success: true });
       } catch (error) {
           console.error('Error executing SMS spam:', error);
           res.status(500).json({ error: 'Lỗi khi chạy SMS spam' });
       }
   });

   async function sendTelegramMessage(message) {
       try {
           await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
               chat_id: TELEGRAM_CHAT_ID,
               text: message,
               parse_mode: 'HTML'
           });
       } catch (error) {
           console.error('Lỗi gửi thông báo Telegram:', error);
       }
   }

   async function cleanExpiredKeys() {
       try {
           await pool.query('DELETE FROM keys_valid WHERE expiry <= NOW()');
           console.log('Xóa key hết hạn thành công');
       } catch (error) {
           console.error('Lỗi xóa key hết hạn:', error.message);
       }
       setTimeout(cleanExpiredKeys, 3600 * 1000); // Chạy mỗi giờ
   }
   cleanExpiredKeys();

   const PORT = process.env.PORT || 10000;
   app.listen(PORT, () => console.log(`Server chạy trên cổng ${PORT}`));
