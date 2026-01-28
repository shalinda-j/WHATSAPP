import mongoose from 'mongoose';
import bcrypt from 'bcrypt';
import dotenv from 'dotenv';
import Admin from './src/models/Admin';

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
    console.error('❌ MONGODB_URI is not defined in .env');
    process.exit(1);
}

const seedAdmin = async () => {
    try {
        await mongoose.connect(MONGODB_URI, {
            serverApi: {
                version: '1',
                strict: true,
                deprecationErrors: true,
            }
        });
        console.log('✅ Connected to MongoDB');

        const adminCount = await Admin.countDocuments();

        if (adminCount > 0) {
            console.log('⚠️ Admin user already exists.');
            // Ideally we shouldn't reveal existing passwords, but for dev we might reset or just notify.
            // But the user asked for credentials. If they exist and are unknown, we might need to reset.
            // For now, let's just create a NEW one if "admin" doesn't exist, or reset "admin".

            const defaultAdmin = await Admin.findOne({ username: 'admin' });
            if (defaultAdmin) {
                console.log('ℹ️ User "admin" exists. Resetting password to "admin123"...');
                const hashedPassword = await bcrypt.hash('admin123', 10);
                defaultAdmin.passwordHash = hashedPassword;
                await defaultAdmin.save();
                console.log('✅ Password reset for "admin".');
                console.log('👤 Username: admin');
                console.log('cw Password: admin123');
            } else {
                console.log('ℹ️ User "admin" does not exist. Creating...');
                const hashedPassword = await bcrypt.hash('admin123', 10);
                const newAdmin = new Admin({
                    username: 'admin',
                    passwordHash: hashedPassword,
                    role: 'superadmin'
                });
                await newAdmin.save();
                console.log('✅ Admin user created.');
                console.log('👤 Username: admin');
                console.log('🔑 Password: admin123');
            }

        } else {
            console.log('ℹ️ No admins found. Creating default admin...');
            const hashedPassword = await bcrypt.hash('admin123', 10);
            const newAdmin = new Admin({
                username: 'admin',
                passwordHash: hashedPassword,
                role: 'superadmin'
            });

            await newAdmin.save();
            console.log('✅ Admin user created.');
            console.log('👤 Username: admin');
            console.log('🔑 Password: admin123');
        }

    } catch (error) {
        console.error('❌ Error seeding admin:', error);
    } finally {
        await mongoose.disconnect();
        process.exit(0);
    }
};

seedAdmin();
