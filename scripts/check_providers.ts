import * as dotenv from 'dotenv';
dotenv.config();

import mongoose from 'mongoose';
import Config from '../src/models/Config';

async function checkProviders() {
  await mongoose.connect(process.env.MONGODB_URI!);
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
