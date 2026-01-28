import { Router } from 'express';
import Dataset from '../../models/Dataset';
import { authenticateToken } from '../middleware/auth';

const router = Router();

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

router.post('/', async (req, res) => {
    try {
        const { name, content, scope, isActive } = req.body;
        const newDataset = new Dataset({ name, content, scope, isActive });
        await newDataset.save();
        res.json(newDataset);
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

router.put('/:id', async (req, res) => {
    try {
        const { name, content, scope, isActive } = req.body;
        const updatedDataset = await Dataset.findByIdAndUpdate(
            req.params.id,
            { name, content, scope, isActive },
            { new: true }
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
