const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const { promisePool, testConnection } = require('./db');
const multer = require('multer');
const fs = require('fs');
const nodemailer = require('nodemailer');
const crypto = require('crypto'); // Встроенный модуль Node.js для генерации кодов
require('dotenv').config();

const app = express();
const PORT = 3000;



// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Настройка статических файлов
const publicPath = path.join(__dirname, 'public');
app.use(express.static(publicPath));

// Настройка для загрузки файлов
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const uploadDir = path.join(__dirname, 'public/uploads');
        // Создаем папку, если её нет
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        // Создаем уникальное имя файла
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname);
        cb(null, 'product-' + uniqueSuffix + ext);
    }
});

const upload = multer({ 
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // Ограничение 5MB
    fileFilter: (req, file, cb) => {
        // Разрешаем только изображения
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Только изображения разрешены!'));
        }
    }
});

// Проверяем подключение к БД при старте
testConnection().then(connected => {
    if (!connected) {
        console.log('⚠️ Сервер запущен, но БД не подключена!');
    }
});

// API Routes

// Маршрут для healthcheck (Railway)
app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

// Получить все товары
app.get('/api/products', async (req, res) => {
    try {
        const [rows] = await promisePool.query(`
            SELECT 
                p.*,
                c.name as category_name,
                c.slug as category_slug,
                u.username as seller_name
            FROM products p
            JOIN categories c ON p.category_id = c.id
            JOIN users u ON p.user_id = u.id
            WHERE p.status = 'active'
            ORDER BY p.created_at DESC
        `);
        res.json(rows);
    } catch (error) {
        console.error('Ошибка при получении товаров:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Получить товары по категории
app.get('/api/products/category/:slug', async (req, res) => {
    try {
        const [rows] = await promisePool.query(`
            SELECT 
                p.*,
                c.name as category_name,
                u.username as seller_name
            FROM products p
            JOIN categories c ON p.category_id = c.id
            JOIN users u ON p.user_id = u.id
            WHERE c.slug = ? AND p.status = 'active'
        `, [req.params.slug]);
        res.json(rows);
    } catch (error) {
        console.error('Ошибка при получении товаров по категории:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Получить категории
app.get('/api/categories', async (req, res) => {
    try {
        const [rows] = await promisePool.query('SELECT * FROM categories ORDER BY name');
        res.json(rows);
    } catch (error) {
        console.error('Ошибка при получении категорий:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Получение данных пользователя по ID
app.get('/api/users/:id', async (req, res) => {
    const userId = req.params.id;
    
    try {
        const [rows] = await promisePool.query(
            'SELECT id, username, email, phone, bio, avatar_url, role, created_at FROM users WHERE id = ?',
            [userId]
        );
        
        if (rows.length > 0) {
            res.json(rows[0]);
        } else {
            res.status(404).json({ error: 'Пользователь не найден' });
        }
    } catch (error) {
        console.error('Ошибка при получении пользователя:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

/// ===== ЧАТ ПОДДЕРЖКИ =====

// Получить список пользователей для чата (админ)
app.get('/api/chat/users', async (req, res) => {
    try {
        const [rows] = await promisePool.query(`
            SELECT DISTINCT u.id, u.username, u.avatar_url 
            FROM users u
            INNER JOIN chat_messages cm ON u.id = cm.user_id
            ORDER BY u.username
        `);
        res.json(rows);
    } catch (error) {
        console.error('Ошибка при получении пользователей чата:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Получить все сообщения (для админа)
app.get('/api/chat/messages', async (req, res) => {
    try {
        const [rows] = await promisePool.query(`
            SELECT cm.*, u.username, u.avatar_url 
            FROM chat_messages cm
            JOIN users u ON cm.user_id = u.id
            ORDER BY cm.created_at DESC
        `);
        res.json(rows);
    } catch (error) {
        console.error('Ошибка при получении сообщений:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Получить сообщения для конкретного пользователя
app.get('/api/chat/messages/:userId', async (req, res) => {
    const userId = req.params.userId;
    
    try {
        const [rows] = await promisePool.query(`
            SELECT * FROM chat_messages 
            WHERE user_id = ?
            ORDER BY created_at ASC
        `, [userId]);
        
        res.json(rows);
    } catch (error) {
        console.error('Ошибка при получении сообщений пользователя:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Отправить сообщение
app.post('/api/chat/send', async (req, res) => {
    const { user_id, message, is_admin } = req.body;
    
    if (!user_id || !message) {
        return res.status(400).json({ error: 'Не все данные заполнены' });
    }
    
    try {
        const [result] = await promisePool.query(
            `INSERT INTO chat_messages (user_id, message, is_admin, is_read) 
             VALUES (?, ?, ?, ?)`,
            [user_id, message, is_admin || false, is_admin ? true : false]
        );
        
        res.json({ 
            success: true, 
            messageId: result.insertId,
            message: 'Сообщение отправлено'
        });
    } catch (error) {
        console.error('Ошибка при отправке сообщения:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Отметить сообщения как прочитанные
app.post('/api/chat/read/:userId', async (req, res) => {
    const userId = req.params.userId;
    const { admin_id } = req.body;
    
    try {
        if (admin_id) {
            await promisePool.query(
                `UPDATE chat_messages SET is_read = TRUE 
                 WHERE user_id = ? AND is_admin = FALSE AND is_read = FALSE`,
                [userId]
            );
        } else {
            await promisePool.query(
                `UPDATE chat_messages SET is_read = TRUE 
                 WHERE user_id = ? AND is_read = FALSE`,
                [userId]
            );
        }
        
        res.json({ success: true });
    } catch (error) {
        console.error('Ошибка при отметке прочитанных:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Получить количество непрочитанных сообщений
app.get('/api/chat/unread/:userId', async (req, res) => {
    const userId = req.params.userId;
    
    try {
        const [rows] = await promisePool.query(
            `SELECT COUNT(*) as unread FROM chat_messages 
             WHERE user_id = ? AND is_read = FALSE AND is_admin = FALSE`,
            [userId]
        );
        
        res.json({ unread: rows[0].unread });
    } catch (error) {
        console.error('Ошибка при получении непрочитанных:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// ===== НАСТРОЙКИ ПОЛЬЗОВАТЕЛЯ =====

// Получить настройки пользователя
app.get('/api/user/settings/:userId', async (req, res) => {
    const userId = req.params.userId;
    
    try {
        const [rows] = await promisePool.query(
            'SELECT settings FROM users WHERE id = ?',
            [userId]
        );
        
        if (rows.length > 0) {
            const settings = rows[0].settings ? JSON.parse(rows[0].settings) : {};
            res.json(settings);
        } else {
            res.json({});
        }
    } catch (error) {
        console.error('Ошибка при получении настроек:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Сохранить настройки пользователя
app.post('/api/user/settings', async (req, res) => {
    const { user_id, ...settings } = req.body;
    
    try {
        await promisePool.query(
            'UPDATE users SET settings = ? WHERE id = ?',
            [JSON.stringify(settings), user_id]
        );
        
        res.json({ success: true, message: 'Настройки сохранены' });
    } catch (error) {
        console.error('Ошибка при сохранении настроек:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// ===== ПРОМОКОДЫ =====

// Получить список всех промокодов (только для админа)
app.get('/api/promo/list', async (req, res) => {
    try {
        const [rows] = await promisePool.query(
            'SELECT * FROM promo_codes ORDER BY created_at DESC'
        );
        res.json(rows);
    } catch (error) {
        console.error('Ошибка при получении промокодов:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Проверить промокод
app.get('/api/promo/check', async (req, res) => {
    const { code, amount } = req.query;
    
    try {
        const [rows] = await promisePool.query(
            'SELECT * FROM promo_codes WHERE code = ? AND is_active = TRUE',
            [code]
        );
        
        if (rows.length === 0) {
            return res.json({ valid: false, message: 'Промокод не найден' });
        }
        
        const promo = rows[0];
        
        // Проверка даты
        const now = new Date();
        if (promo.start_date && new Date(promo.start_date) > now) {
            return res.json({ valid: false, message: 'Промокод еще не активен' });
        }
        if (promo.end_date && new Date(promo.end_date) < now) {
            return res.json({ valid: false, message: 'Срок действия промокода истек' });
        }
        
        // Проверка лимита использований
        if (promo.usage_limit && promo.used_count >= promo.usage_limit) {
            return res.json({ valid: false, message: 'Лимит использований исчерпан' });
        }
        
        // Проверка минимальной суммы заказа
        const orderAmount = parseFloat(amount);
        if (promo.min_order_amount && orderAmount < promo.min_order_amount) {
            return res.json({ 
                valid: false, 
                message: `Минимальная сумма заказа ${promo.min_order_amount} ₽` 
            });
        }
        
        // Расчет скидки
        let discount = 0;
        if (promo.discount_type === 'percentage') {
            discount = (orderAmount * promo.discount_value) / 100;
            if (promo.max_discount_amount && discount > promo.max_discount_amount) {
                discount = promo.max_discount_amount;
            }
        } else {
            discount = promo.discount_value;
        }
        
        res.json({
            valid: true,
            code: promo.code,
            discount: discount,
            discount_type: promo.discount_type,
            discount_value: promo.discount_value
        });
        
    } catch (error) {
        console.error('Ошибка проверки промокода:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Создать новый промокод (только для админа)
app.post('/api/promo', async (req, res) => {
    const { code, type, value, min_order, max_discount, usage_limit, start_date, end_date, description, created_by } = req.body;
    
    try {
        // Проверяем, существует ли уже такой код
        const [existing] = await promisePool.query(
            'SELECT id FROM promo_codes WHERE code = ?',
            [code]
        );
        
        if (existing.length > 0) {
            return res.status(400).json({ error: 'Промокод с таким кодом уже существует' });
        }
        
        const [result] = await promisePool.query(
            `INSERT INTO promo_codes 
             (code, discount_type, discount_value, min_order_amount, max_discount_amount, 
              usage_limit, start_date, end_date, description, created_by) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [code, type, value, min_order, max_discount, usage_limit, start_date, end_date, description, created_by]
        );
        
        res.json({ 
            success: true, 
            message: 'Промокод создан',
            id: result.insertId 
        });
        
    } catch (error) {
        console.error('Ошибка создания промокода:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Изменить статус промокода (только для админа)
app.post('/api/promo/:id/toggle', async (req, res) => {
    const promoId = req.params.id;
    const { user_id } = req.body;
    
    try {
        // Проверяем, что пользователь админ
        const [user] = await promisePool.query('SELECT role FROM users WHERE id = ?', [user_id]);
        if (user.length === 0 || user[0].role !== 'admin') {
            return res.status(403).json({ error: 'Доступ запрещен' });
        }
        
        const [promo] = await promisePool.query(
            'SELECT is_active FROM promo_codes WHERE id = ?',
            [promoId]
        );
        
        if (promo.length === 0) {
            return res.status(404).json({ error: 'Промокод не найден' });
        }
        
        await promisePool.query(
            'UPDATE promo_codes SET is_active = ? WHERE id = ?',
            [!promo[0].is_active, promoId]
        );
        
        res.json({ success: true, message: 'Статус обновлен' });
        
    } catch (error) {
        console.error('Ошибка изменения статуса:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Удалить промокод (только для админа)
app.delete('/api/promo/:id', async (req, res) => {
    const promoId = req.params.id;
    const user_id = req.query.user_id;
    
    try {
        // Проверяем, что пользователь админ
        const [user] = await promisePool.query('SELECT role FROM users WHERE id = ?', [user_id]);
        if (user.length === 0 || user[0].role !== 'admin') {
            return res.status(403).json({ error: 'Доступ запрещен' });
        }
        
        await promisePool.query('DELETE FROM promo_codes WHERE id = ?', [promoId]);
        
        res.json({ success: true, message: 'Промокод удален' });
        
    } catch (error) {
        console.error('Ошибка удаления промокода:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// ===== ЗАКАЗЫ =====

// Создать новый заказ
app.post('/api/orders', async (req, res) => {
    const { 
        user_id, items, subtotal, discount, total, 
        payment_method, delivery_method, delivery_address, 
        delivery_date, delivery_time, comment, promo_code 
    } = req.body;
    
    // Генерируем номер заказа
    const orderNumber = 'ORD-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
    
    try {
        // Начинаем транзакцию
        await promisePool.query('START TRANSACTION');
        
        // Создаем заказ
        const [orderResult] = await promisePool.query(
            `INSERT INTO orders 
             (user_id, order_number, total_amount, discount_amount, final_amount, 
              payment_method, delivery_method, delivery_address, delivery_date, 
              delivery_time, status, promo_code) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
            [user_id, orderNumber, subtotal, discount, total, 
             payment_method, delivery_method, delivery_address, delivery_date, 
             delivery_time, promo_code]
        );
        
        const orderId = orderResult.insertId;
        
        // Добавляем товары в заказ
        for (const item of items) {
            const itemTotal = Number(item.price) * item.quantity;
            await promisePool.query(
                `INSERT INTO order_items 
                 (order_id, product_id, product_name, price, quantity, total) 
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [orderId, item.id, item.name, item.price, item.quantity, itemTotal]
            );
        }
        
        // Если использован промокод, увеличиваем счетчик использований
        if (promo_code) {
            await promisePool.query(
                'UPDATE promo_codes SET used_count = used_count + 1 WHERE code = ?',
                [promo_code]
            );
        }
        
        // Завершаем транзакцию
        await promisePool.query('COMMIT');
        
        res.json({ 
            success: true, 
            message: 'Заказ оформлен',
            orderId: orderId,
            orderNumber: orderNumber
        });
        
    } catch (error) {
        // Откатываем транзакцию в случае ошибки
        await promisePool.query('ROLLBACK');
        console.error('Ошибка создания заказа:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// ===== ОФОРМЛЕННЫЕ ЗАКАЗЫ =====

// Получить заказы пользователя
app.get('/api/orders/user/:userId', async (req, res) => {
    const userId = req.params.userId;
    
    try {
        const [orders] = await promisePool.query(
            `SELECT * FROM orders 
             WHERE user_id = ? 
             ORDER BY created_at DESC`,
            [userId]
        );
        
        // Для каждого заказа получаем список товаров
        for (let order of orders) {
            const [items] = await promisePool.query(
                `SELECT * FROM order_items WHERE order_id = ?`,
                [order.id]
            );
            order.items = items;
        }
        
        res.json(orders);
    } catch (error) {
        console.error('Ошибка при получении заказов:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Получить детали заказа
app.get('/api/orders/:orderId', async (req, res) => {
    const orderId = req.params.orderId;
    
    try {
        const [orders] = await promisePool.query(
            `SELECT * FROM orders WHERE id = ?`,
            [orderId]
        );
        
        if (orders.length === 0) {
            return res.status(404).json({ error: 'Заказ не найден' });
        }
        
        const order = orders[0];
        
        const [items] = await promisePool.query(
            `SELECT * FROM order_items WHERE order_id = ?`,
            [orderId]
        );
        order.items = items;
        
        res.json(order);
    } catch (error) {
        console.error('Ошибка при получении заказа:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// ===== ОТЗЫВЫ =====

// Получить все отзывы для товара
app.get('/api/reviews/product/:productId', async (req, res) => {
    const productId = req.params.productId;
    
    try {
        const [rows] = await promisePool.query(`
            SELECT r.*, u.username, u.avatar_url 
            FROM reviews r
            JOIN users u ON r.user_id = u.id
            WHERE r.product_id = ?
            ORDER BY r.created_at DESC
        `, [productId]);
        
        res.json(rows);
    } catch (error) {
        console.error('Ошибка при получении отзывов:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Получить статистику отзывов для товара
app.get('/api/reviews/product/:productId/stats', async (req, res) => {
    const productId = req.params.productId;
    
    try {
        const [rows] = await promisePool.query(`
            SELECT 
                COUNT(*) as total,
                AVG(rating) as average,
                SUM(CASE WHEN rating = 5 THEN 1 ELSE 0 END) as rating_5,
                SUM(CASE WHEN rating = 4 THEN 1 ELSE 0 END) as rating_4,
                SUM(CASE WHEN rating = 3 THEN 1 ELSE 0 END) as rating_3,
                SUM(CASE WHEN rating = 2 THEN 1 ELSE 0 END) as rating_2,
                SUM(CASE WHEN rating = 1 THEN 1 ELSE 0 END) as rating_1
            FROM reviews
            WHERE product_id = ?
        `, [productId]);
        
        // Преобразуем строки в числа
        const stats = rows[0];
        const result = {
            total: parseInt(stats.total) || 0,
            average: parseFloat(stats.average) || 0,
            rating_5: parseInt(stats.rating_5) || 0,
            rating_4: parseInt(stats.rating_4) || 0,
            rating_3: parseInt(stats.rating_3) || 0,
            rating_2: parseInt(stats.rating_2) || 0,
            rating_1: parseInt(stats.rating_1) || 0
        };
        
        res.json(result);
    } catch (error) {
        console.error('Ошибка при получении статистики:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Получить рейтинг продавца по ID
app.get('/api/seller/:sellerId/rating', async (req, res) => {
    const sellerId = req.params.sellerId;
    
    try {
        // Получаем все товары продавца
        const [products] = await promisePool.query(
            'SELECT id FROM products WHERE user_id = ?',
            [sellerId]
        );
        
        if (products.length === 0) {
            return res.json({
                totalReviews: 0,
                averageRating: 0,
                ratingCounts: {1:0,2:0,3:0,4:0,5:0}
            });
        }
        
        const productIds = products.map(p => p.id);
        
        // Получаем статистику отзывов по всем товарам продавца
        const [stats] = await promisePool.query(`
            SELECT 
                COUNT(*) as total,
                AVG(rating) as average,
                SUM(CASE WHEN rating = 5 THEN 1 ELSE 0 END) as rating_5,
                SUM(CASE WHEN rating = 4 THEN 1 ELSE 0 END) as rating_4,
                SUM(CASE WHEN rating = 3 THEN 1 ELSE 0 END) as rating_3,
                SUM(CASE WHEN rating = 2 THEN 1 ELSE 0 END) as rating_2,
                SUM(CASE WHEN rating = 1 THEN 1 ELSE 0 END) as rating_1
            FROM reviews
            WHERE product_id IN (?)
        `, [productIds]);
        
        const result = {
            totalReviews: parseInt(stats[0].total) || 0,
            averageRating: parseFloat(stats[0].average) || 0,
            ratingCounts: {
                1: parseInt(stats[0].rating_1) || 0,
                2: parseInt(stats[0].rating_2) || 0,
                3: parseInt(stats[0].rating_3) || 0,
                4: parseInt(stats[0].rating_4) || 0,
                5: parseInt(stats[0].rating_5) || 0
            }
        };
        
        res.json(result);
    } catch (error) {
        console.error('Ошибка при получении рейтинга продавца:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Получить информацию о продавце с рейтингом
app.get('/api/seller/:sellerId', async (req, res) => {
    const sellerId = req.params.sellerId;
    
    try {
        // Получаем информацию о продавце
        const [userRows] = await promisePool.query(
            'SELECT id, username, email, phone, bio, avatar_url, role, created_at FROM users WHERE id = ?',
            [sellerId]
        );
        
        if (userRows.length === 0) {
            return res.status(404).json({ error: 'Продавец не найден' });
        }
        
        const seller = userRows[0];
        
        // Получаем количество товаров продавца
        const [productRows] = await promisePool.query(
            'SELECT COUNT(*) as count FROM products WHERE user_id = ?',
            [sellerId]
        );
        seller.productCount = productRows[0].count;
        
        // Получаем рейтинг продавца
        const [products] = await promisePool.query(
            'SELECT id FROM products WHERE user_id = ?',
            [sellerId]
        );
        
        if (products.length > 0) {
            const productIds = products.map(p => p.id);
            const [ratingRows] = await promisePool.query(`
                SELECT 
                    COUNT(*) as total,
                    AVG(rating) as average
                FROM reviews
                WHERE product_id IN (?)
            `, [productIds]);
            
            seller.totalReviews = parseInt(ratingRows[0].total) || 0;
            seller.averageRating = parseFloat(ratingRows[0].average) || 0;
        } else {
            seller.totalReviews = 0;
            seller.averageRating = 0;
        }
        
        res.json(seller);
    } catch (error) {
        console.error('Ошибка при получении продавца:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Добавить отзыв
app.post('/api/reviews', async (req, res) => {
    const { product_id, user_id, rating, title, comment } = req.body;
    
    if (!product_id || !user_id || !rating || !comment) {
        return res.status(400).json({ error: 'Заполните все обязательные поля' });
    }
    
    try {
        // Проверяем, не оставлял ли пользователь уже отзыв
        const [existing] = await promisePool.query(
            'SELECT id FROM reviews WHERE product_id = ? AND user_id = ?',
            [product_id, user_id]
        );
        
        if (existing.length > 0) {
            return res.status(400).json({ error: 'Вы уже оставили отзыв на этот товар' });
        }
        
        const [result] = await promisePool.query(
            'INSERT INTO reviews (product_id, user_id, rating, title, comment) VALUES (?, ?, ?, ?, ?)',
            [product_id, user_id, rating, title || null, comment]
        );
        
        res.json({ 
            success: true, 
            message: 'Отзыв добавлен',
            reviewId: result.insertId 
        });
    } catch (error) {
        console.error('Ошибка при добавлении отзыва:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Обновить отзыв
app.put('/api/reviews/:id', async (req, res) => {
    const reviewId = req.params.id;
    const { user_id, rating, title, comment } = req.body;
    
    try {
        // Проверяем, что отзыв принадлежит пользователю
        const [review] = await promisePool.query(
            'SELECT user_id FROM reviews WHERE id = ?',
            [reviewId]
        );
        
        if (review.length === 0) {
            return res.status(404).json({ error: 'Отзыв не найден' });
        }
        
        if (review[0].user_id !== user_id) {
            return res.status(403).json({ error: 'Нет прав на редактирование' });
        }
        
        await promisePool.query(
            'UPDATE reviews SET rating = ?, title = ?, comment = ? WHERE id = ?',
            [rating, title || null, comment, reviewId]
        );
        
        res.json({ success: true, message: 'Отзыв обновлен' });
    } catch (error) {
        console.error('Ошибка при обновлении отзыва:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Удалить отзыв
app.delete('/api/reviews/:id', async (req, res) => {
    const reviewId = req.params.id;
    const user_id = req.query.user_id;
    
    try {
        // Проверяем, что отзыв принадлежит пользователю или пользователь - админ
        const [review] = await promisePool.query(
            'SELECT user_id FROM reviews WHERE id = ?',
            [reviewId]
        );
        
        if (review.length === 0) {
            return res.status(404).json({ error: 'Отзыв не найден' });
        }
        
        // Проверяем права (админ может удалять любые отзывы)
        const [user] = await promisePool.query('SELECT role FROM users WHERE id = ?', [user_id]);
        const isAdmin = user.length > 0 && user[0].role === 'admin';
        
        if (review[0].user_id !== user_id && !isAdmin) {
            return res.status(403).json({ error: 'Нет прав на удаление' });
        }
        
        await promisePool.query('DELETE FROM reviews WHERE id = ?', [reviewId]);
        
        res.json({ success: true, message: 'Отзыв удален' });
    } catch (error) {
        console.error('Ошибка при удалении отзыва:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Отправить сообщение
app.post('/api/chat/send', async (req, res) => {
    console.log('Получен запрос на отправку сообщения:', req.body);
    
    const { user_id, message, is_admin } = req.body;
    
    if (!user_id || !message) {
        return res.status(400).json({ error: 'Не все данные заполнены' });
    }
    
    try {
        const [result] = await promisePool.query(
            `INSERT INTO chat_messages (user_id, message, is_admin, is_read) 
             VALUES (?, ?, ?, ?)`,
            [user_id, message, is_admin || false, is_admin ? true : false]
        );
        
        console.log('Сообщение сохранено, ID:', result.insertId);
        
        res.json({ 
            success: true, 
            messageId: result.insertId,
            message: 'Сообщение отправлено'
        });
    } catch (error) {
        console.error('Ошибка при отправке сообщения:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Отметить сообщения как прочитанные
app.post('/api/chat/read/:userId', async (req, res) => {
    const userId = req.params.userId;
    const { admin_id } = req.body;
    
    try {
        // Если это админ, проверяем права
        if (admin_id) {
            const [user] = await promisePool.query('SELECT role FROM users WHERE id = ?', [admin_id]);
            if (user.length > 0 && user[0].role === 'admin') {
                // Админ отмечает все сообщения пользователя как прочитанные
                await promisePool.query(
                    'UPDATE chat_messages SET is_read = TRUE WHERE user_id = ? AND is_admin = FALSE',
                    [userId]
                );
            }
        } else {
            // Пользователь отмечает свои сообщения от админа как прочитанные
            await promisePool.query(
                'UPDATE chat_messages SET is_read = TRUE WHERE user_id = ? AND is_admin = TRUE',
                [userId]
            );
        }
        
        res.json({ success: true });
    } catch (error) {
        console.error('Ошибка при отметке прочитанных:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Получить непрочитанные сообщения для пользователя
app.get('/api/chat/unread/:userId', async (req, res) => {
    const userId = req.params.userId;
    
    try {
        const [rows] = await promisePool.query(
            'SELECT COUNT(*) as count FROM chat_messages WHERE user_id = ? AND is_admin = TRUE AND is_read = FALSE',
            [userId]
        );
        
        res.json({ unread: rows[0].count });
    } catch (error) {
        console.error('Ошибка при получении непрочитанных:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Обновление профиля пользователя
app.post('/api/user/update', async (req, res) => {
    const { user_id, email, phone, bio } = req.body;
    
    try {
        await promisePool.query(
            'UPDATE users SET email = ?, phone = ?, bio = ? WHERE id = ?',
            [email, phone, bio, user_id]
        );
        
        res.json({ success: true, message: 'Профиль обновлен' });
    } catch (error) {
        console.error('Ошибка при обновлении профиля:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Загрузка аватара
const avatarStorage = multer.diskStorage({
    destination: function (req, file, cb) {
        const uploadDir = path.join(__dirname, 'public/avatars');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname);
        cb(null, 'avatar-' + uniqueSuffix + ext);
    }
});

const avatarUpload = multer({ 
    storage: avatarStorage,
    limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Только изображения разрешены!'));
        }
    }
});

app.post('/api/user/avatar', avatarUpload.single('avatar'), async (req, res) => {
    const user_id = req.body.user_id;
    
    if (!req.file) {
        return res.status(400).json({ error: 'Файл не загружен' });
    }
    
    try {
        const avatarUrl = `/avatars/${req.file.filename}`;
        
        await promisePool.query(
            'UPDATE users SET avatar_url = ? WHERE id = ?',
            [avatarUrl, user_id]
        );
        
        res.json({ success: true, avatarUrl: avatarUrl });
    } catch (error) {
        console.error('Ошибка при загрузке аватара:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});


// Регистрация пользователя (упрощенная, без подтверждения)
app.post('/api/register', async (req, res) => {
    console.log('📝 Получен запрос на регистрацию:', req.body);
    
    const { username, email, password } = req.body;

    // Проверяем наличие всех полей
    if (!username || !email || !password) {
        return res.status(400).json({ error: 'Все поля обязательны' });
    }

    // Проверяем длину пароля
    if (password.length < 6) {
        return res.status(400).json({ error: 'Пароль должен быть не менее 6 символов' });
    }

    try {
        // Проверяем, существует ли пользователь
        const [existing] = await promisePool.query(
            'SELECT id FROM users WHERE username = ? OR email = ?',
            [username, email]
        );

        if (existing.length > 0) {
            return res.status(400).json({ error: 'Пользователь уже существует' });
        }

        // Создаем пользователя (сразу подтвержденного)
        const [result] = await promisePool.query(
            `INSERT INTO users (username, email, password_hash, role, is_verified) 
             VALUES (?, ?, ?, 'user', TRUE)`,
            [username, email, password]
        );

        console.log('✅ Пользователь создан, ID:', result.insertId);

        res.json({
            success: true,
            message: 'Регистрация успешна!',
            userId: result.insertId
        });

    } catch (error) {
        console.error('❌ Ошибка при регистрации:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});



// Вход пользователя
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    
    try {
        const [rows] = await promisePool.query(
            'SELECT id, username, email, role, is_verified FROM users WHERE username = ? AND password_hash = ?',
            [username, password]
        );
        
        if (rows.length > 0) {
            const user = rows[0];
            
            // Если нет поля is_verified или оно null, считаем что verified
            if (user.is_verified === null || user.is_verified === undefined) {
                user.is_verified = true;
            }
            
            res.json({ 
                success: true, 
                user: user
            });
        } else {
            res.status(401).json({ error: 'Неверный логин или пароль' });
        }
    } catch (error) {
        console.error('Ошибка при входе:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Добавление товара (для авторизованных пользователей)
// Добавление товара с изображением (новый endpoint)
app.post('/api/products-with-image', upload.single('image'), async (req, res) => {
    try {
        const { user_id, category_id, name, description, price } = req.body;
        
        // Определяем URL изображения
        let image_main = 'https://via.placeholder.com/300x200';
        
        // Если файл загружен, создаем URL для доступа к нему
        if (req.file) {
            image_main = `/uploads/${req.file.filename}`;
        }
        
        const [result] = await promisePool.query(
            `INSERT INTO products 
            (user_id, category_id, name, description, price, image_main, status) 
            VALUES (?, ?, ?, ?, ?, ?, 'active')`,
            [user_id, category_id, name, description, price, image_main]
        );
        
        res.json({ 
            success: true, 
            message: 'Товар добавлен',
            productId: result.insertId,
            imageUrl: image_main
        });
    } catch (error) {
        console.error('Ошибка при добавлении товара:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Оставляем старый endpoint для обратной совместимости
app.post('/api/products', async (req, res) => {
    const { user_id, category_id, name, description, price, image_main } = req.body;
    
    try {
        const [result] = await promisePool.query(
            `INSERT INTO products 
            (user_id, category_id, name, description, price, image_main, status) 
            VALUES (?, ?, ?, ?, ?, ?, 'active')`,
            [user_id, category_id, name, description, price, image_main || 'https://via.placeholder.com/300x200']
        );
        
        res.json({ 
            success: true, 
            message: 'Товар добавлен',
            productId: result.insertId 
        });
    } catch (error) {
        console.error('Ошибка при добавлении товара:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Обновление товара с изображением
app.put('/api/products-with-image/:id', upload.single('image'), async (req, res) => {
    const productId = req.params.id;
    const { name, category_id, price, description, user_id } = req.body;
    
    try {
        // Проверяем, что товар принадлежит пользователю
        const [product] = await promisePool.query(
            'SELECT * FROM products WHERE id = ?',
            [productId]
        );
        
        if (product.length === 0) {
            return res.status(404).json({ error: 'Товар не найден' });
        }
        
        if (product[0].user_id != user_id) {
            return res.status(403).json({ error: 'Нет прав на редактирование' });
        }
        
        let image_main = product[0].image_main;
        
        // Если загружено новое изображение
        if (req.file) {
            image_main = `/uploads/${req.file.filename}`;
            
            // Удаляем старое изображение, если оно не заглушка
            if (product[0].image_main && !product[0].image_main.includes('placeholder')) {
                const oldImagePath = path.join(__dirname, 'public', product[0].image_main);
                if (fs.existsSync(oldImagePath)) {
                    fs.unlinkSync(oldImagePath);
                }
            }
        }
        
        // Обновляем товар
        await promisePool.query(
            'UPDATE products SET name = ?, category_id = ?, price = ?, description = ?, image_main = ? WHERE id = ?',
            [name, category_id, price, description, image_main, productId]
        );
        
        res.json({ 
            success: true, 
            message: 'Товар обновлен',
            imageUrl: image_main 
        });
    } catch (error) {
        console.error('Ошибка при обновлении товара:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Обновление товара
app.put('/api/products/:id', async (req, res) => {
    const productId = req.params.id;
    const { name, category_id, price, description } = req.body;
    const userId = req.body.user_id; // В реальном проекте нужно получать из сессии
    
    try {
        // Проверяем, что товар принадлежит пользователю
        const [product] = await promisePool.query(
            'SELECT user_id FROM products WHERE id = ?',
            [productId]
        );
        
        if (product.length === 0) {
            return res.status(404).json({ error: 'Товар не найден' });
        }
        
        if (product[0].user_id !== userId) {
            return res.status(403).json({ error: 'Нет прав на редактирование' });
        }
        
        // Обновляем товар
        await promisePool.query(
            'UPDATE products SET name = ?, category_id = ?, price = ?, description = ? WHERE id = ?',
            [name, category_id, price, description, productId]
        );
        
        res.json({ success: true, message: 'Товар обновлен' });
    } catch (error) {
        console.error('Ошибка при обновлении товара:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Удаление товара
app.delete('/api/products/:id', async (req, res) => {
    const productId = req.params.id;
    const userId = req.query.user_id; // В реальном проекте нужно получать из сессии
    
    try {
        // Проверяем, что товар принадлежит пользователю
        const [product] = await promisePool.query(
            'SELECT user_id FROM products WHERE id = ?',
            [productId]
        );
        
        if (product.length === 0) {
            return res.status(404).json({ error: 'Товар не найден' });
        }
        
        if (product[0].user_id != userId) {
            return res.status(403).json({ error: 'Нет прав на удаление' });
        }
        
        // Удаляем товар
        await promisePool.query('DELETE FROM products WHERE id = ?', [productId]);
        
        res.json({ success: true, message: 'Товар удален' });
    } catch (error) {
        console.error('Ошибка при удалении товара:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// ===== УПРАВЛЕНИЕ КАТЕГОРИЯМИ (ТОЛЬКО ДЛЯ АДМИНА) =====

// Получить все категории (доступно всем)
app.get('/api/categories', async (req, res) => {
    try {
        const [rows] = await promisePool.query('SELECT * FROM categories ORDER BY name');
        res.json(rows);
    } catch (error) {
        console.error('Ошибка при получении категорий:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Создать новую категорию (только админ)
app.post('/api/categories', async (req, res) => {
    const { name, slug, user_id } = req.body;
    
    try {
        // Проверяем, является ли пользователь админом
        const [user] = await promisePool.query('SELECT role FROM users WHERE id = ?', [user_id]);
        
        if (user.length === 0 || user[0].role !== 'admin') {
            return res.status(403).json({ error: 'Только администратор может создавать категории' });
        }
        
        // Проверяем, существует ли уже такая категория
        const [existing] = await promisePool.query(
            'SELECT id FROM categories WHERE name = ? OR slug = ?',
            [name, slug]
        );
        
        if (existing.length > 0) {
            return res.status(400).json({ error: 'Категория с таким названием уже существует' });
        }
        
        const [result] = await promisePool.query(
            'INSERT INTO categories (name, slug) VALUES (?, ?)',
            [name, slug]
        );
        
        res.json({ 
            success: true, 
            message: 'Категория создана',
            categoryId: result.insertId 
        });
    } catch (error) {
        console.error('Ошибка при создании категории:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Обновить категорию (только админ)
app.put('/api/categories/:id', async (req, res) => {
    const categoryId = req.params.id;
    const { name, slug, user_id } = req.body;
    
    try {
        // Проверяем, является ли пользователь админом
        const [user] = await promisePool.query('SELECT role FROM users WHERE id = ?', [user_id]);
        
        if (user.length === 0 || user[0].role !== 'admin') {
            return res.status(403).json({ error: 'Только администратор может изменять категории' });
        }
        
        await promisePool.query(
            'UPDATE categories SET name = ?, slug = ? WHERE id = ?',
            [name, slug, categoryId]
        );
        
        res.json({ success: true, message: 'Категория обновлена' });
    } catch (error) {
        console.error('Ошибка при обновлении категории:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Удалить категорию (только админ)
app.delete('/api/categories/:id', async (req, res) => {
    const categoryId = req.params.id;
    const user_id = req.query.user_id;
    
    try {
        // Проверяем, является ли пользователь админом
        const [user] = await promisePool.query('SELECT role FROM users WHERE id = ?', [user_id]);
        
        if (user.length === 0 || user[0].role !== 'admin') {
            return res.status(403).json({ error: 'Только администратор может удалять категории' });
        }
        
        // Проверяем, есть ли товары в этой категории
        const [products] = await promisePool.query('SELECT id FROM products WHERE category_id = ?', [categoryId]);
        
        if (products.length > 0) {
            return res.status(400).json({ 
                error: 'Нельзя удалить категорию, в которой есть товары. Сначала переместите товары в другую категорию.' 
            });
        }
        
        await promisePool.query('DELETE FROM categories WHERE id = ?', [categoryId]);
        
        res.json({ success: true, message: 'Категория удалена' });
    } catch (error) {
        console.error('Ошибка при удалении категории:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Корневой маршрут - отдаем HTML
app.get('/', (req, res) => {
    res.sendFile(path.join(publicPath, 'index.html'));
});

// Запускаем сервер
app.listen(PORT, () => {
    console.log(`🚀 Сервер запущен на http://localhost:${PORT}`);
    console.log(`📁 Откройте в браузере: http://localhost:${PORT}`);
});

