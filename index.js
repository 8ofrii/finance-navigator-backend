require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Client } = require('pg');
const app = express();
const PORT = process.env.PORT || 5000;

// Enhanced CORS configuration
app.use(cors({
    origin: ['http://localhost:3000', 'http://localhost:3001', 'http://127.0.0.1:3000'],
    credentials: true
}));

// Add JSON parsing middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Create DB connection with better error handling
function getDBClient() {
    return new Client({
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER,
        database: process.env.DB_NAME,
        password: process.env.DB_PASS,
        port: process.env.DB_PORT || 5432,
        ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false
    });
}

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Top Customers
app.get('/api/top-customers', async (req, res) => {
    const client = getDBClient();
    try {
        await client.connect();
        const result = await client.query(`
            SELECT receiver_name, SUM(total_amount) AS total_payment
            FROM sent_documents
            WHERE receiver_name IS NOT NULL
            GROUP BY receiver_name
            ORDER BY total_payment DESC
            LIMIT 5
        `);
        res.json(result.rows);
    } catch (err) {
        console.error('Error in /api/top-customers:', err);
        res.status(500).json({ error: err.message, endpoint: 'top-customers' });
    } finally {
        await client.end();
    }
});

// Total Revenue
app.get('/api/total-revenue', async (req, res) => {
    const client = getDBClient();
    try {
        await client.connect();
        const result = await client.query(`
            SELECT SUM(total_amount) AS total_revenue FROM (
                SELECT total_amount FROM sent_documents WHERE total_amount IS NOT NULL
                UNION ALL
                SELECT total_amount FROM documents WHERE total_amount IS NOT NULL
            ) AS all_docs
        `);
        res.json(result.rows[0] || { total_revenue: 0 });
    } catch (err) {
        console.error('Error in /api/total-revenue:', err);
        res.status(500).json({ error: err.message, endpoint: 'total-revenue' });
    } finally {
        await client.end();
    }
});

// Total Invoices
app.get('/api/total-invoices', async (req, res) => {
    const client = getDBClient();
    try {
        await client.connect();
        const result = await client.query(`
            SELECT COUNT(*) AS total_invoices FROM (
                SELECT uuid FROM sent_documents WHERE uuid IS NOT NULL
                UNION ALL
                SELECT uuid FROM documents WHERE uuid IS NOT NULL
            ) AS all_docs
        `);
        res.json(result.rows[0] || { total_invoices: 0 });
    } catch (err) {
        console.error('Error in /api/total-invoices:', err);
        res.status(500).json({ error: err.message, endpoint: 'total-invoices' });
    } finally {
        await client.end();
    }
});

// Total Taxes
app.get('/api/total-taxes', async (req, res) => {
    const client = getDBClient();
    try {
        await client.connect();
        const result = await client.query(`
            SELECT 
                SUM(COALESCE(tax1_amount,0) + COALESCE(tax2_amount,0) + COALESCE(tax3_amount,0) + COALESCE(tax4_amount,0) + COALESCE(tax5_amount,0)) AS total_tax
            FROM (
                SELECT tax1_amount, tax2_amount, tax3_amount, tax4_amount, tax5_amount FROM sent_documents
                UNION ALL
                SELECT tax1_amount, tax2_amount, tax3_amount, tax4_amount, tax5_amount FROM documents
            ) AS all_docs
        `);
        res.json(result.rows[0] || { total_tax: 0 });
    } catch (err) {
        console.error('Error in /api/total-taxes:', err);
        res.status(500).json({ error: err.message, endpoint: 'total-taxes' });
    } finally {
        await client.end();
    }
});

// Tax Breakdown (for pie chart) - FIXED
app.get('/api/tax-breakdown', async (req, res) => {
    const client = getDBClient();
    try {
        await client.connect();
        const result = await client.query(`
            SELECT 'Tax1' AS type, SUM(COALESCE(tax1_amount, 0)) AS amount FROM (
                SELECT tax1_amount FROM sent_documents
                UNION ALL
                SELECT tax1_amount FROM documents
            ) AS all_docs
            UNION ALL
            SELECT 'Tax2', SUM(COALESCE(tax2_amount, 0)) FROM (
                SELECT tax2_amount FROM sent_documents
                UNION ALL
                SELECT tax2_amount FROM documents
            ) AS all_docs
            UNION ALL
            SELECT 'Tax3', SUM(COALESCE(tax3_amount, 0)) FROM (
                SELECT tax3_amount FROM sent_documents
                UNION ALL
                SELECT tax3_amount FROM documents
            ) AS all_docs
            UNION ALL
            SELECT 'Tax4', SUM(COALESCE(tax4_amount, 0)) FROM (
                SELECT tax4_amount FROM sent_documents
                UNION ALL
                SELECT tax4_amount FROM documents
            ) AS all_docs
            UNION ALL
            SELECT 'Tax5', SUM(COALESCE(tax5_amount, 0)) FROM (
                SELECT tax5_amount FROM sent_documents
                UNION ALL
                SELECT tax5_amount FROM documents
            ) AS all_docs
            ORDER BY amount DESC;
        `);

        const total = result.rows.reduce((sum, row) => sum + Number(row.amount || 0), 0);
        const breakdown = result.rows
            .filter(row => Number(row.amount) > 0) // Only include non-zero taxes
            .map(row => ({
                type: row.type,
                amount: Number(row.amount),
                percentage: total ? ((Number(row.amount) / total) * 100).toFixed(1) : '0'
            }));

        res.json(breakdown);
    } catch (err) {
        console.error('Error in /api/tax-breakdown:', err);
        res.status(500).json({ error: err.message, endpoint: 'tax-breakdown' });
    } finally {
        await client.end();
    }
});

// Revenue by Month (ENHANCED for monthly performance)
app.get('/api/revenue-by-month', async (req, res) => {
    const client = getDBClient();
    try {
        await client.connect();
        const result = await client.query(`
            SELECT 
                TO_CHAR(date_time_issued, 'YYYY-MM') AS month,
                SUM(total_amount) AS revenue,
                COUNT(*) AS invoices,
                SUM(COALESCE(tax1_amount,0) + COALESCE(tax2_amount,0) + COALESCE(tax3_amount,0) + COALESCE(tax4_amount,0) + COALESCE(tax5_amount,0)) AS taxes
            FROM (
                SELECT date_time_issued, total_amount, tax1_amount, tax2_amount, tax3_amount, tax4_amount, tax5_amount FROM sent_documents WHERE date_time_issued IS NOT NULL
                UNION ALL
                SELECT date_time_issued, total_amount, tax1_amount, tax2_amount, tax3_amount, tax4_amount, tax5_amount FROM documents WHERE date_time_issued IS NOT NULL
            ) AS all_docs
            GROUP BY month
            ORDER BY month;
        `);
        res.json(result.rows);
    } catch (err) {
        console.error('Error in /api/revenue-by-month:', err);
        res.status(500).json({ error: err.message, endpoint: 'revenue-by-month' });
    } finally {
        await client.end();
    }
});

// Invoice Status - FIXED
app.get('/api/invoice-status', async (req, res) => {
    const client = getDBClient();
    try {
        await client.connect();
        const result = await client.query(`
            SELECT 
                COALESCE(status, 'Unknown') AS status, 
                COUNT(*)::int AS count  -- Cast to integer here
            FROM (
                SELECT status FROM sent_documents
                UNION ALL
                SELECT status FROM documents
            ) AS all_docs
            GROUP BY status
            ORDER BY count DESC
        `);
        res.json(result.rows);
    } catch (err) {
        console.error('Error in /api/invoice-status:', err);
        res.status(500).json({ error: err.message, endpoint: 'invoice-status' });
    } finally {
        await client.end();
    }
});


// Quarterly Performance
app.get('/api/quarterly-performance', async (req, res) => {
    const client = getDBClient();
    try {
        await client.connect();
        const result = await client.query(`
            SELECT 
                TO_CHAR(date_time_issued, 'YYYY-"Q"Q') AS quarter,
                SUM(total_amount) AS revenue,
                SUM(COALESCE(tax1_amount,0) + COALESCE(tax2_amount,0) + COALESCE(tax3_amount,0) + COALESCE(tax4_amount,0) + COALESCE(tax5_amount,0)) AS taxes
            FROM (
                SELECT date_time_issued, total_amount, tax1_amount, tax2_amount, tax3_amount, tax4_amount, tax5_amount FROM sent_documents WHERE date_time_issued IS NOT NULL
                UNION ALL
                SELECT date_time_issued, total_amount, tax1_amount, tax2_amount, tax3_amount, tax4_amount, tax5_amount FROM documents WHERE date_time_issued IS NOT NULL
            ) AS all_docs
            GROUP BY quarter
            ORDER BY quarter;
        `);
        res.json(result.rows);
    } catch (err) {
        console.error('Error in /api/quarterly-performance:', err);
        res.status(500).json({ error: err.message, endpoint: 'quarterly-performance' });
    } finally {
        await client.end();
    }
});

// Top Products
app.get('/api/top-products', async (req, res) => {
    const client = getDBClient();
    try {
        await client.connect();
        const result = await client.query(`
            SELECT item_primary_name, SUM(sales_total) AS total_sales
            FROM sent_document_lines
            WHERE item_primary_name IS NOT NULL AND sales_total IS NOT NULL
            GROUP BY item_primary_name
            ORDER BY total_sales DESC
            LIMIT 5
        `);
        res.json(result.rows);
    } catch (err) {
        console.error('Error in /api/top-products:', err);
        res.status(500).json({ error: err.message, endpoint: 'top-products' });
    } finally {
        await client.end();
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error', message: err.message });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'Endpoint not found', path: req.path });
});

// Start server with better error handling
app.listen(PORT, (err) => {
    if (err) {
        console.error('Failed to start server:', err);
        process.exit(1);
    }
    console.log(`Backend server running on http://localhost:${PORT}`);
    console.log('Available endpoints:');
    console.log('  GET /api/health');
    console.log('  GET /api/top-customers');
    console.log('  GET /api/total-revenue');
    console.log('  GET /api/total-invoices');
    console.log('  GET /api/total-taxes');
    console.log('  GET /api/tax-breakdown');
    console.log('  GET /api/revenue-by-month');
    console.log('  GET /api/invoice-status');
    console.log('  GET /api/quarterly-performance');
    console.log('  GET /api/top-products');
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\nReceived SIGINT. Gracefully shutting down...');
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\nReceived SIGTERM. Gracefully shutting down...');
    process.exit(0);
});