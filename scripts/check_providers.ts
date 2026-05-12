import * as dotenv from 'dotenv';
dotenv.config();

import mongoose from 'mongoose';
import Config from '../src/models/Config';

async function checkProviders() {
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) {
    console.error('MONGODB_URI environment variable is not set');
    process.exit(1);
  }
  await mongoose.connect(mongoUri);
  console.log('Connected to MongoDB');

  const providers = await Config.find({ isProvider: true });
  console.log('AI Providers in DB:', providers.length);
  providers.forEach((p) => {
    console.log(
      `  - ${p.providerType}: active=${p.isActive}, model=${p.aiModel}`,
    );
  });

  await mongoose.disconnect();
}

checkProviders().catch(console.error);
