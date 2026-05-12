# Deployment Skill

Procedures for deploying the WhatsApp AI Bot to production.

## Triggers
- User asks about deployment or production setup
- User wants to configure environment for production
- User needs help with MongoDB Atlas or server setup

## Pre-Deployment Checklist

### Environment Variables
```bash
# Required
MONGODB_URI=mongodb+srv://user:pass@cluster.mongodb.net/db?retryWrites=true&w=majority
JWT_SECRET=<32+ character secret>
ENCRYPTION_KEY=<exactly 32 characters>

# AI Providers (at least one)
GEMINI_API_KEY=<key>
OPENAI_API_KEY=<key>
GROQ_API_KEY=<key>
OPENROUTER_API_KEY=<key>

# Server
PORT=8080
NODE_ENV=production
```

### MongoDB Atlas Setup
1. Create cluster (M0 Sandbox for free tier)
2. Create database user with read/write permissions
3. **Add server IP to whitelist** (or use 0.0.0.0/0 for all IPs)
4. Get connection string from Atlas dashboard
5. Test connection before deploying

### Security Requirements
- JWT_SECRET: Minimum 32 characters, unique per deployment
- ENCRYPTION_KEY: Exactly 32 characters for AES encryption
- Never commit `.env` to git
- Use environment secrets in deployment platform

## Build Process

```bash
# Install dependencies
npm install

# Build frontend and backend
npm run build

# Verify build
ls dist/         # Backend compiled JS
ls client/dist/  # Frontend static files
```

## Deployment Options

### Option 1: DigitalOcean Droplet
```bash
# On droplet
git clone <repo>
cd WHATSAPP
npm install
npm run build

# Create .env
nano .env

# Start with PM2
npm install -g pm2
pm2 start dist/index.js --name whatsapp-bot
pm2 save
pm2 startup
```

### Option 2: Heroku
```bash
# Create app
heroku create whatsapp-bot

# Set env vars
heroku config:set MONGODB_URI=<uri>
heroku config:set JWT_SECRET=<secret>
# ... etc

# Deploy
git push heroku main
```

### Option 3: Vercel/Render
- Set environment variables in dashboard
- Configure build command: `npm run build`
- Configure start command: `npm run start`

## Post-Deployment

### Health Check
```bash
curl https://your-domain.com/health

# Expected response
{
  "status": "ok",
  "database": {
    "status": "connected",
    "readyState": 1
  }
}
```

### WhatsApp QR Scan
1. Open Admin Panel: `https://your-domain.com`
2. Login with admin credentials
3. Navigate to Sessions page
4. Scan QR code with WhatsApp mobile app
5. Verify "Connected" status

### Monitoring
- Check logs for emoji markers (✅, ❌, ⚠️)
- Monitor `/health` endpoint
- Watch AI provider usage in Admin Panel → Config
- Check message processing in Chat page

## Troubleshooting

### Database 503 Error
- Check MongoDB Atlas IP whitelist
- Verify connection string format
- Check database user credentials

### WhatsApp Conflict (440)
- Normal during rolling deployments
- Auto-handled with exponential backoff
- Wait 30-60 seconds for reconnection

### AI Provider Rate Limited
- Load balancer falls back to next provider
- Check API quotas in provider dashboard
- Add additional providers for redundancy

### Session Won't Connect
1. Delete session from Admin Panel
2. Wait 10 seconds
3. Create new session
4. Scan new QR code