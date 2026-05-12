/**
 * Graceful Shutdown Handler
 * Ensures all resources are properly cleaned up before process exit
 */

import { shutdownRateLimiter } from '../server/middleware/rateLimit';

type ShutdownCallback = () => Promise<void> | void;

const shutdownCallbacks: ShutdownCallback[] = [];

/**
 * Register a callback to be called during shutdown
 */
export function registerShutdownCallback(callback: ShutdownCallback): void {
  shutdownCallbacks.push(callback);
}

/**
 * Execute all shutdown callbacks
 */
async function executeShutdownCallbacks(): Promise<void> {
  console.log('\n🛑 Initiating graceful shutdown...');

  for (const callback of shutdownCallbacks) {
    try {
      await callback();
    } catch (err) {
      console.error('Error during shutdown callback:', err);
    }
  }

  // Cleanup rate limiter
  try {
    shutdownRateLimiter();
  } catch (err) {
    console.error('Error cleaning up rate limiter:', err);
  }

  console.log('✅ Graceful shutdown completed');
}

/**
 * Handle process signals
 */
function handleShutdownSignal(signal: string): void {
  console.log(`\nReceived ${signal} signal`);

  // Set a timeout to force exit if graceful shutdown takes too long
  const forceExitTimeout = setTimeout(() => {
    console.error('⚠️ Graceful shutdown timeout, forcing exit');
    process.exit(1);
  }, 10000); // 10 seconds

  executeShutdownCallbacks()
    .then(() => {
      clearTimeout(forceExitTimeout);
      process.exit(0);
    })
    .catch((err) => {
      clearTimeout(forceExitTimeout);
      console.error('❌ Error during graceful shutdown:', err);
      process.exit(1);
    });
}

/**
 * Initialize shutdown handlers
 */
export function initializeShutdownHandlers(): void {
  // Handle SIGTERM (kill command, Kubernetes, etc.)
  process.on('SIGTERM', () => handleShutdownSignal('SIGTERM'));

  // Handle SIGINT (Ctrl+C)
  process.on('SIGINT', () => handleShutdownSignal('SIGINT'));

  // Handle uncaught exceptions
  process.on('uncaughtException', (err) => {
    console.error('❌ Uncaught Exception:', err);
    handleShutdownSignal('uncaughtException');
  });

  // Handle unhandled promise rejections
  process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
    // Don't exit on unhandled rejection in development (let it continue)
    if (process.env.NODE_ENV === 'production') {
      handleShutdownSignal('unhandledRejection');
    }
  });

  console.log('✅ Shutdown handlers initialized');
}

/**
 * Shutdown MongoDB connection
 */
export async function shutdownMongoDB(): Promise<void> {
  const mongoose = await import('mongoose');
  if (mongoose.connection.readyState !== 0) {
    console.log('🔌 Closing MongoDB connection...');
    await mongoose.connection.close();
    console.log('   ✅ MongoDB connection closed');
  }
}

/**
 * Shutdown Socket.io
 */
export async function shutdownSocketIO(): Promise<void> {
  try {
    const { getIO } = await import('../server/socket');
    const io = getIO();
    console.log('🔌 Closing Socket.io connections...');
    io.close(() => {
      console.log('   ✅ Socket.io connections closed');
    });
  } catch {
    // Socket.io not initialized yet, skip
  }
}

/**
 * Shutdown WhatsApp sessions
 */
export async function shutdownWhatsApp(): Promise<void> {
  try {
    const { disconnectWhatsApp } = await import('../services/whatsapp');
    const { HumanizerService } = await import('../services/HumanizerService');
    console.log('📱 Disconnecting WhatsApp sessions...');
    await disconnectWhatsApp();
    HumanizerService.shutdown();
    console.log('   ✅ WhatsApp sessions disconnected');
  } catch (err) {
    console.error('   ⚠️ Error disconnecting WhatsApp:', err);
  }
}

/**
 * Shutdown AI Load Balancer
 */
export async function shutdownAILoadBalancer(): Promise<void> {
  try {
    const { aiLoadBalancer } = await import('../services/AILoadBalancer');
    console.log('🤖 Shutting down AI Load Balancer...');
    aiLoadBalancer.shutdown();
    console.log('   ✅ AI Load Balancer shutdown complete');
  } catch (err) {
    console.error('   ⚠️ Error shutting down AI Load Balancer:', err);
  }
}
