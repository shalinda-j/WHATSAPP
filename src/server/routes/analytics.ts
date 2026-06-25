import { Router } from 'express';
import ChatMessage from '../../models/ChatMessage';
import Lead from '../../models/Lead';
import Booking from '../../models/Booking';
import { authenticateToken } from '../middleware/auth';
import { resolveTenant, withTenantScope } from '../middleware/tenantContext';

const router = Router();

router.use(authenticateToken);
router.use(resolveTenant);

// ⚡ Bolt: Precompile regexes for /questions categorization to avoid O(M*N) CPU bottleneck
// and unnecessary garbage collection overhead during the request loop. We intentionally
// avoid word boundaries to preserve the original substring matching logic.
const QUESTION_KEYWORDS = {
  jobs: ['job', 'work', 'employment', 'vacancy', 'hire', 'recruit', 'jobs'],
  register: ['register', 'apply', 'sign up', 'join', 'cv', 'registration'],
  payment: ['payment', 'pay', 'salary', 'wage', 'bank', 'account'],
  booking: ['book', 'visit', 'appointment', 'schedule', 'meeting', 'time'],
  location: ['address', 'location', 'where', 'branch', 'office', 'map'],
  services: ['service', 'what do you do', 'help', 'information', 'details'],
  hello: ['hello', 'hi', 'hey', 'good morning', 'good afternoon'],
  language: ['sinhala', 'english', 'tamil', 'translate'],
};

const COMPILED_KEYWORDS = Object.entries(QUESTION_KEYWORDS).map(
  ([category, words]) => ({
    category,
    regex: new RegExp(
      words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'),
      'i',
    ),
  }),
);

router.get('/', async (req, res) => {
  try {
    // Determine counts for VoiceAgentHub stats
    const [totalVoiceNotes, totalCallsRejected] = await Promise.all([
      ChatMessage.countDocuments(withTenantScope(req, { type: 'voice' })),
      // Our rejection data is not explicitly stored in ChatMessage differently, but
      // let's look for known rejections or just use a default placeholder or query
      // Alternatively, assuming text messages warning about calls
      ChatMessage.countDocuments(
        withTenantScope(req, {
          role: 'assistant',
          content: { $regex: /voice message/i },
        }),
      ),
    ]);

    res.json({
      totalVoiceNotes,
      totalCallsRejected: totalCallsRejected || 0,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

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
      userMessages,
      totalCallsRejected,
    ] = await Promise.all([
      ChatMessage.countDocuments(withTenantScope(req, {})),
      ChatMessage.countDocuments(
        withTenantScope(req, { timestamp: { $gte: today } }),
      ),
      ChatMessage.countDocuments(
        withTenantScope(req, { timestamp: { $gte: weekAgo } }),
      ),
      ChatMessage.countDocuments(
        withTenantScope(req, { timestamp: { $gte: monthAgo } }),
      ),
      // distinct('userId') can't take the legacy-tolerant $or clause, so we
      // run an aggregate with a tenant-scoped $match stage instead.
      ChatMessage.aggregate([
        { $match: withTenantScope(req, {}) },
        { $group: { _id: '$userId' } },
      ]),
      ChatMessage.countDocuments(withTenantScope(req, { type: 'voice' })),
      ChatMessage.countDocuments(withTenantScope(req, { type: 'text' })),
      ChatMessage.countDocuments(withTenantScope(req, { role: 'assistant' })),
      ChatMessage.countDocuments(withTenantScope(req, { role: 'user' })),
      // Count messages that mention call rejection (bot telling user to send voice note instead)
      ChatMessage.countDocuments(
        withTenantScope(req, {
          role: 'assistant',
          $or: [
            { content: { $regex: /voice note/i } },
            { content: { $regex: /voice message/i } },
            { content: { $regex: /cannot.*call/i } },
            { content: { $regex: /send a voice/i } },
          ],
        }),
      ),
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
      totalCallsRejected,
      avgMessagesPerUser:
        userCount > 0 ? (totalMessages / userCount).toFixed(1) : 0,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/questions', async (req, res) => {
  try {
    const { limit = 20 } = req.query;

    // ⚡ Bolt: Use .lean() with .select() to minimize memory footprint
    // Only 'content' is used, avoiding hydration of unnecessary Mongoose document fields
    const userMessages = await ChatMessage.find(
      withTenantScope(req, { role: 'user' }),
    )
      .select('content -_id')
      .sort({ timestamp: -1 })
      .limit(Number(limit))
      .lean();

    const questionCounts: Record<string, number> = {};

    for (const msg of userMessages) {
      const content = msg.content;
      for (const { category, regex } of COMPILED_KEYWORDS) {
        if (regex.test(content)) {
          questionCounts[category] = (questionCounts[category] || 0) + 1;
          break;
        }
      }
    }

    const sortedQuestions = Object.entries(questionCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);

    res.json({
      categories: sortedQuestions.map((item: any) => ({
        category: item[0],
        count: item[1],
      })),
      totalQuestions: userMessages.length,
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
        $match: withTenantScope(req, {
          timestamp: { $gte: startDate },
          role: 'user',
        }),
      },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } },
          count: { $sum: 1 },
          uniqueUsers: { $addToSet: '$userId' },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    const usersByDay = messagesByDay.map((item: any) => ({
      date: item._id,
      messages: item.count,
      users: item.uniqueUsers.length,
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
      .limit(10)
      .lean();

    const mappedDatasets = datasets.map((ds: any) => {
      const content = ds.content as string | Record<string, unknown> | null;
      let contentLength = 0;
      if (typeof content === 'string') {
        contentLength = content.length;
      } else if (content && typeof content === 'object') {
        // Use a for...in loop with hasOwnProperty check instead of Object.keys().length
        // to avoid memory overhead of allocating a large array of keys just to count them
        let count = 0;
        for (const key in content) {
          if (Object.prototype.hasOwnProperty.call(content, key)) {
            count++;
          }
        }
        contentLength = count;
      }
      return {
        id: ds._id,
        name: ds.name || 'Unnamed Dataset',
        contentLength,
        updatedAt: ds.updatedAt,
      };
    });

    const totalRecords = mappedDatasets.reduce(
      (sum, ds) => sum + ds.contentLength,
      0,
    );

    res.json({
      datasets: mappedDatasets,
      totalRecords,
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

    // Tenant scope: only this tenant's leads (plus legacy rows with no
    // tenantId, so single-tenant / pre-migration data still counts).
    const tid = (req as any).tenant?._id;
    const tenantScope: Record<string, any> = tid
      ? {
          $or: [
            { tenantId: tid },
            { tenantId: { $exists: false } },
            { tenantId: null },
          ],
        }
      : {};

    const [totalLeads, weekLeads, byStatus, byJobType] = await Promise.all([
      Lead.countDocuments(tenantScope),
      Lead.countDocuments({
        ...tenantScope,
        registeredAt: { $gte: weekAgo },
      }),
      Lead.aggregate([
        { $match: tenantScope },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
      Lead.aggregate([
        { $match: tenantScope },
        { $group: { _id: '$jobVacancyType', count: { $sum: 1 } } },
      ]),
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
      }, {}),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/top-questions', async (req, res) => {
  try {
    const { limit = 50 } = req.query;

    const limitNum = Number(limit);

    // ⚡ Bolt: Use lean() and precise selection to minimize memory footprint
    // Instead of instantiating full Mongoose documents which are memory heavy,
    // we use lean() to get pure JS objects and only select the needed 'content' field.
    const userMessages = await ChatMessage.find(
      withTenantScope(req, { role: 'user', type: 'text' }),
    )
      .select('content -_id')
      .sort({ timestamp: -1 })
      .limit(Number(limit) * 2)
      .lean();

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
      .slice(0, limitNum)
      .map(([question, count]) => ({ question, count }));

    res.json(topQuestions);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Bookings ───────────────────────────────────────────────────────────────

router.get('/bookings', async (req, res) => {
  try {
    const { year, month } = req.query as { year?: string; month?: string };

    const query: Record<string, any> = {};
    if (year && month) {
      const y = parseInt(year, 10);
      const m = parseInt(month, 10) - 1; // 0-indexed
      // UTC bounds: booking dates are stored as UTC instants, so building
      // the range in the server's local timezone would clip bookings at
      // month edges whenever the server isn't running UTC.
      const start = new Date(Date.UTC(y, m, 1));
      const end = new Date(Date.UTC(y, m + 1, 0, 23, 59, 59, 999));
      query.date = { $gte: start, $lte: end };
    }

    // Tenant scope: only this tenant's bookings (plus legacy rows with no
    // tenantId, so single-tenant / pre-migration data still shows up).
    const tenantId = (req as any).tenant?._id;
    if (tenantId) {
      query.$or = [{ tenantId }, { tenantId: { $exists: false } }];
    }

    const bookings = await Booking.find(query).sort({ date: 1 }).lean();
    res.json({ bookings });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/bookings', async (req, res) => {
  try {
    const {
      clientName,
      clientPhone,
      clientEmail,
      date,
      time,
      duration,
      type,
      notes,
      sessionId,
      location,
    } = req.body;

    if (!clientName || !clientPhone || !date) {
      return res
        .status(400)
        .json({ error: 'clientName, clientPhone, and date are required' });
    }

    // Anchor the calendar day in UTC. Parsing 'YYYY-MM-DD' with new Date()
    // then setHours() bakes the SERVER's timezone into the stored instant,
    // which shifts the booking onto the wrong day when the admin's browser
    // is in a different timezone. UTC on both ends keeps the day stable.
    const [yy, mm, dd] = String(date)
      .split('T')[0]
      .split('-')
      .map((v: string) => parseInt(v, 10));
    if (!yy || !mm || !dd) {
      return res.status(400).json({ error: 'Invalid date format' });
    }
    const dateObj = new Date(Date.UTC(yy, mm - 1, dd));
    if (time) {
      const [h, m] = String(time).split(':').map(Number);
      dateObj.setUTCHours(h || 0, m || 0, 0, 0);
    }

    const booking = await Booking.create({
      clientName,
      clientPhone,
      clientEmail,
      date: dateObj,
      time,
      duration: duration || 60,
      type: type || 'Consultation',
      notes,
      sessionId,
      location,
      status: 'confirmed',
      tenantId: (req as any).tenant?._id,
    });

    res.status(201).json(booking);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/bookings/:id', async (req, res) => {
  try {
    const { status, notes, type, time, location } = req.body;
    const tid = (req as any).tenant?._id;
    const scope: Record<string, any> = tid
      ? {
          _id: req.params.id,
          $or: [
            { tenantId: tid },
            { tenantId: { $exists: false } },
            { tenantId: null },
          ],
        }
      : { _id: req.params.id };
    const booking = await Booking.findOneAndUpdate(
      scope,
      {
        ...(status && { status }),
        ...(notes !== undefined && { notes }),
        ...(type && { type }),
        ...(time && { time }),
        ...(location && { location }),
      },
      { new: true },
    ).lean();

    if (!booking) {
      return res.status(404).json({ error: 'Booking not found' });
    }
    res.json(booking);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/bookings/:id', async (req, res) => {
  try {
    const tid = (req as any).tenant?._id;
    const scope: Record<string, any> = tid
      ? {
          _id: req.params.id,
          $or: [
            { tenantId: tid },
            { tenantId: { $exists: false } },
            { tenantId: null },
          ],
        }
      : { _id: req.params.id };
    const deleted = await Booking.findOneAndDelete(scope);
    if (!deleted) {
      return res.status(404).json({ error: 'Booking not found' });
    }
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Recent Replies ──────────────────────────────────────────────────────────

router.get('/recent-replies', async (req, res) => {
  try {
    const { limit = 10 } = req.query;

    // Fetch the absolute newest messages where the bot has replied
    const recentReplies = await ChatMessage.find(
      withTenantScope(req, { role: 'assistant' }),
    )
      .sort({ timestamp: -1 })
      .limit(Number(limit))
      .lean();

    res.json(
      recentReplies.map((reply: any) => ({
        id: reply._id,
        content: reply.content,
        type: reply.type,
        timestamp: reply.timestamp,
        metadata: reply.metadata,
      })),
    );
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
