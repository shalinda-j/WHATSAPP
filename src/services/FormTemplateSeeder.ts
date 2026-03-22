import FormTemplate from '../models/FormTemplate';

/**
 * Seed default form template for registration
 * NOTE: Job types and countries are pulled from Datasets at runtime
 * Configure via Admin Panel > Datasets > JOB_TYPES and COUNTRIES
 */
export async function seedDefaultFormTemplate(): Promise<void> {
  try {
    // Check if any template exists
    const existingCount = await FormTemplate.countDocuments();
    if (existingCount > 0) {
      console.log('📋 Form templates already exist, skipping seed');
      return;
    }

    // Create default registration form
    // Options for job_type and country are pulled from Datasets at runtime
    const defaultTemplate = new FormTemplate({
      name: 'Default Registration Form',
      description: 'Standard registration form for job applicants - Configure JOB_TYPES and COUNTRIES in Admin Panel > Datasets',
      isActive: true,
      isDefault: true,
      triggerMode: 'both', // Can be triggered manually (!register) or automatically
      triggerDelay: 10, // 10 seconds delay for auto-trigger
      welcomeMessage: '📋 Welcome! Let\'s get you registered. Please answer the following questions.',
      completionMessage: '✅ Thank you! Your registration has been submitted successfully. We will contact you soon!',
      fields: [
        {
          id: 'full_name',
          type: 'text',
          label: 'Full Name',
          placeholder: 'John Doe',
          required: true,
          order: 1,
          validation: {
            minLength: 2,
            maxLength: 100
          }
        },
        {
          id: 'age',
          type: 'number',
          label: 'Age',
          placeholder: '25',
          required: true,
          order: 2,
          validation: {
            min: 18,
            max: 70
          }
        },
        {
          id: 'phone',
          type: 'phone',
          label: 'Phone Number',
          placeholder: '+94 77 123 4567',
          required: true,
          order: 3
        },
        {
          id: 'country',
          type: 'select',
          label: 'Which country are you interested in working?',
          required: true,
          order: 4,
          // Options pulled from Datasets > COUNTRIES at runtime
          options: [],
          _dataSource: 'COUNTRIES' // Indicates this field should use dataset
        },
        {
          id: 'experience',
          type: 'select',
          label: 'Years of Experience',
          required: true,
          order: 5,
          // Options pulled from Datasets > EXPERIENCE_LEVELS at runtime
          options: [],
          _dataSource: 'EXPERIENCE_LEVELS'
        },
        {
          id: 'job_type',
          type: 'select',
          label: 'What type of job are you interested in?',
          required: true,
          order: 6,
          // Options pulled from Datasets > JOB_TYPES at runtime
          options: [],
          _dataSource: 'JOB_TYPES'
        },
        {
          id: 'cv_link',
          type: 'text',
          label: 'CV Link (Google Drive, Dropbox, etc.)',
          placeholder: 'https://drive.google.com/...',
          required: false,
          order: 7
        }
      ]
    });

    await defaultTemplate.save();
    console.log('✅ Default registration form template seeded successfully');
    console.log('   ⚠️ IMPORTANT: Configure JOB_TYPES, COUNTRIES, and EXPERIENCE_LEVELS in Admin Panel > Datasets');
  } catch (error) {
    console.error('❌ Error seeding default form template:', error);
  }
}

export default seedDefaultFormTemplate;