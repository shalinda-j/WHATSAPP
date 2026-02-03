import { Router } from 'express';
import multer from 'multer';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pdf = require('pdf-parse');
import * as xlsx from 'xlsx';
import Dataset from '../../models/Dataset';
import { authenticateToken } from '../middleware/auth';
import { extractTextFromImage } from '../../services/gemini';

const router = Router();

// Configure multer for memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
});

// Public read (for bot) - though bot likely imports model directly
// Keeping this authenticatd for admin panel
router.use(authenticateToken);

router.get('/', async (req, res) => {
  try {
    const datasets = await Dataset.find().sort({ createdAt: -1 });
    res.json(datasets);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const dataset = await Dataset.findById(req.params.id);
    if (!dataset) return res.status(404).json({ message: 'Dataset not found' });
    res.json(dataset);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Extract text from uploaded file
 */
router.post('/extract', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    const { mimetype, buffer } = req.file;
    let extractedText = '';

    // 1. PDF Handling
    if (mimetype === 'application/pdf') {
      const data = await pdf(buffer);
      extractedText = data.text;
    }
    // 2. Excel/CSV Handling
    else if (
      mimetype.includes('excel') ||
      mimetype.includes('spreadsheet') ||
      mimetype.includes('csv')
    ) {
      const workbook = xlsx.read(buffer, { type: 'buffer' });
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      // Convert to CSV string for simplicity
      extractedText = xlsx.utils.sheet_to_csv(sheet);
    }
    // 3. Image Handling (OCR)
    else if (mimetype.startsWith('image/')) {
      const base64Data = buffer.toString('base64');
      extractedText = await extractTextFromImage(base64Data, mimetype);
    }
    // 4. Fallback (Text files)
    else if (mimetype.startsWith('text/')) {
      extractedText = buffer.toString('utf-8');
    } else {
      return res.status(400).json({ message: 'Unsupported file type' });
    }

    res.json({ text: extractedText.trim() });
  } catch (err: any) {
    console.error('File extraction error:', err);
    res
      .status(500)
      .json({ error: 'Failed to extract text. ' + (err.message || '') });
  }
});

router.post('/', async (req, res) => {
  try {
    const { name, content, scope, category, isActive } = req.body;
    const newDataset = new Dataset({
      name,
      content,
      scope,
      category,
      isActive,
    });
    await newDataset.save();
    res.json(newDataset);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const { name, content, scope, category, isActive } = req.body;
    const updatedDataset = await Dataset.findByIdAndUpdate(
      req.params.id,
      { name, content, scope, category, isActive },
      { new: true },
    );
    res.json(updatedDataset);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await Dataset.findByIdAndDelete(req.params.id);
    res.json({ message: 'Dataset deleted' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
