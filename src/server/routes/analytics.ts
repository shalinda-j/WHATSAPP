import { Router } from 'express';
import ChatMessage from '../../models/ChatMessage';
import Lead from '../../models/Lead';
import { authenticateToken } from '../middleware/auth';

const router = Router();

router.use(authenticateToken);

router.get('/overview', async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const weekAgo = new Date(today);
    weekAgo.setDate(weekAgo.getDate() - 7);

    const monthAgo = new Date(today);
    monthAgo.setMonth(monthAgo.getMonth() - 1);

    const [
      totalMessages,
      todayMessages,
      weekMessages,
      monthMessages,
      uniqueUsers,
      voiceMessages,
      textMessages,
      botMessages,
      userMessages
    ] = await Promise.all([
      ChatMessage.countDocuments(),
      ChatMessage.countDocuments({ timestamp: { $gte: today } }),
      ChatMessage.countDocuments({ timestamp: { $gte: weekAgo } }),
      ChatMessage.countDocuments({ timestamp: { $gte: monthAgo } }),
      ChatMessage.distinct('userId'),
      ChatMessage.countDocuments({ type: 'voice' }),
      ChatMessage.countDocuments({ type: 'text' }),
      ChatMessage.countDocuments({ role: 'assistant' }),
      ChatMessage.countDocuments({ role: 'user' })
    ]);

    const userCount = uniqueUsers.length;

    res.json({
      totalMessages,
      todayMessages,
      weekMessages,
      monthMessages,
      totalUsers: userCount,
      voiceMessages,
      textMessages,
      botMessages,
      userMessages,
      avgMessagesPerUser: userCount > 0 ? (totalMessages / userCount).toFixed(1) : 0
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/questions', async (req, res) => {
  try {
    const { limit = 20 } = req.query;

    const userMessages = await ChatMessage.find({ role: 'user' })
      .sort({ timestamp: -1 })
      .limit(Number(limit));

    const questionCounts: Record<string, number> = {};
    const keywordsMap: Record<string, string[]> = {
      'jobs': ['job', 'work', 'employment', 'vacancy', 'hire', 'recruit', 'jobs'],
      'register': ['register', 'apply', 'sign up', 'join', 'cv', 'registration'],
      'payment': ['payment', 'pay', 'salary', 'wage', 'bank', 'account'],
      'booking': ['book', 'visit', 'appointment', 'schedule', 'meeting', 'time'],
      'location': ['address', 'location', 'where', 'branch', 'office', 'map'],
      'services': ['service', 'what do you do', 'help', 'information', 'details'],
      'hello': ['hello', 'hi', 'hey', 'good morning', 'good afternoon'],
      'language': ['sinhala', 'english', 'tamil', 'translate']
    };

    for (const msg of userMessages) {
      const content = msg.content.toLowerCase();
      for (const [category, keywords] of Object.entries(keywordsMap)) {
        if (keywords.some(k => content.includes(k))) {
          questionCounts[category] = (questionCounts[category] || 0) + 1;
          break;
        }
      }
    }

    const sortedQuestions = Object.entries(questionCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);

    res.json({
      categories: sortedQuestions.map(([category, count]) => ({ category, count })),
      totalQuestions: userMessages.length
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/trends', async (req, res) => {
  try {
    const { days = 7 } = req.query;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - Number(days));
    startDate.setHours(0, 0, 0, 0);

    const messagesByDay = await ChatMessage.aggregate([
      {
        $match: {
          timestamp: { $gte: startDate },
          role: 'user'
        }
      },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } },
          count: { $sum: 1 },
          uniqueUsers: { $addToSet: '$userId' }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    const usersByDay = messagesByDay.map(item => ({
      date: item._id,
      messages: item.count,
      users: item.uniqueUsers.length
    }));

    res.json(usersByDay);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/datasets', async (req, res) => {
  try {
    const Dataset = (await import('../../models/Dataset')).default;

    const datasets = await Dataset.find({ isActive: true })
      .sort({ updatedAt: -1 })
      .limit(10);

    const totalRecords = datasets.reduce((sum, ds) => sum + (ds.content?.length || 0), 0);

    res.json({
      datasets: datasets.map(ds => ({
        id: ds._id,
        name: ds.name || 'Unnamed Dataset',
        contentLength: ds.content?.length || 0,
        updatedAt: ds.updatedAt
      })),
      totalRecords
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/leads', async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const weekAgo = new Date(today);
    weekAgo.setDate(weekAgo.getDate() - 7);

    const [
      totalLeads,
      weekLeads,
      byStatus,
      byJobType
    ] = await Promise.all([
      Lead.countDocuments(),
      Lead.countDocuments({ registeredAt: { $gte: weekAgo } }),
      Lead.aggregate([
        { $group: { _id: '$status', count: { $sum: 1 } } }
      ]),
      Lead.aggregate([
        { $group: { _id: '$jobVacancyType', count: { $sum: 1 } } }
      ])
    ]);

    res.json({
      totalLeads,
      weekLeads,
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

router.get('/top-questions', async (req, res) => {
  try {
    const { limit = 50 } = req.query;

    const userMessages = await ChatMessage.find({ role: 'user', type: 'text' })
      .sort({ timestamp: -1 })
      .limit(Number(limit) * 2);

    const messageCounts: Record<string, number> = {};

    for (const msg of userMessages) {
      const content = msg.content.trim().toLowerCase();
      if (content.length > 2 && content.length < 200) {
        const key = msg.content.trim();
        messageCounts[key] = (messageCounts[key] || 0) + 1;
      }
    }

    const topQuestions = Object.entries(messageCounts)
      .filter(([_, count]) => count >= 1)
      .sort((a, b) => b[1] - a[1])
      .slice(0, Number(limit))
      .map(([question, count]) => ({ question, count }));

    res.json(topQuestions);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
