const mysql = require('mysql2');

// Создаем подключение к базе данных
const pool = mysql.createPool({
    host: 'localhost',
    user: 'root',
    password: '22022007VoVa', // Введите пароль, который задавали при установке MySQL
    database: 'internet_shop',
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