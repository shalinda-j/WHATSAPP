import { Router } from 'express';
import { CRMService } from '../../services/CRMService';
import { authenticateToken } from '../middleware/auth';

const router = Router();

// All CRM routes require authentication
router.use(authenticateToken);

// ==================== DASHBOARD ====================

router.get('/dashboard', async (req, res) => {
  try {
    const stats = await CRMService.getDashboardStats();
    res.json(stats);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== SEARCH ====================

router.get('/search', async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || typeof q !== 'string') {
      return res.status(400).json({ error: 'Search query is required' });
    }
    const results = await CRMService.globalSearch(q);
    res.json(results);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== CONTACTS ====================

router.get('/contacts', async (req, res) => {
  try {
    const { page, limit, search, type, status, source, tags } = req.query;
    const result = await CRMService.getContacts({
      page: Number(page) || 1,
      limit: Number(limit) || 20,
      search: search as string,
      type: type as string,
      status: status as string,
      source: source as string,
      tags: tags ? (tags as string).split(',') : undefined,
    });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/contacts/stats', async (req, res) => {
  try {
    const stats = await CRMService.getContactStats();
    res.json(stats);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/contacts/:id', async (req, res) => {
  try {
    const contact = await CRMService.getContactById(req.params.id);
    if (!contact) {
      return res.status(404).json({ error: 'Contact not found' });
    }
    res.json(contact);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/contacts', async (req, res) => {
  try {
    const contact = await CRMService.createContact(req.body);
    res.status(201).json(contact);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/contacts/:id', async (req, res) => {
  try {
    const contact = await CRMService.updateContact(req.params.id, req.body);
    if (!contact) {
      return res.status(404).json({ error: 'Contact not found' });
    }
    res.json(contact);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/contacts/:id', async (req, res) => {
  try {
    const result = await CRMService.deleteContact(req.params.id);
    if (!result) {
      return res.status(404).json({ error: 'Contact not found' });
    }
    res.json({ message: 'Contact deleted successfully' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== DEALS ====================

router.get('/deals', async (req, res) => {
  try {
    const { page, limit, search, stage, contact, owner } = req.query;
    const result = await CRMService.getDeals({
      page: Number(page) || 1,
      limit: Number(limit) || 20,
      search: search as string,
      stage: stage as string,
      contact: contact as string,
      owner: owner as string,
    });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/deals/kanban', async (req, res) => {
  try {
    const deals = await CRMService.getDealsByStage();
    res.json(deals);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/deals/stats', async (req, res) => {
  try {
    const stats = await CRMService.getDealStats();
    res.json(stats);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/deals/:id', async (req, res) => {
  try {
    const deal = await CRMService.getDealById(req.params.id);
    if (!deal) {
      return res.status(404).json({ error: 'Deal not found' });
    }
    res.json(deal);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/deals', async (req, res) => {
  try {
    const deal = await CRMService.createDeal(req.body);
    res.status(201).json(deal);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/deals/:id', async (req, res) => {
  try {
    const deal = await CRMService.updateDeal(req.params.id, req.body);
    if (!deal) {
      return res.status(404).json({ error: 'Deal not found' });
    }
    res.json(deal);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/deals/:id', async (req, res) => {
  try {
    const result = await CRMService.deleteDeal(req.params.id);
    if (!result) {
      return res.status(404).json({ error: 'Deal not found' });
    }
    res.json({ message: 'Deal deleted successfully' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== ACTIVITIES ====================

router.get('/activities', async (req, res) => {
  try {
    const { page, limit, type, contact, deal, status, owner, upcoming } =
      req.query;
    const result = await CRMService.getActivities({
      page: Number(page) || 1,
      limit: Number(limit) || 20,
      type: type as string,
      contact: contact as string,
      deal: deal as string,
      status: status as string,
      owner: owner as string,
      upcoming: upcoming === 'true',
    });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/activities/upcoming', async (req, res) => {
  try {
    const { limit } = req.query;
    const activities = await CRMService.getUpcomingActivities(
      Number(limit) || 10,
    );
    res.json(activities);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/activities/:id', async (req, res) => {
  try {
    const activity = await CRMService.getActivityById(req.params.id);
    if (!activity) {
      return res.status(404).json({ error: 'Activity not found' });
    }
    res.json(activity);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/activities', async (req, res) => {
  try {
    const activity = await CRMService.createActivity(req.body);
    res.status(201).json(activity);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/activities/:id', async (req, res) => {
  try {
    const activity = await CRMService.updateActivity(req.params.id, req.body);
    if (!activity) {
      return res.status(404).json({ error: 'Activity not found' });
    }
    res.json(activity);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/activities/:id', async (req, res) => {
  try {
    const result = await CRMService.deleteActivity(req.params.id);
    if (!result) {
      return res.status(404).json({ error: 'Activity not found' });
    }
    res.json({ message: 'Activity deleted successfully' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== PIPELINE STAGES ====================

router.get('/pipeline-stages', async (req, res) => {
  try {
    const stages = await CRMService.getPipelineStages();
    res.json(stages);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/pipeline-stages', async (req, res) => {
  try {
    const stage = await CRMService.createPipelineStage(req.body);
    res.status(201).json(stage);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/pipeline-stages/:id', async (req, res) => {
  try {
    const stage = await CRMService.updatePipelineStage(req.params.id, req.body);
    if (!stage) {
      return res.status(404).json({ error: 'Pipeline stage not found' });
    }
    res.json(stage);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/pipeline-stages/:id', async (req, res) => {
  try {
    const result = await CRMService.deletePipelineStage(req.params.id);
    if (!result) {
      return res.status(404).json({ error: 'Pipeline stage not found' });
    }
    res.json({ message: 'Pipeline stage deleted successfully' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
