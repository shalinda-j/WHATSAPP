import { Router } from 'express';
import multer from 'multer';
import { bulkSenderService } from '../../services/BulkSenderService';
import { authenticateToken } from '../middleware/auth';
import { resolveTenant } from '../middleware/tenantContext';
import { strictRateLimit } from '../middleware/rateLimit';
import { isPhoneOptedOut } from '../../services/optOut';
import {
  isQuietHoursActive,
  tenantQuietHours,
} from '../../services/quietHours';

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

// All bulk routes require authentication
router.use(authenticateToken);
// Resolve the active tenant so /send can honour tenant-wide quiet hours.
router.use(resolveTenant);

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/bulk/send
// Streams NDJSON progress lines so the frontend can show real-time updates.
// Each line is a JSON object:  {"type":"progress","current":1,"total":5,"number":"...","status":"ok"|"error","message":"..."}
// Final line:                  {"type":"done","success":N,"failed":N,"errors":[...]}
// ─────────────────────────────────────────────────────────────────────────────
// FIX M13: Rate-limit bulk send to prevent mass-spam via stolen JWT
router.post(
  '/send',
  strictRateLimit,
  upload.single('media'),
  async (req, res) => {
    try {
      const { recipients, message, delay, sessionId } = req.body;
      let recipientList: string[] = [];

      if (typeof recipients === 'string') {
        try {
          recipientList = JSON.parse(recipients);
        } catch {
          recipientList = recipients
            .split(',')
            .map((s: string) => s.trim())
            .filter(Boolean);
        }
      } else if (Array.isArray(recipients)) {
        recipientList = recipients;
      }

      if (!recipientList || recipientList.length === 0) {
        return res.status(400).json({ error: 'No recipients provided' });
      }

      if (!message && !req.file) {
        return res
          .status(400)
          .json({ error: 'A message or media file is required' });
      }

      // Stream NDJSON progress back to client
      res.setHeader('Content-Type', 'application/x-ndjson');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('X-Accel-Buffering', 'no');

      const write = (obj: object) => {
        try {
          res.write(JSON.stringify(obj) + '\n');
        } catch {
          /* ignore write errors */
        }
      };

      const result = {
        total: recipientList.length,
        success: 0,
        failed: 0,
        skipped: 0,
        errors: [] as { number: string; error: string }[],
      };
      const delayMs = (Number(delay) || 5) * 1000;
      const sid = sessionId || 'default';

      // Compliance gate: tenant-wide quiet hours block the ENTIRE batch,
      // mirroring CampaignService.tickSender which returns { sent: 0 } while
      // the tenant's quiet-hours window is active. Refuse up-front rather than
      // messaging recipients during their muted window. req.tenant is resolved
      // by the resolveTenant middleware registered above.
      if (isQuietHoursActive(tenantQuietHours(req.tenant))) {
        write({
          type: 'done',
          total: result.total,
          success: 0,
          failed: 0,
          skipped: result.total,
          errors: [],
          quietHours: true,
          message:
            'Quiet hours are active for this tenant — bulk send was blocked.',
        });
        return res.end();
      }

      for (let i = 0; i < recipientList.length; i++) {
        const number = recipientList[i];
        const jid = number.includes('@') ? number : `${number}@s.whatsapp.net`;

        try {
          // Compliance gate: never deliver to a contact who replied
          // STOP/UNSUBSCRIBE. isPhoneOptedOut normalises to bare digits, so the
          // raw recipient (digits or JID) resolves to the same identity that
          // CampaignService.tickSender checks before each send. A skipped
          // recipient does NOT consume the inter-send delay because we
          // `continue` before the setTimeout at the bottom of the loop — no
          // message left the socket. Running this inside the existing try means
          // a transient lookup error is counted as a per-recipient failure
          // rather than aborting the whole batch.
          if (await isPhoneOptedOut(number, req.tenant?._id)) {
            result.skipped++;
            write({
              type: 'progress',
              current: i + 1,
              total: result.total,
              number,
              status: 'skipped',
              reason: 'opted_out',
            });
            continue;
          }

          if (req.file) {
            let type: 'image' | 'document' | 'audio' | 'video' = 'document';
            if (req.file.mimetype.startsWith('image/')) type = 'image';
            else if (req.file.mimetype.startsWith('audio/')) type = 'audio';
            else if (req.file.mimetype.startsWith('video/')) type = 'video';

            const { sendMediaMessage } =
              await import('../../services/whatsapp');
            const sent = await sendMediaMessage(
              jid,
              req.file.buffer,
              type,
              {
                caption: message || undefined,
                mimetype: req.file.mimetype,
                fileName: req.file.originalname,
              },
              sid,
            );
            if (!sent)
              throw new Error(
                'WhatsApp not connected — scan the QR code first',
              );
          } else {
            const { sendMessage } = await import('../../services/whatsapp');
            await sendMessage(jid, message, sid);
          }

          result.success++;
          write({
            type: 'progress',
            current: i + 1,
            total: result.total,
            number,
            status: 'ok',
          });
        } catch (err: any) {
          result.failed++;
          const errMsg = err?.message || String(err);
          result.errors.push({ number, error: errMsg });
          write({
            type: 'progress',
            current: i + 1,
            total: result.total,
            number,
            status: 'error',
            error: errMsg,
          });
        }

        if (i < recipientList.length - 1) {
          await new Promise<void>((r) => setTimeout(r, delayMs));
        }
      }

      write({ type: 'done', ...result });
      res.end();
    } catch (error: any) {
      console.error('Bulk Send Error:', error);
      if (!res.headersSent) {
        res.status(500).json({ error: error.message });
      } else {
        try {
          res.write(
            JSON.stringify({ type: 'error', error: error.message }) + '\n',
          );
          res.end();
        } catch {
          /* ignore */
        }
      }
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/bulk/upload-csv
// Fallback server-side CSV parsing (frontend should try this if client-side fails)
// ─────────────────────────────────────────────────────────────────────────────
router.post('/upload-csv', upload.single('file'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const text = req.file.buffer.toString('utf-8');
    const numbers = parseCSVNumbers(text);

    if (numbers.length === 0) {
      return res.status(400).json({
        error:
          'No valid phone numbers found in the file. Make sure the CSV has at least one column with 10+ digit phone numbers.',
      });
    }

    res.json({ numbers, count: numbers.length });
  } catch (error: any) {
    console.error('CSV parse error:', error);
    res.status(500).json({ error: `Failed to parse file: ${error.message}` });
  }
});

/**
 * Parse phone numbers from CSV text.
 * Handles: headers (skipped if not numeric), various separators, international prefixes.
 */
function parseCSVNumbers(csvText: string): string[] {
  const numbers: string[] = [];
  const seen = new Set<string>();

  // Split into rows — handles \r\n and \n
  const rows = csvText.split(/\r?\n/).filter((r) => r.trim().length > 0);

  // Phone column detection (look for a "phone"-like header in row 0)
  let phoneColIndex = -1;
  const firstRow = rows[0]?.toLowerCase() || '';
  const firstRowCells = splitCSVRow(firstRow);
  const headerKeywords = [
    'phone',
    'number',
    'mobile',
    'tel',
    'contact',
    'whatsapp',
  ];
  for (let i = 0; i < firstRowCells.length; i++) {
    if (headerKeywords.some((k) => firstRowCells[i].includes(k))) {
      phoneColIndex = i;
      break;
    }
  }

  // Skip header if we found a phone column keyword
  const startRow = phoneColIndex >= 0 ? 1 : 0;

  for (let rowIdx = startRow; rowIdx < rows.length; rowIdx++) {
    const cells = splitCSVRow(rows[rowIdx]);

    if (phoneColIndex >= 0) {
      // Only read the phone column
      const raw = cells[phoneColIndex];
      const cleaned = cleanPhoneNumber(raw);
      if (cleaned && !seen.has(cleaned)) {
        seen.add(cleaned);
        numbers.push(cleaned);
      }
    } else {
      // Scan all cells for anything that looks like a phone number
      for (const cell of cells) {
        const cleaned = cleanPhoneNumber(cell);
        if (cleaned && !seen.has(cleaned)) {
          seen.add(cleaned);
          numbers.push(cleaned);
        }
      }
    }
  }

  return numbers;
}

function splitCSVRow(row: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < row.length; i++) {
    const ch = row[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if ((ch === ',' || ch === ';' || ch === '\t') && !inQuotes) {
      cells.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  cells.push(current.trim());
  return cells;
}

function cleanPhoneNumber(raw: string): string | null {
  if (!raw) return null;
  const stripped = raw.replace(/\D/g, ''); // Keep digits only
  // Valid phone numbers: 10–15 digits
  if (stripped.length >= 10 && stripped.length <= 15) return stripped;
  return null;
}

export default router;
