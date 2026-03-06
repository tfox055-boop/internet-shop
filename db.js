const mysql = require('mysql2');
require('dotenv').config();

const pool = mysql.createPool({
    host: process.env.MYSQL_HOST || 'localhost',
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || 'internet_shop',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// Преобразуем в промисы для удобства
const promisePool = pool.promise();

// Проверяем подключение
async function testConnection() {
    try {
        const [rows] = await promisePool.query('SELECT 1 + 1 AS solution');
        console.log('✅ База данных подключена!');
        return true;
    } catch (error) {
        console.error('❌ Ошибка подключения к БД:', error.message);
        return false;
    }
}

module.exports = { promisePool, testConnection };