import { Router } from 'express';
import Config from '../../models/Config';
import { authenticateToken } from '../middleware/auth';

const router = Router();

router.use(authenticateToken);

router.get('/', async (req, res) => {
    try {
        const configs = await Config.find();
        res.json(configs);
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});


router.post('/', async (req, res) => {
    try {
        // Allow all body props to be saved
        const newConfig = new Config(req.body);
        await newConfig.save();
        res.json(newConfig);
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

router.put('/:id', async (req, res) => {
    try {
        const updatedConfig = await Config.findByIdAndUpdate(
            req.params.id,
            { $set: req.body }, // Update whatever is in the body
            { new: true }
        );
        res.json(updatedConfig);
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

router.delete('/:id', async (req, res) => {
    try {
        await Config.findByIdAndDelete(req.params.id);
        res.json({ message: 'Config deleted' });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

export default router;
