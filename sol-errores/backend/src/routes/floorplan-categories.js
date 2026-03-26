const router = require('express').Router();
const { pool } = require('../db');
const { authenticate, requireAdmin, requireEditor } = require('../middleware/auth');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Configuración de multer (reusamos la lógica de imágenes de plano)
const UPLOAD_DIR = path.join(__dirname, '../../uploads/floorplan');
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, UPLOAD_DIR);
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname);
    const unique = crypto.randomBytes(8).toString('hex');
    cb(null, `cat_icon_${unique}${ext}`); // Prefijo distinto para iconos
  }
});

const upload = multer({ 
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Solo se permiten imágenes'));
  }
});

// GET /api/floorplan-categories
router.get('/', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM floorplan_categories ORDER BY label ASC');
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener categorías de plano' });
  }
});

// POST /api/floorplan-categories
router.post('/', authenticate, requireEditor, async (req, res) => {
  const { type, label, icon, image_url, default_color, default_w, default_h } = req.body;
  if (!type || !label) return res.status(400).json({ error: 'type y label son requeridos' });
  
  try {
    const slug = type.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
    const { rows } = await pool.query(
      `INSERT INTO floorplan_categories (type, label, icon, image_url, default_color, default_w, default_h) 
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [slug, label.trim(), icon || 'Square', image_url || null, default_color || '#1e3a5f', default_w || 100, default_h || 100]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Ya existe una categoría con ese tipo ('+type+')' });
    console.error(err);
    res.status(500).json({ error: 'Error al crear la categoría' });
  }
});

// PUT /api/floorplan-categories/:id
router.put('/:id', authenticate, requireEditor, async (req, res) => {
  const { label, icon, image_url, default_color, default_w, default_h } = req.body;
  if (!label) return res.status(400).json({ error: 'label es requerido' });
  
  try {
    const { rows } = await pool.query(
      `UPDATE floorplan_categories 
       SET label=$1, icon=$2, image_url=$3, default_color=$4, default_w=$5, default_h=$6 
       WHERE id=$7 RETURNING *`,
      [label.trim(), icon || 'Square', image_url || null, default_color || '#1e3a5f', default_w || 100, default_h || 100, req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Categoría no encontrada' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al actualizar la categoría' });
  }
});

// DELETE /api/floorplan-categories/:id
router.delete('/:id', authenticate, requireEditor, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT type FROM floorplan_categories WHERE id=$1', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Categoría no encontrada' });
    
    // Check if any floorplan_items use this category type
    const { rows: itemRows } = await pool.query(
      'SELECT COUNT(*) FROM floorplan_items WHERE type=$1', [rows[0].type]
    );
    if (parseInt(itemRows[0].count) > 0) {
      return res.status(409).json({ error: `No se puede eliminar: hay ${itemRows[0].count} elemento(s) en el mapa usando esta categoría` });
    }

    await pool.query('DELETE FROM floorplan_categories WHERE id=$1', [req.params.id]);
    res.json({ message: 'Categoría eliminada' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al eliminar la categoría' });
  }
});

// POST /api/floorplan-categories/image
router.post('/image', authenticate, requireEditor, upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No se ha subido ninguna imagen' });
  try {
    res.json({
      message: 'Imagen subida',
      // Responde utilizando el mismo endpoint que sirve las imágenes de planos
      url: `/api/floorplan/image-file/${req.file.filename}`
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al procesar la imagen' });
  }
});

module.exports = router;
