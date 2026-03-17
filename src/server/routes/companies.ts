import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { CompanyConfig } from '../../config/types';
import { createCompanyConfig } from '../../config/companies';

const router = Router();
const STORAGE_DIR = path.join(__dirname, '../../config/companies/data');

// Ensure storage directory exists
if (!fs.existsSync(STORAGE_DIR)) {
  fs.mkdirSync(STORAGE_DIR, { recursive: true });
}

/**
 * Get all available companies
 */
router.get('/', async (req, res) => {
  try {
    const companies: { id: string; name: string }[] = [];

    // 1. Load from files
    if (fs.existsSync(STORAGE_DIR)) {
      const files = fs
        .readdirSync(STORAGE_DIR)
        .filter((f) => f.endsWith('.json'));
      for (const file of files) {
        try {
          const content = fs.readFileSync(
            path.join(STORAGE_DIR, file),
            'utf-8',
          );
          const config = JSON.parse(content) as CompanyConfig;
          companies.push({ id: config.id, name: config.name });
        } catch (e) {
          console.error(`Error reading company config ${file}:`, e);
        }
      }
    }

    // 2. Add default/hardcoded ones if not present
    // This is optional if we want to migrate everything to files eventually
    // For now, let's just return what we find in files + the default 'default'
    if (!companies.find((c) => c.id === 'default')) {
      companies.push({ id: 'default', name: 'Default Company' });
    }

    // Add legacy ones from the static list in index.ts if not present?
    // The static list in index.ts is private, so we can't easily access it without exporting it.
    // For this iteration, let's rely on the file system ones + default.
    // If the user needs the old hardcoded ones (TechCorp etc) to appear, they should be migrated or added manually.
    // OR we can expose the list from index.ts.
    // Let's stick to the file system for "new" dynamic companies.

    res.json(companies);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Create a new company
 */
router.post('/', async (req, res) => {
  try {
    const { name } = req.body;
    if (!name)
      return res.status(400).json({ message: 'Company name is required' });

    // Generate ID
    const id = name.toLowerCase().replace(/[^a-z0-9]/g, '-');
    const filePath = path.join(STORAGE_DIR, `${id}.json`);

    if (fs.existsSync(filePath)) {
      return res
        .status(409)
        .json({ message: 'Company with this name/ID already exists' });
    }

    // Generate default config
    // We use the existing createCompanyConfig to get a template, then override ID and Name
    // This assumes createCompanyConfig returns a valid object structure we can save
    const template = createCompanyConfig(id);

    // Customize the template for the new company
    const newConfig: CompanyConfig = {
      ...template,
      id,
      name,
      // We can customize other fields here if needed in the future
    };

    // Remove functions (getSystemPrompt) before saving to JSON
    const configToSave = { ...newConfig } as Record<string, unknown>;
    delete configToSave.getSystemPrompt;

    fs.writeFileSync(filePath, JSON.stringify(configToSave, null, 2));

    res.status(201).json({ id, name });
  } catch (err: any) {
    console.error('Error creating company:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
