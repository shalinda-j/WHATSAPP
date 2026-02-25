import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import Lead from '../../models/Lead';
import { authenticateToken } from '../middleware/auth';
import pdf from 'pdf-parse';

const router = Router();

const UPLOAD_DIR = path.join(__dirname, '../../../uploads/qualifications');
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|pdf|doc|docx/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    if (extname && mimetype) {
      return cb(null, true);
    }
    cb(new Error('Only images and PDF files are allowed'));
  }
});

// Public route for bot registration (no auth required)
router.post('/register', async (req, res) => {
  try {
    const { fullName, phoneNumber, address, email, jobVacancyType } = req.body;
    
    if (!fullName || !phoneNumber || !address || !jobVacancyType) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const lead = new Lead({
      fullName,
      phoneNumber,
      address,
      email,
      jobVacancyType,
      status: 'new',
      registeredAt: new Date()
    });
    
    await lead.save();
    res.status(201).json({ success: true, leadId: lead._id });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Apply auth middleware for all other routes
router.use(authenticateToken);

router.get('/', async (req, res) => {
  try {
    const { status, jobVacancyType, search, page = 1, limit = 20 } = req.query;
    
    const query: any = {};
    
    if (status) query.status = status;
    if (jobVacancyType) query.jobVacancyType = jobVacancyType;
    if (search) {
      query.$or = [
        { fullName: { $regex: search, $options: 'i' } },
        { phoneNumber: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ];
    }

    const total = await Lead.countDocuments(query);
    const leads = await Lead.find(query)
      .sort({ registeredAt: -1 })
      .skip((Number(page) - 1) * Number(limit))
      .limit(Number(limit));

    res.json({
      leads,
      total,
      page: Number(page),
      totalPages: Math.ceil(total / Number(limit))
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/stats', async (req, res) => {
  try {
    const totalLeads = await Lead.countDocuments();
    const byStatus = await Lead.aggregate([
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ]);
    const byJobType = await Lead.aggregate([
      { $group: { _id: '$jobVacancyType', count: { $sum: 1 } } }
    ]);

    res.json({
      totalLeads,
      byStatus: byStatus.reduce((acc: any, item: any) => {
        acc[item._id] = item.count;
        return acc;
      }, {}),
      byJobType: byJobType.reduce((acc: any, item: any) => {
        acc[item._id] = item.count;
        return acc;
      }, {})
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/job-types', (req, res) => {
  const jobTypes = [
    'Electrician',
    'Plumber',
    'Asphalt Worker',
    'Concrete Pump Driver',
    'Excavator Operator',
    'JCB Operator',
    'Heavy Duty Cleaner',
    'Gypsum Fixer',
    'Tile Fixer',
    'General Worker',
    'Welder',
    'Carpenter',
    'Mason',
    'Painter',
    'AC Technician'
  ];
  res.json(jobTypes);
});

router.get('/:id', async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id);
    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }
    res.json(lead);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const lead = new Lead(req.body);
    await lead.save();
    res.status(201).json(lead);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const lead = await Lead.findByIdAndUpdate(
      req.params.id,
      { ...req.body, updatedAt: new Date() },
      { new: true }
    );
    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }
    res.json(lead);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const lead = await Lead.findByIdAndDelete(req.params.id);
    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }
    
    for (const qual of lead.qualifications) {
      const filePath = path.join(UPLOAD_DIR, path.basename(qual.filePath));
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }
    
    res.json({ message: 'Lead deleted successfully' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/qualifications', upload.single('file'), async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id);
    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    let extractedText = '';
    if (req.file.mimetype === 'application/pdf') {
      try {
        const dataBuffer = fs.readFileSync(req.file.path);
        const data = await pdf(dataBuffer);
        extractedText = data.text;
      } catch (pdfErr) {
        console.error('PDF parsing error:', pdfErr);
      }
    }

    const qualification: any = {
      documentType: req.body.documentType || 'other',
      fileName: req.file.originalname,
      filePath: `/uploads/qualifications/${req.file.filename}`,
      fileSize: req.file.size,
      extractedText,
      uploadedAt: new Date()
    };

    const leadDoc = lead as any;
    if (!leadDoc.qualifications) {
      leadDoc.qualifications = [];
    }
    leadDoc.qualifications.push(qualification);
    leadDoc.updatedAt = new Date();
    await lead.save();

    res.json(lead);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id/qualifications/:qualIndex/download', async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id);
    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    const qualIndex = parseInt(req.params.qualIndex);
    if (isNaN(qualIndex) || qualIndex < 0 || qualIndex >= lead.qualifications.length) {
      return res.status(404).json({ error: 'Qualification not found' });
    }

    const qual = lead.qualifications[qualIndex];
    const filePath = path.join(UPLOAD_DIR, path.basename(qual.filePath));

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    res.download(filePath, qual.fileName);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
